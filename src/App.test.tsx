import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import license from '../LICENSE?raw';
import { bridge, defaults, updateBridge, type Snapshot, type UpdateSnapshot } from './bridge';

vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

vi.mock('./bridge', async importOriginal => {
  const original = await importOriginal<typeof import('./bridge')>();
  return { ...original, bridge: { snapshot: vi.fn(), sync: vi.fn(), start: vi.fn(), cancel: vi.fn(), save: vi.fn(), subscribe: vi.fn() }, updateBridge: { snapshot: vi.fn(), preference: vi.fn(), check: vi.fn(), download: vi.fn(), install: vi.fn(), subscribe: vi.fn() } };
});
const pinWindow = vi.hoisted(() => ({ isAlwaysOnTop: vi.fn(), setAlwaysOnTop: vi.fn() }));
const sizingWindow = vi.hoisted(() => ({ setSize: vi.fn(), isMaximized: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ ...pinWindow, ...sizingWindow, show: vi.fn(), onResized: async () => () => {}, minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(), startDragging: vi.fn() }), LogicalSize: class { constructor(public width: number, public height: number) {} } }));

const initial: Snapshot = { sequence: 1, phase: 'idle', sent: 0, total: 0, remainingSeconds: 0, message: '', settings: defaults, shortcutError: null };
let notify: (state: Snapshot) => void;
let updateNotify: (state: UpdateSnapshot) => void;
const updateInitial: UpdateSnapshot = { sequence: 1, phase: 'idle', installed: true, autoCheck: true, version: null, notes: '', downloaded: 0, total: null, message: '' };
beforeEach(() => {
  vi.mocked(updateBridge.snapshot).mockResolvedValue(updateInitial);
  vi.mocked(updateBridge.subscribe).mockImplementation(async handler => { updateNotify = handler; return () => {}; });
  vi.mocked(updateBridge.check).mockResolvedValue({ ...updateInitial, sequence: 2, phase: 'available', version: '2.0.0', notes: '修复输入问题' });
  vi.mocked(updateBridge.download).mockResolvedValue({ ...updateInitial, sequence: 3, phase: 'ready', version: '2.0.0' });
  vi.mocked(updateBridge.install).mockResolvedValue({ ...updateInitial, sequence: 4, phase: 'ready', message: '任务结束后可安装更新。' });
  vi.mocked(updateBridge.preference).mockImplementation(async autoCheck => ({ ...updateInitial, sequence: 5, autoCheck }));
  vi.mocked(getVersion).mockResolvedValue('1.2.3');
  vi.mocked(openUrl).mockResolvedValue();
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
  it('checks without downloading and requires explicit confirmation before installation', async () => {
    await mount();
    fireEvent.input(screen.getByRole('textbox'), { target: { value: '保留文本' } });
    fireEvent.click(screen.getByRole('tab', { name: '关于' }));
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    await waitFor(() => expect(screen.getByText('发现新版本 2.0.0')).toBeVisible());
    expect(updateBridge.download).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '下载更新' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '安装并重启' })).toBeEnabled());
    expect(updateBridge.install).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '安装并重启' }));
    expect(screen.getByText('重启后将清除编辑框中的全部文本，请先保存需要保留的内容。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '暂不安装' }));
    expect(updateBridge.install).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '安装并重启' }));
    fireEvent.click(screen.getByRole('button', { name: '确认安装并重启' }));
    await waitFor(() => expect(updateBridge.install).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('任务结束后可安装更新。')).toBeVisible());
    fireEvent.click(screen.getByRole('tab', { name: '输入' }));
    expect(screen.getByRole('textbox')).toHaveValue('保留文本');
  });
  it('keeps portable updates manual and never changes the selected tab on discovery', async () => {
    vi.mocked(updateBridge.snapshot).mockResolvedValue({ ...updateInitial, installed: false });
    await mount();
    act(() => updateNotify({ ...updateInitial, sequence: 2, installed: false, phase: 'available', version: '2.0.0' }));
    expect(screen.getByRole('tab', { name: '输入' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: /关于/ }));
    expect(screen.getByRole('link', { name: '前往下载' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '下载更新' })).not.toBeInTheDocument();
    expect(updateBridge.download).not.toHaveBeenCalled();
  });
  it('automatically checks after ten seconds and respects the persistent opt-out', async () => {
    vi.useFakeTimers();
    const view = render(<App />);
    try {
      await act(async () => {});
      await act(async () => { await vi.advanceTimersByTimeAsync(9999); });
      expect(updateBridge.check).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(updateBridge.check).toHaveBeenCalledTimes(1);
      expect(updateBridge.download).not.toHaveBeenCalled();
      expect(screen.getByRole('tab', { name: '输入' })).toHaveAttribute('aria-selected', 'true');
      fireEvent.click(screen.getByRole('tab', { name: /关于/ }));
      await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: '自动检查更新' })); });
      expect(updateBridge.preference).toHaveBeenCalledWith(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(86_400_000); });
      expect(updateBridge.check).toHaveBeenCalledTimes(1);
    } finally { view.unmount(); vi.useRealTimers(); }
  });
  it('discards an installation confirmation when an input task starts', async () => {
    vi.mocked(updateBridge.snapshot).mockResolvedValue({ ...updateInitial, phase: 'ready', version: '2.0.0' });
    await mount();
    fireEvent.click(screen.getByRole('tab', { name: /关于/ }));
    fireEvent.click(screen.getByRole('button', { name: '安装并重启' }));
    act(() => notify({ ...initial, sequence: 2, phase: 'typing' }));
    expect(screen.getByRole('tab', { name: '输入' })).toHaveAttribute('aria-selected', 'true');
    act(() => notify({ ...initial, sequence: 3, phase: 'done' }));
    fireEvent.click(screen.getByRole('tab', { name: /关于/ }));
    expect(screen.queryByRole('button', { name: '确认安装并重启' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '安装并重启' })).toBeEnabled();
    expect(updateBridge.install).not.toHaveBeenCalled();
  });
  it('stops installation if valid settings cannot be persisted', async () => {
    vi.mocked(updateBridge.snapshot).mockResolvedValue({ ...updateInitial, phase: 'ready', version: '2.0.0' });
    vi.mocked(bridge.save).mockRejectedValue(new Error('保存设置失败'));
    await mount();
    fireEvent.click(screen.getByRole('tab', { name: /关于/ }));
    fireEvent.click(screen.getByRole('button', { name: '安装并重启' }));
    fireEvent.click(screen.getByRole('button', { name: '确认安装并重启' }));
    await waitFor(() => expect(screen.getByRole('region', { name: '应用更新' })).toHaveTextContent('Error: 保存设置失败'));
    expect(updateBridge.install).not.toHaveBeenCalled();
  });
  it('shows runtime version, contact links and the bundled license while preserving the draft', async () => {
    await mount();
    fireEvent.input(screen.getByRole('textbox'), { target: { value: '保留文本' } });
    fireEvent.click(screen.getByRole('tab', { name: '关于' }));
    await waitFor(() => expect(screen.getByText('版本 1.2.3 · Windows 64 位')).toBeVisible());
    expect(screen.getByText('© 2026 sunnyx11')).toBeVisible();
    for (const [name, url] of [
      ['项目主页', 'https://github.com/sunnyx11/key-relay'],
      ['使用说明', 'https://github.com/sunnyx11/key-relay#readme'],
      ['问题反馈', 'https://github.com/sunnyx11/key-relay/issues'],
      ['hkhl888@foxmail.com', 'mailto:hkhl888@foxmail.com'],
    ]) {
      const link = screen.getByRole('link', { name });
      expect(link).toHaveAttribute('href', url);
      fireEvent.click(link);
      await waitFor(() => expect(openUrl).toHaveBeenLastCalledWith(url));
    }
    fireEvent.click(screen.getByRole('button', { name: 'MIT 许可证' }));
    expect(screen.getByLabelText('MIT 许可证全文').textContent).toBe(license);
    expect(screen.getByRole('button', { name: '返回关于' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '返回关于' }));
    expect(screen.getByRole('button', { name: 'MIT 许可证' })).toHaveFocus();
    fireEvent.click(screen.getByRole('tab', { name: '输入' }));
    expect(screen.getByRole('textbox')).toHaveValue('保留文本');
  });
  it('reports version and opener failures in the about panel and supports retry', async () => {
    vi.mocked(getVersion).mockRejectedValueOnce(new Error('metadata unavailable'));
    await mount(); fireEvent.click(screen.getByRole('tab', { name: '关于' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('读取版本失败'));
    fireEvent.click(screen.getByRole('button', { name: '重试读取版本' }));
    await waitFor(() => expect(screen.getByText('版本 1.2.3 · Windows 64 位')).toBeVisible());
    vi.mocked(openUrl).mockRejectedValueOnce(new Error('no handler'));
    fireEvent.click(screen.getByRole('link', { name: 'hkhl888@foxmail.com' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('打开失败'));
    fireEvent.click(screen.getByRole('link', { name: 'hkhl888@foxmail.com' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
  it('navigates three tabs and returns from about when a native task starts', async () => {
    await mount();
    const input = screen.getByRole('tab', { name: '输入' });
    const settings = screen.getByRole('tab', { name: '设置' });
    const about = screen.getByRole('tab', { name: '关于' });
    fireEvent.keyDown(input, { key: 'ArrowRight' }); expect(settings).toHaveFocus();
    fireEvent.keyDown(settings, { key: 'ArrowRight' }); expect(about).toHaveFocus();
    fireEvent.keyDown(about, { key: 'ArrowRight' }); expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'ArrowLeft' }); expect(about).toHaveFocus();
    fireEvent.keyDown(about, { key: 'Home' }); expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'End' }); expect(about).toHaveFocus();
    act(() => notify({ ...initial, sequence: 2, phase: 'arming' }));
    expect(input).toHaveAttribute('aria-selected', 'true');
    expect(about).toBeDisabled();
    fireEvent.keyDown(input, { key: 'End' }); expect(settings).toHaveFocus();
    act(() => notify({ ...initial, sequence: 3, phase: 'countdown' }));
    fireEvent.keyDown(input, { key: 'End' }); expect(input).toHaveFocus();
    expect(about).toBeDisabled();
    act(() => notify({ ...initial, sequence: 4, phase: 'typing' }));
    expect(about).toBeDisabled();
    fireEvent.pointerDown(about);
    act(() => notify({ ...initial, sequence: 5, phase: 'stopped' }));
    fireEvent.click(about, { detail: 1 });
    expect(about).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(about); expect(about).toHaveAttribute('aria-selected', 'true');
    act(() => notify({ ...initial, sequence: 6, phase: 'typing' }));
    expect(input).toHaveAttribute('aria-selected', 'true');
    act(() => notify({ ...initial, sequence: 7, phase: 'stopped', interactionBlocked: true }));
    expect(about).toBeDisabled();
    act(() => notify({ ...initial, sequence: 8, phase: 'stopped', interactionBlocked: false }));
    expect(about).toBeEnabled();
    expect(input).toHaveAttribute('aria-selected', 'true');
  });
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
    expect(document.getElementById('status-message')).toHaveTextContent('等待输入，剩余 5 秒，请选择输入位置。');
    act(() => notify({ ...initial, sequence: 3, phase: 'countdown', remainingSeconds: 4, message: '等待输入，请在倒计时结束前选择输入位置' }));
    expect(document.getElementById('status-message')).toHaveTextContent('等待输入，剩余 4 秒，请选择输入位置。');
    fireEvent.click(screen.getByRole('button', { name: '取消输入' }));
    await waitFor(() => expect(bridge.cancel).toHaveBeenCalled());
  });
  it('keeps text actions disabled while empty or protected by task and installation state', async () => {
    render(<App />);
    const cleanup = screen.getByRole('button', { name: '清理' });
    const clear = screen.getByRole('button', { name: '清空' });
    expect(cleanup).toBeDisabled(); expect(clear).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: '开始输入' })).toBeEnabled());
    expect(cleanup).toBeDisabled(); expect(clear).toBeDisabled();
    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'text  ' } });
    expect(cleanup).toBeEnabled(); expect(clear).toBeEnabled();
    let sequence = initial.sequence;
    for (const phase of ['arming', 'countdown', 'typing'] as const) {
      act(() => notify({ ...initial, sequence: ++sequence, phase }));
      expect(cleanup).toBeDisabled(); expect(clear).toBeDisabled();
    }
    act(() => notify({ ...initial, sequence: ++sequence, phase: 'stopped', interactionBlocked: true }));
    expect(cleanup).toBeDisabled(); expect(clear).toBeDisabled();
    act(() => notify({ ...initial, sequence: ++sequence, phase: 'stopped', interactionBlocked: false }));
    expect(cleanup).toBeEnabled(); expect(clear).toBeEnabled();
    act(() => updateNotify({ ...updateInitial, sequence: 2, phase: 'installing' }));
    expect(cleanup).toBeDisabled(); expect(clear).toBeDisabled();
    expect(screen.getByRole('textbox')).toHaveAttribute('readonly');
  });
  it('blocks text actions while a start command is pending', async () => {
    let finishStart!: (state: Snapshot) => void;
    vi.mocked(bridge.start).mockImplementation(() => new Promise(resolve => { finishStart = resolve; }));
    await mount();
    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'text  ' } });
    fireEvent.click(screen.getByRole('button', { name: '开始输入' }));
    expect(screen.getByRole('button', { name: '清理' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '清空' })).toBeDisabled();
    await waitFor(() => expect(bridge.start).toHaveBeenCalled());
    await act(async () => finishStart({ ...initial, sequence: 2, phase: 'countdown', remainingSeconds: 5 }));
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
  it.each(['清理', '清空'])('preserves %s when the native stop event precedes pointerdown', async name => {
    await mount(); fireEvent.input(screen.getByRole('textbox'), { target: { value: 'keep  ' } });
    act(() => notify({ ...initial, sequence: 10, phase: 'stopped', interactionBlocked: true }));
    const button = screen.getByRole('button', { name });
    expect(button).toBeDisabled();
    fireEvent.pointerDown(button);
    act(() => notify({ ...initial, sequence: 11, phase: 'stopped', interactionBlocked: false }));
    fireEvent.click(button, { detail: 1 });
    expect(screen.getByRole('textbox')).toHaveValue('keep  ');
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
