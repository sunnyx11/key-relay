//! Windows desktop text relay.
pub mod archive;
mod commands;
pub mod settings;
pub mod task;
pub mod text;
mod updates;
mod window_state;
pub mod windows;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let result = (|| -> tauri::Result<()> {
            if window.is_minimized()? {
                window.unminimize()?;
            }
            window.show()?;
            window.set_focus()
        })();
        if let Err(error) = result {
            eprintln!("打开窗口失败：{error}");
        }
    }
}

fn show_exit_error(app: &tauri::AppHandle, error: &str) {
    use ::windows::{
        core::PCWSTR,
        Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK},
    };
    show_main_window(app);
    let message: Vec<u16> = format!("退出应用失败：{error}\n请从通知区域选择退出应用以重试。")
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let title: Vec<u16> = "Key Relay".encode_utf16().chain(Some(0)).collect();
    unsafe {
        MessageBoxW(
            None,
            PCWSTR(message.as_ptr()),
            PCWSTR(title.as_ptr()),
            MB_OK | MB_ICONERROR,
        );
    }
}

fn request_exit(app: &tauri::AppHandle) {
    if app.state::<updates::Updates>().installing() {
        return;
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let runtime = app.state::<commands::Runtime>();
    if runtime
        .editor_ready
        .load(std::sync::atomic::Ordering::SeqCst)
    {
        let (reply, _) = std::sync::mpsc::channel();
        if let Err(error) = runtime.sender.send(commands::Message::Cancel(reply)) {
            show_exit_error(app, &error.to_string());
            return;
        }
        if let Err(error) = window.emit("relay-close-requested", ()) {
            show_exit_error(app, &error.to_string());
        }
    } else {
        runtime.shutdown(app.clone());
    }
}

fn tray_icon(icon: &tauri::image::Image<'_>) -> tauri::image::Image<'static> {
    let width = icon.width() as usize;
    let height = icon.height() as usize;
    let mut margin = width.min(height) / 2;
    let mut visible = false;
    for (index, pixel) in icon.rgba().chunks_exact(4).enumerate() {
        if pixel[3] != 0 {
            let x = index % width;
            let y = index / width;
            margin = margin.min(x).min(y).min(width - 1 - x).min(height - 1 - y);
            visible = true;
        }
    }
    if !visible || margin == 0 {
        return icon.clone().to_owned();
    }
    let cropped_width = width - 2 * margin;
    let cropped_height = height - 2 * margin;
    let mut rgba = Vec::with_capacity(cropped_width * cropped_height * 4);
    for y in margin..height - margin {
        let start = (y * width + margin) * 4;
        rgba.extend_from_slice(&icon.rgba()[start..start + cropped_width * 4]);
    }
    tauri::image::Image::new_owned(rgba, cropped_width as u32, cropped_height as u32)
}

fn data_directory(
    home: tauri::Result<std::path::PathBuf>,
    test_directory: Option<std::ffi::OsString>,
) -> tauri::Result<std::path::PathBuf> {
    test_directory.map_or_else(
        || home.map(|home| home.join(".key-relay")),
        |directory| Ok(directory.into()),
    )
}

/// Run the Windows application with a single native task owner.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let directory = data_directory(
                app.path().home_dir(),
                std::env::var_os("KEY_RELAY_TEST_CONFIG_DIR"),
            )?;
            let mut geometry = window_state::Store::new(directory.join("window-state.json"));
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = geometry.restore(&window) {
                    eprintln!("恢复窗口状态失败：{error}");
                }
            }
            app.manage(geometry);
            let path = directory.join("settings.json");
            let archive =
                archive::Archive::spawn(app.handle().clone(), path.with_file_name("text.json"));
            app.manage(commands::Runtime::spawn(
                app.handle().clone(),
                path,
                archive,
            ));
            app.manage(updates::Updates::new(directory.join("updates.json")));
            let open = MenuItem::with_id(app, "open", "打开窗口", true, None::<&str>)?;
            let reset = MenuItem::with_id(app, "reset", "重置位置", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出应用", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &reset, &quit])?;
            let icon = app
                .default_window_icon()
                .ok_or_else(|| std::io::Error::other("应用图标不可用"))?;
            TrayIconBuilder::new()
                .icon(tray_icon(icon))
                .tooltip("Key Relay")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_main_window(app),
                    "reset" => {
                        if let Some(window) = app.get_webview_window("main") {
                            if let Err(error) = window_state::reset_position(&window) {
                                eprintln!("重置窗口位置失败：{error}");
                            }
                            show_main_window(app);
                        }
                    }
                    "quit" => request_exit(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::sync_draft,
            commands::start_task,
            commands::cancel_task,
            commands::save_settings,
            commands::get_text_state,
            commands::change_text_state,
            commands::flush_text,
            commands::close_app,
            updates::get_update_state,
            updates::set_update_preference,
            updates::check_update,
            updates::download_update,
            updates::install_update
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if window.state::<updates::Updates>().installing() {
                    return;
                }
                if let Err(error) = window.hide() {
                    eprintln!("隐藏窗口失败：{error}");
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Key Relay application initialization failed");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_icon_removes_symmetric_transparent_margin() {
        let mut rgba = vec![0; 6 * 6 * 4];
        for y in 1..5 {
            for x in 1..5 {
                let offset = (y * 6 + x) * 4;
                rgba[offset..offset + 4].copy_from_slice(&[50, 103, 152, 128]);
            }
        }
        let icon = tauri::image::Image::new_owned(rgba.clone(), 6, 6);
        let tray_icon = super::tray_icon(&icon);

        assert_eq!((tray_icon.width(), tray_icon.height()), (4, 4));
        assert_eq!(tray_icon.rgba(), [50, 103, 152, 128].repeat(16));
        assert_eq!(icon.rgba(), rgba);
    }

    #[test]
    fn tray_icon_preserves_transparent_and_asymmetric_images() {
        let transparent = tauri::image::Image::new_owned(vec![0; 4 * 4 * 4], 4, 4);
        let tray_icon = super::tray_icon(&transparent);
        assert_eq!((tray_icon.width(), tray_icon.height()), (4, 4));
        assert_eq!(tray_icon.rgba(), transparent.rgba());

        let mut rgba = vec![0; 4 * 4 * 4];
        rgba[19] = 1;
        let asymmetric = tauri::image::Image::new_owned(rgba, 4, 4);
        let tray_icon = super::tray_icon(&asymmetric);
        assert_eq!((tray_icon.width(), tray_icon.height()), (4, 4));
        assert_eq!(tray_icon.rgba(), asymmetric.rgba());
    }

    #[test]
    fn normal_storage_uses_the_hidden_home_directory() {
        let home = std::path::PathBuf::from("C:/Users/example");
        assert_eq!(
            data_directory(Ok(home.clone()), None).unwrap(),
            home.join(".key-relay")
        );
    }

    #[test]
    fn missing_new_files_use_defaults_and_leave_legacy_files_untouched() {
        let home = tempfile::tempdir().unwrap();
        let legacy = home
            .path()
            .join("AppData/Roaming/io.github.key-relay.desktop");
        std::fs::create_dir_all(&legacy).unwrap();
        let settings = settings::Settings { interval_ms: 999 };
        settings.save(&legacy.join("settings.json")).unwrap();
        let mut text = archive::TextData::default();
        text.update_draft("legacy draft");
        text.record("legacy history", 1);
        text.save(&legacy.join("text.json")).unwrap();
        let directory = data_directory(Ok(home.path().to_owned()), None).unwrap();
        assert_eq!(
            settings::Settings::load(&directory.join("settings.json")).unwrap(),
            settings::Settings::default()
        );
        assert_eq!(
            archive::TextData::load(&directory.join("text.json")).unwrap(),
            archive::TextData::default()
        );
        assert_eq!(
            settings::Settings::load(&legacy.join("settings.json")).unwrap(),
            settings
        );
        assert_eq!(
            archive::TextData::load(&legacy.join("text.json")).unwrap(),
            text
        );
        assert!(!directory.exists());
    }

    #[test]
    fn test_storage_overrides_home_without_loading_user_data() {
        let isolated = tempfile::tempdir().unwrap();
        assert_eq!(
            data_directory(
                Err(std::io::Error::other("home unavailable").into()),
                Some(isolated.path().as_os_str().to_owned()),
            )
            .unwrap(),
            isolated.path()
        );
        assert!(
            data_directory(Err(std::io::Error::other("home unavailable").into()), None).is_err()
        );
    }
}
