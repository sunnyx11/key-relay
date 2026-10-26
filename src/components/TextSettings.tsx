import { useState } from 'react';
import type { TextAction, TextState } from '../bridge';

/** Text persistence preferences preserve saved data when disabled and allow explicit removal. */
export function TextSettings({ archive, busy, onChange }: { archive: TextState; busy: boolean; onChange: (action: TextAction) => Promise<boolean> }) {
  const [confirming, setConfirming] = useState(false);
  const preference = (restoreDraft: boolean, saveHistory: boolean) => { void onChange({ kind: 'preferences', restoreDraft, saveHistory }); };
  return <section className="text-settings" aria-labelledby="text-settings-heading">
    <h2 id="text-settings-heading">文本保存</h2>
    <label><input type="checkbox" checked={archive.restoreDraft} disabled={busy} onChange={event => preference(event.target.checked, archive.saveHistory)} />保存并恢复上次编辑内容</label>
    <label><input type="checkbox" checked={archive.saveHistory} disabled={busy} onChange={event => preference(archive.restoreDraft, event.target.checked)} />保存历史输入记录</label>
    <p>文本以明文保存在 <code>%USERPROFILE%\.key-relay\</code>。历史最多保留最近 100 条，关闭保存后已有内容保留，可在历史页清除。</p>
    {!archive.restoreDraft && <div className="saved-draft-actions">
      {confirming ? <><span>清除已保存草稿？当前编辑内容保留。</span><div className="button-group"><button className="button" disabled={busy} onClick={() => setConfirming(false)}>取消清除</button><button className="button" disabled={busy} onClick={() => { void onChange({ kind: 'clearDraft' }).then(ok => { if (ok) setConfirming(false); }); }}>确认清除草稿</button></div></> : <button className="button" disabled={busy || !archive.draft} onClick={() => setConfirming(true)}>清除已保存草稿</button>}
    </div>}
  </section>;
}
