//! Windows desktop text relay.
pub mod archive;
mod commands;
pub mod settings;
mod shortcut;
pub mod task;
pub mod text;
mod updates;
mod window_state;
pub mod windows;

use tauri::{Emitter, Manager};

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
            if let Some(window) = app.get_webview_window("main") {
                if window.is_minimized().unwrap_or(false) {
                    let _ = window.unminimize();
                }
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
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
                let runtime = window.state::<commands::Runtime>();
                if runtime
                    .editor_ready
                    .load(std::sync::atomic::Ordering::SeqCst)
                {
                    let (reply, _) = std::sync::mpsc::channel();
                    let _ = runtime.sender.send(commands::Message::Cancel(reply));
                    let _ = window.emit("relay-close-requested", ());
                } else {
                    runtime.shutdown(window.app_handle().clone());
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
        let settings = settings::Settings {
            interval_ms: 999,
            shortcut: "F10".into(),
        };
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
