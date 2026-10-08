use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, Ordering},
        Arc,
    },
};

/// Shared callback flags. The stop latch closes the queue-to-send race.
#[derive(Default)]
pub struct Signals {
    pub phase: AtomicU8,
    pub stop: AtomicBool,
    pub cycle: AtomicU64,
    pub shortcut_key: AtomicU32,
    pub mouse_buttons: AtomicU8,
}

/// Hook events carry only keys needed for state decisions, never typed text.
#[derive(Clone, Copy, Debug)]
pub enum HookEvent {
    Key { vk: u32, down: bool, cycle: u64 },
    MouseDown,
    MouseUp,
}

struct Tracker {
    held: HashSet<u32>,
    signals: Arc<Signals>,
}
impl Tracker {
    fn mouse(&self, button: u8, down: bool) {
        if down {
            self.signals
                .mouse_buttons
                .fetch_or(button, Ordering::SeqCst);
            if matches!(self.signals.phase.load(Ordering::SeqCst), 1 | 3) {
                self.signals.stop.store(true, Ordering::SeqCst);
            }
        } else {
            self.signals
                .mouse_buttons
                .fetch_and(!button, Ordering::SeqCst);
        }
    }
    fn key(&mut self, vk: u32, down: bool, injected: bool, marker: usize) -> Option<HookEvent> {
        if injected && marker == super::input::INPUT_MARKER {
            return None;
        }
        let cycle_key =
            super::input::is_modifier(vk) || vk == self.signals.shortcut_key.load(Ordering::SeqCst);
        if cycle_key || self.held.contains(&vk) {
            if down {
                if self.held.is_empty() {
                    self.signals.cycle.fetch_add(1, Ordering::SeqCst);
                }
                self.held.insert(vk);
            } else {
                self.held.remove(&vk);
            }
        } else if vk != 27 {
            return None;
        }
        if down && vk == 27 && matches!(self.signals.phase.load(Ordering::SeqCst), 1..=3) {
            self.signals.stop.store(true, Ordering::SeqCst);
        }
        Some(HookEvent::Key {
            vk,
            down,
            cycle: self.signals.cycle.load(Ordering::SeqCst),
        })
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
            if let Some((tracker, sink)) = context.borrow_mut().as_mut() {
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
                        HookEvent::MouseDown
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
            let mut msg = MSG::default();
            let _ = PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE);
            CONTEXT.with(|context| {
                *context.borrow_mut() = Some((
                    Tracker {
                        held: HashSet::new(),
                        signals,
                    },
                    Box::new(sink),
                ))
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
            held: HashSet::new(),
            signals: signals.clone(),
        };
        tracker.mouse(1, true);
        assert!(signals.stop.load(Ordering::SeqCst));
        assert_ne!(signals.mouse_buttons.load(Ordering::SeqCst), 0);
        signals.phase.store(0, Ordering::SeqCst);
        tracker.mouse(1, false);
        assert_eq!(signals.mouse_buttons.load(Ordering::SeqCst), 0);
    }
    #[test]
    fn only_external_escape_interrupts_every_active_phase() {
        for phase in [1, 2, 3] {
            let signals = Arc::new(Signals::default());
            signals.phase.store(phase, Ordering::SeqCst);
            let mut tracker = Tracker {
                held: HashSet::new(),
                signals: signals.clone(),
            };
            assert!(tracker.key(27, true, true, INPUT_MARKER).is_none());
            for vk in [65, 0x25, 0x85, 0xA2] {
                tracker.key(vk, true, false, 0);
                tracker.key(vk, true, false, 0);
                tracker.key(vk, false, false, 0);
                tracker.key(vk, true, true, 42);
                tracker.key(vk, false, true, 42);
                assert!(
                    !signals.stop.load(Ordering::SeqCst),
                    "phase={phase}, key {vk:#x}"
                );
            }
            tracker.key(27, false, false, 0);
            assert!(!signals.stop.load(Ordering::SeqCst));
            assert!(tracker.key(27, true, true, 42).is_some());
            assert!(signals.stop.load(Ordering::SeqCst));
        }
    }
    #[test]
    fn unrelated_held_keys_allow_independent_shortcut_cycles() {
        for vk in [65, 0x85, 120] {
            let signals = Arc::new(Signals::default());
            signals.shortcut_key.store(119, Ordering::SeqCst);
            let mut tracker = Tracker {
                held: HashSet::new(),
                signals: signals.clone(),
            };
            tracker.key(vk, true, false, 0);
            tracker.key(162, true, false, 0);
            tracker.key(164, true, false, 0);
            tracker.key(119, true, false, 0);
            let first = signals.cycle.load(Ordering::SeqCst);
            tracker.key(119, false, false, 0);
            tracker.key(164, false, false, 0);
            tracker.key(162, false, false, 0);
            tracker.key(162, true, false, 0);
            tracker.key(164, true, false, 0);
            tracker.key(119, true, false, 0);
            assert_eq!(
                signals.cycle.load(Ordering::SeqCst),
                first + 1,
                "key {vk:#x}"
            );
        }
    }
    #[test]
    fn changing_shortcut_releases_the_previous_function_key() {
        let signals = Arc::new(Signals::default());
        signals.shortcut_key.store(119, Ordering::SeqCst);
        let mut tracker = Tracker {
            held: HashSet::new(),
            signals: signals.clone(),
        };
        tracker.key(162, true, false, 0);
        tracker.key(164, true, false, 0);
        tracker.key(119, true, false, 0);
        tracker.key(162, false, false, 0);
        tracker.key(164, false, false, 0);
        signals.shortcut_key.store(120, Ordering::SeqCst);
        tracker.key(119, false, false, 0);
        tracker.key(162, true, false, 0);
        tracker.key(164, true, false, 0);
        tracker.key(120, true, false, 0);
        assert_eq!(signals.cycle.load(Ordering::SeqCst), 2);
    }
    #[test]
    fn key_cycle_changes_only_after_full_release() {
        for key in [119, 120, 121] {
            let signals = Arc::new(Signals::default());
            signals.shortcut_key.store(key, Ordering::SeqCst);
            let mut tracker = Tracker {
                held: HashSet::new(),
                signals: signals.clone(),
            };
            tracker.key(162, true, false, 0);
            tracker.key(164, true, false, 0);
            tracker.key(key, true, false, 0);
            assert_eq!(signals.cycle.load(Ordering::SeqCst), 1);
            tracker.key(162, false, false, 0);
            tracker.key(164, false, false, 0);
            tracker.key(162, true, false, 0);
            assert_eq!(signals.cycle.load(Ordering::SeqCst), 1);
            tracker.key(162, false, false, 0);
            tracker.key(key, false, false, 0);
            tracker.key(162, true, false, 0);
            assert_eq!(signals.cycle.load(Ordering::SeqCst), 2);
        }
    }
    #[test]
    fn countdown_only_escape_interrupts_and_release_does_not() {
        let signals = Arc::new(Signals::default());
        signals.phase.store(2, Ordering::SeqCst);
        let mut tracker = Tracker {
            held: HashSet::new(),
            signals: signals.clone(),
        };
        tracker.key(65, true, false, 0);
        tracker.key(65, false, false, 0);
        assert!(!signals.stop.load(Ordering::SeqCst));
        tracker.key(27, true, false, 0);
        assert!(signals.stop.load(Ordering::SeqCst));
    }
}
