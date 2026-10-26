use serde::{Deserialize, Serialize};
use std::{io::Write, os::windows::ffi::OsStrExt, path::PathBuf};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::HWND,
        Graphics::Gdi::{
            GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        },
        Storage::FileSystem::{MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH},
        UI::{
            HiDpi::{
                GetDpiForWindow, GetSystemMetricsForDpi, SetThreadDpiAwarenessContext,
                DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
            },
            WindowsAndMessaging::{
                GetWindowLongW, GetWindowPlacement, GWL_EXSTYLE, SM_CXPADDEDBORDER, SM_CXSIZEFRAME,
                WINDOWPLACEMENT, WS_EX_TOOLWINDOW,
            },
        },
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Geometry {
    x: i32,
    y: i32,
    width: f64,
    height: f64,
}
impl Geometry {
    fn from_physical(x: i32, y: i32, width: u32, height: u32, scale: f64) -> Self {
        Self {
            x,
            y,
            width: (f64::from(width) / scale).max(320.0),
            height: (f64::from(height) / scale).max(340.0),
        }
    }
    fn valid(self) -> bool {
        self.width.is_finite()
            && self.height.is_finite()
            && self.width >= 320.0
            && self.height >= 340.0
    }
}

#[derive(Clone, Copy)]
struct WorkArea {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale: f64,
    frame: (u32, u32),
}
#[derive(Debug, PartialEq)]
struct Placement {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

fn placement(saved: Option<Geometry>, areas: &[WorkArea], primary: WorkArea) -> Placement {
    let saved = saved.filter(|geometry| geometry.valid());
    if let Some(geometry) = saved {
        for area in areas {
            let width = (geometry.width * area.scale).round() + f64::from(area.frame.0);
            let height = (geometry.height * area.scale).round() + f64::from(area.frame.1);
            if geometry.x >= area.x
                && geometry.y >= area.y
                && f64::from(geometry.x) + width <= f64::from(area.x) + f64::from(area.width)
                && f64::from(geometry.y) + height <= f64::from(area.y) + f64::from(area.height)
            {
                return Placement {
                    x: geometry.x,
                    y: geometry.y,
                    width: (geometry.width * area.scale).round() as u32,
                    height: (geometry.height * area.scale).round() as u32,
                };
            }
        }
    }
    let geometry = saved.unwrap_or(Geometry {
        x: 0,
        y: 0,
        width: 600.0,
        height: 340.0,
    });
    let width = (geometry.width * primary.scale)
        .round()
        .min(f64::from(primary.width.saturating_sub(primary.frame.0)))
        .max((320.0 * primary.scale).round()) as u32;
    let height = (geometry.height * primary.scale)
        .round()
        .min(f64::from(primary.height.saturating_sub(primary.frame.1)))
        .max((340.0 * primary.scale).round()) as u32;
    Placement {
        x: primary.x
            + (primary
                .width
                .saturating_sub(width.saturating_add(primary.frame.0))
                / 2) as i32,
        y: primary.y
            + (primary
                .height
                .saturating_sub(height.saturating_add(primary.frame.1))
                / 2) as i32,
        width,
        height,
    }
}

fn native_frame(dpi: u32, top_border: bool) -> (u32, u32) {
    let edge = unsafe {
        GetSystemMetricsForDpi(SM_CXSIZEFRAME, dpi) + GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi)
    } as u32;
    // Tao's undecorated shadow frame has side/bottom resize insets and a DPI-rounded top inset on Windows 11.
    (
        edge * 2,
        edge + if top_border {
            (f64::from(dpi) / 96.0).round() as u32
        } else {
            0
        },
    )
}

/// Own the independent window geometry file in the application data directory.
pub(crate) struct Store {
    path: PathBuf,
    top_border: bool,
}
impl Store {
    pub(crate) fn new(path: PathBuf) -> Self {
        Self {
            path,
            top_border: false,
        }
    }

