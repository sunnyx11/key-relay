use crate::{
    archive::{Archive, TextAction, TextState},
    settings::Settings,
    shortcut,
    task::{Draft, Engine, Phase, Snapshot},
    windows::{
        hooks::{HookEvent, Hooks, Signals},
        input,
        target::{self, Target},
    },
};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Sender},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

type Reply<T = Snapshot> = Sender<Result<T, String>>;
/// Worker messages serialize all task mutations and persistence.
pub enum Message {
    Snapshot(Reply),
    Sync(Draft, Reply),
    Start(Draft, Reply),
    Cancel(Reply),
    Save(Settings, Reply),
    TextRead(Reply<TextState>),
    TextAction(TextAction, Reply<TextState>),
    TextFlush(Reply<TextState>),
    Shortcut { cycle: u64, key: u32 },
    Hook(HookEvent),
    Shutdown(Reply),
    PrepareUpdate(Reply),
    ResumeUpdate(Reply),
}
/// Application-owned worker sender; the worker owns hooks and persistent preferences.
pub struct Runtime {
    pub sender: Sender<Message>,
    pub closing: AtomicBool,
    pub editor_ready: AtomicBool,
}
impl Runtime {
    /// Spawn the single task owner without blocking the Tauri event loop.
    pub fn spawn(app: AppHandle, path: PathBuf, archive: Archive) -> Self {
        let (sender, receiver) = mpsc::channel();
        let hook_sender = sender.clone();
        thread::spawn(move || {
            let signals = Arc::new(Signals::default());
            let loaded = Settings::load(&path);
            let load_error = loaded.as_ref().err().cloned();
            let mut engine = Engine::new(loaded.unwrap_or_default());
            if let Some(error) = load_error {
                engine.snapshot.message = error;
            }
            let mut hooks = start_hooks(signals.clone(), hook_sender.clone());
            let mut hook_error = hooks.as_ref().err().cloned();
            let mut updating = false;
            let mut target: Option<Target> = None;
            let mut target_checked = 0;
            if let Some(error) = &hook_error {
                engine.snapshot.phase = Phase::Failed;
                engine.snapshot.message = error.clone();
            }
            engine.snapshot.shortcut_error =
                shortcut::register(&app, &engine.snapshot.settings.shortcut, signals.clone()).err();
            engine.snapshot.sequence = 1;
            let origin = Instant::now();
            let mut published = 0;
            loop {
                // Idle workers sleep until an operation arrives; active waits remain interruptible.
                let wait = if engine.busy() {
                    Duration::from_millis(2)
                } else if target.is_some() {
                    Duration::from_millis(250)
                } else {
                    Duration::from_secs(60)
                };
                let incoming = receiver.recv_timeout(wait);
                let now = origin.elapsed().as_millis() as u64;
                match incoming {
                    Ok(Message::Snapshot(reply)) => {
                        let _ = reply.send(Ok(engine.snapshot.clone()));
                    }
                    Ok(Message::Sync(draft, reply)) => {
                        archive.draft(draft.revision, draft.text.clone());
                        engine.sync(draft);
                        let _ = reply.send(Ok(engine.snapshot.clone()));
                    }
                    Ok(Message::Start(draft, reply)) => {
                        archive.draft(draft.revision, draft.text.clone());
                        engine.sync(draft);
                        let result = if let Some(error) = &hook_error {
                            Err(error.clone())
                        } else {
                            signals.stop.store(false, Ordering::SeqCst);
                            engine.start(None, now, signals.cycle.load(Ordering::SeqCst))
                        };
                        publish_phase(&signals, engine.snapshot.phase);
                        let _ = reply.send(result.map(|_| engine.snapshot.clone()));
                    }
                    Ok(Message::Cancel(reply)) => {
                        engine.cancel("已取消，剩余内容已取消");
                        let _ = reply.send(Ok(engine.snapshot.clone()));
                    }
                    Ok(Message::Save(settings, reply)) => {
                        let result = if updating {
                            Err("正在安装更新，请稍候。".into())
                        } else {
                            settings.save(&path)
                        };
                        if result.is_ok() {
                            if settings.shortcut != engine.snapshot.settings.shortcut
                                || engine.snapshot.shortcut_error.is_some()
                            {
                                engine.snapshot.shortcut_error =
                                    shortcut::register(&app, &settings.shortcut, signals.clone())
                                        .err();
                            }
                            engine.snapshot.settings = settings;
                            engine.snapshot.sequence += 1;
                        }
                        let _ = reply.send(result.map(|_| engine.snapshot.clone()));
                    }
                    Ok(Message::TextRead(reply)) => {
                        let _ = reply.send(archive.read());
                    }
                    Ok(Message::TextAction(action, reply)) => {
                        let result =
                            if updating || engine.busy() || engine.snapshot.interaction_blocked {
                                Err("任务结束后可修改保存内容。".into())
                            } else {
                                archive.action(action)
                            };
                        let _ = reply.send(result);
                    }
                    Ok(Message::TextFlush(reply)) => {
                        let _ = reply.send(archive.flush());
                    }
                    Ok(Message::Shortcut { cycle, key }) => {
                        if !updating && hook_error.is_none() {
                            let was_busy = engine.busy();
                            if !was_busy {
                                signals.stop.store(false, Ordering::SeqCst);
                            }
                            if let Err(error) = engine.start(Some(key), now, cycle) {
                                engine.snapshot.message = error;
                                engine.snapshot.sequence += 1;
                            }
                        }
                    }
                    Ok(Message::Hook(HookEvent::Key { vk, down, cycle })) => {
                        engine.key(vk, down, cycle)
                    }
                    Ok(Message::Hook(HookEvent::MouseDown { click })) => {
                        let was_busy = engine.busy();
                        engine.mouse_down();
                        if !was_busy && !updating {
                            if let Some(recorded) = click.and_then(Target::capture) {
                                engine.record_target(recorded.info.clone());
                                target = Some(recorded);
                            }
                        }
                    }
                    Ok(Message::Hook(HookEvent::MouseUp)) => {}
                    Ok(Message::PrepareUpdate(reply)) => {
                        if let Err(error) = archive.flush().and_then(|_| engine.prepare_update()) {
                            let _ = reply.send(Err(error));
                        } else {
                            updating = true;
                            signals.phase.store(0, Ordering::SeqCst);
                            if let Ok(hooks) = &mut hooks {
                                hooks.stop();
                            }
                            let result = app
                                .global_shortcut()
                                .unregister_all()
                                .map_err(|_| "快捷键释放失败。".to_string());
                            let _ = reply.send(result.map(|_| engine.snapshot.clone()));
                        }
                    }
                    Ok(Message::ResumeUpdate(reply)) => {
                        if updating {
                            // Releases while hooks were stopped cannot clear these cached flags.
                            signals.stop.store(false, Ordering::SeqCst);
                            signals.mouse_buttons.store(0, Ordering::SeqCst);
                            hooks = start_hooks(signals.clone(), hook_sender.clone());
                            hook_error = hooks.as_ref().err().cloned();
                            engine.snapshot.shortcut_error = shortcut::register(
                                &app,
                                &engine.snapshot.settings.shortcut,
                                signals.clone(),
                            )
                            .err();
                            updating = false;
                            engine.resume_update();
                            engine.snapshot.sequence += 1;
                        }
                        let _ = reply.send(
                            hook_error
                                .clone()
                                .map_or_else(|| Ok(engine.snapshot.clone()), Err),
                        );
                    }
                    Ok(Message::Shutdown(reply)) => {
                        engine.cancel("软件退出，任务已结束");
                        signals.phase.store(0, Ordering::SeqCst);
                        if let Err(error) = archive.flush() {
                            engine.snapshot.phase = Phase::Failed;
                            engine.snapshot.message = error.clone();
                            engine.snapshot.sequence += 1;
                            let _ = reply.send(Err(error));
                        } else {
                            if let Ok(hooks) = &mut hooks {
                                hooks.stop();
                            }
                            let _ = app.global_shortcut().unregister_all();
                            let _ = reply.send(Ok(engine.snapshot.clone()));
                            break;
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                }
                if !engine.busy() && !updating && now.saturating_sub(target_checked) >= 250 {
                    target_checked = now;
                    if let Some(recorded) = &target {
                        if let Err(error) = recorded.validate() {
                            engine.target_failed(error);
                        }
                    }
                }
                if signals.stop.load(Ordering::SeqCst) && engine.busy() {
                    engine.interrupt(signals.cycle.load(Ordering::SeqCst));
                }
                publish_phase(&signals, engine.snapshot.phase);
                if engine.needs_target_click(now, input::any_held(engine.startup_key))
                    && !signals.stop.load(Ordering::SeqCst)
                {
                    let result = target
                        .as_ref()
                        .ok_or_else(|| "请重新选择输入位置。".to_string())
                        .and_then(|recorded| recorded.click(&signals.stop));
                    if signals.stop.load(Ordering::SeqCst) {
                        engine.interrupt(signals.cycle.load(Ordering::SeqCst));
                    } else if let Err(error) = result {
                        engine.target_failed(error);
                    } else {
                        engine.clicked_target(origin.elapsed().as_millis() as u64);
                    }
                }
                // The hook's atomic latch is checked again immediately before submission.
                if engine.busy() && !signals.stop.load(Ordering::SeqCst) {
                    let before = engine.snapshot.phase;
                    let unit = engine.due(
                        now,
                        input::own_foreground(),
                        input::any_held(engine.startup_key),
                    );
                    publish_phase(&signals, engine.snapshot.phase);
                    if let Some(unit) = unit {
                        let target_error = if before == Phase::Targeting {
                            target
                                .as_ref()
                                .ok_or_else(|| "请重新选择输入位置。".to_string())
                                .and_then(Target::ready)
                                .err()
                        } else {
                            None
                        };
                        if signals.stop.load(Ordering::SeqCst) {
                            engine.interrupt(signals.cycle.load(Ordering::SeqCst));
                        } else if let Some(error) = target_error {
                            engine.target_failed(error);
                        } else if before == Phase::Typing || !input::any_held(engine.startup_key) {
                            if let Some(text) = engine.take_history_text() {
                                archive.record(text);
                            }
                            engine
                                .submitted(origin.elapsed().as_millis() as u64, input::send(unit));
                        } else {
                            engine.cancel("已取消，开始时仍有修饰键、启动快捷键或鼠标按钮按下");
                        }
                    }
                }
                publish_phase(&signals, engine.snapshot.phase);
                let blocked = engine.snapshot.phase == Phase::Stopped
                    && signals.stop.load(Ordering::SeqCst)
                    && signals.mouse_buttons.load(Ordering::SeqCst) != 0;
                if engine.snapshot.interaction_blocked != blocked {
                    engine.snapshot.interaction_blocked = blocked;
                    engine.snapshot.sequence += 1;
                }
                if engine.snapshot.target.is_none() {
                    target = None;
                }
                if published != engine.snapshot.sequence {
                    let _ = app.emit("relay-state", &engine.snapshot);
                    published = engine.snapshot.sequence;
                }
            }
        });
        Self {
            sender,
            closing: AtomicBool::new(false),
            editor_ready: AtomicBool::new(false),
        }
    }
    /// Ask the worker to stop and release native resources before application exit.
    pub fn shutdown(&self, app: AppHandle) {
        if self.closing.swap(true, Ordering::SeqCst) {
            return;
        }
        let sender = self.sender.clone();
        thread::spawn(move || {
            if shutdown_worker(sender).is_ok() {
                app.exit(0);
            } else {
                use tauri::Manager;
                app.state::<Runtime>()
                    .closing
                    .store(false, Ordering::SeqCst);
            }
        });
    }
}
fn shutdown_worker(sender: Sender<Message>) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    sender
        .send(Message::Shutdown(tx))
        .map_err(|_| "任务线程已停止。".to_string())?;
    rx.recv().map_err(|_| "退出请求执行失败。".to_string())??;
    Ok(())
}

fn start_hooks(signals: Arc<Signals>, sender: Sender<Message>) -> Result<Hooks, String> {
    target::use_physical_coordinates()?;
    Hooks::start(signals, move |event| {
        let _ = sender.send(Message::Hook(event));
    })
}

/// Serialize installation preparation with task starts and settings writes.
pub async fn prepare_update(runtime: &Runtime) -> Result<Snapshot, String> {
    if runtime.closing.load(Ordering::SeqCst) {
        return Err("程序正在退出。".into());
    }
    request(runtime.sender.clone(), Message::PrepareUpdate).await
}

/// Restore native resources when installation cannot start.
pub async fn resume_update(runtime: &Runtime) -> Result<Snapshot, String> {
    request(runtime.sender.clone(), Message::ResumeUpdate).await
}

fn publish_phase(signals: &Signals, phase: Phase) {
    let phase_code = match phase {
        Phase::Targeting => 2,
        Phase::Typing => 3,
        _ => 0,
    };
    signals.phase.store(phase_code, Ordering::SeqCst);
    // Keep the stopping mouse gesture protected until every button is released.
    if phase_code == 0 && signals.mouse_buttons.load(Ordering::SeqCst) == 0 {
        signals.stop.store(false, Ordering::SeqCst);
    }
}
async fn request<T: Send + 'static>(
    sender: Sender<Message>,
    build: impl FnOnce(Reply<T>) -> Message + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (tx, rx) = mpsc::channel();
        sender
            .send(build(tx))
            .map_err(|_| "任务线程已停止。".to_string())?;
        rx.recv_timeout(Duration::from_secs(10))
            .map_err(|_| "任务响应超时，请重启软件。".to_string())?
    })
    .await
    .map_err(|_| "任务请求执行失败。".to_string())?
}
/// Read the complete current state without stealing target focus.
#[tauri::command]
pub async fn get_snapshot(runtime: State<'_, Runtime>) -> Result<Snapshot, String> {
    request(runtime.sender.clone(), Message::Snapshot).await
}
/// Synchronize the editor and enqueue its latest text for local draft persistence.
#[tauri::command]
pub async fn sync_draft(runtime: State<'_, Runtime>, draft: Draft) -> Result<(), String> {
    request(runtime.sender.clone(), |reply| Message::Sync(draft, reply)).await?;
    runtime.editor_ready.store(true, Ordering::SeqCst);
    Ok(())
}
/// Complete a frontend-coordinated close after its editor queue has drained.
#[tauri::command]
pub async fn close_app(app: AppHandle, runtime: State<'_, Runtime>) -> Result<(), String> {
    if runtime.closing.swap(true, Ordering::SeqCst) {
        return Err("程序正在退出。".into());
    }
    let sender = runtime.sender.clone();
    let result = tauri::async_runtime::spawn_blocking(move || shutdown_worker(sender))
        .await
        .map_err(|_| "退出请求执行失败。".to_string())
        .and_then(|result| result);
    if result.is_ok() {
        app.exit(0);
    } else {
        runtime.closing.store(false, Ordering::SeqCst);
    }
    result
}

