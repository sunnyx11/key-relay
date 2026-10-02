use serde::{Deserialize, Serialize};
use std::path::Path;

/// Validated persistent preferences; timing values are integer seconds/milliseconds.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub delay_seconds: u64,
    pub interval_ms: u64,
    pub shortcut: String,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            delay_seconds: 5,
            interval_ms: 50,
            shortcut: "F8".into(),
        }
    }
}
impl Settings {
    /// Reject out-of-range timing and unsupported shortcut selections.
    pub fn validate(&self) -> Result<(), String> {
        if !(1..=60).contains(&self.delay_seconds) {
            return Err("请输入 1～60 秒的整数。".into());
        }
        if !(10..=1000).contains(&self.interval_ms) {
            return Err("请输入 10～1,000 毫秒的整数。".into());
        }
        if !matches!(self.shortcut.as_str(), "F8" | "F9" | "F10") {
            return Err("请选择 F8、F9 或 F10 快捷键。".into());
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
    fn validates_all_boundaries() {
        assert!(Settings::default().validate().is_ok());
        for delay in [0, 61] {
            assert!(Settings {
                delay_seconds: delay,
                ..Settings::default()
            }
            .validate()
            .is_err());
        }
        for spacing in [0, 9, 1001] {
            assert!(Settings {
                interval_ms: spacing,
                ..Settings::default()
            }
            .validate()
            .is_err());
        }
        for (delay, spacing) in [(1, 10), (60, 1000)] {
            assert!(Settings {
                delay_seconds: delay,
                interval_ms: spacing,
                shortcut: "F10".into()
            }
            .validate()
            .is_ok());
        }
        assert!(Settings {
            shortcut: "F11".into(),
            ..Settings::default()
        }
        .validate()
        .is_err());
    }
    #[test]
    fn persists_settings_without_text_and_replaces_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        assert_eq!(Settings::load(&path).unwrap(), Settings::default());
        let first = Settings {
            delay_seconds: 8,
            ..Settings::default()
        };
        first.save(&path).unwrap();
        assert_eq!(Settings::load(&path).unwrap(), first);
        Settings::default().save(&path).unwrap();
        assert_eq!(Settings::load(&path).unwrap(), Settings::default());
        assert!(!std::fs::read_to_string(&path).unwrap().contains("text"));
    }
    #[test]
    fn invalid_save_preserves_existing_preferences() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        Settings::default().save(&path).unwrap();
        assert!(Settings {
            delay_seconds: 0,
            ..Settings::default()
        }
        .save(&path)
        .is_err());
        assert_eq!(Settings::load(&path).unwrap(), Settings::default());
        std::fs::write(&path, "broken").unwrap();
        assert!(Settings::load(&path).is_err());
    }
}
