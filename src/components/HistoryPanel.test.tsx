import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HistoryPanel } from './HistoryPanel';
import type { TextState } from '../bridge';

const text = '第一行\n  第二行😀\n\t第三行完整原文';
const archive: TextState = { sequence: 1, draft: '当前草稿', entries: [{ id: 1, time: Date.now(), text }], restoreDraft: true, saveHistory: true, canUndo: false, error: null };

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
    expect(restore).toHaveTextContent(/^恢复$/);
    fireEvent.click(restore);
    expect(onRestore).toHaveBeenCalledExactlyOnceWith(archive.entries[0]);
    expect(screen.getByRole('status')).toHaveTextContent('点击内容查看全文');
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
