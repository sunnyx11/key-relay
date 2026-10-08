use crate::{
    settings::Settings,
    text::{units, Unit},
    windows::input,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// UI draft with monotonic revision; invalid numeric drafts remain representable.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub revision: u64,
    pub text: String,
    pub settings: serde_json::Value,
}

/// Authoritative task phase shared with the frontend.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Idle,
    Arming,
    Countdown,
    Typing,
    Done,
    Stopped,
    Failed,
}

/// Complete UI snapshot, ordered by sequence; contains no prepared text.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub sequence: u64,
    pub phase: Phase,
    pub sent: usize,
    pub total: usize,
    pub remaining_seconds: u64,
    pub message: String,
    pub settings: Settings,
    pub shortcut_error: Option<String>,
    pub interaction_blocked: bool,
}

/// Deterministic task state. Time is monotonic milliseconds supplied by the worker.
pub struct Engine {
    pub snapshot: Snapshot,
    /// Frozen function key to await for a shortcut start; button starts use None.
    pub startup_key: Option<u32>,
    draft: Draft,
    pending: Vec<Unit>,
    deadline: u64,
    spacing: u64,
    held: HashSet<u32>,
    blocked_cycle: Option<u64>,
    cycle: u64,
    installing: bool,
}
impl Engine {
    /// Initialize idle state and an empty draft using validated preferences.
    pub fn new(settings: Settings) -> Self {
        Self {
            startup_key: None,
            draft: Draft {
                revision: 0,
                text: String::new(),
                settings: serde_json::to_value(&settings).unwrap(),
            },
            snapshot: Snapshot {
                sequence: 0,
                phase: Phase::Idle,
                sent: 0,
                total: 0,
                remaining_seconds: 0,
                message: String::new(),
                settings,
                shortcut_error: None,
                interaction_blocked: false,
            },
            pending: Vec::new(),
            deadline: 0,
            spacing: 50,
            held: HashSet::new(),
            blocked_cycle: None,
            cycle: 0,
            installing: false,
        }
    }
    /// True while a task owns the send pipeline.
    pub fn busy(&self) -> bool {
        matches!(
            self.snapshot.phase,
            Phase::Arming | Phase::Countdown | Phase::Typing
        )
    }
    /// Reserve the idle task owner for installation; both start sources share this guard.
    pub fn prepare_update(&mut self) -> Result<(), String> {
        if self.installing || self.busy() || self.snapshot.interaction_blocked {
            return Err("任务结束后可安装更新。".into());
        }
        self.installing = true;
        Ok(())
    }
    /// Release the installation reservation after native resources have been restored.
    pub fn resume_update(&mut self) {
        self.installing = false;
        self.held.clear();
    }
    /// Accept only newer editor revisions.
    pub fn sync(&mut self, draft: Draft) {
        if draft.revision > self.draft.revision {
            self.draft = draft;
        }
    }
    /// Start a frozen draft; None uses countdown, Some(vk) waits for the triggered shortcut.
    /// Repeated starts cancel active work; validation preserves the phase.
    pub fn start(
        &mut self,
        shortcut: Option<u32>,
        now: u64,
        own_foreground: bool,
        cycle: u64,
    ) -> Result<(), String> {
        if self.installing {
            return Err("正在安装更新，请稍候。".into());
        }
        if shortcut.is_some() && self.blocked_cycle == Some(cycle) {
            return Ok(());
        }
        if self.busy() {
            self.blocked_cycle = Some(cycle);
            self.cancel("已取消，剩余内容已取消");
            return Ok(());
        }
        if shortcut.is_some() && own_foreground {
            return Err("请先选择目标输入位置。".into());
        }
        if self.draft.text.is_empty() {
            return Err("请先填写文本。".into());
        }
        let settings: Settings = serde_json::from_value(self.draft.settings.clone())
            .map_err(|_| "请检查设置，等待时间和字符间隔需要有效整数。".to_string())?;
        settings.validate()?;
        self.startup_key = shortcut;
        self.pending = units(&self.draft.text);
        self.spacing = settings.interval_ms;
        self.deadline = now
            + if shortcut.is_some() {
                0
            } else {
                settings.delay_seconds * 1000
            };
        self.snapshot.phase = if shortcut.is_some() {
            Phase::Arming
        } else {
            Phase::Countdown
        };
        self.snapshot.sent = 0;
        self.snapshot.total = self.pending.len();
        self.snapshot.remaining_seconds = if shortcut.is_some() {
            0
        } else {
            settings.delay_seconds
        };
        self.snapshot.message = if shortcut.is_some() {
            "等待按键释放，松开快捷键后开始输入"
        } else {
            "等待输入，请在倒计时结束前选择输入位置"
        }
        .into();
        self.snapshot.sequence += 1;
        Ok(())
    }
    /// Esc cancels active work; modifiers and start function keys maintain release state.
    pub fn key(&mut self, vk: u32, down: bool, cycle: u64) {
        self.cycle = cycle;
        if !down {
            self.held.remove(&vk);
            return;
        }
        if input::is_modifier(vk) || matches!(vk, 0x77..=0x79) {
            self.held.insert(vk);
        }
        if vk == 27 && self.busy() {
            self.blocked_cycle = Some(cycle);
            self.cancel("已中止，剩余内容已取消");
        }
    }
    /// Mouse-down cancels arming/typing; countdown permits target selection.
    pub fn mouse_down(&mut self) {
        if matches!(self.snapshot.phase, Phase::Arming | Phase::Typing) {
            if !self.held.is_empty() {
                self.blocked_cycle = Some(self.cycle);
            }
            self.cancel("已中止，剩余内容已取消");
        }
    }
    /// Record the physical cycle even when its queued hook event arrives after cancellation.
    pub fn interrupt(&mut self, cycle: u64) {
        self.blocked_cycle = Some(cycle);
        self.cancel("已中止，剩余内容已取消");
    }
    /// Cancel unsent work while retaining submitted progress.
    pub fn cancel(&mut self, message: &str) {
        if !self.busy() {
            return;
        }
        self.snapshot.phase = Phase::Stopped;
        self.snapshot.remaining_seconds = 0;
        self.snapshot.message = format!(
            "{message}（已发送 {} / {}）",
            self.snapshot.sent, self.snapshot.total
        );
        self.pending.clear();
        self.snapshot.sequence += 1;
    }
    /// Produce at most one due unit, after final foreground and held-key checks.
    pub fn due(&mut self, now: u64, own_foreground: bool, any_held: bool) -> Option<Unit> {
        let held_for_start = any_held
            || self
                .held
                .iter()
                .any(|vk| input::is_modifier(*vk) || self.startup_key == Some(*vk));
        if self.snapshot.phase == Phase::Countdown {
            let remaining = self.deadline.saturating_sub(now).div_ceil(1000);
            if remaining != self.snapshot.remaining_seconds {
                self.snapshot.remaining_seconds = remaining;
                self.snapshot.sequence += 1;
            }
            if now < self.deadline {
                return None;
            }
            if held_for_start {
                self.cancel("已取消，开始时仍有修饰键或鼠标按钮按下");
                return None;
            }
        } else if self.snapshot.phase == Phase::Arming && held_for_start {
            return None;
        }
        if matches!(self.snapshot.phase, Phase::Arming | Phase::Countdown) {
            if own_foreground {
                self.cancel("已取消，请先选择目标输入位置");
                return None;
            }
            self.snapshot.phase = Phase::Typing;
            self.deadline = now;
            self.snapshot.sequence += 1;
        }
        if self.snapshot.phase == Phase::Typing && now >= self.deadline {
            self.pending.get(self.snapshot.sent).copied()
        } else {
            None
        }
    }
    /// Commit one successful send, or fail the task on a platform error.
    pub fn submitted(&mut self, now: u64, result: Result<(), String>) {
        if self.snapshot.phase != Phase::Typing {
            return;
        }
        if let Err(error) = result {
            self.snapshot.phase = Phase::Failed;
            self.snapshot.message = error;
            self.pending.clear();
        } else {
            self.snapshot.sent += 1;
            self.deadline = now + self.spacing;
            if self.snapshot.sent == self.snapshot.total {
                self.snapshot.phase = Phase::Done;
                self.snapshot.message = format!("已完成，已发送 {} 个字符", self.snapshot.sent);
                self.pending.clear();
            } else {
                self.snapshot.message = format!(
                    "已发送 {} / {} 字符 · 按 Esc 或点击鼠标停止",
                    self.snapshot.sent, self.snapshot.total
                );
            }
        }
        self.snapshot.sequence += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn engine(text: &str) -> Engine {
        let mut e = Engine::new(Settings {
            delay_seconds: 1,
            ..Settings::default()
        });
        e.sync(Draft {
            revision: 1,
            text: text.into(),
            settings: serde_json::to_value(&e.snapshot.settings).unwrap(),
        });
        e
    }
    #[test]
    fn installation_blocks_both_start_sources_until_recovery() {
        for shortcut in [false, true] {
            let mut e = engine("preserved draft");
            e.prepare_update().unwrap();
            assert!(e.start(shortcut.then_some(0x77), 0, false, 1).is_err());
            assert!(!e.busy());
            assert!(e.prepare_update().is_err());
            e.resume_update();
            e.start(shortcut.then_some(0x77), 0, false, 2).unwrap();
            assert!(e.busy());
            assert_eq!(e.snapshot.total, 15);
        }
    }
    #[test]
    fn active_or_interrupted_tasks_defer_installation() {
        for phase in [Phase::Arming, Phase::Countdown, Phase::Typing] {
            let mut e = engine("ab");
            e.snapshot.phase = phase;
            assert!(e.prepare_update().is_err());
            assert_eq!(e.snapshot.phase, phase);
        }
        let mut e = engine("ab");
        e.snapshot.interaction_blocked = true;
        assert!(e.prepare_update().is_err());
        e.snapshot.interaction_blocked = false;
        e.prepare_update().unwrap();
    }
    #[test]
    fn atomic_stop_blocks_same_shortcut_cycle() {
        let mut e = engine("ab");
        e.start(None, 0, true, 0).unwrap();
        e.due(1000, false, false);
        e.interrupt(1);
        e.start(Some(0x77), 1001, false, 1).unwrap();
        assert_eq!(e.snapshot.phase, Phase::Stopped);
        e.start(Some(0x77), 1002, false, 2).unwrap();
        assert_eq!(e.snapshot.phase, Phase::Arming);
    }
    #[test]
    fn countdown_freezes_text_and_observes_spacing() {
        let mut e = engine("ab");
        e.start(None, 0, true, 0).unwrap();
        e.sync(Draft {
            revision: 2,
            text: "changed".into(),
            settings: serde_json::to_value(Settings::default()).unwrap(),
        });
        assert_eq!(e.due(999, false, false), None);
        assert_eq!(e.snapshot.remaining_seconds, 1);
        assert_eq!(e.due(1000, false, false), Some(Unit::Character('a')));
        e.submitted(1000, Ok(()));
        assert_eq!(e.due(1049, false, false), None);
        assert_eq!(e.due(1050, false, false), Some(Unit::Character('b')));
        e.submitted(1050, Ok(()));
        assert_eq!(e.snapshot.phase, Phase::Done);
        assert_eq!(e.snapshot.sent, 2);
    }
    #[test]
    fn empty_and_invalid_drafts_preserve_phase() {
        let mut e = engine("");
        assert!(e.start(None, 0, false, 0).is_err());
        assert_eq!(e.snapshot.phase, Phase::Idle);
        e.sync(Draft {
            revision: 2,
            text: "a".into(),
            settings: serde_json::json!({"delaySeconds":0,"intervalMs":50,"shortcut":"F8"}),
        });
        assert!(e.start(None, 0, false, 0).is_err());
        assert_eq!(e.snapshot.phase, Phase::Idle);
    }
    #[test]
    fn final_checks_cancel_before_any_send() {
        for (foreground, held) in [(true, false), (false, true)] {
            let mut e = engine("a");
            e.start(None, 0, false, 0).unwrap();
            assert_eq!(e.due(1000, foreground, held), None);
            assert_eq!(e.snapshot.phase, Phase::Stopped);
        }
    }
    #[test]
    fn shortcut_waits_for_every_key_and_rejects_own_window() {
        let mut e = engine("a");
        assert!(e.start(Some(0x77), 0, true, 1).is_err());
        e.key(0xA2, true, 1);
        e.key(0xA4, true, 1);
        e.key(0x77, true, 1);
        e.start(Some(0x77), 0, false, 1).unwrap();
        e.key(0x77, false, 1);
        assert_eq!(e.due(5, false, true), None);
        e.key(0xA4, false, 1);
        e.key(0xA2, false, 1);
        assert_eq!(e.due(10, false, false), Some(Unit::Character('a')));
    }
    #[test]
    fn shortcut_release_uses_triggered_key_when_draft_settings_change() {
        let mut e = engine("a");
        e.sync(Draft {
            revision: 2,
            text: "a".into(),
            settings: serde_json::json!({"delaySeconds":1,"intervalMs":50,"shortcut":"F9"}),
        });
        e.key(0x77, true, 1);
        e.start(Some(0x77), 0, false, 1).unwrap();
        assert_eq!(e.due(0, false, false), None);
        assert_eq!(e.snapshot.phase, Phase::Arming);
        e.key(0x77, false, 1);
        assert_eq!(e.due(1, false, false), Some(Unit::Character('a')));
    }
    #[test]
    fn selected_function_key_waits_for_release_with_frozen_settings() {
        for (shortcut, vk) in [("F8", 0x77), ("F9", 0x78), ("F10", 0x79)] {
            let mut e = engine("a");
            let settings = Settings {
                shortcut: shortcut.into(),
                ..Settings::default()
            };
            e.sync(Draft {
                revision: 2,
                text: "a".into(),
                settings: serde_json::to_value(settings).unwrap(),
            });
            e.key(vk, true, 1);
            e.start(Some(vk), 0, false, 1).unwrap();
            assert_eq!(e.due(0, false, false), None);
            assert_eq!(e.snapshot.phase, Phase::Arming);
            e.key(vk, false, 1);
            assert_eq!(e.due(1, false, false), Some(Unit::Character('a')));
            e.submitted(1, Ok(()));
            e.key(vk, true, 2);
            e.start(None, 2, false, 2).unwrap();
            assert_eq!(e.due(5002, false, false), Some(Unit::Character('a')));
        }
    }
    #[test]
    fn ordinary_keys_do_not_interrupt_active_tasks() {
        for phase in [Phase::Arming, Phase::Countdown, Phase::Typing] {
            for vk in [65, 0x25, 0x85, 0xA2] {
                let mut e = engine("ab");
                e.start((phase == Phase::Arming).then_some(0x77), 0, false, 1)
                    .unwrap();
                if phase == Phase::Typing {
                    assert_eq!(e.due(1000, false, false), Some(Unit::Character('a')));
                    e.submitted(1000, Ok(()));
                }
                e.key(vk, true, 2);
                e.key(vk, true, 2);
                e.key(vk, false, 2);
                assert_eq!(e.snapshot.phase, phase, "key {vk:#x}");
            }
        }
    }
    #[test]
    fn unrelated_held_keys_allow_button_and_shortcut_start() {
        for shortcut in [false, true] {
            for vk in [65, 0x25, 0x85, 0x78] {
                let mut e = engine("a");
                e.key(vk, true, 1);
                e.start(shortcut.then_some(0x77), 0, false, 1).unwrap();
                assert_eq!(
                    e.due(1000, false, false),
                    Some(Unit::Character('a')),
                    "shortcut={shortcut}, key {vk:#x}"
                );
                e.submitted(1000, Ok(()));
                assert_eq!(e.snapshot.phase, Phase::Done);
            }
        }
    }
    #[test]
    fn modifiers_still_block_button_and_shortcut_start() {
        for shortcut in [false, true] {
            for vk in [
                0x10, 0x11, 0x12, 0x5B, 0x5C, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5,
            ] {
                let mut e = engine("a");
                e.key(vk, true, 1);
                e.start(shortcut.then_some(0x77), 0, false, 1).unwrap();
                assert_eq!(e.due(1000, false, false), None, "key {vk:#x}");
                assert_eq!(e.snapshot.sent, 0);
                if shortcut {
                    assert_eq!(e.snapshot.phase, Phase::Arming);
                    e.key(vk, false, 1);
                    assert_eq!(e.due(1001, false, false), Some(Unit::Character('a')));
                } else {
                    assert_eq!(e.snapshot.phase, Phase::Stopped);
                }
            }
        }
    }
    #[test]
    fn escape_down_interrupts_every_active_phase_and_release_keeps_task() {
        for phase in [Phase::Arming, Phase::Countdown, Phase::Typing] {
            let mut e = engine("ab");
            e.start((phase == Phase::Arming).then_some(0x77), 0, false, 1)
                .unwrap();
            if phase == Phase::Typing {
                e.due(1000, false, false);
                e.submitted(1000, Ok(()));
            }
            e.key(27, false, 2);
            assert_eq!(e.snapshot.phase, phase);
            e.key(27, true, 2);
            assert_eq!(e.snapshot.phase, Phase::Stopped);
            assert_eq!(e.snapshot.sent, usize::from(phase == Phase::Typing));
            assert_eq!(e.due(5000, false, false), None);
        }
    }
    #[test]
    fn escape_interrupts_and_same_shortcut_cycle_cannot_restart() {
        let mut e = engine("ab");
        e.start(None, 0, false, 0).unwrap();
        e.due(1000, false, false);
        e.submitted(1000, Ok(()));
        e.key(27, true, 2);
        assert_eq!(e.snapshot.phase, Phase::Stopped);
        e.start(Some(0x77), 1001, false, 2).unwrap();
        assert_eq!(e.snapshot.phase, Phase::Stopped);
        e.key(27, false, 2);
        e.start(Some(0x77), 1002, false, 2).unwrap();
        assert_eq!(e.snapshot.phase, Phase::Stopped);
        e.key(0xA2, true, 3);
        e.start(Some(0x77), 1003, false, 3).unwrap();
        assert_eq!(e.snapshot.phase, Phase::Arming);
        assert_eq!(e.snapshot.sent, 0);
    }
    #[test]
    fn mouse_target_selection_allowed_but_typing_interrupts() {
        let mut e = engine("ab");
        e.start(None, 0, false, 0).unwrap();
        e.mouse_down();
        assert_eq!(e.snapshot.phase, Phase::Countdown);
        e.due(1000, false, false);
        e.submitted(1000, Ok(()));
        e.mouse_down();
        assert_eq!(e.due(5000, false, false), None);
        assert_eq!(e.snapshot.sent, 1);
        assert_eq!(e.snapshot.phase, Phase::Stopped);
    }
    #[test]
    fn countdown_keys_and_duplicate_start_follow_cancel_rules() {
        let mut e = engine("a");
        e.start(None, 0, false, 0).unwrap();
        e.key(65, true, 1);
        assert_eq!(e.snapshot.phase, Phase::Countdown);
        e.key(27, true, 1);
        assert_eq!(e.snapshot.phase, Phase::Stopped);
        e.start(None, 0, false, 0).unwrap();
        e.start(None, 0, false, 0).unwrap();
        assert_eq!(e.snapshot.phase, Phase::Stopped);
    }
    #[test]
    fn send_failure_preserves_successful_count() {
        let mut e = engine("ab");
        e.start(None, 0, false, 0).unwrap();
        e.due(1000, false, false);
        e.submitted(1000, Ok(()));
        e.due(1050, false, false);
        e.submitted(1050, Err("发送失败".into()));
        assert_eq!(e.snapshot.phase, Phase::Failed);
        assert_eq!(e.snapshot.sent, 1);
        assert_eq!(e.due(2000, false, false), None);
    }
    #[test]
    fn stale_editor_revision_cannot_replace_new_text() {
        let mut e = engine("new");
        e.sync(Draft {
            revision: 0,
            text: "old".into(),
            settings: serde_json::to_value(Settings::default()).unwrap(),
        });
        e.start(None, 0, false, 0).unwrap();
        assert_eq!(e.due(1000, false, false), Some(Unit::Character('n')));
    }
}
