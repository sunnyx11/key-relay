use std::sync::{
    atomic::{AtomicBool, AtomicU8, Ordering},
    Arc,
};

/// Shared callback flags. The stop latch closes the queue-to-send race.
#[derive(Default)]
pub struct Signals {
    pub phase: AtomicU8,
    pub stop: AtomicBool,
    pub mouse_buttons: AtomicU8,
}

/// Hook events carry only keys needed for state decisions, never typed text.
#[derive(Clone, Copy, Debug)]
pub enum HookEvent {
    Key { vk: u32, down: bool },
    MouseDown { click: Option<super::target::Click> },
    MouseUp,
}

struct Tracker {
    signals: Arc<Signals>,
}
impl Tracker {
    fn mouse(&self, button: u8, down: bool) {
        if down {
            self.signals
                .mouse_buttons
                .fetch_or(button, Ordering::SeqCst);
            if matches!(self.signals.phase.load(Ordering::SeqCst), 2..=3) {
                self.signals.stop.store(true, Ordering::SeqCst);
            }
        } else {
            self.signals
                .mouse_buttons
                .fetch_and(!button, Ordering::SeqCst);
        }
    }
    fn key(&self, vk: u32, down: bool, injected: bool, marker: usize) -> Option<HookEvent> {
        if vk != 27 || !down || (injected && marker == super::input::INPUT_MARKER) {
            return None;
        }
        if matches!(self.signals.phase.load(Ordering::SeqCst), 2..=3) {
            self.signals.stop.store(true, Ordering::SeqCst);
        }
        Some(HookEvent::Key { vk, down })
    }
}

use std::{
    cell::RefCell,
    sync::mpsc,
    thread::{self, JoinHandle},
};
use windows::Win32::{
    Foundation::{LPARAM, LRESULT, WPARAM},
    System::{LibraryLoader::GetModuleHandleW, Threading::GetCurrentThreadId},
    UI::WindowsAndMessaging::*,
};

type EventSink = Box<dyn Fn(HookEvent)>;
thread_local! { static CONTEXT: RefCell<Option<(Tracker, EventSink)>> = const { RefCell::new(None) }; }

