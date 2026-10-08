use crate::{
    commands::{Message, Runtime},
    windows::hooks::Signals,
};
use std::sync::{atomic::Ordering, Arc};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Replace the application's shortcut; failure keeps button-based input available.
pub fn register(app: &AppHandle, key: &str, signals: Arc<Signals>) -> Result<(), String> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|_| "释放原快捷键失败，请重启软件。".to_string())?;
    let function_key = match key {
        "F8" => 0x77,
        "F9" => 0x78,
        "F10" => 0x79,
        _ => unreachable!("shortcut preferences are validated before use"),
    };
    signals.shortcut_key.store(function_key, Ordering::SeqCst);
    let accelerator = format!("Ctrl+Alt+{key}");
    app.global_shortcut()
        .on_shortcut(accelerator.as_str(), move |app, _, event| {
            if event.state == ShortcutState::Pressed {
                if let Some(runtime) = app.try_state::<Runtime>() {
                    let _ = runtime.sender.send(Message::Shortcut {
                        cycle: signals.cycle.load(Ordering::SeqCst),
                        key: function_key,
                    });
                }
            }
        })
        .map_err(|_| "快捷键注册失败，可能已被占用；请选择其他组合键。".into())
}
