//! Local text archive and its serialized, debounced disk writer.
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::mpsc::{self, Sender},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};

/// Complete original text of a started task; timestamps are Unix milliseconds.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: u64,
    pub time: u64,
    pub text: String,
}

/// Per-user text.json data; disabling a preference preserves previously saved data.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextData {
    pub restore_draft: bool,
    pub save_history: bool,
    pub draft: String,
    pub entries: Vec<HistoryEntry>,
    next_id: u64,
}
impl Default for TextData {
    fn default() -> Self {
        Self {
            restore_draft: true,
            save_history: true,
            draft: String::new(),
            entries: Vec::new(),
            next_id: 1,
        }
    }
}
impl TextData {
    /// Load saved text; missing files use defaults and malformed files remain untouched.
    pub fn load(path: &Path) -> Result<Self, String> {
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default())
            }
            Err(_) => return Err("读取上次内容失败，请检查配置目录权限。".into()),
        };
        let data: Self = serde_json::from_slice(&bytes)
            .map_err(|_| "读取上次内容失败，文本文件格式无效。".to_string())?;
        if data.next_id == 0
            || data.next_id >= 9_007_199_254_740_991
            || data.entries.len() > 100
            || data.entries.iter().any(|entry| {
                entry.id == 0
                    || entry.id >= data.next_id
                    || entry.time > 8_640_000_000_000_000
                    || entry.text.is_empty()
            })
            || data.entries.iter().enumerate().any(|(index, entry)| {
                data.entries[..index]
                    .iter()
                    .any(|other| other.id == entry.id)
            })
        {
            return Err("读取上次内容失败，历史记录格式无效。".into());
        }
        Ok(data)
    }
    /// Save with a flushed temporary file and atomic Windows replacement; errors omit text.
    pub fn save(&self, path: &Path) -> Result<(), String> {
        use std::{io::Write, os::windows::ffi::OsStrExt};
        use windows::{
            core::PCWSTR,
            Win32::Storage::FileSystem::{
                MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
            },
        };
        let parent = path.parent().ok_or("文本保存目录无效。")?;
        std::fs::create_dir_all(parent).map_err(|_| "创建文本保存目录失败。")?;
        let temporary = path.with_extension("json.tmp");
        let bytes = serde_json::to_vec(self).map_err(|_| "编码保存内容失败。")?;
        let mut file = std::fs::File::create(&temporary).map_err(|_| "创建文本保存文件失败。")?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "内容暂未保存，关闭后可能丢失。")?;
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
        .map_err(|_| "内容暂未保存，关闭后可能丢失。".to_string())
    }
    /// Update the latest draft while its save preference is enabled.
    pub fn update_draft(&mut self, text: &str) {
        if self.restore_draft {
            self.draft = text.into();
        }
    }
    /// Capture a started task, merging only the most recent identical original text.
    pub fn record(&mut self, text: &str, time: u64) {
        if !self.save_history || text.is_empty() {
            return;
        }
        if let Some(entry) = self.entries.first_mut().filter(|entry| entry.text == text) {
            entry.time = time;
            return;
        }
        self.entries.insert(
            0,
            HistoryEntry {
                id: self.next_id,
                time,
                text: text.into(),
            },
        );
        self.next_id += 1;
        self.entries.truncate(100);
    }
}