unsafe extern "system" fn keyboard(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let event = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        let down = matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
        CONTEXT.with(|context| {
            if let Some((tracker, sink)) = context.borrow().as_ref() {
                if let Some(event) = tracker.key(
                    event.vkCode,
                    down,
                    event.flags.contains(LLKHF_INJECTED),
                    event.dwExtraInfo,
                ) {
                    sink(event);
                }
            }
        });
    }
    CallNextHookEx(None, code, wparam, lparam)
}
unsafe extern "system" fn mouse(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let event = &*(lparam.0 as *const MSLLHOOKSTRUCT);
        if event.flags & LLMHF_INJECTED != 0 && event.dwExtraInfo == super::input::INPUT_MARKER {
            return CallNextHookEx(None, code, wparam, lparam);
        }
        let button = match wparam.0 as u32 {
            WM_LBUTTONDOWN | WM_LBUTTONUP => 1,
            WM_RBUTTONDOWN | WM_RBUTTONUP => 2,
            WM_MBUTTONDOWN | WM_MBUTTONUP => 4,
            WM_XBUTTONDOWN | WM_XBUTTONUP => {
                if event.mouseData >> 16 == 1 {
                    8
                } else {
                    16
                }
            }
            _ => 0,
        };
        if button != 0 {
            let down = matches!(
                wparam.0 as u32,
                WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_XBUTTONDOWN
            );
            CONTEXT.with(|context| {
                if let Some((tracker, sink)) = context.borrow().as_ref() {
                    tracker.mouse(button, down);
                    sink(if down {
                        HookEvent::MouseDown {
                            click: (button == 1
                                && event.flags & LLMHF_INJECTED == 0
                                && tracker.signals.phase.load(Ordering::SeqCst) == 0)
                                .then(|| super::target::clicked_window(event.pt.x, event.pt.y)),
                        }
                    } else {
                        HookEvent::MouseUp
                    });
                }
            });
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

/// Owns the hook thread and uninstalls both hooks when stopped.
pub struct Hooks {
    id: u32,
    thread: Option<JoinHandle<()>>,
}
impl Hooks {
    /// Start both global hooks; errors prevent input tasks from being enabled.
    pub fn start(
        signals: Arc<Signals>,
        sink: impl Fn(HookEvent) + Send + 'static,
    ) -> Result<Self, String> {
        let (tx, rx) = mpsc::sync_channel(1);
        let handle = thread::spawn(move || unsafe {
            if let Err(error) = super::target::use_physical_coordinates() {
                let _ = tx.send(Err(error));
                return;
            }
            let mut msg = MSG::default();
            let _ = PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE);
            CONTEXT.with(|context| {
                *context.borrow_mut() = Some((Tracker { signals }, Box::new(sink)))
            });
            let module = GetModuleHandleW(None).ok().map(Into::into);
            let keyboard_hook = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard), module, 0) {
                Ok(hook) => hook,
                Err(_) => {
                    let _ = tx.send(Err("键盘监听安装失败。".to_string()));
                    return;
                }
            };
            let mouse_hook = match SetWindowsHookExW(WH_MOUSE_LL, Some(mouse), module, 0) {
                Ok(hook) => hook,
                Err(_) => {
                    let _ = UnhookWindowsHookEx(keyboard_hook);
                    let _ = tx.send(Err("鼠标监听安装失败。".to_string()));
                    return;
                }
            };
            let _ = tx.send(Ok(GetCurrentThreadId()));
            while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            let _ = UnhookWindowsHookEx(mouse_hook);
            let _ = UnhookWindowsHookEx(keyboard_hook);
            CONTEXT.with(|context| *context.borrow_mut() = None);
        });
        match rx.recv().map_err(|_| "监听线程启动失败。".to_string())? {
            Ok(id) => Ok(Self {
                id,
                thread: Some(handle),
            }),
            Err(error) => {
                let _ = handle.join();
                Err(error)
            }
        }
    }
    /// Request shutdown and wait until system hooks have been removed.
    pub fn stop(&mut self) {
        if let Some(handle) = self.thread.take() {
            unsafe {
                let _ = PostThreadMessageW(self.id, WM_QUIT, WPARAM(0), LPARAM(0));
            }
            let _ = handle.join();
        }
    }
}
impl Drop for Hooks {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::windows::input::INPUT_MARKER;
    #[test]
    fn mouse_gesture_remains_blocked_until_release() {
        let signals = Arc::new(Signals::default());
        signals.phase.store(3, Ordering::SeqCst);
        let tracker = Tracker {
            signals: signals.clone(),
        };
        tracker.mouse(1, true);
        tracker.mouse(2, true);
        assert!(signals.stop.load(Ordering::SeqCst));
        assert_eq!(signals.mouse_buttons.load(Ordering::SeqCst), 3);
        signals.phase.store(0, Ordering::SeqCst);
        tracker.mouse(1, false);
        assert_eq!(signals.mouse_buttons.load(Ordering::SeqCst), 2);
        tracker.mouse(2, false);
        assert_eq!(signals.mouse_buttons.load(Ordering::SeqCst), 0);
    }
    #[test]
    fn only_external_escape_presses_interrupt_every_active_phase() {
        for phase in [2, 3] {
            let signals = Arc::new(Signals::default());
            signals.phase.store(phase, Ordering::SeqCst);
            let tracker = Tracker {
                signals: signals.clone(),
            };
            assert!(tracker.key(27, true, true, INPUT_MARKER).is_none());
            assert!(tracker.key(27, false, false, 0).is_none());
            for vk in [65, 0x25, 0x85, 0xA2, 0xA4, 0x77, 0x78, 0x79] {
                for (down, injected, marker) in
                    [(true, false, 0), (false, false, 0), (true, true, 42)]
                {
                    assert!(tracker.key(vk, down, injected, marker).is_none());
                }
                assert!(
                    !signals.stop.load(Ordering::SeqCst),
                    "phase={phase}, key {vk:#x}"
                );
            }
            assert!(tracker.key(27, true, true, 42).is_some());
            assert!(signals.stop.load(Ordering::SeqCst));
        }
    }
    #[test]
    fn idle_escape_preserves_the_stop_latch() {
        let signals = Arc::new(Signals::default());
        let tracker = Tracker {
            signals: signals.clone(),
        };
        assert!(tracker.key(27, true, false, 0).is_some());
        assert!(!signals.stop.load(Ordering::SeqCst));
    }
}
