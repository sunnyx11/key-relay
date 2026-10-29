use super::input::INPUT_MARKER;
use serde::Serialize;
use std::{
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};
use windows::Win32::{
    Foundation::{HWND, POINT, RECT},
    Graphics::Gdi::{GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONULL},
    System::Threading::GetCurrentProcessId,
    UI::{
        HiDpi::{
            GetDpiForMonitor, GetDpiForWindow, SetThreadDpiAwarenessContext,
            DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, MDT_EFFECTIVE_DPI,
        },
        Input::KeyboardAndMouse::*,
        WindowsAndMessaging::*,
    },
};

/// Public target description; native window identity stays in the worker.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct TargetInfo {
    pub x: i32,
    pub y: i32,
    pub title: String,
}

/// Coordinates and the window under a physical left-button press.
#[derive(Clone, Copy, Debug)]
pub struct Click {
    pub x: i32,
    pub y: i32,
    pub window: usize,
}

/// A recorded point is valid only while its window and display geometry match.
#[derive(Clone, Debug)]
pub struct Target {
    pub info: TargetInfo,
    window: usize,
    process: u32,
    thread: u32,
    rect: [i32; 4],
    dpi: u32,
    display: Display,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Display {
    desktop: [i32; 4],
    monitor: usize,
    rect: [i32; 4],
    dpi: [u32; 2],
}

/// Keep native coordinates independent of WebView zoom and per-monitor scaling.
pub fn use_physical_coordinates() -> Result<(), String> {
    let previous =
        unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    if previous.0.is_null() {
        Err("无法启用物理屏幕坐标，请检查 Windows 环境。".into())
    } else {
        Ok(())
    }
}

fn window_at(x: i32, y: i32) -> HWND {
    unsafe { GetAncestor(WindowFromPoint(POINT { x, y }), GA_ROOT) }
}

fn window_rect(window: HWND) -> Result<[i32; 4], String> {
    let mut rect = RECT::default();
    unsafe { GetWindowRect(window, &mut rect) }.map_err(|_| "目标已失效，请重新选择输入位置")?;
    Ok([rect.left, rect.top, rect.right, rect.bottom])
}

fn display_at(x: i32, y: i32) -> Result<Display, String> {
    unsafe {
        let monitor = MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONULL);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if monitor.0.is_null() || !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return Err("目标已失效，请重新选择输入位置".into());
        }
        let mut dpi_x = 0;
        let mut dpi_y = 0;
        GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y)
            .map_err(|_| "无法读取目标显示器缩放，请重新选择输入位置。")?;
        let left = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let top = GetSystemMetrics(SM_YVIRTUALSCREEN);
        Ok(Display {
            desktop: [
                left,
                top,
                left + GetSystemMetrics(SM_CXVIRTUALSCREEN),
                top + GetSystemMetrics(SM_CYVIRTUALSCREEN),
            ],
            monitor: monitor.0 as usize,
            rect: [
                info.rcMonitor.left,
                info.rcMonitor.top,
                info.rcMonitor.right,
                info.rcMonitor.bottom,
            ],
            dpi: [dpi_x, dpi_y],
        })
    }
}

/// Capture the window at callback time before the physical click changes activation.
pub fn clicked_window(x: i32, y: i32) -> Click {
    Click {
        x,
        y,
        window: window_at(x, y).0 as usize,
    }
}

impl Target {
    /// Record external application windows; own windows and desktop chrome preserve the old target.
    pub fn capture(click: Click) -> Option<Self> {
        let window = HWND(click.window as *mut _);
        unsafe {
            let mut process = 0;
            let thread = GetWindowThreadProcessId(window, Some(&mut process));
            if thread == 0 || process == GetCurrentProcessId() || !IsWindowVisible(window).as_bool()
            {
                return None;
            }
            let mut class = [0u16; 256];
            let len = GetClassNameW(window, &mut class) as usize;
            if matches!(
                String::from_utf16_lossy(&class[..len]).as_str(),
                "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
            ) {
                return None;
            }
            let mut title = [0u16; 256];
            let len = GetWindowTextW(window, &mut title) as usize;
            Some(Self {
                info: TargetInfo {
                    x: click.x,
                    y: click.y,
                    title: if len == 0 {
                        "目标窗口".into()
                    } else {
                        String::from_utf16_lossy(&title[..len])
                    },
                },
                window: click.window,
                process,
                thread,
                rect: window_rect(window).ok()?,
                dpi: GetDpiForWindow(window),
                display: display_at(click.x, click.y).ok()?,
            })
        }
    }

    /// Validate identity and physical geometry without changing focus.
    pub fn validate(&self) -> Result<(), String> {
        let window = HWND(self.window as *mut _);
        unsafe {
            let mut process = 0;
            let thread = GetWindowThreadProcessId(window, Some(&mut process));
            if !IsWindow(Some(window)).as_bool()
                || process != self.process
                || thread != self.thread
                || !IsWindowVisible(window).as_bool()
                || IsIconic(window).as_bool()
                || !IsWindowEnabled(window).as_bool()
            {
                return Err("目标已失效，请重新选择输入位置".into());
            }
            if window_rect(window)? != self.rect
                || GetDpiForWindow(window) != self.dpi
                || display_at(self.info.x, self.info.y)? != self.display
            {
                return Err("目标已失效，请重新选择输入位置".into());
            }
        }
        Ok(())
    }

