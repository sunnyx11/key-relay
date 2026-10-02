import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

/** Custom caption with separate drag and window-action regions. */
export function TitleBar({ disabled, onError }: { disabled: boolean; onError: (error: unknown) => void }) {
  const [pinned, setPinned] = useState(false);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    void getCurrentWindow().isAlwaysOnTop()
      .then(value => { if (!disposed) setPinned(value); })
      .catch(() => { if (!disposed) setError('读取置顶状态失败，请点击图钉重试。'); })
      .finally(() => { if (!disposed) setPending(false); });
    return () => { disposed = true; };
  }, []);
  const togglePin = async () => {
    if (disabled || pending) return;
    setPending(true); setError('');
    try {
      const appWindow = getCurrentWindow();
      const current = await appWindow.isAlwaysOnTop();
      setPinned(current);
      await appWindow.setAlwaysOnTop(!current);
      setPinned(!current);
    } catch { setError('置顶设置失败，请点击图钉重试。'); }
    finally { setPending(false); }
  };
  const act = (action: 'minimize' | 'toggleMaximize' | 'close' | 'startDragging') => {
    void getCurrentWindow()[action]().catch(onError);
  };
  return <><header className="titlebar">
    <div className="title-drag" onPointerDown={event => { if (event.button === 0 && event.detail !== 2) act('startDragging'); }} onDoubleClick={() => act('toggleMaximize')}>
      <span className="app-name">Key Relay</span>
    </div>
    <div className="window-actions">
      <button className="caption-button pin" disabled={disabled || pending} aria-label={pinned ? '取消置顶' : '置顶窗口'} title={pinned ? '取消置顶' : '置顶窗口'} aria-pressed={pinned} onClick={() => { void togglePin(); }}><svg viewBox="0 0 16 16" aria-hidden="true"><g transform={pinned ? undefined : 'rotate(35 8 8)'}><path d="M5 2.5h6M6 2.5v5l-2 3h8l-2-3v-5M8 10.5v3"/></g></svg></button>
      <button className="caption-button" aria-label="最小化" onClick={() => act('minimize')}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9"/></svg></button>
      <button className="caption-button" aria-label="最大化或还原" onClick={() => act('toggleMaximize')}><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9"/></svg></button>
      <button className="caption-button close" aria-label="关闭" onClick={() => act('close')}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8"/></svg></button>
    </div>
  </header>{error && <p className="window-error" role="alert">{error}</p>}</>;
}
