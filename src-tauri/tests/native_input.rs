//! Explicit desktop-input test. Run only on an unlocked Windows desktop.
use key_relay::{
    settings::Settings,
    task::{Draft, Engine, Phase},
    text::units,
    windows::{
        hooks::{Hooks, Signals},
        input,
        target::{self, Target},
    },
};
use std::{
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
use windows::{
    core::{w, BOOL},
    Win32::{
        Foundation::{HWND, LPARAM, RECT},
        Graphics::Gdi::{EnumDisplayMonitors, HDC, HMONITOR},
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

// Give the dedicated test window a real input activation before testing restoration.
fn focus_receiver(window: HWND) {
    unsafe {
        SetWindowPos(
            window,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
        .unwrap();
        let mut rect = RECT::default();
        GetWindowRect(window, &mut rect).unwrap();
        let (x, y) = (rect.left + 60, rect.top + 80);
        SetCursorPos(x, y).unwrap();
        assert_eq!(target::clicked_window(x, y).window, window.0 as usize);
        let events = [MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP].map(|flags| INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dwFlags: flags,
                    ..Default::default()
                },
            },
        });
        assert_eq!(SendInput(&events, std::mem::size_of::<INPUT>() as i32), 2);
        let deadline = Instant::now() + Duration::from_secs(2);
        while GetForegroundWindow() != window && Instant::now() < deadline {
            pump();
            thread::sleep(Duration::from_millis(5));
        }
        pump();
        assert_eq!(
            GetForegroundWindow(),
            window,
            "Receiver must own foreground"
        );
        SetWindowPos(
            window,
            Some(HWND_NOTOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
        .unwrap();
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
        focus_receiver(window);
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

struct ExternalReceiver(Child);
impl Drop for ExternalReceiver {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Child process for the target test; exposes only its own test window and received text.
#[test]
#[ignore = "helper for the external target test"]
fn target_receiver() {
    let Ok(directory) = std::env::var("KEY_RELAY_TEST_RECEIVER") else {
        return;
    };
    target::use_physical_coordinates().unwrap();
    let directory = std::path::Path::new(&directory);
    let position: [i32; 2] =
        serde_json::from_str(&std::env::var("KEY_RELAY_TEST_POSITION").unwrap()).unwrap();
    unsafe {
        let window = CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("EDIT"),
            w!(""),
            WS_OVERLAPPEDWINDOW | WS_VISIBLE | WINDOW_STYLE((ES_MULTILINE | ES_WANTRETURN) as u32),
            position[0],
            position[1],
            480,
            240,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let _receiver = Receiver {
            window,
            previous: HWND::default(),
        };
        focus_receiver(window);
        let mut rect = RECT::default();
        GetWindowRect(window, &mut rect).unwrap();
        std::fs::write(
            directory.join("window.json"),
            serde_json::to_vec(&serde_json::json!({
                "window": window.0 as usize, "x": rect.left + 80, "y": rect.top + 80
            }))
            .unwrap(),
        )
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(20);
        let mut previous = String::new();
        while Instant::now() < deadline {
            pump();
            let received = text(window);
            if received != previous {
                std::fs::write(directory.join("text.txt"), &received).unwrap();
                previous = received;
            }
            thread::sleep(Duration::from_millis(5));
        }
    }
}

#[test]
#[ignore = "activates and clicks a dedicated external receiver on the Windows desktop"]
fn recorded_target_clicks_external_window_and_rejects_stale_geometry() {
    target::use_physical_coordinates().unwrap();
    unsafe extern "system" fn collect(_: HMONITOR, _: HDC, rect: *mut RECT, data: LPARAM) -> BOOL {
        let origins = &mut *(data.0 as *mut Vec<[i32; 2]>);
        origins.push([(*rect).left + 80, (*rect).top + 80]);
        BOOL(1)
    }
    let mut origins: Vec<[i32; 2]> = Vec::new();
    assert!(unsafe {
        EnumDisplayMonitors(
            None,
            None,
            Some(collect),
            LPARAM(&mut origins as *mut _ as isize),
        )
    }
    .as_bool());
    assert!(!origins.is_empty());
    for origin in origins {
        verify_recorded_target(origin);
    }
}

fn verify_recorded_target(position: [i32; 2]) {
    assert!(
        !input::any_held(None),
        "Release modifiers and mouse buttons first"
    );
    let directory = tempfile::tempdir().unwrap();
    let mut child = Command::new(std::env::current_exe().unwrap());
    child
        .args(["--ignored", "--exact", "target_receiver", "--nocapture"])
        .env("KEY_RELAY_TEST_RECEIVER", directory.path())
        .env(
            "KEY_RELAY_TEST_POSITION",
            serde_json::to_string(&position).unwrap(),
        )
        .stdout(Stdio::null())
        .stderr(Stdio::inherit());
    let _external = ExternalReceiver(child.spawn().unwrap());
    let deadline = Instant::now() + Duration::from_secs(5);
    let info: serde_json::Value = loop {
        if let Ok(bytes) = std::fs::read(directory.path().join("window.json")) {
            if let Ok(value) = serde_json::from_slice(&bytes) {
                break value;
            }
        }
        assert!(Instant::now() < deadline, "Receiver did not initialize");
        thread::sleep(Duration::from_millis(10));
    };
    let x = info["x"].as_i64().unwrap() as i32;
    let y = info["y"].as_i64().unwrap() as i32;
    let external_window = HWND(info["window"].as_u64().unwrap() as usize as *mut _);
    assert_eq!(
        target::clicked_window(x, y).window,
        external_window.0 as usize
    );
    let recorded =
        Target::capture(target::clicked_window(x, y)).expect("External click must be recordable");
    assert_eq!((recorded.info.x, recorded.info.y), (x, y));
    recorded.validate().unwrap();
    unsafe {
        let previous = GetForegroundWindow();
        let window = CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("EDIT"),
            w!("Key Relay test"),
            WS_OVERLAPPEDWINDOW | WS_VISIBLE,
            x + 500,
            y,
            300,
            200,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let _own_window = Receiver { window, previous };
        assert!(Target::capture(target::Click {
            x: x + 550,
            y: y + 80,
            window: window.0 as usize
        })
        .is_none());
        focus_receiver(window);
        assert!(recorded.click(&AtomicBool::new(true)).is_err());
        assert_eq!(
            GetForegroundWindow(),
            window,
            "Stopped activation must preserve focus"
        );
        let signals = Arc::new(Signals::default());
        signals.phase.store(2, Ordering::SeqCst);
        let mut hooks = Hooks::start(signals.clone(), |_| {}).unwrap();
        for shortcut in [None, Some(0x77)] {
            signals.phase.store(0, Ordering::SeqCst);
            focus_receiver(window);
            signals.stop.store(false, Ordering::SeqCst);
            // WM_SETTEXT updates the external edit buffer across process boundaries.
            assert_ne!(
                SendMessageW(
                    external_window,
                    WM_SETTEXT,
                    None,
                    Some(LPARAM(w!("").as_ptr() as isize))
                )
                .0,
                0
            );
            let sample = format!("中文 Ab9!\r\n下一行\t😀{shortcut:?}");
            let mut engine = Engine::new(Settings::default());
            engine.record_target(recorded.info.clone());
            engine.sync(Draft {
                revision: 1,
                text: sample.clone(),
                settings: serde_json::to_value(Settings::default()).unwrap(),
            });
            assert!(input::own_foreground());
            let origin = Instant::now();
            engine.start(shortcut, 0, 1).unwrap();
            if let Some(key) = shortcut {
                engine.key(key, true, 1);
                assert!(!engine.needs_target_click(0, false));
                engine.key(key, false, 1);
            }
            assert!(engine.needs_target_click(0, false));
            signals.phase.store(2, Ordering::SeqCst);
            recorded.click(&signals.stop).unwrap();
            engine.clicked_target(origin.elapsed().as_millis() as u64);
            assert!(
                !signals.stop.load(Ordering::SeqCst),
                "Own click must preserve targeting"
            );
            assert_eq!(signals.mouse_buttons.load(Ordering::SeqCst), 0);
            assert_eq!(GetForegroundWindow(), external_window);
            let mut cursor = Default::default();
            GetCursorPos(&mut cursor).unwrap();
            assert_eq!(
                (cursor.x, cursor.y),
                (x, y),
                "Physical target must be restored"
            );
            while engine.busy() {
                assert!(
                    origin.elapsed() < Duration::from_secs(5),
                    "Task did not finish"
                );
                assert!(!signals.stop.load(Ordering::SeqCst));
                let now = origin.elapsed().as_millis() as u64;
                let before = engine.snapshot.phase;
                if let Some(unit) = engine.due(
                    now,
                    input::own_foreground(),
                    input::any_held(engine.startup_key),
                ) {
                    if before == Phase::Targeting {
                        recorded.ready().unwrap();
                    }
                    signals.phase.store(3, Ordering::SeqCst);
                    engine.submitted(now, input::send(unit));
                }
                pump();
                thread::sleep(Duration::from_millis(2));
            }
            assert_eq!(engine.snapshot.phase, Phase::Done);
            let deadline = Instant::now() + Duration::from_secs(3);
            while std::fs::read_to_string(directory.path().join("text.txt"))
                .ok()
                .as_deref()
                != Some(sample.as_str())
            {
                assert!(
                    Instant::now() < deadline,
                    "External receiver {shortcut:?}: expected {sample:?}, received {:?}",
                    std::fs::read_to_string(directory.path().join("text.txt"))
                );
                thread::sleep(Duration::from_millis(10));
            }
        }
        signals.phase.store(2, Ordering::SeqCst);
        assert!(!signals.stop.load(Ordering::SeqCst));
        eprintln!(
            "Native target: ({x}, {y}), monitors={}, virtual origin=({}, {}), window DPI={}",
            GetSystemMetrics(SM_CMONITORS),
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
            windows::Win32::UI::HiDpi::GetDpiForWindow(external_window)
        );
        SetWindowPos(
            window,
            Some(HWND_TOPMOST),
            x - 20,
            y - 40,
            200,
            120,
            SWP_NOACTIVATE,
        )
        .unwrap();
        assert!(
            recorded.ready().is_err(),
            "An obscured point must be rejected"
        );
        assert!(
            recorded.click(&signals.stop).is_err(),
            "An overlay must prevent the click"
        );
        SetWindowPos(
            window,
            Some(HWND_NOTOPMOST),
            x + 500,
            y,
            300,
            200,
            SWP_NOACTIVATE,
        )
        .unwrap();
        recorded.ready().unwrap();
        SetWindowPos(
            external_window,
            None,
            x + 20,
            y + 20,
            480,
            240,
            SWP_NOZORDER | SWP_NOACTIVATE,
        )
        .unwrap();
        assert!(
            recorded.validate().is_err(),
            "Moving the target must invalidate the recorded point"
        );
        assert!(recorded.click(&signals.stop).is_err());
        SetCursorPos(x + 100, y + 100).unwrap();
        assert_eq!(
            target::clicked_window(x + 100, y + 100).window,
            external_window.0 as usize
        );
        let mouse: Vec<_> = [MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP]
            .map(|flags| INPUT {
                r#type: INPUT_MOUSE,
                Anonymous: INPUT_0 {
                    mi: MOUSEINPUT {
                        dwFlags: flags,
                        ..Default::default()
                    },
                },
            })
            .to_vec();
        assert_eq!(SendInput(&mouse, std::mem::size_of::<INPUT>() as i32), 2);
        assert!(
            signals.stop.load(Ordering::SeqCst),
            "External mouse input must interrupt targeting"
        );
        hooks.stop();
    }
}
