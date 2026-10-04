import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import type { useUpdates } from '../useUpdates';

/** Display explicit download and install actions without taking focus on discovery. */
export function UpdatePanel({ updates, hidden, beforeInstall, open }: {
  updates: ReturnType<typeof useUpdates>; hidden: boolean; beforeInstall: () => Promise<void>;
  open: (event: MouseEvent<HTMLAnchorElement>) => Promise<void>;
}) {
  const { snapshot, pending, ready, error } = updates;
  const [confirming, setConfirming] = useState(false);
  const installButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const confirm = (value: boolean) => {
    flushSync(() => setConfirming(value));
    (value ? cancelButton : installButton).current?.focus();
  };
  const waiting = pending || !ready || ['checking', 'downloading', 'installing'].includes(snapshot.phase);
  useEffect(() => { if (hidden || snapshot.phase !== 'ready') setConfirming(false); }, [hidden, snapshot.phase]);
  const status = {
    idle: '可检查新版本', checking: '正在检查更新…', current: '当前已是最新版本',
    available: `发现新版本 ${snapshot.version}`, downloading: '正在下载并验证更新…',
    ready: `版本 ${snapshot.version} 已准备好`, installing: '正在准备安装并重启…', error: '更新检查未完成',
  }[snapshot.phase];
  return <section className="update-section" aria-label="应用更新">
    <div className="update-heading"><h3>应用更新</h3><button className="button" disabled={waiting || snapshot.phase === 'ready'} onClick={() => { void updates.check(); }}>检查更新</button></div>
    <div className="update-summary">
      <p className="update-status" role="status">{status}</p>
      <label className="update-preference"><input type="checkbox" checked={snapshot.autoCheck} disabled={waiting} onChange={event => { void updates.preference(event.target.checked); }} />自动检查更新</label>
    </div>
    {(error || snapshot.message) && <p className="about-error" role="status">{error || snapshot.message}</p>}
    {snapshot.phase === 'downloading' && <progress aria-label="下载进度" value={snapshot.total ? snapshot.downloaded : undefined} max={snapshot.total || undefined} />}
    {!snapshot.installed && <p className="update-hint">独立 EXE 需退出后手动替换。<a href="https://github.com/sunnyx11/key-relay/releases/latest" onClick={event => { void open(event); }}>前往下载</a></p>}
    {snapshot.installed && snapshot.phase === 'available' && <button className="button primary" disabled={waiting} onClick={() => { void updates.download(); }}>下载更新</button>}
    {snapshot.installed && snapshot.phase === 'ready' && (confirming ? <div className="update-confirmation">
      <p>重启后将清除编辑框中的全部文本，请先保存需要保留的内容。</p>
      <div className="update-actions"><button className="button" ref={cancelButton} disabled={waiting} onClick={() => confirm(false)}>暂不安装</button><button className="button primary" disabled={waiting} onClick={() => { setConfirming(false); void updates.install(beforeInstall); }}>确认安装并重启</button></div>
    </div> : <button className="button primary" ref={installButton} disabled={waiting} onClick={() => confirm(true)}>安装并重启</button>)}
  </section>;
}
