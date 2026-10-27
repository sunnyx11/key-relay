//! Native geometry checks against a freshly built executable on an interactive Windows desktop.
use std::{
    path::PathBuf,
    process::{Child, Command},
    thread,
    time::{Duration, Instant},
};
use windows::{
    core::BOOL,
    Win32::{
        Foundation::{HWND, LPARAM, RECT},
        Graphics::Gdi::{
            GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        },
        UI::WindowsAndMessaging::{
            EnumWindows, GetClientRect, GetWindowLongW, GetWindowRect, GetWindowTextW,
            GetWindowThreadProcessId, IsIconic, IsWindowVisible, IsZoomed, PostMessageW,
            SetWindowPos, ShowWindow, GWL_EXSTYLE, SWP_NOACTIVATE, SWP_NOZORDER, SW_MAXIMIZE,
            SW_MINIMIZE, WM_CLOSE, WS_EX_TOPMOST,
        },
    },
};

struct App {
    child: Child,
    window: HWND,
    debug_port: u16,
}
impl App {
    fn open(directory: &std::path::Path) -> Self {
        let executable = std::env::var_os("KEY_RELAY_TEST_EXECUTABLE")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/release/key-relay.exe")
            });
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let debug_port = listener.local_addr().unwrap().port();
        drop(listener);
        let child = Command::new(executable)
            .env("KEY_RELAY_TEST_CONFIG_DIR", directory)
            .env("WEBVIEW2_USER_DATA_FOLDER", directory.join("webview"))
            .env(
                "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                format!("--remote-debugging-port={debug_port}"),
            )
            .spawn()
            .unwrap();
        let mut app = Self {
            child,
            window: HWND::default(),
            debug_port,
        };
        let deadline = Instant::now() + Duration::from_secs(20);
        while app.window.is_invalid() && Instant::now() < deadline {
            let mut found = (app.child.id(), HWND::default());
            unsafe {
                EnumWindows(
                    Some(find_window),
                    LPARAM((&mut found as *mut (u32, HWND)) as isize),
                )
                .unwrap();
            }
            app.window = found.1;
            thread::sleep(Duration::from_millis(50));
        }
        assert!(
            !app.window.is_invalid(),
            "visible application window did not appear"
        );
        // Native visibility precedes the frontend close subscription.
        thread::sleep(Duration::from_secs(1));
        app
    }
    fn geometry(&self) -> (RECT, RECT) {
        let (mut outer, mut client) = (RECT::default(), RECT::default());
        unsafe {
            GetWindowRect(self.window, &mut outer).unwrap();
            GetClientRect(self.window, &mut client).unwrap();
        }
        (outer, client)
    }
    fn close(mut self) {
        let status = Command::new("node")
            .current_dir(PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap())
            .args(["-e", r#"
                const { chromium } = require('@playwright/test');
                (async () => {
                    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.RELAY_DEBUG_PORT}`);
                    const page = browser.contexts()[0].pages()[0];
                    await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'relay-close-requested', payload: null })).catch(() => {});
                    await browser.close().catch(() => {});
                })().catch(error => { console.error(error); process.exitCode = 1; });
            "#])
            .env("RELAY_DEBUG_PORT", self.debug_port.to_string())
            .status()
            .unwrap();
        assert!(
            status.success(),
            "could not request normal application exit"
        );
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                assert!(status.success());
                return;
            }
            assert!(Instant::now() < deadline, "application did not close");
            thread::sleep(Duration::from_millis(50));
        }
    }
}
impl Drop for App {
    fn drop(&mut self) {
        if self.child.try_wait().unwrap().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}
unsafe extern "system" fn find_window(window: HWND, parameter: LPARAM) -> BOOL {
    let found = unsafe { &mut *(parameter.0 as *mut (u32, HWND)) };
    let mut process = 0;
    unsafe {
        GetWindowThreadProcessId(window, Some(&mut process));
    }
    let mut title = [0_u16; 64];
    let length = unsafe { GetWindowTextW(window, &mut title) } as usize;
    if process == found.0
        && unsafe { IsWindowVisible(window).as_bool() }
        && String::from_utf16_lossy(&title[..length]) == "Key Relay"
    {
        found.1 = window;
    }
    true.into()
}

#[test]
#[ignore = "requires a freshly built release EXE and interactive Windows desktop"]
fn restores_normal_geometry_after_close_maximize_minimize_and_invalid_records() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(
        directory.path().join("updates.json"),
        r#"{"autoCheck":false}"#,
    )
    .unwrap();
    let app = App::open(directory.path());
    let (initial, initial_client) = app.geometry();
    assert_eq!(
        (initial.right - initial.left, initial.bottom - initial.top),
        (initial_client.right, initial_client.bottom),
        "the undecorated window must not add a native shadow frame"
    );
    unsafe {
        SetWindowPos(
            app.window,
            None,
            initial.left + 24,
            initial.top + 20,
            initial.right - initial.left + 60,
            initial.bottom - initial.top + 90,
            SWP_NOZORDER | SWP_NOACTIVATE,
        )
        .unwrap();
    }
    let expected = app.geometry();
    unsafe {
        PostMessageW(
            Some(app.window),
            WM_CLOSE,
            Default::default(),
            Default::default(),
        )
        .unwrap();
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    while unsafe { IsWindowVisible(app.window).as_bool() } && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(50));
    }
    assert!(
        !unsafe { IsWindowVisible(app.window).as_bool() },
        "close must hide the window"
    );
    unsafe {
        let _ = ShowWindow(app.window, SW_MINIMIZE);
    }
    let mut duplicate = Command::new(
        std::env::var_os("KEY_RELAY_TEST_EXECUTABLE")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/release/key-relay.exe")
            }),
    )
    .env("KEY_RELAY_TEST_CONFIG_DIR", directory.path())
    .spawn()
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while duplicate.try_wait().unwrap().is_none() {
        if Instant::now() >= deadline {
            let _ = duplicate.kill();
            panic!("duplicate instance did not exit");
        }
        thread::sleep(Duration::from_millis(50));
    }
    assert!(duplicate.wait().unwrap().success());
    assert!(!unsafe { IsIconic(app.window).as_bool() });
    let restored = app.geometry();
    assert_eq!(
        (
            restored.0.left,
            restored.0.top,
            restored.1.right,
            restored.1.bottom
        ),
        (
            expected.0.left,
            expected.0.top,
            expected.1.right,
            expected.1.bottom
        )
    );
    app.close();
    let path = directory.path().join("window-state.json");
    assert!(path.is_file(), "normal close must persist window geometry");
    for show in [None, Some(SW_MAXIMIZE), Some(SW_MINIMIZE), None] {
        let app = App::open(directory.path());
        let actual = app.geometry();
        assert!(!unsafe { IsIconic(app.window).as_bool() || IsZoomed(app.window).as_bool() });
        assert_ne!(
            unsafe { GetWindowLongW(app.window, GWL_EXSTYLE) } as u32 & WS_EX_TOPMOST.0,
            0
        );
        assert_eq!(
            (actual.0.left, actual.0.top, actual.1.right, actual.1.bottom),
            (
                expected.0.left,
                expected.0.top,
                expected.1.right,
                expected.1.bottom
            )
        );
        if let Some(show) = show {
            unsafe {
                let _ = ShowWindow(app.window, show);
            }
            thread::sleep(Duration::from_millis(200));
        }
        app.close();
    }
    let mut state: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    state["x"] = serde_json::json!(1_000_000);
    state["y"] = serde_json::json!(1_000_000);
    std::fs::write(&path, serde_json::to_vec(&state).unwrap()).unwrap();
    let app = App::open(directory.path());
    let (outer, client) = app.geometry();
    let mut monitor = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    unsafe {
        GetMonitorInfoW(
            MonitorFromWindow(app.window, MONITOR_DEFAULTTONEAREST),
            &mut monitor,
        )
        .ok()
        .unwrap();
    }
    assert_eq!(
        (outer.left, outer.top),
        (
            monitor.rcWork.left
                + (monitor.rcWork.right - monitor.rcWork.left - outer.right + outer.left) / 2,
            monitor.rcWork.top
                + (monitor.rcWork.bottom - monitor.rcWork.top - outer.bottom + outer.top) / 2
        )
    );
    assert_eq!(
        (client.right, client.bottom),
        (expected.1.right, expected.1.bottom)
    );
    app.close();
    std::fs::write(&path, "broken").unwrap();
    let app = App::open(directory.path());
    let (_, client) = app.geometry();
    assert_eq!((client.right, client.bottom), (600, 340));
    app.close();
    std::fs::remove_file(&path).unwrap();
    std::fs::create_dir(&path).unwrap();
    let app = App::open(directory.path());
    app.close();
}