    fn load(&self) -> Result<Option<Geometry>, String> {
        let bytes = match std::fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(format!("读取窗口状态失败：{error}")),
        };
        let geometry: Geometry =
            serde_json::from_slice(&bytes).map_err(|error| format!("窗口状态格式无效：{error}"))?;
        if !geometry.valid() {
            return Err("窗口状态尺寸无效。".into());
        }
        Ok(Some(geometry))
    }

    /// Restore the hidden, undecorated main window before its first frontend show request.
    pub(crate) fn restore(&mut self, window: &WebviewWindow) -> tauri::Result<()> {
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
        };
        // Calculate the custom non-client frame before Tao samples its hidden client size.
        unsafe {
            SetWindowPos(
                HWND(window.hwnd()?.0),
                None,
                0,
                0,
                0,
                0,
                SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
            )
            .map_err(|error| tauri::Error::Io(std::io::Error::other(error.to_string())))?;
        }
        let outer = window.outer_size()?;
        let inner = window.inner_size()?;
        self.top_border =
            outer.height.saturating_sub(inner.height) > outer.width.saturating_sub(inner.width) / 2;
        let saved = self.load().unwrap_or_else(|error| {
            eprintln!("{error}");
            None
        });
        let monitors = window.available_monitors()?;
        let Some(primary) = window
            .primary_monitor()?
            .or_else(|| monitors.first().cloned())
        else {
            return Ok(());
        };
        let area = |monitor: &tauri::Monitor| {
            let work = monitor.work_area();
            WorkArea {
                x: work.position.x,
                y: work.position.y,
                width: work.size.width,
                height: work.size.height,
                scale: monitor.scale_factor(),
                frame: native_frame(
                    (monitor.scale_factor() * 96.0).round() as u32,
                    self.top_border,
                ),
            }
        };
        let areas: Vec<_> = monitors.iter().map(area).collect();
        let target = placement(saved, &areas, area(&primary));
        // Physical dimensions use the destination monitor's scale, even before DPI events settle.
        window.set_position(PhysicalPosition::new(target.x, target.y))?;
        window.set_size(PhysicalSize::new(target.width, target.height))?;
        // A DPI transition may adjust the origin while changing the client size.
        window.set_position(PhysicalPosition::new(target.x, target.y))?;
        Ok(())
    }

    fn write(&self, geometry: Geometry) -> Result<(), String> {
        if !geometry.valid() {
            return Err("窗口状态尺寸无效。".into());
        }
        let parent = self.path.parent().ok_or("窗口状态目录无效。")?;
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("创建窗口状态目录失败：{error}"))?;
        let temporary = self.path.with_extension("json.tmp");
        let bytes = serde_json::to_vec_pretty(&geometry).map_err(|error| error.to_string())?;
        let mut file = std::fs::File::create(&temporary).map_err(|error| error.to_string())?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|error| error.to_string())?;
        drop(file);
        let from: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = self.path.as_os_str().encode_wide().chain(Some(0)).collect();
        unsafe {
            MoveFileExW(
                PCWSTR(from.as_ptr()),
                PCWSTR(to.as_ptr()),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        }
        .map_err(|error| format!("保存窗口状态失败：{error}"))
    }
}