/// Frontend archive state, independent of task snapshots and ordered by sequence.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextState {
    pub sequence: u64,
    #[serde(flatten)]
    pub data: TextData,
    pub can_undo: bool,
    pub error: Option<String>,
}
/// User text mutations accepted only while the task owner is idle.
#[derive(Clone, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TextAction {
    Preferences {
        restore_draft: bool,
        save_history: bool,
    },
    Delete {
        id: u64,
    },
    Undo,
    Clear,
    ClearDraft,
    Retry,
}
type Reply = Sender<Result<TextState, String>>;
enum Write {
    Read(Reply),
    Draft(u64, String),
    Record(String),
    Action(TextAction, Reply),
    Flush(Reply),
}
/// Dedicated disk owner; task submission only enqueues work and never waits for file I/O.
#[derive(Clone)]
pub struct Archive {
    sender: Sender<Write>,
}
impl Archive {
    /// Start the per-user writer. Events contain only local application data.
    pub fn spawn(app: AppHandle, path: PathBuf) -> Self {
        Self::open(path, move |state| {
            let _ = app.emit("text-state", state);
        })
    }
    /// Start the serialized writer with a local state notification sink.
    pub fn open(path: PathBuf, notify: impl Fn(&TextState) + Send + 'static) -> Self {
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let mut data: Option<TextData> = None;
            let mut storage_lock = None;
            let mut state_sequence = 0;
            let mut revision = 0;
            let mut dirty = false;
            let mut error = None;
            let mut deleted: Option<(HistoryEntry, u64)> = None;
            loop {
                let received = receiver.recv_timeout(if dirty {
                    Duration::from_millis(250)
                } else {
                    Duration::from_secs(60)
                });
                let mut reply = None;
                let mut save = false;
                let mut publish = false;
                match received {
                    Ok(Write::Read(tx)) => {
                        if data.is_none() {
                            let loaded = (|| {
                                let parent = path.parent().ok_or("文本目录不可用。")?;
                                std::fs::create_dir_all(parent)
                                    .map_err(|_| "文本目录读取失败。")?;
                                let lock = std::fs::OpenOptions::new()
                                    .read(true)
                                    .write(true)
                                    .create(true)
                                    .truncate(false)
                                    .open(path.with_extension("json.lock"))
                                    .map_err(|_| "文本存储锁定失败，请检查配置目录权限。")?;
                                lock.try_lock().map_err(|_| {
                                    "文本存储正由另一运行实例使用，请关闭该实例后重试读取。"
                                })?;
                                let value = TextData::load(&path)?;
                                storage_lock = Some(lock);
                                Ok::<_, String>(value)
                            })();
                            match loaded {
                                Ok(value) => data = Some(value),
                                Err(message) => {
                                    let _ = tx.send(Err(message));
                                    continue;
                                }
                            }
                        }
                        reply = Some(tx);
                    }
                    Ok(Write::Draft(next, text)) => {
                        if next > revision {
                            revision = next;
                            if let Some(value) = &mut data {
                                if value.restore_draft && value.draft != text {
                                    value.update_draft(&text);
                                    dirty = true;
                                }
                            }
                        }
                    }
                    Ok(Write::Record(text)) => {
                        if let Some(value) = &mut data {
                            if value.save_history {
                                value.record(&text, now());
                                dirty = true;
                                save = true;
                            }
                        }
                    }
                    Ok(Write::Action(action, tx)) => {
                        let Some(value) = &mut data else {
                            let _ = tx.send(Err("请先重试读取上次内容。".into()));
                            continue;
                        };
                        match action {
                            TextAction::Preferences {
                                restore_draft,
                                save_history,
                            } => {
                                value.restore_draft = restore_draft;
                                value.save_history = save_history;
                            }
                            TextAction::Delete { id } => {
                                if let Some(index) =
                                    value.entries.iter().position(|entry| entry.id == id)
                                {
                                    deleted = Some((value.entries.remove(index), now() + 10000));
                                }
                            }
                            TextAction::Undo => {
                                if let Some((entry, expires)) = deleted.take() {
                                    if now() <= expires {
                                        let index = value
                                            .entries
                                            .iter()
                                            .position(|other| other.id < entry.id)
                                            .unwrap_or(value.entries.len());
                                        value.entries.insert(index, entry);
                                        value.entries.truncate(100);
                                    }
                                }
                            }
                            TextAction::Clear => {
                                value.entries.clear();
                                deleted = None;
                            }
                            TextAction::ClearDraft => value.draft.clear(),
                            TextAction::Retry => {}
                        }
                        dirty = true;
                        save = true;
                        reply = Some(tx);
                    }
                    Ok(Write::Flush(tx)) => {
                        if data.is_none() {
                            let _ = tx.send(Ok(TextState {
                                sequence: state_sequence,
                                data: TextData::default(),
                                can_undo: false,
                                error: None,
                            }));
                            continue;
                        }
                        save = dirty || error.is_some();
                        reply = Some(tx);
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => save = dirty,
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        if dirty {
                            if let Some(value) = &data {
                                let _ = value.save(&path);
                            }
                        }
                        break;
                    }
                }
                if save {
                    if let Some(value) = &data {
                        error = value.save(&path).err();
                        // Explicit retry or a later edit retries failed writes without a busy loop.
                        dirty = false;
                        publish = true;
                    }
                }
                if publish || reply.is_some() {
                    if let Some(value) = &data {
                        state_sequence += 1;
                        let state = TextState {
                            sequence: state_sequence,
                            data: value.clone(),
                            can_undo: deleted
                                .as_ref()
                                .is_some_and(|(_, expires)| now() <= *expires),
                            error: error.clone(),
                        };
                        if publish {
                            notify(&state);
                        }
                        if let Some(tx) = reply {
                            let _ = tx.send(Ok(state));
                        }
                    }
                }
            }
        });
        Self { sender }
    }
    /// Queue the newest revision; older revisions cannot overwrite a newer draft.
    pub fn draft(&self, revision: u64, text: String) {
        let _ = self.sender.send(Write::Draft(revision, text));
    }
    /// Queue one frozen original when native submission starts, including one-unit tasks.
    pub fn record(&self, text: String) {
        let _ = self.sender.send(Write::Record(text));
    }
    fn request(&self, build: impl FnOnce(Reply) -> Write) -> Result<TextState, String> {
        let (tx, rx) = mpsc::channel();
        self.sender
            .send(build(tx))
            .map_err(|_| "文本保存线程已停止。".to_string())?;
        rx.recv_timeout(Duration::from_secs(10))
            .map_err(|_| "文本保存响应超时。".to_string())?
    }
    /// Load or retry reading without writing an empty replacement on failure.
    pub fn read(&self) -> Result<TextState, String> {
        self.request(Write::Read)
    }
    /// Serialize a user mutation with queued drafts and history captures.
    pub fn action(&self, action: TextAction) -> Result<TextState, String> {
        self.request(|reply| Write::Action(action, reply))
    }
    /// Persist all preceding queued drafts before shutdown or installation.
    pub fn flush(&self) -> Result<TextState, String> {
        let state = self.request(Write::Flush)?;
        if let Some(error) = &state.error {
            return Err(error.clone());
        }
        Ok(state)
    }
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
