import { useCallback, useEffect, useRef, useState } from 'react';
import { bridge, defaults, type Draft, type DraftSettings, type Settings, type Snapshot } from './bridge';

const initial: Snapshot = { sequence: 0, phase: 'idle', sent: 0, total: 0, remainingSeconds: 0, message: '', settings: defaults, shortcutError: null };

/** Own editor synchronization and subscription lifetime; Rust owns task execution. */
export function useRelay() {
  const [snapshot, setSnapshot] = useState(initial);
  const [settings, setSettings] = useState<DraftSettings>(defaults);
  const [text, setText] = useState('');
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const sequence = useRef(-1);
  const revision = useRef(Date.now());
  const draft = useRef<Draft>({ revision: revision.current, text: '', settings: defaults });
  const queue = useRef(Promise.resolve());
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

  useEffect(() => {
    alive.current = true;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      try {
        const cleanup = await bridge.subscribe(accept);
        if (disposed) { cleanup(); return; }
        unsubscribe = cleanup;
        const state = await bridge.snapshot();
        if (disposed) return;
        accept(state); setSettings(state.settings);
        draft.current = { revision: ++revision.current, text: '', settings: state.settings };
        await bridge.sync(draft.current);
        if (!disposed) setReady(true);
      } catch (error) { if (!disposed) report(error); }
    })();
    return () => { disposed = true; alive.current = false; unsubscribe?.(); };
  }, [accept, report]);

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
    const valid = Number.isInteger(value.delaySeconds) && Number(value.delaySeconds) >= 1 && Number(value.delaySeconds) <= 60 && Number.isInteger(value.intervalMs) && Number(value.intervalMs) >= 10 && Number(value.intervalMs) <= 1000;
    if (valid) {
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
  return { snapshot, settings, text, ready, pending, notice, setNotice, updateText, updateSettings, start, cancel };
}
