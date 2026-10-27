import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TextSettings } from './TextSettings';
import type { TextState } from '../bridge';

const archive: TextState = { sequence: 1, draft: 'keep draft', entries: [], restoreDraft: true, saveHistory: true, maxHistoryEntries: 100, error: null };

describe('maximum history preference', () => {
  it('shows the saved limit and saves an edited value explicitly', async () => {
    const onChange = vi.fn().mockResolvedValue(true);
    render(<TextSettings archive={archive} busy={false} onChange={onChange} />);
    const input = screen.getByRole('spinbutton', { name: '最大历史条数' });
    expect(input).toHaveValue(100);
    fireEvent.change(input, { target: { value: '250' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存上限' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith({ kind: 'historyLimit', maxHistoryEntries: 250 }));
  });

  it.each(['', '0', '10001', '1.5'])('rejects invalid limit %s without a mutation', value => {
    const onChange = vi.fn();
    render(<TextSettings archive={archive} busy={false} onChange={onChange} />);
    const input = screen.getByRole('spinbutton', { name: '最大历史条数' });
    fireEvent.change(input, { target: { value } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('1～10,000');
    expect(screen.getByRole('button', { name: '保存上限' })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('submits a lower limit in one save without a deletion reminder or confirmation', async () => {
    const onChange = vi.fn().mockResolvedValue(true);
    const entries = [1, 2, 3].map(id => ({ id, time: id, text: `saved ${id}`, pinned: id === 1 }));
    render(<TextSettings archive={{ ...archive, entries }} busy={false} onChange={onChange} />);
    const input = screen.getByRole('spinbutton', { name: '最大历史条数' });
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '保存上限' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith({ kind: 'historyLimit', maxHistoryEntries: 2 }));
    expect(screen.queryByRole('group', { name: '调整历史上限确认' })).not.toBeInTheDocument();
    expect(screen.queryByText(/将删除/)).not.toBeInTheDocument();
  });

  it('protects pinned records and keeps limit controls disabled during a task', () => {
    const entries = [1, 2].map(id => ({ id, time: id, text: `saved ${id}`, pinned: true }));
    const props = { archive: { ...archive, entries }, busy: false, onChange: vi.fn() };
    const { rerender } = render(<TextSettings {...props} />);
    const input = screen.getByRole('spinbutton', { name: '最大历史条数' });
    fireEvent.change(input, { target: { value: '1' } });
    expect(screen.getByRole('alert')).toHaveTextContent('2 条置顶记录');
    expect(screen.getByRole('button', { name: '保存上限' })).toBeDisabled();
    fireEvent.change(input, { target: { value: '200' } });
    rerender(<TextSettings {...props} busy />);
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存上限' })).toBeDisabled();
  });

  it('keeps the edited value after a failed save and permits retry', async () => {
    const onChange = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<TextSettings archive={archive} busy={false} onChange={onChange} />);
    fireEvent.change(screen.getByRole('spinbutton', { name: '最大历史条数' }), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: '保存上限' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('spinbutton', { name: '最大历史条数' })).toHaveValue(200);
    fireEvent.click(screen.getByRole('button', { name: '保存上限' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
  });
});
