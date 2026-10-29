use serde::{Deserialize, Serialize};
use std::path::Path;

/// Validated persistent preferences; character spacing is measured in milliseconds.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub interval_ms: u64,
}
impl Default for Settings {
    fn default() -> Self {
        Self { interval_ms: 50 }
    }
}
impl Settings {
    /// Reject character intervals outside the supported integer range.
    pub fn validate(&self) -> Result<(), String> {
        if !(10..=1000).contains(&self.interval_ms) {
            return Err("请输入 10～1,000 毫秒的整数。".into());
        }
        Ok(())
    }
    /// Read validated preferences; a missing file uses defaults.
    pub fn load(path: &Path) -> Result<Self, String> {
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(_) => return Err("读取设置失败，请检查配置目录权限。".into()),
        };
        let settings: Self = serde_json::from_slice(&bytes)
            .map_err(|_| "设置文件格式无效，请恢复默认设置。".to_string())?;
        settings.validate()?;
        Ok(settings)
    }
    /// Atomically replace the preferences file after validation.
    pub fn save(&self, path: &Path) -> Result<(), String> {
        use std::io::Write;
        use std::os::windows::ffi::OsStrExt;
        use windows::{
            core::PCWSTR,
            Win32::Storage::FileSystem::{
                MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
            },
        };
        self.validate()?;
        let parent = path.parent().ok_or("设置目录无效。")?;
        std::fs::create_dir_all(parent).map_err(|_| "创建设置目录失败。")?;
        let temporary = path.with_extension("json.tmp");
        let bytes = serde_json::to_vec_pretty(self).map_err(|_| "编码设置失败。")?;
        let mut file = std::fs::File::create(&temporary).map_err(|_| "创建设置文件失败。")?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "写入设置失败。")?;
        drop(file);
        let from: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        unsafe {
            MoveFileExW(
                PCWSTR(from.as_ptr()),
                PCWSTR(to.as_ptr()),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        }
        .map_err(|_| "保存设置失败，请检查配置目录权限。".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn interval_only_preferences_load_and_save() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{"intervalMs":120}"#).unwrap();
        let settings = Settings::load(&path).unwrap();
        assert_eq!(settings.interval_ms, 120);
        settings.save(&path).unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&std::fs::read(path).unwrap()).unwrap(),
            serde_json::json!({"intervalMs":120})
        );
    }
    #[test]
    fn validates_all_boundaries() {
        assert!(Settings::default().validate().is_ok());
        for spacing in [0, 9, 1001] {
            assert!(Settings {
                interval_ms: spacing
            }
            .validate()
            .is_err());
        }
        for spacing in [10, 1000] {
            assert!(Settings {
                interval_ms: spacing
            }
            .validate()
            .is_ok());
        }
    }
    #[test]
    fn persists_settings_without_text_and_replaces_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        assert_eq!(Settings::load(&path).unwrap(), Settings::default());
        let first = Settings { interval_ms: 80 };
        first.save(&path).unwrap();
        assert_eq!(Settings::load(&path).unwrap(), first);
        Settings::default().save(&path).unwrap();
        assert_eq!(Settings::load(&path).unwrap(), Settings::default());
        assert!(!std::fs::read_to_string(&path).unwrap().contains("text"));
    }
    #[test]
    fn old_preferences_keep_interval_and_save_current_fields() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(
            &path,
            r#"{"delaySeconds":7,"intervalMs":120,"shortcut":"F10"}"#,
        )
        .unwrap();
        let settings = Settings::load(&path).unwrap();
        assert_eq!(settings.interval_ms, 120);
        settings.save(&path).unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&std::fs::read(path).unwrap()).unwrap(),
            serde_json::json!({"intervalMs":120})
        );
    }
    #[test]
    fn invalid_save_preserves_existing_preferences() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        Settings::default().save(&path).unwrap();
        assert!(Settings { interval_ms: 0 }.save(&path).is_err());
        assert_eq!(Settings::load(&path).unwrap(), Settings::default());
        std::fs::write(&path, "broken").unwrap();
        assert!(Settings::load(&path).is_err());
    }
}
