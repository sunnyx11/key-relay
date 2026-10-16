import { useState } from 'react';
import type { Snapshot } from '../bridge';

/** Task status, scalar count and text actions share a compact footer. */
export function TaskFooter({ hidden, text, snapshot, ready, pending, notice, onStart, onTrimTrailing, onClear }: { hidden: boolean; text: string; snapshot: Snapshot; ready: boolean; pending: boolean; notice: { text: string; error: boolean } | null; onStart: () => void; onTrimTrailing: () => void; onClear: () => void }) {
  const [detailsDismissed, setDetailsDismissed] = useState(false);
  const busy = ['targeting', 'typing'].includes(snapshot.phase);
  const target = !busy ? snapshot.target : null;
  const editingDisabled = !ready || busy || pending || !text.length;
  const count = Array.from(text.replace(/\r\n?/g, '\n')).length;
  const state = notice?.error ? 'error' : notice ? 'idle' : snapshot.phase;
  const targetMessage = snapshot.target ? '已记录输入位置' : '请先点击外部输入位置';
  const message = notice?.text || snapshot.message || targetMessage;
  const label = snapshot.phase === 'targeting' ? '取消输入' : snapshot.phase === 'typing' ? '输入中…' : '开始输入';
  return <footer className="footer" style={{ visibility: hidden ? 'hidden' : undefined }} inert={hidden}>
    <div className="task-status" data-dismissed={detailsDismissed} onMouseEnter={() => setDetailsDismissed(false)} onFocus={() => setDetailsDismissed(false)} onKeyDown={event => { if (event.key === 'Escape') setDetailsDismissed(true); }}>
      <p id="status-message" role="status" aria-live={snapshot.phase === 'typing' ? 'off' : 'polite'} data-state={state} data-summary={!notice?.text && !snapshot.message} tabIndex={target ? 0 : undefined} aria-describedby={target ? 'target-details' : undefined}>{message}</p>
      {target && <div id="target-details" role="tooltip">
        <div>{target.title}</div>
        <div>坐标：({target.x}, {target.y})</div>
      </div>}
    </div>
    <div className="footer-actions">
      <span id="text-count">{count} 个字符</span>
      <div className="button-group" role="group" aria-label="输入操作">
        <button className="button tool-button" id="trim-trailing" disabled={editingDisabled} aria-label="清理" aria-description="去除每行末尾的空格和制表符，保留缩进与空行；可按 Ctrl+Z 逐行撤销" data-tooltip="去除行尾空格" onClick={onTrimTrailing}>清理</button>
        <button className="button tool-button" id="clear" disabled={editingDisabled} aria-label="清空" aria-description="清空文本，可按 Ctrl+Z 撤销" data-tooltip="清空文本" onClick={onClear}>清空</button>
        <button className="button primary" id="start" disabled={!ready || pending || !snapshot.target || snapshot.phase === 'typing'} onClick={onStart}>{label}</button>
      </div>
    </div>
  </footer>;
}
