//! Signed release discovery and in-memory downloads; installation is serialized with input tasks.
use crate::commands::{self, Runtime};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

const ENDPOINT: &str = "https://github.com/sunnyx11/key-relay/releases/latest/download/latest.json";

/// Ordered UI state excludes the downloaded executable and all editor data.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSnapshot {
    sequence: u64,
    phase: &'static str,
    installed: bool,
    auto_check: bool,
    version: Option<String>,
    notes: String,
    downloaded: u64,
    total: Option<u64>,
    message: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Preferences {
    auto_check: bool,
}
struct DownloadState {
    snapshot: UpdateSnapshot,
    candidate: Option<Update>,
    bytes: Option<Vec<u8>>,
}
/// One native owner prevents concurrent checks, downloads and installation requests.
pub struct Updates {
    data: Mutex<DownloadState>,
    preferences: PathBuf,
}
impl Updates {
    /// Load update preferences separately from the input settings contract.
    pub fn new(preferences: PathBuf) -> Self {
        let loaded = match std::fs::read(&preferences) {
            Ok(bytes) => serde_json::from_slice::<Preferences>(&bytes)
                .map_err(|_| "更新偏好格式无效，请重新设置自动检查。"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(Preferences { auto_check: true })
            }
            Err(_) => Err("读取更新偏好失败，请检查配置目录权限。"),
        };
        let (auto_check, message) = match loaded {
            Ok(value) => (value.auto_check, String::new()),
            Err(error) => (false, error.into()),
        };
        Self {
            data: Mutex::new(DownloadState {
                snapshot: UpdateSnapshot {
                    sequence: 1,
                    phase: "idle",
                    installed: installed(),
                    auto_check,
                    version: None,
                    notes: String::new(),
                    downloaded: 0,
                    total: None,
                    message,
                },
                candidate: None,
                bytes: None,
            }),
            preferences,
        }
    }
    fn change(&self, app: &AppHandle, update: impl FnOnce(&mut DownloadState)) -> UpdateSnapshot {
        let mut data = self.data.lock().expect("update state lock");
        update(&mut data);
        data.snapshot.sequence += 1;
        let snapshot = data.snapshot.clone();
        let _ = app.emit("update-state", &snapshot);
        snapshot
    }
    /// Window-close handlers preserve the installer handoff once preparation begins.
    pub fn installing(&self) -> bool {
        self.data.lock().expect("update state lock").snapshot.phase == "installing"
    }
}
fn same_installation(executable: &Path, directory: &Path) -> bool {
    match (
        executable.canonicalize(),
        directory.join("key-relay.exe").canonicalize(),
    ) {
        (Ok(left), Ok(right)) => left
            .to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy()),
        _ => false,
    }
}
fn installed() -> bool {
    let Ok(key) = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Key Relay")
    else {
        return false;
    };
    let Ok(directory) = key.get_value::<String, _>("InstallLocation") else {
        return false;
    };
    std::env::current_exe().is_ok_and(|executable| {
        same_installation(&executable, Path::new(directory.trim_matches('"')))
    })
}
/// Read state without initiating a network request.
#[tauri::command]
pub fn get_update_state(updates: State<'_, Updates>) -> UpdateSnapshot {
    updates
        .data
        .lock()
        .expect("update state lock")
        .snapshot
        .clone()
}
/// Persist the explicit automatic-check preference; editor data is excluded.
#[tauri::command]
pub fn set_update_preference(
    app: AppHandle,
    updates: State<'_, Updates>,
    auto_check: bool,
) -> Result<UpdateSnapshot, String> {
    let parent = updates.preferences.parent().ok_or("更新配置目录无效。")?;
    std::fs::create_dir_all(parent).map_err(|_| "创建更新配置目录失败。")?;
    let temporary = updates.preferences.with_extension("tmp");
    let bytes =
        serde_json::to_vec(&Preferences { auto_check }).map_err(|_| "编码更新偏好失败。")?;
    // Serialize preference writes with snapshots and other preference requests.
    let mut data = updates.data.lock().expect("update state lock");
    std::fs::write(&temporary, bytes)
        .and_then(|_| std::fs::rename(&temporary, &updates.preferences))
        .map_err(|_| "保存更新偏好失败。")?;
    data.snapshot.auto_check = auto_check;
    data.snapshot.sequence += 1;
    let snapshot = data.snapshot.clone();
    let _ = app.emit("update-state", &snapshot);
    Ok(snapshot)
}
/// Check only the configured official stable channel. Checking never downloads an installer.
#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    updates: State<'_, Updates>,
) -> Result<UpdateSnapshot, String> {
    {
        let mut data = updates.data.lock().expect("update state lock");
        if matches!(
            data.snapshot.phase,
            "checking" | "downloading" | "ready" | "installing"
        ) {
            return Ok(data.snapshot.clone());
        }
        data.snapshot.phase = "checking";
        data.snapshot.message.clear();
        data.snapshot.sequence += 1;
        let _ = app.emit("update-state", &data.snapshot);
    }
    let result = async {
        let public_key = app
            .config()
            .plugins
            .0
            .get("updater")
            .and_then(|config| config.get("pubkey"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        if public_key.trim().is_empty() {
            return Err("此构建尚未配置更新公钥，请使用正式发布版。".to_string());
        }
        let updater = app
            .updater_builder()
            .endpoints(vec![ENDPOINT.parse().map_err(|_| "更新地址无效。")?])
            .map_err(|error| error.to_string())?
            .timeout(Duration::from_secs(30))
            .configure_client(|client| client.https_only(true))
            .version_comparator(|current, release| {
                release.version.pre.is_empty() && release.version > current
            })
            .restart_after_install(true)
            .build()
            .map_err(|error| error.to_string())?;
        updater
            .check()
            .await
            .map_err(|error| format!("更新检查失败，请检查网络后重试。{error}"))
    }
    .await;
    Ok(updates.change(&app, |data| match result {
        Ok(candidate) => {
            data.snapshot.phase = if candidate.is_some() {
                "available"
            } else {
                "current"
            };
            data.snapshot.version = candidate.as_ref().map(|value| value.version.clone());
            data.snapshot.notes = candidate
                .as_ref()
                .and_then(|value| value.body.clone())
                .unwrap_or_default();
            data.candidate = candidate;
        }
        Err(error) => {
            data.snapshot.phase = "error";
            data.snapshot.message = error;
        }
    }))
}
/// Download on request and expose ready only after the official updater verifies the signature.
#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    updates: State<'_, Updates>,
) -> Result<UpdateSnapshot, String> {
    let candidate = {
        let mut data = updates.data.lock().expect("update state lock");
        if !data.snapshot.installed {
            return Err("独立 EXE 请从发布页面下载更新。".into());
        }
        if data.snapshot.phase != "available" {
            return Err("请先检查并选择可用更新。".into());
        }
        let mut candidate = data.candidate.clone().ok_or("缺少更新信息，请重新检查。")?;
        candidate.timeout = Some(Duration::from_secs(600));
        data.snapshot.phase = "downloading";
        data.snapshot.downloaded = 0;
        data.snapshot.total = None;
        data.snapshot.message.clear();
        data.snapshot.sequence += 1;
        let _ = app.emit("update-state", &data.snapshot);
        candidate
    };
    let mut last_progress = std::time::Instant::now();
    let mut downloaded = 0;
    let result = candidate
        .download(
            |length, total| {
                downloaded += length as u64;
                if last_progress.elapsed() >= Duration::from_millis(100) {
                    updates.change(&app, |data| {
                        data.snapshot.downloaded = downloaded;
                        data.snapshot.total = total;
                    });
                    last_progress = std::time::Instant::now();
                }
            },
            || {},
        )
        .await;
    Ok(updates.change(&app, |data| match result {
        Ok(bytes) => {
            data.snapshot.downloaded = bytes.len() as u64;
            data.snapshot.total = Some(bytes.len() as u64);
            data.bytes = Some(bytes);
            data.snapshot.phase = "ready";
        }
        Err(error) => {
            data.bytes = None;
            data.snapshot.phase = "available";
            data.snapshot.message = format!("下载或签名验证失败，请重试。{error}");
        }
    }))
}
/// Install an already verified package after the editor-loss confirmation and native idle check.
#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    updates: State<'_, Updates>,
    runtime: State<'_, Runtime>,
    confirmed: bool,
) -> Result<UpdateSnapshot, String> {
    if !confirmed {
        return Err("安装更新需要确认重启后清除编辑文本。".into());
    }
    let (candidate, bytes) = {
        let mut data = updates.data.lock().expect("update state lock");
        if !data.snapshot.installed || data.snapshot.phase != "ready" {
            return Err("更新尚未准备完成。".into());
        }
        let candidate = data.candidate.clone().ok_or("缺少更新信息。")?;
        let bytes = data.bytes.take().ok_or("缺少已验证的更新包。")?;
        data.snapshot.phase = "installing";
        data.snapshot.sequence += 1;
        let _ = app.emit("update-state", &data.snapshot);
        (candidate, bytes)
    };
    if let Err(error) = commands::prepare_update(&runtime).await {
        let recovery = commands::resume_update(&runtime).await.err();
        return Ok(updates.change(&app, |data| {
            data.bytes = Some(bytes);
            data.snapshot.phase = "ready";
            data.snapshot.message =
                recovery.map_or(error.clone(), |value| format!("{error} {value}"));
        }));
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let error = candidate
            .install(&bytes)
            .err()
            .map(|error| error.to_string());
        (bytes, error)
    })
    .await;
    let recovery = commands::resume_update(&runtime).await.err();
    Ok(updates.change(&app, |data| {
        let error = match result {
            Ok((bytes, error)) => {
                data.bytes = Some(bytes);
                error.unwrap_or_else(|| "安装程序未接管，请重试。".into())
            }
            Err(error) => error.to_string(),
        };
        data.snapshot.phase = if data.bytes.is_some() {
            "ready"
        } else {
            "available"
        };
        data.snapshot.message = format!(
            "安装启动失败：{error}{}",
            recovery
                .map(|value| format!(" {value}"))
                .unwrap_or_default()
        );
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn copied_executable_is_portable_even_if_an_installation_exists() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("installed");
        std::fs::create_dir(&directory).unwrap();
        let executable = directory.join("key-relay.exe");
        std::fs::write(&executable, b"app").unwrap();
        let copied = root.path().join("key-relay.exe");
        std::fs::copy(&executable, &copied).unwrap();
        assert!(same_installation(&executable, &directory));
        assert!(!same_installation(&copied, &directory));
    }
    #[test]
    fn new_preferences_enable_checks_and_corruption_requires_explicit_choice() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("updates.json");
        assert!(
            Updates::new(path.clone())
                .data
                .lock()
                .unwrap()
                .snapshot
                .auto_check
        );
        std::fs::write(&path, b"invalid").unwrap();
        let updates = Updates::new(path);
        let state = updates.data.lock().unwrap();
        assert!(!state.snapshot.auto_check);
        assert!(!state.snapshot.message.is_empty());
    }
}
