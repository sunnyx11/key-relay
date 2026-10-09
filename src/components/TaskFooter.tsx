import type { DraftSettings, Snapshot } from '../bridge';

/** Task status, scalar count and text actions share a compact footer. */
export function TaskFooter({ hidden, text, snapshot, settings, ready, pending, notice, onStart, onTrimTrailing, onClear }: { hidden: boolean; text: string; snapshot: Snapshot; settings: DraftSettings; ready: boolean; pending: boolean; notice: { text: string; error: boolean } | null; onStart: () => void; onTrimTrailing: () => void; onClear: () => void }) {
  const busy = ['arming', 'countdown', 'typing'].includes(snapshot.phase);
  const editingDisabled = !ready || busy || pending || !text.length;
  const count = Array.from(text.replace(/\r\n?/g, '\n')).length;
  const state = notice?.error ? 'error' : notice ? 'idle' : snapshot.phase;
  const message = notice?.text || (snapshot.phase === 'countdown' ? `等待输入，剩余 ${snapshot.remainingSeconds} 秒，请选择输入位置。` : snapshot.message) || (settings.delaySeconds !== null && settings.delaySeconds >= 1 && settings.delaySeconds <= 60 ? `点击后等待 ${settings.delaySeconds} 秒，请在此期间选择输入位置。` : '请在设置中填写 1～60 秒的等待时间。');
  const label = snapshot.phase === 'countdown' ? '取消输入' : snapshot.phase === 'typing' ? '输入中…' : '开始输入';
  return <footer className="footer" style={{ visibility: hidden ? 'hidden' : undefined }} inert={hidden}>
    <p id="status-message" role="status" aria-live={snapshot.phase === 'typing' ? 'off' : 'polite'} data-state={state}>{message}</p>
    <div className="footer-actions">
      <span id="text-count">{count} 个字符</span>
      <div className="button-group" role="group" aria-label="输入操作">
        <button className="button tool-button" id="trim-trailing" disabled={editingDisabled} aria-label="清理" aria-description="去除每行末尾的空格和制表符，保留缩进与空行；可按 Ctrl+Z 逐行撤销" data-tooltip="去除行尾空格" onClick={onTrimTrailing}>清理</button>
        <button className="button tool-button" id="clear" disabled={editingDisabled} aria-label="清空" aria-description="清空文本，可按 Ctrl+Z 撤销" data-tooltip="清空文本" onClick={onClear}>清空</button>
        <button className="button primary" id="start" disabled={!ready || pending || ['arming', 'typing'].includes(snapshot.phase)} onClick={onStart}>{label}</button>
      </div>
    </div>
  </footer>;
}