    /// Confirm that the recorded window is foreground and owns the visible point.
    pub fn ready(&self) -> Result<(), String> {
        self.validate()?;
        if unsafe { GetForegroundWindow().0 as usize } != self.window
            || window_at(self.info.x, self.info.y).0 as usize != self.window
        {
            return Err("目标位置被遮挡或窗口未激活，请重新选择输入位置。".into());
        }
        Ok(())
    }

    /// Activate and click the recorded point; stop requests prevent any remaining synthetic input.
    pub fn click(&self, stop: &AtomicBool) -> Result<(), String> {
        self.validate()?;
        if stop.load(Ordering::SeqCst) {
            return Err("已取消目标激活。".into());
        }
        let window = HWND(self.window as *mut _);
        if !unsafe { SetForegroundWindow(window) }.as_bool() {
            return Err("目标窗口激活失败，请重新选择输入位置。".into());
        }
        let deadline = Instant::now() + Duration::from_millis(300);
        while unsafe { GetForegroundWindow() } != window {
            if stop.load(Ordering::SeqCst) || Instant::now() >= deadline {
                return Err("目标窗口激活未完成，请重新选择输入位置。".into());
            }
            thread::sleep(Duration::from_millis(5));
        }
        self.ready()?;
        if stop.load(Ordering::SeqCst) || super::input::any_held() {
            return Err("已取消，开始时仍有修饰键或鼠标按钮按下。".into());
        }
        let events = click_events(self.info.x, self.info.y, self.display.desktop)?;
        let sent = unsafe { SendInput(&events, std::mem::size_of::<INPUT>() as i32) };
        if sent == events.len() as u32 {
            return Ok(());
        }
        if sent == 2 {
            unsafe {
                SendInput(&events[2..], std::mem::size_of::<INPUT>() as i32);
            }
        }
        Err("目标点击提交失败，请检查本地权限并重新选择输入位置。".into())
    }
}

fn click_events(x: i32, y: i32, desktop: [i32; 4]) -> Result<[INPUT; 3], String> {
    let [left, top, right, bottom] = desktop.map(i64::from);
    let (x, y) = (i64::from(x), i64::from(y));
    if right <= left || bottom <= top || x < left || x >= right || y < top || y >= bottom {
        return Err("记录位置已超出虚拟桌面，请重新选择输入位置。".into());
    }
    // SendInput maps 65536 discrete values across the whole virtual desktop; use pixel centers.
    let dx = (((x - left) * 2 + 1) * 65536 / ((right - left) * 2)).min(65535) as i32;
    let dy = (((y - top) * 2 + 1) * 65536 / ((bottom - top) * 2)).min(65535) as i32;
    Ok([
        MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
        MOUSEEVENTF_LEFTDOWN,
        MOUSEEVENTF_LEFTUP,
    ]
    .map(|flags| INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx,
                dy,
                dwFlags: flags,
                dwExtraInfo: INPUT_MARKER,
                ..Default::default()
            },
        },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn click_round_trips_physical_pixels_across_negative_origin_and_mixed_monitor_sizes() {
        for desktop in [
            [0, 0, 1920, 1080],
            [-1920, -1200, 3840, 2160],
            [-3840, 0, 2560, 2160],
        ] {
            let [left, top, right, bottom] = desktop;
            for (x, y) in [
                (left, top),
                (right - 1, bottom - 1),
                (0, 0),
                ((left + right) / 2, (top + bottom) / 2),
            ] {
                let events = click_events(x, y, desktop).unwrap();
                let move_event = unsafe { events[0].Anonymous.mi };
                assert!(move_event
                    .dwFlags
                    .contains(MOUSEEVENTF_VIRTUALDESK | MOUSEEVENTF_ABSOLUTE));
                assert_eq!(
                    i64::from(move_event.dx) * i64::from(right - left) / 65536 + i64::from(left),
                    i64::from(x)
                );
                assert_eq!(
                    i64::from(move_event.dy) * i64::from(bottom - top) / 65536 + i64::from(top),
                    i64::from(y)
                );
                assert_eq!(
                    unsafe { events[1].Anonymous.mi.dwFlags },
                    MOUSEEVENTF_LEFTDOWN
                );
                assert_eq!(
                    unsafe { events[2].Anonymous.mi.dwFlags },
                    MOUSEEVENTF_LEFTUP
                );
                for event in events {
                    assert_eq!(unsafe { event.Anonymous.mi.dwExtraInfo }, INPUT_MARKER);
                }
            }
        }
    }
    #[test]
    fn clicks_outside_the_virtual_desktop_are_rejected() {
        for (x, y) in [(-1921, 0), (1920, 0), (0, -1081), (0, 1080)] {
            assert!(click_events(x, y, [-1920, -1080, 1920, 1080]).is_err());
        }
        assert!(click_events(0, 0, [0, 0, 0, 0]).is_err());
    }
}