/// Freeze the submitted editor state and activate the recorded target.
#[tauri::command]
pub async fn start_task(runtime: State<'_, Runtime>, draft: Draft) -> Result<Snapshot, String> {
    request(runtime.sender.clone(), |reply| Message::Start(draft, reply)).await
}
/// Cancel preparation or input; submitted Windows events remain in effect.
#[tauri::command]
pub async fn cancel_task(runtime: State<'_, Runtime>) -> Result<Snapshot, String> {
    request(runtime.sender.clone(), Message::Cancel).await
}
/// Validate, persist and register settings, preserving button access on shortcut failure.
#[tauri::command]
pub async fn save_settings(
    runtime: State<'_, Runtime>,
    settings: Settings,
) -> Result<Snapshot, String> {
    request(runtime.sender.clone(), |reply| {
        Message::Save(settings, reply)
    })
    .await
}

/// Read saved text and preferences; failed reads preserve the original file.
#[tauri::command]
pub async fn get_text_state(runtime: State<'_, Runtime>) -> Result<TextState, String> {
    request(runtime.sender.clone(), Message::TextRead).await
}
/// Apply archive preferences or history mutations while the task owner is idle.
#[tauri::command]
pub async fn change_text_state(
    runtime: State<'_, Runtime>,
    action: TextAction,
) -> Result<TextState, String> {
    request(runtime.sender.clone(), |reply| {
        Message::TextAction(action, reply)
    })
    .await
}
/// Wait for queued text writes before installation or an explicit save retry.
#[tauri::command]
pub async fn flush_text(runtime: State<'_, Runtime>) -> Result<TextState, String> {
    request(runtime.sender.clone(), Message::TextFlush).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escape_interruption_allows_independent_mouse_operations() {
        for phase in [Phase::Targeting, Phase::Typing] {
            let signals = Signals::default();
            let mut engine = Engine::new(Settings::default());
            engine.snapshot.phase = phase;
            publish_phase(&signals, phase);
            signals.stop.store(true, Ordering::SeqCst);

            engine.key(27, true, 1);
            publish_phase(&signals, engine.snapshot.phase);
            assert_eq!(engine.snapshot.phase, Phase::Stopped);
            assert!(
                !signals.stop.load(Ordering::SeqCst),
                "Escape interruption must release the stop latch in {phase:?}"
            );

            signals.mouse_buttons.store(1, Ordering::SeqCst);
            publish_phase(&signals, engine.snapshot.phase);
            assert!(
                !signals.stop.load(Ordering::SeqCst),
                "An independent click must remain available after Escape"
            );
        }
    }

    #[test]
    fn mouse_interruption_releases_stop_after_all_buttons_are_up() {
        let signals = Signals::default();
        signals.stop.store(true, Ordering::SeqCst);
        signals.mouse_buttons.store(3, Ordering::SeqCst);
        publish_phase(&signals, Phase::Stopped);
        assert!(signals.stop.load(Ordering::SeqCst));

        signals.mouse_buttons.store(2, Ordering::SeqCst);
        publish_phase(&signals, Phase::Stopped);
        assert!(signals.stop.load(Ordering::SeqCst));

        signals.mouse_buttons.store(0, Ordering::SeqCst);
        publish_phase(&signals, Phase::Stopped);
        assert!(
            !signals.stop.load(Ordering::SeqCst),
            "Mouse release must end protection for the stopping gesture"
        );

        signals.mouse_buttons.store(1, Ordering::SeqCst);
        publish_phase(&signals, Phase::Stopped);
        assert!(!signals.stop.load(Ordering::SeqCst));
    }

    #[test]
    fn active_phases_preserve_stop_before_the_worker_cancels() {
        for phase in [Phase::Targeting, Phase::Typing] {
            let signals = Signals::default();
            signals.stop.store(true, Ordering::SeqCst);
            publish_phase(&signals, phase);
            assert!(signals.stop.load(Ordering::SeqCst), "phase={phase:?}");
        }
    }
}
