import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { useRelay } from './useRelay';
import { TitleBar } from './components/TitleBar';
import { InputPanel } from './components/InputPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { TaskFooter } from './components/TaskFooter';

/** Compose the local editor window; native commands retain authoritative task state. */
export default function App() {
  const relay = useRelay();
  const [tab, setTab] = useState<'input' | 'settings'>('input');
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLElement>(null);
  const busy = ['arming', 'countdown', 'typing'].includes(relay.snapshot.phase) || !!relay.snapshot.interactionBlocked;
  const report = (error: unknown) => relay.setNotice({ text: String(error), error: true });

  useEffect(() => {
    let suppressed: Element | null = null;
    const pointer = (event: PointerEvent) => {
      suppressed = (event.target as Element).closest(':disabled');
    };
    const click = (event: MouseEvent) => {
      if (event.detail > 0 && suppressed?.contains(event.target as Node)) { event.preventDefault(); event.stopImmediatePropagation(); }
      suppressed = null;
    };
    const cancel = () => { suppressed = null; };
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('click', click, true);
    document.addEventListener('pointercancel', cancel, true);
    return () => { document.removeEventListener('pointerdown', pointer, true); document.removeEventListener('click', click, true); document.removeEventListener('pointercancel', cancel, true); };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let resizing = false;
    let resizePending = false;
    const appWindow = getCurrentWindow();
    const resize = async () => {
      if (disposed) return;
      resizePending = true;
      if (resizing) return;
      resizing = true;
      try {
        do {
          resizePending = false;
          if (await appWindow.isMaximized() || disposed) return;
          const height = Math.max(360, Math.ceil(container.getBoundingClientRect().height));
          if (Math.abs(window.innerHeight - height) > 1) await appWindow.setSize(new LogicalSize(window.innerWidth, height));
        } while (resizePending && !disposed);
      } finally { resizing = false; }
    };
    const update = () => { void resize().catch(() => {}); };
    const observer = new ResizeObserver(update);
    observer.observe(container);
    window.addEventListener('resize', update);
    void resize().finally(() => appWindow.show()).catch(() => {});
    return () => { disposed = true; observer.disconnect(); window.removeEventListener('resize', update); };
  }, []);

  const start = () => {
    if (relay.snapshot.phase === 'countdown') { void relay.cancel(); return; }
    if (busy || relay.pending) return;
    if (!relay.text.length) {
      flushSync(() => setTab('input'));
      relay.setNotice({ text: '请先填写文本，在编辑区输入或粘贴需要发送的内容。', error: true }); sourceRef.current?.focus(); return;
    }
    const invalid = ['delay', 'interval'].find(id => !(document.getElementById(id) as HTMLInputElement).checkValidity());
    if (invalid) { flushSync(() => setTab('settings')); document.getElementById(invalid)?.focus(); return; }
    void relay.start();
  };
  const clear = () => {
    if (busy || !relay.text.length) return;
    const source = sourceRef.current!; source.focus(); source.select();
    if (!document.execCommand('delete')) { report('清空未完成，可在编辑框中全选并按 Delete。'); return; }
    relay.updateText(source.value); relay.setNotice({ text: '已清空，按 Ctrl+Z 撤销。', error: false });
  };
  const tabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'input' : event.key === 'End' ? 'settings' : tab === 'input' ? 'settings' : 'input';
    if (next === 'settings' && relay.snapshot.phase === 'countdown') return;
    setTab(next); document.getElementById(`${next}-tab`)?.focus();
  };
  return <main className="window" ref={containerRef}>
    <TitleBar disabled={busy || relay.pending || !relay.ready} onError={report} />
    <div className="workspace">
      <nav className="tabs" role="tablist" aria-label="功能页签">
        {(['input', 'settings'] as const).map(name => <button key={name} id={`${name}-tab`} className="tab" role="tab" aria-selected={tab === name} aria-controls={`${name}-panel`} tabIndex={tab === name ? 0 : -1} disabled={name === 'settings' && relay.snapshot.phase === 'countdown'} onClick={() => setTab(name)} onKeyDown={tabKey}>{name === 'input' ? '输入' : '设置'}</button>)}
      </nav>
      <InputPanel hidden={tab !== 'input'} busy={busy || relay.pending || !relay.ready} text={relay.text} sourceRef={sourceRef} onInput={relay.updateText} />
      <SettingsPanel hidden={tab !== 'settings'} busy={busy || !relay.ready} settings={relay.settings} shortcutError={relay.snapshot.shortcutError} onChange={relay.updateSettings} />
    </div>
    <TaskFooter hidden={tab !== 'input'} snapshot={relay.snapshot} settings={relay.settings} ready={relay.ready && !relay.snapshot.interactionBlocked} pending={relay.pending} notice={relay.notice} onStart={start} onClear={clear} />
  </main>;
}
