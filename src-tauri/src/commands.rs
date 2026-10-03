use crate::{
    settings::Settings,
    shortcut,
    task::{Draft, Engine, Phase, Snapshot},
    windows::{
        hooks::{HookEvent, Hooks, Signals},
        input,
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

type Reply = Sender<Result<Snapshot, String>>;
/// Worker messages serialize all task mutations and persistence.
pub enum Message {
    Snapshot(Reply),
    Sync(Draft, Reply),
    Start(Draft, Reply),
    Cancel(Reply),
    Save(Settings, Reply),
    Shortcut(u64),
    Hook(HookEvent),
    Shutdown(Reply),
    PrepareUpdate(Reply),
    ResumeUpdate(Reply),
}
/// Application-owned worker sender; the worker owns hooks and persistent preferences.
pub struct Runtime {
    pub sender: Sender<Message>,
    pub closing: AtomicBool,
}
impl Runtime {
    /// Spawn the single task owner without blocking the Tauri event loop.
    pub fn spawn(app: AppHandle, path: PathBuf) -> Self {
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
                        engine.sync(draft);
                        let _ = reply.send(Ok(engine.snapshot.clone()));
                    }
                    Ok(Message::Start(draft, reply)) => {
                        engine.sync(draft);
                        let result = if let Some(error) = &hook_error {
                            Err(error.clone())
                        } else {
                            signals.stop.store(false, Ordering::SeqCst);
                            engine.start(
                                false,
                                now,
                                input::own_foreground(),
                                signals.cycle.load(Ordering::SeqCst),
                            )
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
                    Ok(Message::Shortcut(cycle)) => {
                        if !updating && hook_error.is_none() {
                            let was_busy = engine.busy();
                            if !was_busy {
                                signals.stop.store(false, Ordering::SeqCst);
                            }
                            if let Err(error) =
                                engine.start(true, now, input::own_foreground(), cycle)
                            {
                                engine.snapshot.message = error;
                                engine.snapshot.sequence += 1;
                            }
                        }
                    }
                    Ok(Message::Hook(HookEvent::Key { vk, down, cycle })) => {
                        engine.key(vk, down, cycle)
                    }
                    Ok(Message::Hook(HookEvent::MouseDown)) => engine.mouse_down(),
                    Ok(Message::Hook(HookEvent::MouseUp)) => {}
                    Ok(Message::PrepareUpdate(reply)) => {
                        if let Err(error) = engine.prepare_update() {
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
                        if let Ok(hooks) = &mut hooks {
                            hooks.stop();
                        }
                        let result = app
                            .global_shortcut()
                            .unregister_all()
                            .map_err(|_| "快捷键释放失败。".to_string());
                        let _ = reply.send(result.map(|_| engine.snapshot.clone()));
                        break;
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                }
                if signals.stop.load(Ordering::SeqCst) && engine.busy() {
                    engine.interrupt(signals.cycle.load(Ordering::SeqCst));
                }
                publish_phase(&signals, engine.snapshot.phase);
                // The hook's atomic latch is checked again immediately before submission.
                if engine.busy() && !signals.stop.load(Ordering::SeqCst) {
                    let before = engine.snapshot.phase;
                    let unit = engine.due(now, input::own_foreground(), input::any_held());
                    publish_phase(&signals, engine.snapshot.phase);
                    if let Some(unit) = unit {
                        if signals.stop.load(Ordering::SeqCst) {
                            engine.interrupt(signals.cycle.load(Ordering::SeqCst));
                        } else if before == Phase::Typing || !input::any_held() {
                            engine
                                .submitted(origin.elapsed().as_millis() as u64, input::send(unit));
                        } else {
                            engine.cancel("已取消，开始时仍有按键或鼠标按钮按下");
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
                if published != engine.snapshot.sequence {
                    let _ = app.emit("relay-state", &engine.snapshot);
                    published = engine.snapshot.sequence;
                }
            }
        });
        Self {
            sender,
            closing: AtomicBool::new(false),
        }
    }
    /// Ask the worker to stop and release native resources before application exit.
    pub fn shutdown(&self, app: AppHandle) {
        if self.closing.swap(true, Ordering::SeqCst) {
            return;
        }
        let sender = self.sender.clone();
        thread::spawn(move || {
            let (tx, rx) = mpsc::channel();
            if sender.send(Message::Shutdown(tx)).is_ok() {
                let _ = rx.recv_timeout(Duration::from_secs(5));
            }
            app.exit(0);
        });
    }
}
fn start_hooks(signals: Arc<Signals>, sender: Sender<Message>) -> Result<Hooks, String> {
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
    signals.phase.store(
        match phase {
            Phase::Arming => 1,
            Phase::Countdown => 2,
            Phase::Typing => 3,
            _ => 0,
        },
        Ordering::SeqCst,
    );
}
async fn request(
    sender: Sender<Message>,
    build: impl FnOnce(Reply) -> Message + Send + 'static,
) -> Result<Snapshot, String> {
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
/// Synchronize an editor revision in memory; source text is never persisted.
#[tauri::command]
pub async fn sync_draft(runtime: State<'_, Runtime>, draft: Draft) -> Result<(), String> {
    request(runtime.sender.clone(), |reply| Message::Sync(draft, reply))
        .await
        .map(|_| ())
}
/// Freeze the submitted editor state and start the button countdown.
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
