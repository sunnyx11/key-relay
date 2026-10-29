import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useRelay } from './useRelay';
import { useUpdates } from './useUpdates';
import { TitleBar } from './components/TitleBar';
import { InputPanel } from './components/InputPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { AboutPanel } from './components/AboutPanel';
import { TaskFooter } from './components/TaskFooter';
import { HistoryPanel } from './components/HistoryPanel';
import { TextSettings } from './components/TextSettings';
import type { HistoryEntry } from './bridge';

const tabs = [{ name: 'input', label: '输入' }, { name: 'history', label: '历史' }, { name: 'settings', label: '设置' }, { name: 'about', label: '关于' }] as const;

/** Compose the local editor window; native commands retain authoritative task state. */
export default function App() {
  const relay = useRelay();
  const setNotice = relay.setNotice;
  const updates = useUpdates();
  const installing = updates.snapshot.phase === 'installing';
  const [tab, setTab] = useState<'input' | 'history' | 'settings' | 'about'>('input');
  const [restoredSequence, setRestoredSequence] = useState<number | null>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const active = ['targeting', 'typing'].includes(relay.snapshot.phase);
  const busy = active || !!relay.snapshot.interactionBlocked || installing;
  const editingDisabled = busy || relay.pending || !relay.ready;
  const historyDisabled = editingDisabled || relay.archivePending;
  const report = (error: unknown) => relay.setNotice({ text: String(error), error: true });
  const tabDisabled = (name: typeof tab) => installing || (name === 'history' ? historyDisabled : name === 'about' ? busy || relay.pending || !relay.ready : name === 'settings' && relay.snapshot.phase === 'targeting');

  useLayoutEffect(() => {
    if (relay.restoredText !== null && sourceRef.current) sourceRef.current.value = relay.restoredText;
  }, [relay.restoredText]);
  useEffect(() => {
    if (relay.notice?.text !== '已恢复历史内容 · Ctrl+Z 可撤销') return;
    const timer = window.setTimeout(() => setNotice(current => current?.text === '已恢复历史内容 · Ctrl+Z 可撤销' ? null : current), 3000);
    return () => window.clearTimeout(timer);
  }, [relay.notice, setNotice]);

  useEffect(() => {
    if (active) setTab(current => current === 'about' || current === 'history' ? 'input' : current);
  }, [active]);

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
    void getCurrentWindow().show().catch(error => setNotice({ text: String(error), error: true }));
  }, [setNotice]);

  const start = () => {
    if (relay.snapshot.phase === 'targeting') { void relay.cancel(); return; }
    if (busy || relay.pending) return;
    if (!relay.text.length) {
      flushSync(() => setTab('input'));
      relay.setNotice({ text: '请先填写文本，在编辑区输入或粘贴需要发送的内容。', error: true }); sourceRef.current?.focus(); return;
    }
    const invalid = ['interval'].find(id => !(document.getElementById(id) as HTMLInputElement).checkValidity());
    if (invalid) { flushSync(() => setTab('settings')); document.getElementById(invalid)?.focus(); return; }
    void relay.start();
  };
  const trimTrailing = () => {
    if (editingDisabled || !relay.text.length) return;
    const source = sourceRef.current!;
    const trailingSpaces = [...source.value.matchAll(/[ \t]+$/gm)];
    if (!trailingSpaces.length) {
      relay.setNotice({ text: '当前文本没有行尾空格。', error: false });
      return;
    }
    source.focus();
    // Delete backwards to keep offsets valid and each line in native undo history.
    for (const match of trailingSpaces.reverse()) {
      source.setSelectionRange(match.index, match.index + match[0].length);
      if (!document.execCommand('delete')) {
        relay.updateText(source.value);
        report('去除行尾空格未完成，请重试');
        return;
      }
    }
    relay.updateText(source.value);
    relay.setNotice({ text: '已去除行尾空格，可按 Ctrl+Z 逐行撤销。', error: false });
  };
  const clear = () => {
    if (editingDisabled || !relay.text.length) return;
    const source = sourceRef.current!; source.focus(); source.select();
    if (!document.execCommand('delete')) { report('清空未完成，可在编辑框中全选并按 Delete。'); return; }
    relay.updateText(source.value); relay.setNotice({ text: '已清空，按 Ctrl+Z 撤销。', error: false });
  };
  const restoreHistory = (entry: HistoryEntry) => {
    if (historyDisabled) return;
    flushSync(() => setTab('input'));
    const source = sourceRef.current!;
    source.focus();
    if (source.value !== entry.text) {
      source.select();
      if (!document.execCommand('insertText', false, entry.text)) {
        relay.updateText(source.value);
        report('恢复未完成，请重试。');
        return;
      }
    }
    source.setSelectionRange(source.value.length, source.value.length);
    relay.updateText(source.value);
    setRestoredSequence(relay.snapshot.sequence);
    relay.setNotice({ text: '已恢复历史内容 · Ctrl+Z 可撤销', error: false });
  };
  const tabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const available = tabs.filter(item => !tabDisabled(item.name));
    const index = available.findIndex(item => item.name === tab);
    const next = available[event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + available.length) % available.length].name;
    setTab(next); document.getElementById(`${next}-tab`)?.focus();
  };
  return <main className="window">
    <TitleBar disabled={busy || relay.pending || !relay.ready} onError={report} />
    {relay.closeError && <div className="storage-notice" role="alert">{relay.closeError} 请从通知区域选择退出应用以重试。</div>}
    {(!relay.ready || relay.archive.error) && <div className="storage-notice" role={relay.loadError || relay.archive.error ? 'alert' : 'status'}>
      <span>{relay.loadError || relay.archive.error || '正在恢复上次内容…'}</span>
      {relay.loadError ? <button className="button" onClick={relay.retryLoad}>重试读取</button> : relay.archive.error && <button className="button" disabled={historyDisabled} onClick={() => { void relay.changeArchive({ kind: 'retry' }); }}>重试保存</button>}
    </div>}
    {relay.ready && relay.archive.saveHistory && relay.archive.entries.length >= relay.archive.maxHistoryEntries && relay.archive.entries.every(entry => entry.pinned) && <div className="storage-notice" role="status">历史记录已满且全部置顶，新输入将不保存到历史。请取消部分置顶或删除记录。</div>}
    <div className="workspace">
      <nav className="tabs" role="tablist" aria-label="功能页签">
        {tabs.map(({ name, label }) => <button key={name} id={`${name}-tab`} className="tab" role="tab" aria-selected={tab === name} aria-controls={`${name}-panel`} tabIndex={tab === name ? 0 : -1} disabled={tabDisabled(name)} onClick={() => setTab(name)} onKeyDown={tabKey}>{label}{name === 'about' && ['available', 'ready'].includes(updates.snapshot.phase) && <span className="update-indicator" title="有新版本" aria-hidden="true" />}</button>)}
      </nav>
      <InputPanel hidden={tab !== 'input'} busy={editingDisabled} sourceRef={sourceRef} onInput={relay.updateText} />
      <HistoryPanel hidden={tab !== 'history'} busy={historyDisabled} archive={relay.archive} onRestore={restoreHistory} onChange={relay.changeArchive} />
      <SettingsPanel hidden={tab !== 'settings'} busy={busy || relay.pending || !relay.ready} settings={relay.settings} onChange={relay.updateSettings}>
        <TextSettings archive={relay.archive} busy={historyDisabled} onChange={relay.changeArchive} />
      </SettingsPanel>
      <AboutPanel hidden={tab !== 'about'} updates={updates} beforeInstall={relay.flushSettings} restoreDraft={relay.archive.restoreDraft} />
      <TaskFooter hidden={tab !== 'input'} text={relay.text} snapshot={restoredSequence === relay.snapshot.sequence ? { ...relay.snapshot, message: '' } : relay.snapshot} ready={relay.ready && !relay.snapshot.interactionBlocked && !installing} pending={relay.pending} notice={relay.notice} onStart={start} onTrimTrailing={trimTrailing} onClear={clear} />
    </div>
  </main>;
}
