//! Explicit desktop-input test. Run only on an unlocked Windows desktop.
use key_relay::{
    text::units,
    windows::{
        hooks::{Hooks, Signals},
        input,
    },
};
use std::{
    sync::{atomic::Ordering, Arc},
    thread,
    time::{Duration, Instant},
};
use windows::{
    core::w,
    Win32::{
        Foundation::HWND,
        UI::{Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
    },
};

struct Receiver {
    window: HWND,
    previous: HWND,
}
impl Drop for Receiver {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyWindow(self.window);
            let _ = SetForegroundWindow(self.previous);
        }
    }
}
fn pump() {
    unsafe {
        let mut msg = MSG::default();
        while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}
fn text(window: HWND) -> String {
    unsafe {
        let mut buffer = [0u16; 256];
        let n = GetWindowTextW(window, &mut buffer);
        String::from_utf16_lossy(&buffer[..n as usize])
    }
}

#[test]
#[ignore = "sends actual Windows input to a dedicated receiver window"]
fn unicode_enter_tab_hooks_and_cleanup() {
    unsafe {
        assert!(
            !input::any_held(None),
            "Release modifier keys and mouse buttons first"
        );
        let previous = GetForegroundWindow();
        let window = CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("EDIT"),
            w!(""),
            WS_OVERLAPPEDWINDOW
                | WS_VISIBLE
                | WINDOW_STYLE((ES_MULTILINE | ES_WANTRETURN | ES_AUTOVSCROLL) as u32),
            80,
            80,
            620,
            260,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let receiver = Receiver { window, previous };
        assert!(
            SetForegroundWindow(window).as_bool(),
            "Receiver must own the foreground before sending input"
        );
        SetFocus(Some(window)).unwrap();
        pump();
        let signals = Arc::new(Signals::default());
        signals.phase.store(3, Ordering::SeqCst);
        let mut hooks = Hooks::start(signals.clone(), |_| {}).unwrap();
        let sample = "中文 Ab9!\r\n下一行\t😀";
        for unit in units(sample) {
            assert_eq!(
                GetForegroundWindow(),
                receiver.window,
                "Foreground changed; input aborted"
            );
            input::send(unit).unwrap();
            pump();
            thread::sleep(Duration::from_millis(30));
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        while text(window) != sample && Instant::now() < deadline {
            pump();
            thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(text(window), sample);
        assert!(
            !signals.stop.load(Ordering::SeqCst),
            "Own marked events must pass without interruption"
        );
        assert!(!input::any_held(None));
        let mut foreign = input::encode(key_relay::text::Unit::Character('!'));
        for event in &mut foreign {
            event.Anonymous.ki.dwExtraInfo = 0;
        }
        assert_eq!(GetForegroundWindow(), receiver.window);
        assert_eq!(SendInput(&foreign, std::mem::size_of::<INPUT>() as i32), 2);
        pump();
        assert!(
            !signals.stop.load(Ordering::SeqCst),
            "Ordinary foreign input keeps the task active"
        );
        assert_eq!(
            text(window),
            format!("{sample}!"),
            "Ordinary input retains its normal effect"
        );
        let escape: Vec<_> = [KEYBD_EVENT_FLAGS(0), KEYEVENTF_KEYUP]
            .into_iter()
            .map(|flags| INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_ESCAPE,
                        dwFlags: flags,
                        ..Default::default()
                    },
                },
            })
            .collect();
        assert_eq!(GetForegroundWindow(), receiver.window);
        assert_eq!(SendInput(&escape, std::mem::size_of::<INPUT>() as i32), 2);
        pump();
        assert!(
            signals.stop.load(Ordering::SeqCst),
            "Foreign Escape input latches interruption"
        );
        assert_eq!(text(window), format!("{sample}!"));
        hooks.stop();
        signals.stop.store(false, Ordering::SeqCst);
        assert_eq!(GetForegroundWindow(), receiver.window);
        assert_eq!(SendInput(&escape, std::mem::size_of::<INPUT>() as i32), 2);
        pump();
        assert!(
            !signals.stop.load(Ordering::SeqCst),
            "Removed hooks must receive no events"
        );
    }
}
