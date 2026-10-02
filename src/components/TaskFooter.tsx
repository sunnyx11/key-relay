import type { DraftSettings, Snapshot } from '../bridge';

/** Shared status location and fixed-width start slot preserve the footer layout. */
export function TaskFooter({ hidden, snapshot, settings, ready, pending, notice, onStart, onClear }: { hidden: boolean; snapshot: Snapshot; settings: DraftSettings; ready: boolean; pending: boolean; notice: { text: string; error: boolean } | null; onStart: () => void; onClear: () => void }) {
  const busy = ['arming', 'countdown', 'typing'].includes(snapshot.phase);
  const state = notice?.error ? 'error' : notice ? 'idle' : snapshot.phase;
  const message = notice?.text || snapshot.message || (settings.delaySeconds !== null && settings.delaySeconds >= 1 && settings.delaySeconds <= 60 ? `点击后等待 ${settings.delaySeconds} 秒，请在此期间选择输入位置。` : '请在设置中填写 1～60 秒的等待时间。');
  const label = snapshot.phase === 'countdown' ? `取消输入（剩余 ${snapshot.remainingSeconds} 秒）` : snapshot.phase === 'typing' ? '正在输入…' : '开始输入';
  return <footer className="footer" style={{ visibility: hidden ? 'hidden' : undefined }} inert={hidden}>
    <p id="status-message" role="status" aria-live={snapshot.phase === 'typing' ? 'off' : 'polite'} data-state={state}>{message}</p>
    <div className="footer-actions"><div className="start-slot"><button className="button primary" id="start" disabled={!ready || pending || ['arming', 'typing'].includes(snapshot.phase)} onClick={onStart}>{label}</button></div><button className="button" id="clear" disabled={!ready || busy || pending} title="清空文本后可按 Ctrl+Z 撤销" onClick={onClear}>清空</button></div>
  </footer>;
}
