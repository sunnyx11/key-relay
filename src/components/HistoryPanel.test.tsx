import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HistoryPanel } from './HistoryPanel';
import type { TextState } from '../bridge';

const text = '第一行\n  第二行😀\n\t第三行完整原文';
const archive: TextState = { sequence: 1, draft: '当前草稿', entries: [{ id: 1, time: Date.now(), text, pinned: false }], restoreDraft: true, saveHistory: true, maxHistoryEntries: 100, error: null };

describe('history viewing and restoration', () => {
  it('opens read-only full text separately from restoration and returns focus to the filtered row', async () => {
    const onRestore = vi.fn();
    const onChange = vi.fn().mockResolvedValue(true);
    render(<HistoryPanel hidden={false} busy={false} archive={archive} onRestore={onRestore} onChange={onChange} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '完整原文' } });
    const preview = screen.getByRole('button', { name: /^查看记录/ });
    fireEvent.click(preview);
    const detail = screen.getByRole('region', { name: '历史全文' });
    expect(within(detail).getByLabelText('历史记录全文').textContent).toBe(text);
    expect(within(detail).getByRole('button', { name: '返回历史' })).toHaveFocus();
    expect(onRestore).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(within(detail).getByRole('button', { name: '返回历史' }));
    await waitFor(() => expect(preview).toHaveFocus());
    expect(screen.getByRole('searchbox')).toHaveValue('完整原文');
    expect(screen.queryByRole('region', { name: '历史全文' })).not.toBeInTheDocument();
  });

  it('provides a separate restore button and preserves the original entry', () => {
    const onRestore = vi.fn();
    render(<HistoryPanel hidden={false} busy={false} archive={archive} onRestore={onRestore} onChange={vi.fn()} />);
    const restore = screen.getByRole('button', { name: /^恢复记录/ });
    expect(restore).toHaveAttribute('title', '恢复记录');
    fireEvent.click(restore);
    expect(onRestore).toHaveBeenCalledExactlyOnceWith(archive.entries[0]);
    expect(screen.getByRole('status')).toHaveTextContent('点击内容查看全文');
  });

  it('sorts pins before ordinary history by time without mutating the archive', async () => {
    const entries = [
      { id: 3, time: 30, text: 'new ordinary', pinned: false },
      { id: 1, time: 10, text: 'old pin', pinned: true },
      { id: 2, time: 20, text: 'new pin', pinned: true },
    ];
    const onChange = vi.fn().mockResolvedValue(true);
    const { container } = render(<HistoryPanel hidden={false} busy={false} archive={{ ...archive, entries }} onRestore={vi.fn()} onChange={onChange} />);
    expect([...container.querySelectorAll('.history-entry')].map(el => el.getAttribute('data-entry-id'))).toEqual(['2', '1', '3']);
    fireEvent.click(screen.getByRole('button', { name: '取消置顶记录：old pin' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ kind: 'pin', id: 1, pinned: false }));
    expect(entries.map(entry => entry.id)).toEqual([3, 1, 2]);
  });

  it('numbers visible records continuously across groups and renumbers after filtering and archive updates', () => {
    const now = new Date(2026, 9, 27, 12).getTime();
    const entries = [
      { id: 90, time: now, text: '今天匹配\n第二行', pinned: false },
      { id: 20, time: now - 86400000, text: '昨天匹配', pinned: false },
      { id: 5, time: now - 2 * 86400000, text: '置顶原文', pinned: true },
    ];
    const props = { hidden: false, busy: false, onRestore: vi.fn(), onChange: vi.fn() };
    const { container, rerender } = render(<HistoryPanel {...props} archive={{ ...archive, entries }} />);
    const previews = () => [...container.querySelectorAll('.history-preview')].map(el => el.textContent);
    expect(previews()).toEqual(['1 置顶原文', '2 今天匹配 第二行', '3 昨天匹配']);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '匹配' } });
    expect(previews()).toEqual(['1 今天匹配 第二行', '2 昨天匹配']);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '第二行' } });
    expect(previews()).toEqual(['1 今天匹配 第二行']);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '没有匹配的内容' } });
    expect(previews()).toEqual([]);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    rerender(<HistoryPanel {...props} archive={{ ...archive, entries: entries.map(entry => ({ ...entry, pinned: entry.id !== 5 })) }} />);
    expect(previews()).toEqual(['1 今天匹配 第二行', '2 昨天匹配', '3 置顶原文']);
    rerender(<HistoryPanel {...props} archive={{ ...archive, entries: entries.slice(1) }} />);
    expect(previews()).toEqual(['1 置顶原文', '2 昨天匹配']);
    expect(entries.map(entry => entry.id)).toEqual([90, 20, 5]);
  });

  it('counts global clear scope and defaults to retaining pins even with a search', async () => {
    const entries = [
      { id: 1, time: 10, text: 'pinned', pinned: true },
      { id: 2, time: 20, text: 'ordinary', pinned: false },
    ];
    const onChange = vi.fn().mockResolvedValue(true);
    render(<HistoryPanel hidden={false} busy={false} archive={{ ...archive, entries }} onRestore={vi.fn()} onChange={onChange} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ordinary' } });
    fireEvent.click(screen.getByRole('button', { name: '清空历史' }));
    const confirmation = screen.getByRole('group', { name: '清空历史确认' });
    expect(within(confirmation).getByRole('checkbox', { name: '同时删除置顶记录' })).not.toBeChecked();
    expect(confirmation).toHaveTextContent('删除 1 条记录，保留 1 条置顶记录');
    fireEvent.click(within(confirmation).getByRole('button', { name: '确认' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ kind: 'clear', includePinned: false }));
    fireEvent.click(screen.getByRole('button', { name: '清空历史' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '同时删除置顶记录' }));
    expect(screen.getByRole('group', { name: '清空历史确认' })).toHaveTextContent('删除 2 条记录，保留 0 条置顶记录');
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ kind: 'clear', includePinned: true }));
  });

  it('deletes immediately without exposing an undo action', async () => {
    const onChange = vi.fn().mockResolvedValue(true);
    const { rerender } = render(<HistoryPanel hidden={false} busy={false} archive={archive} onRestore={vi.fn()} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /^删除记录/ }));
    await waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith({ kind: 'delete', id: 1 }));
    rerender(<HistoryPanel hidden={false} busy={false} archive={{ ...archive, entries: [] }} onRestore={vi.fn()} onChange={onChange} />);
    expect(screen.queryByRole('button', { name: '撤销删除' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('共 0 条记录');
  });

  it('disables both viewing and restoration while protected and closes the viewer when hidden', () => {
    const props = { archive, onRestore: vi.fn(), onChange: vi.fn(), hidden: false, busy: false };
    const { rerender } = render(<HistoryPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /^查看记录/ }));
    rerender(<HistoryPanel {...props} hidden />);
    rerender(<HistoryPanel {...props} busy />);
    expect(screen.queryByRole('region', { name: '历史全文' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^查看记录/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^恢复记录/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^删除记录/ })).toBeDisabled();
  });
});
