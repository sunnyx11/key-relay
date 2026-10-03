//! Windows desktop text relay.
mod commands;
pub mod settings;
mod shortcut;
pub mod task;
pub mod text;
pub mod windows;

use tauri::Manager;

/// Run the Windows application with a single native task owner.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let path = app.path().app_config_dir()?.join("settings.json");
            app.manage(commands::Runtime::spawn(app.handle().clone(), path));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::sync_draft,
            commands::start_task,
            commands::cancel_task,
            commands::save_settings
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                window
                    .state::<commands::Runtime>()
                    .shutdown(window.app_handle().clone());
            }
        })
        .run(tauri::generate_context!())
        .expect("Key Relay application initialization failed");
}