fn capture(window: &WebviewWindow, top_border: bool) -> Result<Geometry, String> {
    let handle = window.hwnd().map_err(|error| error.to_string())?;
    let handle = HWND(handle.0);
    unsafe {
        let previous = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let result = (|| {
            let mut placement = WINDOWPLACEMENT {
                length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
                ..Default::default()
            };
            GetWindowPlacement(handle, &mut placement).map_err(|error| error.to_string())?;
            let mut monitor = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            GetMonitorInfoW(
                MonitorFromWindow(handle, MONITOR_DEFAULTTONEAREST),
                &mut monitor,
            )
            .ok()
            .map_err(|error| error.to_string())?;
            let dpi = GetDpiForWindow(handle);
            if dpi == 0 {
                return Err("读取窗口缩放比例失败。".into());
            }
            let scale = f64::from(dpi) / 96.0;
            let mut rect = placement.rcNormalPosition;
            // Ordinary top-level placements use workspace coordinates; tool windows use screen coordinates.
            if GetWindowLongW(handle, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0 == 0 {
                rect.left += monitor.rcWork.left - monitor.rcMonitor.left;
                rect.top += monitor.rcWork.top - monitor.rcMonitor.top;
                rect.right += monitor.rcWork.left - monitor.rcMonitor.left;
                rect.bottom += monitor.rcWork.top - monitor.rcMonitor.top;
            }
            let frame = native_frame(dpi, top_border);
            Ok(Geometry::from_physical(
                rect.left,
                rect.top,
                ((i64::from(rect.right) - i64::from(rect.left)).max(0) as u32)
                    .saturating_sub(frame.0),
                ((i64::from(rect.bottom) - i64::from(rect.top)).max(0) as u32)
                    .saturating_sub(frame.1),
                scale,
            ))
        })();
        if !previous.is_invalid() {
            let _ = SetThreadDpiAwarenessContext(previous);
        }
        result
    }
}

/// Best-effort geometry persistence before normal exit or installer takeover.
pub(crate) fn save(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let store = app.state::<Store>();
        if let Err(error) =
            capture(&window, store.top_border).and_then(|geometry| store.write(geometry))
        {
            eprintln!("{error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn primary() -> WorkArea {
        WorkArea {
            x: 0,
            y: 40,
            width: 1920,
            height: 1000,
            scale: 1.0,
            frame: (0, 0),
        }
    }
    #[test]
    fn restores_valid_geometry_including_negative_monitor_coordinates() {
        let left = WorkArea {
            x: -1920,
            ..primary()
        };
        let saved = Geometry {
            x: -1600,
            y: 100,
            width: 600.0,
            height: 450.0,
        };
        assert_eq!(
            placement(Some(saved), &[primary(), left], primary()),
            Placement {
                x: -1600,
                y: 100,
                width: 600,
                height: 450
            }
        );
    }
    #[test]
    fn recenters_offscreen_partial_and_gap_positions_without_losing_size() {
        let right = WorkArea {
            x: 2500,
            ..primary()
        };
        for (x, y) in [
            (10000, 100),
            (1600, 100),
            (1950, 100),
            (100, 0),
            (i32::MAX, i32::MAX),
        ] {
            assert_eq!(
                placement(
                    Some(Geometry {
                        x,
                        y,
                        width: 600.0,
                        height: 450.0
                    }),
                    &[primary(), right],
                    primary()
                ),
                Placement {
                    x: 660,
                    y: 315,
                    width: 600,
                    height: 450
                }
            );
        }
    }
    #[test]
    fn uses_destination_scale_and_clamps_oversized_geometry() {
        let scaled = WorkArea {
            scale: 1.5,
            ..primary()
        };
        let saved = Geometry {
            x: 100,
            y: 100,
            width: 600.0,
            height: 450.0,
        };
        assert_eq!(
            placement(Some(saved), &[scaled], scaled),
            Placement {
                x: 100,
                y: 100,
                width: 900,
                height: 675
            }
        );
        assert_eq!(
            placement(
                Some(Geometry {
                    width: 3000.0,
                    height: 2000.0,
                    ..saved
                }),
                &[scaled],
                scaled
            ),
            Placement {
                x: 0,
                y: 40,
                width: 1920,
                height: 1000
            }
        );
    }
    #[test]
    fn defaults_invalid_sizes_and_keeps_minimum_on_small_workareas() {
        for width in [0.0, -1.0, 319.0, f64::NAN, f64::INFINITY] {
            assert_eq!(
                placement(
                    Some(Geometry {
                        x: 100,
                        y: 100,
                        width,
                        height: 450.0
                    }),
                    &[primary()],
                    primary()
                ),
                Placement {
                    x: 660,
                    y: 370,
                    width: 600,
                    height: 340
                }
            );
        }
        let small = WorkArea {
            width: 300,
            height: 200,
            ..primary()
        };
        assert_eq!(
            placement(None, &[small], small),
            Placement {
                x: 0,
                y: 40,
                width: 320,
                height: 340
            }
        );
    }
    #[test]
    fn checks_and_centers_the_entire_native_frame() {
        let area = WorkArea {
            frame: (16, 8),
            ..primary()
        };
        let saved = Geometry {
            x: 1320,
            y: 100,
            width: 600.0,
            height: 450.0,
        };
        assert_eq!(
            placement(Some(saved), &[area], area),
            Placement {
                x: 652,
                y: 311,
                width: 600,
                height: 450
            }
        );
        assert_eq!(
            placement(
                Some(Geometry {
                    width: 3000.0,
                    height: 2000.0,
                    ..saved
                }),
                &[area],
                area
            ),
            Placement {
                x: 0,
                y: 40,
                width: 1904,
                height: 992
            }
        );
    }
    #[test]
    fn fractional_dpi_minimum_sizes_round_trip_and_top_insets_follow_each_dpi() {
        for dpi in [96, 106, 120, 144, 168, 192] {
            let scale = f64::from(dpi) / 96.0;
            let geometry = Geometry::from_physical(
                100,
                120,
                (320.0 * scale).round() as u32,
                (340.0 * scale).round() as u32,
                scale,
            );
            assert!(geometry.valid());
            let area = WorkArea {
                scale,
                frame: native_frame(dpi, true),
                ..primary()
            };
            let restored = placement(Some(geometry), &[area], area);
            assert_eq!((restored.x, restored.y), (100, 120));
            assert_eq!(
                (restored.width, restored.height),
                (
                    (320.0 * scale).round() as u32,
                    (340.0 * scale).round() as u32
                )
            );
        }
        assert_eq!(native_frame(96, true).1 - native_frame(96, false).1, 1);
        assert_eq!(native_frame(144, true).1 - native_frame(144, false).1, 2);
    }
    #[test]
    fn missing_corrupt_and_invalid_records_are_distinct_from_valid_records() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::new(directory.path().join("nested/window-state.json"));
        assert_eq!(store.load().unwrap(), None);
        let geometry = Geometry {
            x: -1600,
            y: 100,
            width: 600.0,
            height: 450.0,
        };
        store.write(geometry).unwrap();
        assert_eq!(store.load().unwrap(), Some(geometry));
        let replacement = Geometry { x: 100, ..geometry };
        store.write(replacement).unwrap();
        assert_eq!(store.load().unwrap(), Some(replacement));
        assert!(store
            .write(Geometry {
                width: 0.0,
                ..geometry
            })
            .is_err());
        assert_eq!(store.load().unwrap(), Some(replacement));
        std::fs::write(&store.path, "broken").unwrap();
        assert!(store.load().is_err());
        std::fs::write(&store.path, r#"{"x":0,"y":0,"width":1,"height":340}"#).unwrap();
        assert!(store.load().is_err());
    }
}
