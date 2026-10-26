import { useCallback, useEffect, useRef, useState } from 'react';
import { archiveBridge, bridge, defaults, type Draft, type DraftSettings, type Settings, type Snapshot, type TextAction, type TextState } from './bridge';

const initial: Snapshot = { sequence: 0, phase: 'idle', sent: 0, total: 0, target: null, message: '', settings: defaults, shortcutError: null };

/** Own editor synchronization and subscription lifetime; Rust owns task execution. */
export function useRelay() {
  const [snapshot, setSnapshot] = useState(initial);
  const [settings, setSettings] = useState<DraftSettings>(defaults);
  const [text, setText] = useState('');
  const [ready, setReady] = useState(false);
  const [archive, setArchive] = useState<TextState>({ sequence: 0, draft: '', entries: [], restoreDraft: true, saveHistory: true, canUndo: false, error: null });
  const [restoredText, setRestoredText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [archivePending, setArchivePending] = useState(false);
  const archiveSequence = useRef(-1);
  const archiveLock = useRef(false);
  const acceptArchive = useCallback((state: TextState) => {
    if (!alive.current || state.sequence <= archiveSequence.current) return;
    archiveSequence.current = state.sequence;
    setArchive(state);
  }, []);
  const [pending, setPending] = useState(false);
  const [closePending, setClosePending] = useState(false);
  const [closeError, setCloseError] = useState('');
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const sequence = useRef(-1);
  const revision = useRef(Date.now());
  const draft = useRef<Draft>({ revision: revision.current, text: '', settings: defaults });
  const queue = useRef(Promise.resolve());
  const closing = useRef(false);
  const validSettings = useRef<Settings>(defaults);
  const alive = useRef(true);
  const report = useCallback((error: unknown) => { if (alive.current) setNotice({ text: String(error), error: true }); }, []);
  const accept = useCallback((next: Snapshot) => {
    if (next.sequence <= sequence.current || !alive.current) return;
    sequence.current = next.sequence;
    setSnapshot(next); setNotice(null);
  }, []);
  const enqueue = useCallback((work: () => Promise<void>) => {
    const next = queue.current.then(work);
    queue.current = next.catch(report);
    return next;
  }, [report]);

  const close = useCallback(async () => {
    if (closing.current) return;
    closing.current = true; setClosePending(true); setCloseError('');
    try {
      await bridge.cancel();
      await enqueue(async () => {
        await bridge.sync({ ...draft.current, revision: ++revision.current });
        accept(await bridge.save(validSettings.current));
        acceptArchive(await archiveBridge.flush());
        await bridge.close();
      });
    } catch (error) {
      report(error); closing.current = false;
      if (alive.current) { setClosePending(false); setCloseError(String(error)); }
    }
  }, [accept, acceptArchive, enqueue, report]);

  useEffect(() => {
    alive.current = true;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    setLoadError('');
    void (async () => {
      try {
        const cleanup = await bridge.subscribe(accept);
        if (disposed) { cleanup(); return; }
        cleanups.push(cleanup);
        const textCleanup = await archiveBridge.subscribe(acceptArchive);
        if (disposed) { textCleanup(); return; }
        cleanups.push(textCleanup);
        const closeCleanup = await bridge.subscribeClose(() => { void close(); });
        if (disposed) { closeCleanup(); return; }
        cleanups.push(closeCleanup);
        const [state, saved] = await Promise.all([bridge.snapshot(), archiveBridge.read()]);
        if (disposed) return;
        accept(state); acceptArchive(saved); setSettings(state.settings); validSettings.current = state.settings;
        const value = saved.restoreDraft ? saved.draft : '';
        setText(value); setRestoredText(value);
        draft.current = { revision: ++revision.current, text: value, settings: state.settings };
        await bridge.sync(draft.current);
        if (!disposed) setReady(true);
      } catch (error) { if (!disposed) setLoadError(String(error)); }
    })();
    return () => { disposed = true; alive.current = false; cleanups.forEach(cleanup => cleanup()); };
  }, [accept, acceptArchive, attempt, close]);

  const sync = (nextText: string, nextSettings: DraftSettings) => {
    draft.current = { revision: ++revision.current, text: nextText, settings: nextSettings };
    const current = draft.current;
    void enqueue(() => bridge.sync(current)).catch(() => {});
  };
  const updateText = (value: string) => {
    setText(value); setNotice(null); sync(value, draft.current.settings);
  };
  const updateSettings = (value: DraftSettings) => {
    setSettings(value); setNotice(null); sync(draft.current.text, value);
    const valid = Number.isInteger(value.intervalMs) && Number(value.intervalMs) >= 10 && Number(value.intervalMs) <= 1000;
    if (valid) {
      validSettings.current = value as Settings;
      void enqueue(async () => { accept(await bridge.save(value as Settings)); }).catch(() => {});
    }
  };
  const start = async () => {
    setPending(true); setNotice(null);
    const current = { ...draft.current, revision: ++revision.current };
    draft.current = current;
    try { await enqueue(async () => accept(await bridge.start(current))); }
    catch { /* enqueue reports the command error without changing the task phase. */ }
    finally { if (alive.current) setPending(false); }
  };
  const cancel = async () => {
    try { accept(await bridge.cancel()); } catch (error) { report(error); }
  };
  const changeArchive = async (action: TextAction) => {
    if (archiveLock.current) return false;
    archiveLock.current = true; setArchivePending(true);
    try {
      await enqueue(async () => {
        const state = await archiveBridge.change(action).finally(async () => {
          if (action.kind === 'preferences' && action.restoreDraft) {
            draft.current = { ...draft.current, revision: ++revision.current };
            await bridge.sync(draft.current);
          }
        });
        acceptArchive(state);
        if (state.error) throw new Error(state.error);
      });
      return true;
    } catch { return false; }
    finally { archiveLock.current = false; if (alive.current) setArchivePending(false); }
  };
  const flushSettings = () => enqueue(async () => {
    await bridge.sync({ ...draft.current, revision: ++revision.current });
    accept(await bridge.save(validSettings.current));
    acceptArchive(await archiveBridge.flush());
  });
  const retryLoad = () => setAttempt(value => value + 1);
  return { snapshot, settings, text, ready, pending: pending || closePending, closeError, notice, setNotice, updateText, updateSettings, start, cancel, flushSettings, archive, restoredText, loadError, retryLoad, archivePending, changeArchive };
}
