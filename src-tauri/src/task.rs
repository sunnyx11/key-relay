use crate::{
    settings::Settings,
    text::{units, Unit},
    windows::target::TargetInfo,
};
use serde::{Deserialize, Serialize};

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
    pub interaction_blocked: bool,
}

/// Deterministic task state. Time is monotonic milliseconds supplied by the worker.
pub struct Engine {
    pub snapshot: Snapshot,
    draft: Draft,
    pending: Vec<Unit>,
    deadline: u64,
    spacing: u64,
    installing: bool,
    target_clicked: bool,
    history_text: Option<String>,
}
impl Engine {
    /// Initialize idle state and an empty draft using validated preferences.
    pub fn new(settings: Settings) -> Self {
        Self {
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
                interaction_blocked: false,
            },
            pending: Vec::new(),
            deadline: 0,
            spacing: 50,
            installing: false,
            target_clicked: false,
            history_text: None,
        }
    }
    /// True while a task owns the send pipeline.
    pub fn busy(&self) -> bool {
        matches!(self.snapshot.phase, Phase::Targeting | Phase::Typing)
    }
    /// Reserve the idle task owner for installation and reject new starts.
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
    pub fn start(&mut self, now: u64) -> Result<(), String> {
        if self.installing {
            return Err("正在安装更新，请稍候。".into());
        }
        if self.busy() {
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
        self.pending = units(&self.draft.text);
        self.history_text = Some(self.draft.text.clone());
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
    /// External Esc presses cancel active work; other keyboard events preserve it.
    pub fn key(&mut self, vk: u32, down: bool) {
        if vk == 27 && down {
            self.interrupt();
        }
    }
    /// Physical mouse presses cancel every preparation and sending phase.
    pub fn mouse_down(&mut self) {
        self.interrupt();
    }
    /// Cancel active work after a physical interruption or the hook's stop latch.
    pub fn interrupt(&mut self) {
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
            self.cancel("已取消，请释放修饰键和鼠标按钮后重试");
            return false;
        }
        !any_held
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
        if self.snapshot.phase == Phase::Targeting {
            if !self.target_clicked || now < self.deadline {
                return None;
            }
            if any_held {
                self.cancel("已取消，开始时仍有修饰键或鼠标按钮按下");
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
    /// Take the frozen original once when sending starts; preparation alone creates no history.
    pub fn take_history_text(&mut self) -> Option<String> {
        if self.snapshot.phase == Phase::Typing {
            self.history_text.take()
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
    #[test]
    fn released_system_state_allows_start_after_unmatched_modifier_events() {
        for vk in [0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0x5B, 0x5C] {
            let mut e = engine("a");
            e.key(vk, true);
            for now in [0, 10_000, 86_400_000] {
                e.start(now).unwrap();
                assert!(!e.needs_target_click(now + 1, true));
                assert!(e.needs_target_click(now + 2, false), "key {vk:#x}");
                e.clicked_target(now + 2);
                assert_eq!(e.due(now + 152, false, false), Some(Unit::Character('a')));
                e.submitted(now + 152, Ok(()));
                assert_eq!(e.snapshot.phase, Phase::Done);
            }
        }
    }
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
    fn button_start_requires_a_recorded_target() {
        let mut e = engine("ab");
        e.snapshot.target = None;
        assert!(e.start(0).is_err());
        assert_eq!(e.snapshot.phase, Phase::Idle);
        assert_eq!(e.snapshot.sent, 0);
    }
    #[test]
    fn button_start_restores_target_from_own_window() {
        let mut e = engine("ab");
        e.start(0).unwrap();
        assert_eq!(e.snapshot.phase, Phase::Targeting);
        assert!(e.needs_target_click(1, false));
        assert_eq!(e.due(1, true, false), None);
        e.clicked_target(2);
        assert_eq!(e.due(151, false, false), None);
        assert_eq!(e.due(152, false, false), Some(Unit::Character('a')));
    }
    #[test]
    fn target_preparation_waits_for_release_and_click_processing() {
        let mut e = engine("ab");
        e.start(0).unwrap();
        assert!(!e.needs_target_click(1, true));
        assert_eq!(e.due(500, false, false), None);
        assert!(e.needs_target_click(501, false));
        e.clicked_target(501);
        assert!(!e.needs_target_click(502, false));
        assert_eq!(e.due(650, false, false), None);
        assert_eq!(e.due(651, false, false), Some(Unit::Character('a')));

        let mut e = engine("ab");
        e.start(0).unwrap();
        assert!(!e.needs_target_click(2000, true));
        assert_eq!(e.snapshot.phase, Phase::Stopped);
        assert_eq!(e.snapshot.sent, 0);
    }
    #[test]
    fn button_start_recovers_after_a_release_timeout() {
        let mut e = engine("a");
        e.start(0).unwrap();
        assert!(!e.needs_target_click(2000, true));
        assert_eq!(e.snapshot.phase, Phase::Stopped);
        assert_eq!(e.snapshot.sent, 0);
        e.start(86_400_000).unwrap();
        assert!(e.needs_target_click(86_400_001, false));
        e.clicked_target(86_400_001);
        assert_eq!(e.due(86_400_151, false, false), Some(Unit::Character('a')));
    }
    #[test]
    fn invalid_target_clears_record_and_blocks_start() {
        let mut e = engine("ab");
        e.start(0).unwrap();
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
        assert!(e.start(1001).is_err());
        assert!(!e.needs_target_click(1002, false));
        assert_eq!(e.due(1002, false, false), None);
    }
    #[test]
    fn installation_blocks_button_start_until_recovery() {
        let mut e = engine("preserved draft");
        e.prepare_update().unwrap();
        assert!(e.start(0).is_err());
        assert!(!e.busy());
        assert!(e.prepare_update().is_err());
        e.resume_update();
        e.start(1).unwrap();
        assert!(e.busy());
        assert_eq!(e.snapshot.total, 15);
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
    fn interrupted_task_allows_a_new_button_start() {
        let mut e = engine("ab");
        e.start(0).unwrap();
        e.clicked_target(0);
        e.due(1000, false, false);
        e.interrupt();
        assert_eq!(e.snapshot.phase, Phase::Stopped);
        e.start(1001).unwrap();
        assert_eq!(e.snapshot.phase, Phase::Targeting);
        assert_eq!(e.snapshot.sent, 0);
    }
    #[test]
    fn targeting_freezes_text_and_observes_spacing() {
        let mut e = engine("ab");
        e.start(0).unwrap();
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
        assert!(e.start(0).is_err());
        assert_eq!(e.snapshot.phase, Phase::Idle);
        e.sync(Draft {
            revision: 2,
            text: "a".into(),
            settings: serde_json::json!({"intervalMs":0}),
        });
        assert!(e.start(0).is_err());
        assert_eq!(e.snapshot.phase, Phase::Idle);
    }
    #[test]
    fn final_checks_cancel_before_any_send() {
        for (foreground, held) in [(true, false), (false, true)] {
            let mut e = engine("a");
            e.start(0).unwrap();
            e.clicked_target(0);
            assert_eq!(e.due(1000, foreground, held), None);
            assert_eq!(e.snapshot.phase, Phase::Stopped);
        }
    }
    #[test]
    fn ordinary_keys_do_not_interrupt_active_tasks() {
        for phase in [Phase::Targeting, Phase::Typing] {
            for vk in [65, 0x25, 0x85, 0xA2] {
                let mut e = engine("ab");
                e.start(0).unwrap();
                if phase == Phase::Typing {
                    e.clicked_target(0);
                    assert_eq!(e.due(1000, false, false), Some(Unit::Character('a')));
                    e.submitted(1000, Ok(()));
                }
                e.key(vk, true);
                e.key(vk, true);
                e.key(vk, false);
                assert_eq!(e.snapshot.phase, phase, "key {vk:#x}");
            }
        }
    }
    #[test]
    fn ordinary_and_function_keys_allow_button_start() {
        for vk in [65, 0x25, 0x85, 0x77, 0x78, 0x79] {
            let mut e = engine("a");
            e.key(vk, true);
            e.start(0).unwrap();
            assert!(e.needs_target_click(1, false));
            e.clicked_target(1);
            assert_eq!(e.due(151, false, false), Some(Unit::Character('a')));
        }
    }
    #[test]
    fn current_system_state_blocks_preparation_until_release() {
        let mut e = engine("a");
        e.start(0).unwrap();
        assert!(!e.needs_target_click(1, true));
        assert_eq!(e.due(1000, false, true), None);
        assert_eq!(e.snapshot.sent, 0);
        assert_eq!(e.snapshot.phase, Phase::Targeting);
        assert!(e.needs_target_click(1001, false));
        e.clicked_target(1001);
        assert_eq!(e.due(1151, false, false), Some(Unit::Character('a')));
    }
    #[test]
    fn escape_down_interrupts_every_active_phase_and_release_keeps_task() {
        for phase in [Phase::Targeting, Phase::Typing] {
            let mut e = engine("ab");
            e.start(0).unwrap();
            if phase == Phase::Typing {
                e.clicked_target(0);
                e.due(1000, false, false);
                e.submitted(1000, Ok(()));
            }
            e.key(27, false);
            assert_eq!(e.snapshot.phase, phase);
            e.key(27, true);
            assert_eq!(e.snapshot.phase, Phase::Stopped);
            assert_eq!(e.snapshot.sent, usize::from(phase == Phase::Typing));
            assert_eq!(e.due(5000, false, false), None);
        }
    }
    #[test]
    fn escape_preserves_progress_and_next_start_uses_the_full_draft() {
        let mut e = engine("ab");
        e.start(0).unwrap();
        e.clicked_target(0);
        e.due(1000, false, false);
        e.submitted(1000, Ok(()));
        e.key(27, true);
        assert_eq!(e.snapshot.phase, Phase::Stopped);
        assert_eq!(e.snapshot.sent, 1);
        e.key(27, false);
        e.start(1001).unwrap();
        assert_eq!(e.snapshot.phase, Phase::Targeting);
        assert_eq!(e.snapshot.sent, 0);
        e.clicked_target(1001);
        assert_eq!(e.due(1151, false, false), Some(Unit::Character('a')));
    }
    #[test]
    fn mouse_cancels_target_activation_and_typing() {
        let mut e = engine("ab");
        e.start(0).unwrap();
        e.clicked_target(0);
        e.mouse_down();
        assert_eq!(e.snapshot.phase, Phase::Stopped);
        e.start(0).unwrap();
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
        e.start(0).unwrap();
        e.clicked_target(0);
        e.key(65, true);
        assert_eq!(e.snapshot.phase, Phase::Targeting);
        e.key(27, true);
        assert_eq!(e.snapshot.phase, Phase::Stopped);
        e.start(0).unwrap();
        e.clicked_target(0);
        e.start(0).unwrap();
        e.clicked_target(0);
        assert_eq!(e.snapshot.phase, Phase::Stopped);
    }
    #[test]
    fn send_failure_preserves_successful_count() {
        let mut e = engine("ab");
        e.start(0).unwrap();
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
        e.start(0).unwrap();
        e.clicked_target(0);
        assert_eq!(e.due(1000, false, false), Some(Unit::Character('n')));
    }
}
