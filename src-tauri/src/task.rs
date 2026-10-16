use crate::{
    settings::Settings,
    text::{units, Unit},
    windows::{input, target::TargetInfo},
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
    Targeting,
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
    pub target: Option<TargetInfo>,
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
    target_clicked: bool,
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
                target: None,
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
            target_clicked: false,
        }
    }
    /// True while a task owns the send pipeline.
    pub fn busy(&self) -> bool {
        matches!(self.snapshot.phase, Phase::Targeting | Phase::Typing)
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
    /// Record a physical external click while idle, preserving active task snapshots.
    pub fn record_target(&mut self, target: TargetInfo) {
        if self.busy() || self.installing {
            return;
        }
        self.snapshot.target = Some(target);
        self.snapshot.phase = Phase::Idle;
        self.snapshot.message.clear();
        self.snapshot.sequence += 1;
    }
    /// Forget an invalid target and stop any unsent work.
    pub fn target_failed(&mut self, message: String) {
        self.pending.clear();
        self.snapshot.target = None;
        self.snapshot.phase = Phase::Failed;
        self.snapshot.message = message;
        self.snapshot.sequence += 1;
    }
    /// Start a frozen draft and recorded target after the starting gesture releases.
    /// Repeated starts cancel active work; validation preserves the phase.
    pub fn start(&mut self, shortcut: Option<u32>, now: u64, cycle: u64) -> Result<(), String> {
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
        if self.draft.text.is_empty() {
            return Err("请先填写文本。".into());
        }
        if self.snapshot.target.is_none() {
            return Err("请先点击外部输入位置".into());
        }
        let settings: Settings = serde_json::from_value(self.draft.settings.clone())
            .map_err(|_| "请检查设置，字符间隔需要有效整数。".to_string())?;
        settings.validate()?;
        self.startup_key = shortcut;
        self.cycle = cycle;
        self.pending = units(&self.draft.text);
        self.spacing = settings.interval_ms;
        self.target_clicked = false;
        self.deadline = now + 2000;
        self.snapshot.phase = Phase::Targeting;
        self.snapshot.sent = 0;
        self.snapshot.total = self.pending.len();
        self.snapshot.message = "正在激活已记录的输入位置…".into();
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
    /// Physical mouse presses cancel every preparation and sending phase.
    pub fn mouse_down(&mut self) {
        if self.busy() {
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
        self.snapshot.message = format!(
            "{message}（已发送 {} / {}）",
            self.snapshot.sent, self.snapshot.total
        );
        self.pending.clear();
        self.snapshot.sequence += 1;
    }
    /// Wait for the starting gesture to release, bounded to avoid a stuck preparation.
    pub fn needs_target_click(&mut self, now: u64, any_held: bool) -> bool {
        if self.snapshot.phase != Phase::Targeting || self.target_clicked {
            return false;
        }
        if now >= self.deadline {
            self.blocked_cycle = Some(self.cycle);
            self.cancel("已取消，请释放启动按键和鼠标按钮后重试");
            return false;
        }
        !any_held
            && !self
                .held
                .iter()
                .any(|vk| input::is_modifier(*vk) || self.startup_key == Some(*vk))
    }
    /// Allow the target to process the synthetic click before sending the first character.
    pub fn clicked_target(&mut self, now: u64) {
        if self.snapshot.phase == Phase::Targeting {
            self.target_clicked = true;
            self.deadline = now + 150;
        }
    }
    /// Produce at most one due unit, after final foreground and held-key checks.
    pub fn due(&mut self, now: u64, own_foreground: bool, any_held: bool) -> Option<Unit> {
        let held_for_start = any_held
            || self
                .held
                .iter()
                .any(|vk| input::is_modifier(*vk) || self.startup_key == Some(*vk));
        if self.snapshot.phase == Phase::Targeting {
            if !self.target_clicked || now < self.deadline {
                return None;
            }
            if held_for_start {
                self.cancel("已取消，开始时仍有启动按键或鼠标按钮按下");
                return None;
            }
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
        let mut e = Engine::new(Settings::default());
        e.record_target(TargetInfo {
            x: -900,
            y: 240,
            title: "Receiver".into(),
        });
        e.sync(Draft {
            revision: 1,
            text: text.into(),
            settings: serde_json::to_value(&e.snapshot.settings).unwrap(),
        });
        e
    }
    #[test]
    fn both_start_sources_require_a_recorded_target() {
        for shortcut in [None, Some(0x77)] {
            let mut e = engine("ab");
            e.snapshot.target = None;
            assert!(e.start(shortcut, 0, 0).is_err());
            assert_eq!(e.snapshot.phase, Phase::Idle);
            assert_eq!(e.snapshot.sent, 0);
        }
    }
    #[test]
    fn both_start_sources_restore_target_from_own_window() {
        for shortcut in [None, Some(0x77)] {
            let mut e = engine("ab");
            e.key(0x77, true, 1);
            e.start(shortcut, 0, 1).unwrap();
            assert_eq!(e.snapshot.phase, Phase::Targeting);
            assert_eq!(e.needs_target_click(1, false), shortcut.is_none());
            assert_eq!(e.due(1, true, false), None);
            e.key(0x77, false, 1);
            assert!(e.needs_target_click(2, false));
            e.clicked_target(2);
            assert_eq!(e.due(151, false, false), None);
            assert_eq!(e.due(152, false, false), Some(Unit::Character('a')));
        }
    }
    #[test]
    fn target_preparation_waits_for_release_and_click_processing() {
        let mut e = engine("ab");
        e.start(None, 0, 0).unwrap();
        assert!(!e.needs_target_click(1, true));
        assert_eq!(e.due(500, false, false), None);
        assert!(e.needs_target_click(501, false));
        e.clicked_target(501);
        assert!(!e.needs_target_click(502, false));
        assert_eq!(e.due(650, false, false), None);
        assert_eq!(e.due(651, false, false), Some(Unit::Character('a')));

        let mut e = engine("ab");
        e.start(None, 0, 0).unwrap();
        assert!(!e.needs_target_click(2000, true));
        assert_eq!(e.snapshot.phase, Phase::Stopped);
        assert_eq!(e.snapshot.sent, 0);
    }
    #[test]
    fn shortcut_timeout_blocks_the_same_press_until_a_new_cycle() {
        let mut e = engine("a");
        e.key(0x77, true, 1);
        e.start(Some(0x77), 0, 1).unwrap();
        assert!(!e.needs_target_click(2000, true));
        assert_eq!(e.snapshot.phase, Phase::Stopped);
        e.start(Some(0x77), 2001, 1).unwrap();
        assert_eq!(e.snapshot.phase, Phase::Stopped);
        e.key(0x77, false, 1);
        e.key(0x77, true, 2);
        e.start(Some(0x77), 2002, 2).unwrap();
        assert_eq!(e.snapshot.phase, Phase::Targeting);
        assert_eq!(e.snapshot.sent, 0);
    }
    #[test]
    fn invalid_target_clears_record_and_blocks_both_start_sources() {
        let mut e = engine("ab");
        e.start(None, 0, 0).unwrap();
        e.record_target(TargetInfo {
            x: 100,
            y: 100,
            title: "Other".into(),
        });
        assert_eq!(e.snapshot.target.as_ref().unwrap().x, -900);
        e.target_failed("目标窗口已失效".into());
        assert_eq!(e.snapshot.target, None);
        assert_eq!(e.snapshot.sent, 0);
        assert_eq!(e.due(1000, false, false), None);
        assert!(e.start(Some(0x77), 1001, 1).is_err());
        assert!(e.start(None, 1001, 1).is_err());
        assert!(!e.needs_target_click(1002, false));
        assert_eq!(e.due(1002, false, false), None);
    }
    #[test]
    fn installation_blocks_both_start_sources_until_recovery() {
        for shortcut in [false, true] {
            let mut e = engine("preserved draft");
            e.prepare_update().unwrap();
            assert!(e.start(shortcut.then_some(0x77), 0, 1).is_err());
            assert!(!e.busy());
            assert!(e.prepare_update().is_err());
            e.resume_update();
            e.start(shortcut.then_some(0x77), 0, 2).unwrap();
            assert!(e.busy());
            assert_eq!(e.snapshot.total, 15);
        }
    }
    #[test]
    fn active_or_interrupted_tasks_defer_installation() {
        for phase in [Phase::Targeting, Phase::Typing] {
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
        e.start(None, 0, 0).unwrap();
        e.clicked_target(0);
        e.due(1000, false, false);
        e.interrupt(1);
        e.start(Some(0x77), 1001, 1).unwrap();
        assert_eq!(e.snapshot.phase, Phase::Stopped);
        e.start(Some(0x77), 1002, 2).unwrap();
        assert_eq!(e.snapshot.phase, Phase::Targeting);
    }
    #[test]
    fn targeting_freezes_text_and_observes_spacing() {
        let mut e = engine("ab");
        e.start(None, 0, 0).unwrap();
        e.clicked_target(0);
        e.sync(Draft {
            revision: 2,
            text: "changed".into(),
            settings: serde_json::to_value(Settings::default()).unwrap(),
        });
        assert_eq!(e.due(149, false, false), None);
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
        assert!(e.start(None, 0, 0).is_err());
        assert_eq!(e.snapshot.phase, Phase::Idle);
        e.sync(Draft {
            revision: 2,
            text: "a".into(),
            settings: serde_json::json!({"intervalMs":0,"shortcut":"F8"}),
        });
        assert!(e.start(None, 0, 0).is_err());
        assert_eq!(e.snapshot.phase, Phase::Idle);
    }
    #[test]
    fn final_checks_cancel_before_any_send() {
        for (foreground, held) in [(true, false), (false, true)] {
            let mut e = engine("a");
            e.start(None, 0, 0).unwrap();
            e.clicked_target(0);
            assert_eq!(e.due(1000, foreground, held), None);
            assert_eq!(e.snapshot.phase, Phase::Stopped);
        }
    }
    #[test]
    fn shortcut_waits_for_every_key_before_target_click() {
        let mut e = engine("a");
        e.key(0xA2, true, 1);
        e.key(0xA4, true, 1);
        e.key(0x77, true, 1);
        e.start(Some(0x77), 0, 1).unwrap();
        assert!(!e.needs_target_click(1, false));
        e.key(0x77, false, 1);
        assert!(!e.needs_target_click(2, false));
        assert_eq!(e.due(5, false, true), None);
        e.key(0xA4, false, 1);
        e.key(0xA2, false, 1);
        assert!(e.needs_target_click(10, false));
        e.clicked_target(10);
        assert_eq!(e.due(160, false, false), Some(Unit::Character('a')));
    }
    #[test]
    fn shortcut_release_uses_triggered_key_when_draft_settings_change() {
        let mut e = engine("a");
        e.sync(Draft {
            revision: 2,
            text: "a".into(),
            settings: serde_json::json!({"intervalMs":50,"shortcut":"F9"}),
        });
        e.key(0x77, true, 1);
        e.start(Some(0x77), 0, 1).unwrap();
        assert!(!e.needs_target_click(0, false));
        assert_eq!(e.due(0, false, false), None);
        assert_eq!(e.snapshot.phase, Phase::Targeting);
        e.key(0x77, false, 1);
        assert!(e.needs_target_click(1, false));
        e.clicked_target(1);
        assert_eq!(e.due(151, false, false), Some(Unit::Character('a')));
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
            e.start(Some(vk), 0, 1).unwrap();
            assert!(!e.needs_target_click(0, false));
            assert_eq!(e.due(0, false, false), None);
            assert_eq!(e.snapshot.phase, Phase::Targeting);
            e.key(vk, false, 1);
            assert!(e.needs_target_click(1, false));
            e.clicked_target(1);
            assert_eq!(e.due(151, false, false), Some(Unit::Character('a')));
            e.submitted(151, Ok(()));
            e.key(vk, true, 2);
            e.start(None, 152, 2).unwrap();
            assert!(e.needs_target_click(152, false));
            e.clicked_target(152);
            assert_eq!(e.due(5002, false, false), Some(Unit::Character('a')));
        }
    }
    #[test]
    fn ordinary_keys_do_not_interrupt_active_tasks() {
        for phase in [Phase::Targeting, Phase::Typing] {
            for vk in [65, 0x25, 0x85, 0xA2] {
                let mut e = engine("ab");
                e.start(Some(0x77), 0, 1).unwrap();
                if phase == Phase::Typing {
                    e.clicked_target(0);
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
                e.start(shortcut.then_some(0x77), 0, 1).unwrap();
                e.clicked_target(0);
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
                e.start(shortcut.then_some(0x77), 0, 1).unwrap();
                assert!(!e.needs_target_click(1, false));
                assert_eq!(e.due(1000, false, false), None, "key {vk:#x}");
                assert_eq!(e.snapshot.sent, 0);
                assert_eq!(e.snapshot.phase, Phase::Targeting);
                e.key(vk, false, 1);
                assert!(e.needs_target_click(1001, false));
                e.clicked_target(1001);
                assert_eq!(e.due(1151, false, false), Some(Unit::Character('a')));
            }
        }
    }
    #[test]
    fn escape_down_interrupts_every_active_phase_and_release_keeps_task() {
        for phase in [Phase::Targeting, Phase::Typing] {
            let mut e = engine("ab");
            e.start(Some(0x77), 0, 1).unwrap();
            if phase == Phase::Typing {
                e.clicked_target(0);
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
        e.start(None, 0, 0).unwrap();
        e.clicked_target(0);
        e.due(1000, false, false);
        e.submitted(1000, Ok(()));
        e.key(27, true, 2);
        assert_eq!(e.snapshot.phase, Phase::Stopped);
        e.start(Some(0x77), 1001, 2).unwrap();
        assert_eq!(e.snapshot.phase, Phase::Stopped);
        e.key(27, false, 2);
        e.start(Some(0x77), 1002, 2).unwrap();
        assert_eq!(e.snapshot.phase, Phase::Stopped);
        e.key(0xA2, true, 3);
        e.start(Some(0x77), 1003, 3).unwrap();
        assert_eq!(e.snapshot.phase, Phase::Targeting);
        assert_eq!(e.snapshot.sent, 0);
    }
    #[test]
    fn mouse_cancels_target_activation_and_typing() {
        let mut e = engine("ab");
        e.start(None, 0, 0).unwrap();
        e.clicked_target(0);
        e.mouse_down();
        assert_eq!(e.snapshot.phase, Phase::Stopped);
        e.start(None, 0, 0).unwrap();
        e.clicked_target(0);
        e.due(1000, false, false);
        e.submitted(1000, Ok(()));
        e.mouse_down();
        assert_eq!(e.due(5000, false, false), None);
        assert_eq!(e.snapshot.sent, 1);
        assert_eq!(e.snapshot.phase, Phase::Stopped);
    }
    #[test]
    fn targeting_keys_and_duplicate_start_follow_cancel_rules() {
        let mut e = engine("a");
        e.start(None, 0, 0).unwrap();
        e.clicked_target(0);
        e.key(65, true, 1);
        assert_eq!(e.snapshot.phase, Phase::Targeting);
        e.key(27, true, 1);
        assert_eq!(e.snapshot.phase, Phase::Stopped);
        e.start(None, 0, 0).unwrap();
        e.clicked_target(0);
        e.start(None, 0, 0).unwrap();
        e.clicked_target(0);
        assert_eq!(e.snapshot.phase, Phase::Stopped);
    }
    #[test]
    fn send_failure_preserves_successful_count() {
        let mut e = engine("ab");
        e.start(None, 0, 0).unwrap();
        e.clicked_target(0);
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
        e.start(None, 0, 0).unwrap();
        e.clicked_target(0);
        assert_eq!(e.due(1000, false, false), Some(Unit::Character('n')));
    }
}
