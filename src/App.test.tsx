import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { bridge, defaults, type Snapshot } from './bridge';

vi.mock('./bridge', async importOriginal => {
  const original = await importOriginal<typeof import('./bridge')>();
  return { ...original, bridge: { snapshot: vi.fn(), sync: vi.fn(), start: vi.fn(), cancel: vi.fn(), save: vi.fn(), subscribe: vi.fn() } };
});
const pinWindow = vi.hoisted(() => ({ isAlwaysOnTop: vi.fn(), setAlwaysOnTop: vi.fn() }));
const sizingWindow = vi.hoisted(() => ({ setSize: vi.fn(), isMaximized: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ ...pinWindow, ...sizingWindow, show: vi.fn(), onResized: async () => () => {}, minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(), startDragging: vi.fn() }), LogicalSize: class { constructor(public width: number, public height: number) {} } }));

const initial: Snapshot = { sequence: 1, phase: 'idle', sent: 0, total: 0, remainingSeconds: 0, message: '', settings: defaults, shortcutError: null };
let notify: (state: Snapshot) => void;
beforeEach(() => {
  sizingWindow.setSize.mockResolvedValue(undefined);
  sizingWindow.isMaximized.mockResolvedValue(false);
  let pinned = false;
  pinWindow.isAlwaysOnTop.mockImplementation(async () => pinned);
  pinWindow.setAlwaysOnTop.mockImplementation(async (value: boolean) => { pinned = value; });
  vi.mocked(bridge.snapshot).mockResolvedValue(initial);
  vi.mocked(bridge.sync).mockResolvedValue();
  vi.mocked(bridge.subscribe).mockImplementation(async handler => { notify = handler; return () => {}; });
  vi.mocked(bridge.start).mockResolvedValue({ ...initial, sequence: 2, phase: 'countdown', remainingSeconds: 5 });
  vi.mocked(bridge.cancel).mockResolvedValue({ ...initial, sequence: 3, phase: 'stopped' });
  vi.mocked(bridge.save).mockImplementation(async settings => ({ ...initial, sequence: 4, settings }));
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
async function mount() {
  render(<App />);
  await waitFor(() => expect(screen.getByRole('button', { name: '开始输入' })).toBeEnabled());
}
describe('editor and native task integration', () => {
  it('applies content shrinkage received during a native resize', async () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 410 } as DOMRect);
    let resized: ResizeObserverCallback = () => {};
    globalThis.ResizeObserver = class { constructor(callback: ResizeObserverCallback) { resized = callback; } observe() {} unobserve() {} disconnect() {} };
    let finishResize!: () => void;
    sizingWindow.setSize.mockImplementationOnce(() => new Promise<void>(resolve => { finishResize = resolve; }));
    const { unmount } = render(<App />);
    try {
      await waitFor(() => expect(sizingWindow.setSize).toHaveBeenCalledWith(expect.objectContaining({ height: 410 })));
      rect.mockReturnValue({ height: 379 } as DOMRect);
      act(() => resized([], {} as ResizeObserver));
      await act(async () => finishResize());
      await waitFor(() => expect(sizingWindow.setSize).toHaveBeenLastCalledWith(expect.objectContaining({ height: 379 })));
    } finally { unmount(); rect.mockRestore(); }
  });
  it('remeasures viewport changes received while resizing', async () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 379 } as DOMRect);
    let finishResize!: () => void;
    sizingWindow.setSize.mockImplementationOnce(() => new Promise<void>(resolve => { finishResize = resolve; }));
    const { unmount } = render(<App />);
    try {
      await waitFor(() => expect(sizingWindow.setSize).toHaveBeenCalledTimes(1));
      act(() => window.dispatchEvent(new Event('resize')));
      await act(async () => finishResize());
      await waitFor(() => expect(sizingWindow.setSize).toHaveBeenCalledTimes(2));
    } finally { unmount(); rect.mockRestore(); }
  });
  it('shows the editor, title controls and default settings', async () => {
    await mount(); expect(screen.getByRole('textbox', { name: '待输入文本' })).toBeVisible();
    expect(screen.getByRole('button', { name: '关闭' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: '设置' }));
    expect(screen.getByLabelText('等待时间')).toHaveValue(5);
    expect(screen.getByLabelText('字符间隔')).toHaveValue(50);
  });
  it('sends the latest source and normalized count with a frozen start draft', async () => {
    await mount(); fireEvent.input(screen.getByRole('textbox'), { target: { value: '中😀\nA' } });
    expect(screen.getByText('4 个字符')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '开始输入' }));
    await waitFor(() => expect(bridge.start).toHaveBeenCalledWith(expect.objectContaining({ text: '中😀\nA', settings: defaults })));
    expect(screen.getByRole('tab', { name: '设置' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '取消输入（剩余 5 秒）' }));
    await waitFor(() => expect(bridge.cancel).toHaveBeenCalled());
  });
  it('locates invalid settings and allows restoration', async () => {
    await mount(); fireEvent.input(screen.getByRole('textbox'), { target: { value: 'text' } });
    fireEvent.click(screen.getByRole('tab', { name: '设置' }));
    fireEvent.change(screen.getByLabelText('等待时间'), { target: { value: '0' } });
    expect(screen.getByText('请输入 1～60 秒的整数。')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: '输入' }));
    fireEvent.click(screen.getByRole('button', { name: '开始输入' }));
    expect(screen.getByLabelText('等待时间')).toHaveFocus(); expect(bridge.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }));
    await waitFor(() => expect(screen.queryByText('请输入 1～60 秒的整数。')).not.toBeInTheDocument());
  });
  it('ignores stale task events and preserves text on interruption', async () => {
    await mount(); fireEvent.input(screen.getByRole('textbox'), { target: { value: 'keep' } });
    act(() => notify({ ...initial, sequence: 10, phase: 'typing', sent: 1, total: 4, message: '已发送 1 / 4 字符' }));
    expect(screen.getByRole('button', { name: '清空' })).toBeDisabled();
    act(() => notify({ ...initial, sequence: 9 }));
    expect(screen.getByRole('button', { name: '清空' })).toBeDisabled();
    fireEvent.pointerDown(screen.getByRole('button', { name: '清空' }));
    act(() => notify({ ...initial, sequence: 11, phase: 'stopped', sent: 1, total: 4 }));
    fireEvent.click(screen.getByRole('button', { name: '清空' }), { detail: 1 });
    expect(screen.getByRole('textbox')).toHaveValue('keep');
  });
  it('preserves disabled actions when the native stop event precedes pointerdown', async () => {
    await mount(); fireEvent.input(screen.getByRole('textbox'), { target: { value: 'keep' } });
    act(() => notify({ ...initial, sequence: 10, phase: 'stopped', ...{ interactionBlocked: true } }));
    expect(screen.getByRole('button', { name: '清空' })).toBeDisabled();
    fireEvent.pointerDown(screen.getByRole('button', { name: '清空' }));
    act(() => notify({ ...initial, sequence: 11, phase: 'stopped', ...{ interactionBlocked: false } }));
    fireEvent.click(screen.getByRole('button', { name: '清空' }), { detail: 1 });
    expect(screen.getByRole('textbox')).toHaveValue('keep');
  });
  it('persists valid settings before an immediate start', async () => {
    await mount(); fireEvent.input(screen.getByRole('textbox'), { target: { value: 'text' } });
    fireEvent.click(screen.getByRole('tab', { name: '设置' }));
    fireEvent.change(screen.getByLabelText('等待时间'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('tab', { name: '输入' }));
    fireEvent.click(screen.getByRole('button', { name: '开始输入' }));
    await waitFor(() => expect(bridge.start).toHaveBeenCalled());
    expect(bridge.save).toHaveBeenCalledWith({ ...defaults, delaySeconds: 2 });
    expect(vi.mocked(bridge.save).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(bridge.start).mock.invocationCallOrder[0]);
  });
  it('toggles native pin state and retains it when setting fails', async () => {
    await mount();
    const pin = screen.getByRole('button', { name: '置顶窗口' });
    await waitFor(() => expect(pin).toBeEnabled());
    fireEvent.click(pin);
    await waitFor(() => expect(screen.getByRole('button', { name: '取消置顶' })).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(screen.getByRole('tab', { name: '设置' }));
    pinWindow.setAlwaysOnTop.mockRejectedValueOnce(new Error('denied'));
    fireEvent.click(screen.getByRole('button', { name: '取消置顶' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('置顶设置失败'));
    expect(screen.getByRole('button', { name: '取消置顶' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '取消置顶' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '置顶窗口' })).toHaveAttribute('aria-pressed', 'false'));
  });
  it('protects the pin from the same gesture that stops a task', async () => {
    await mount();
    const pin = screen.getByRole('button', { name: '置顶窗口' });
    await waitFor(() => expect(pin).toBeEnabled());
    let sequence = initial.sequence;
    for (const phase of ['arming', 'countdown', 'typing'] as const) {
      act(() => notify({ ...initial, sequence: ++sequence, phase }));
      expect(pin).toBeDisabled();
    }
    fireEvent.pointerDown(pin);
    act(() => notify({ ...initial, sequence: ++sequence, phase: 'stopped' }));
    fireEvent.click(pin, { detail: 1 });
    expect(pinWindow.setAlwaysOnTop).not.toHaveBeenCalled();
    fireEvent.click(pin);
    await waitFor(() => expect(pinWindow.setAlwaysOnTop).toHaveBeenCalledWith(true));
  });
  it('registration failure keeps button start available', async () => {
    vi.mocked(bridge.snapshot).mockResolvedValue({ ...initial, shortcutError: '快捷键注册失败，请重新选择。' });
    await mount(); expect(screen.getByText('快捷键注册失败，请重新选择。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始输入' })).toBeEnabled();
  });
});
