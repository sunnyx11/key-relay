import { useCallback, useEffect, useRef, useState } from 'react';
import { updateBridge, type UpdateSnapshot } from './bridge';

const initial: UpdateSnapshot = { sequence: 0, phase: 'idle', installed: false, autoCheck: true, version: null, notes: '', downloaded: 0, total: null, message: '' };

/** Keep update notifications independent of the active tab and the input task. */
export function useUpdates() {
  const [snapshot, setSnapshot] = useState(initial);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(-1);
  const alive = useRef(false);
  const running = useRef(false);
  const accept = useCallback((next: UpdateSnapshot) => {
    if (!alive.current || next.sequence <= sequence.current) return;
    sequence.current = next.sequence;
    setSnapshot(next);
  }, []);
  const run = useCallback(async (operation: () => Promise<UpdateSnapshot>) => {
    if (running.current) return;
    running.current = true;
    setPending(true); setError('');
    try { accept(await operation()); }
    catch (cause) { if (alive.current) setError(String(cause)); }
    finally { running.current = false; if (alive.current) setPending(false); }
  }, [accept]);
  useEffect(() => {
    alive.current = true;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      try {
        const cleanup = await updateBridge.subscribe(accept);
        if (disposed) { cleanup(); return; }
        unsubscribe = cleanup;
        const state = await updateBridge.snapshot();
        if (disposed) return;
        accept(state); setReady(true);
      } catch (cause) { if (!disposed) setError(`读取更新状态失败：${String(cause)}`); }
    })();
    return () => { disposed = true; alive.current = false; unsubscribe?.(); };
  }, [accept]);
  useEffect(() => {
    if (!ready || !snapshot.autoCheck) return;
    const check = () => { void run(updateBridge.check); };
    const startup = window.setTimeout(check, 10_000);
    const interval = window.setInterval(check, 86_400_000);
    return () => { clearTimeout(startup); clearInterval(interval); };
  }, [ready, snapshot.autoCheck, run]);
  return {
    snapshot, ready, pending, error,
    check: () => run(updateBridge.check),
    download: () => run(updateBridge.download),
    preference: (autoCheck: boolean) => run(() => updateBridge.preference(autoCheck)),
    install: (beforeInstall: () => Promise<void>) => run(async () => { await beforeInstall(); return updateBridge.install(); }),
  };
}
