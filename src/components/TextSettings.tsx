import { useState } from 'react';
import type { TextAction, TextState } from '../bridge';
import { NumberSetting } from './SettingsPanel';

/** Text persistence preferences preserve saved data when disabled and allow explicit removal. */
export function TextSettings({ archive, busy, onChange }: { archive: TextState; busy: boolean; onChange: (action: TextAction) => Promise<boolean> }) {
  const [confirming, setConfirming] = useState(false);
  const [limitDraft, setLimitDraft] = useState<number | null | undefined>(undefined);
  const limit = limitDraft === undefined ? archive.maxHistoryEntries : limitDraft;
  const pinned = archive.entries.filter(entry => entry.pinned).length;
  const invalid = limit === null || !Number.isInteger(limit) || limit < Math.max(1, pinned) || limit > 10000;
  const limitError = limit !== null && Number.isInteger(limit) && limit >= 1 && limit < pinned
    ? `已有 ${pinned} 条置顶记录，上限至少为 ${pinned} 条。`
    : '请输入 1～10,000 条的整数。';
  const saveLimit = async () => {
    if (busy || invalid || limit === null) return;
    if (await onChange({ kind: 'historyLimit', maxHistoryEntries: limit })) setLimitDraft(undefined);
  };
  const preference = (restoreDraft: boolean, saveHistory: boolean) => { void onChange({ kind: 'preferences', restoreDraft, saveHistory }); };
  return <section className="text-settings" aria-labelledby="text-settings-heading">
    <h2 id="text-settings-heading">文本保存</h2>
    <label><input type="checkbox" checked={archive.restoreDraft} disabled={busy} onChange={event => preference(event.target.checked, archive.saveHistory)} />保存并恢复上次编辑内容</label>
    <label><input type="checkbox" checked={archive.saveHistory} disabled={busy} onChange={event => preference(archive.restoreDraft, event.target.checked)} />保存历史输入记录</label>
    <NumberSetting id="history-limit" label="最大历史条数" note="1～10,000 条，置顶记录计入上限" unit="条" min={Math.max(1, pinned)} max={10000} value={limit} disabled={busy} error={limitError} onChange={setLimitDraft} />
    <div className="button-group"><button className="button" disabled={busy || invalid || limit === archive.maxHistoryEntries} onClick={() => { void saveLimit(); }}>保存上限</button></div>
    <p>文本以明文保存在 <code>%USERPROFILE%\.key-relay\</code>。历史最多保留 {archive.maxHistoryEntries} 条，关闭保存后已有内容保留，可在历史页清除。</p>
    {!archive.restoreDraft && <div className="saved-draft-actions">
      {confirming ? <><span>清除已保存草稿？当前编辑内容保留。</span><div className="button-group"><button className="button" disabled={busy} onClick={() => setConfirming(false)}>取消清除</button><button className="button" disabled={busy} onClick={() => { void onChange({ kind: 'clearDraft' }).then(ok => { if (ok) setConfirming(false); }); }}>确认清除草稿</button></div></> : <button className="button" disabled={busy || !archive.draft} onClick={() => setConfirming(true)}>清除已保存草稿</button>}
    </div>}
  </section>;
}
