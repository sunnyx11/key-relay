import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { HistoryEntry, TextAction, TextState } from '../bridge';

/** Search and view saved originals, with explicit restore and deletion actions. */
export function HistoryPanel({ hidden, busy, archive, onRestore, onChange }: {
  hidden: boolean; busy: boolean; archive: TextState;
  onRestore: (entry: HistoryEntry) => void; onChange: (action: TextAction) => Promise<boolean>;
}) {
  const [query, setQuery] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [viewed, setViewed] = useState<HistoryEntry | null>(null);
  const [includePinned, setIncludePinned] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const clearButton = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const viewButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 60000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (hidden || busy) { setConfirming(false); setViewed(null); } }, [hidden, busy]);
  useEffect(() => { if (viewed) backButton.current?.focus(); }, [viewed]);
  useEffect(() => { if (confirming) cancelButton.current?.focus(); }, [confirming]);
  const entries = archive.entries.filter(entry => entry.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.time - a.time || b.id - a.id);
  const pinnedCount = archive.entries.filter(entry => entry.pinned).length;
  const retainedCount = includePinned ? 0 : pinnedCount;
  const deleteCount = archive.entries.length - retainedCount;
  const today = new Date(clock);
  const yesterday = new Date(clock); yesterday.setDate(yesterday.getDate() - 1);
  const groups = new Map<string, { entry: HistoryEntry; number: number }[]>();
  for (const [index, entry] of entries.entries()) {
    const date = new Date(entry.time);
    const label = entry.pinned ? '置顶' : date.toDateString() === today.toDateString() ? '今天' : date.toDateString() === yesterday.toDateString() ? '昨天' : date.toLocaleDateString('zh-CN');
    groups.set(label, [...(groups.get(label) || []), { entry, number: index + 1 }]);
  }
  return <section className="panel history-panel" id="history-panel" role="tabpanel" aria-labelledby="history-tab" hidden={hidden} inert={hidden}>
    <div className="history-content">
      {viewed && <section className="history-detail" role="region" aria-labelledby="history-detail-heading">
        <div className="history-detail-heading"><h2 id="history-detail-heading">历史全文</h2><button className="button" ref={backButton} onClick={() => { flushSync(() => setViewed(null)); viewButton.current?.focus(); }}>返回历史</button></div>
        <pre className="history-full-text" aria-label="历史记录全文" tabIndex={0}>{viewed.text}</pre>
      </section>}
      <div className="history-toolbar" hidden={!!viewed}>
        <input className="text-control" ref={search} type="search" aria-label="搜索历史内容" placeholder="搜索历史内容…" value={query} onChange={event => setQuery(event.target.value)} />
        <button className="button" ref={clearButton} disabled={busy || !archive.entries.length} onClick={() => { setIncludePinned(false); setConfirming(true); }}>清空历史</button>
      </div>
      {confirming && <div className="history-confirmation" role="group" aria-label="清空历史确认">
        <p>删除 {deleteCount} 条记录，保留 {retainedCount} 条置顶记录。当前编辑内容和已保存草稿将保留。</p>
        <label><input type="checkbox" checked={includePinned} disabled={busy} onChange={event => setIncludePinned(event.target.checked)} />同时删除置顶记录</label>
        <div className="button-group"><button className="button" ref={cancelButton} disabled={busy} onClick={() => { setConfirming(false); clearButton.current?.focus(); }}>取消</button><button className="button" disabled={busy || !deleteCount} onClick={() => { void onChange({ kind: 'clear', includePinned }).then(ok => { if (ok) { setConfirming(false); search.current?.focus(); } }); }}>确认</button></div>
      </div>}
      <div className="history-list" aria-label="历史输入记录" tabIndex={0} hidden={!!viewed}>
        {!entries.length && <div className="history-empty"><p>{query ? '没有找到匹配的记录。' : '暂无历史输入记录'}</p>{!query && <p>开始输入后，文本会保存在这里。</p>}</div>}
        {[...groups].map(([label, records]) => <section className="history-group" key={label} aria-label={label}>
          <h2>{label}</h2>
          {records.map(({ entry, number }) => <article className="history-entry" key={entry.id} data-entry-id={entry.id}>
            <button className="history-view" disabled={busy} aria-label={`查看记录：${entry.text.slice(0, 80)}`} onClick={event => { viewButton.current = event.currentTarget; setConfirming(false); setViewed(entry); }}>
              <span className="history-preview"><span className="history-number">{number}</span>{' '}{entry.text.replace(/[\r\n]+/g, ' ')}</span>
            </button>
            <span className="history-meta"><time dateTime={new Date(entry.time).toISOString()}>{new Date(entry.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</time></span>
            <div className="history-actions">
              <button className="button history-pin" disabled={busy} aria-label={`${entry.pinned ? '取消置顶' : '置顶'}记录：${entry.text.slice(0, 80)}`} title={entry.pinned ? '取消置顶记录' : '置顶记录'} aria-pressed={entry.pinned} onClick={() => { void onChange({ kind: 'pin', id: entry.id, pinned: !entry.pinned }); }}><svg viewBox="0 0 16 16" aria-hidden="true"><g transform={entry.pinned ? undefined : 'rotate(35 8 8)'}><path d="M5 2.5h6M6 2.5v5l-2 3h8l-2-3v-5M8 10.5v3" /></g></svg></button>
              <button className="button" disabled={busy} aria-label={`恢复记录：${entry.text.slice(0, 80)}`} title="恢复记录" onClick={() => onRestore(entry)}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 3.5 3 7l3.5 3.5M3 7h6a3 3 0 0 1 3 3v2.5" /></svg></button>
              <button className="button" disabled={busy} aria-label={`删除记录：${entry.text.slice(0, 80)}`} title="删除记录" onClick={() => { void onChange({ kind: 'delete', id: entry.id }); }}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6 4.5v-2h4v2M4.5 4.5l.5 9h6l.5-9M6.5 6.5v5M9.5 6.5v5" /></svg></button>
            </div>
          </article>)}
        </section>)}
      </div>
      <div className="history-footer" role="status">
        <span>{query ? `找到 ${entries.length} 条` : `共 ${archive.entries.length} 条记录`} · 点击内容查看全文，点击“恢复”填入输入框</span>
      </div>
    </div>
  </section>;
}
