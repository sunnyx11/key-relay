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
  const [deletedAt, setDeletedAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const clearButton = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const viewButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 60000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (hidden || busy) { setConfirming(false); setViewed(null); } }, [hidden, busy]);
  useEffect(() => { if (viewed) backButton.current?.focus(); }, [viewed]);
  useEffect(() => {
    if (!deletedAt) return;
    const timer = window.setTimeout(() => setDeletedAt(0), Math.max(0, deletedAt + 10000 - Date.now()));
    return () => window.clearTimeout(timer);
  }, [deletedAt]);
  useEffect(() => { if (confirming) cancelButton.current?.focus(); }, [confirming]);
  const entries = archive.entries.filter(entry => entry.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const today = new Date(clock);
  const yesterday = new Date(clock); yesterday.setDate(yesterday.getDate() - 1);
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const date = new Date(entry.time);
    const label = date.toDateString() === today.toDateString() ? '今天' : date.toDateString() === yesterday.toDateString() ? '昨天' : date.toLocaleDateString('zh-CN');
    groups.set(label, [...(groups.get(label) || []), entry]);
  }
  return <section className="panel history-panel" id="history-panel" role="tabpanel" aria-labelledby="history-tab" hidden={hidden} inert={hidden}>
    <div className="history-content">
      {viewed && <section className="history-detail" role="region" aria-labelledby="history-detail-heading">
        <div className="history-detail-heading"><h2 id="history-detail-heading">历史全文</h2><button className="button" ref={backButton} onClick={() => { flushSync(() => setViewed(null)); viewButton.current?.focus(); }}>返回历史</button></div>
        <pre className="history-full-text" aria-label="历史记录全文" tabIndex={0}>{viewed.text}</pre>
      </section>}
      <div className="history-toolbar" hidden={!!viewed}>
        <input ref={search} type="search" aria-label="搜索历史内容" placeholder="搜索历史内容…" value={query} onChange={event => setQuery(event.target.value)} />
        <button className="button" ref={clearButton} disabled={busy || !archive.entries.length} onClick={() => setConfirming(true)}>清空历史</button>
      </div>
      {confirming && <div className="history-confirmation" role="group" aria-label="清空历史确认">
        <p>清空全部历史记录？当前编辑内容和已保存草稿将保留。</p>
        <div className="button-group"><button className="button" ref={cancelButton} disabled={busy} onClick={() => { setConfirming(false); clearButton.current?.focus(); }}>取消</button><button className="button" disabled={busy} onClick={() => { void onChange({ kind: 'clear' }).then(ok => { if (ok) { setConfirming(false); setDeletedAt(0); search.current?.focus(); } }); }}>确认清空历史</button></div>
      </div>}
      <div className="history-list" aria-label="历史输入记录" tabIndex={0} hidden={!!viewed}>
        {!entries.length && <div className="history-empty"><p>{query ? '没有找到匹配的记录。' : '暂无历史输入记录'}</p>{!query && <p>开始输入后，文本会保存在这里。</p>}</div>}
        {[...groups].map(([label, records]) => <section className="history-group" key={label} aria-label={label}>
          <h2>{label}</h2>
          {records.map(entry => <article className="history-entry" key={entry.id} data-entry-id={entry.id}>
            <button className="history-view" disabled={busy} aria-label={`查看记录：${entry.text.slice(0, 80)}`} onClick={event => { viewButton.current = event.currentTarget; setConfirming(false); setViewed(entry); }}>
              <span className="history-preview">{entry.text}</span>
              <span className="history-meta"><time dateTime={new Date(entry.time).toISOString()}>{new Date(entry.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</time> · {Array.from(entry.text.replace(/\r\n?/g, '\n')).length} 个字符</span>
            </button>
            <div className="history-actions">
              <button className="button" disabled={busy} aria-label={`恢复记录：${entry.text.slice(0, 80)}`} onClick={() => onRestore(entry)}>恢复</button>
              <button className="button" disabled={busy} aria-label={`删除记录：${entry.text.slice(0, 80)}`} onClick={() => { void onChange({ kind: 'delete', id: entry.id }).then(() => setDeletedAt(Date.now())); }}>删除</button>
            </div>
          </article>)}
        </section>)}
      </div>
      <div className="history-footer" role="status">
        {deletedAt > 0 && archive.canUndo ? <><span>已删除一条记录</span><button className="button" disabled={busy} onClick={() => { void onChange({ kind: 'undo' }).then(ok => { if (ok) setDeletedAt(0); }); }}>撤销删除</button></> : <span>{query ? `找到 ${entries.length} 条` : `共 ${archive.entries.length} 条记录`} · 点击内容查看全文，点击“恢复”填入输入框</span>}
      </div>
    </div>
  </section>;
}
