import { test, expect, type Page } from '@playwright/test';
import type { Snapshot, Draft, UpdateSnapshot } from '../../src/bridge';

declare global {
  interface Window { relayTest: { state: Snapshot; push: (state: Partial<Snapshot>) => void; calls: string[]; openedUrls: string[]; draft?: Draft; update: UpdateSnapshot; updatePush: (state: Partial<UpdateSnapshot>) => void } }
}

async function openApp(page: Page) {
  await page.addInitScript(() => {
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, string>();
    let next = 1;
    let pinned = false;
    const state: Snapshot = { sequence: 1, phase: 'idle', sent: 0, total: 0, remainingSeconds: 0, message: '', settings: { delaySeconds: 5, intervalMs: 50, shortcut: 'F8' }, shortcutError: null };
    const update: UpdateSnapshot = { sequence: 1, phase: 'idle', installed: true, autoCheck: true, version: null, notes: '', downloaded: 0, total: null, message: '' };
    window.relayTest = { state, update, updatePush: patch => {
      Object.assign(update, patch, { sequence: update.sequence + 1 });
      for (const [id, event] of listeners) if (event === 'update-state') callbacks.get(id)?.({ event, id, payload: structuredClone(update) });
    }, calls: [], openedUrls: [], push: patch => {
      Object.assign(state, patch, { sequence: state.sequence + 1 });
      for (const [id, event] of listeners) if (event === 'relay-state') callbacks.get(id)?.({ event, id, payload: structuredClone(state) });
    } };
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
        transformCallback: (callback: (event: unknown) => void) => { const id = next++; callbacks.set(id, callback); return id; },
        unregisterCallback: (id: number) => callbacks.delete(id),
        invoke: async (command: string, args: Record<string, unknown>) => {
          window.relayTest.calls.push(command);
          if (command === 'get_update_state') return structuredClone(update);
          if (command === 'check_update') { window.relayTest.updatePush({ phase: 'available', version: '0.3.0', notes: '更新说明\n改善输入体验。' }); return structuredClone(update); }
          if (command === 'download_update') { window.relayTest.updatePush({ phase: 'ready' }); return structuredClone(update); }
          if (command === 'install_update') { window.relayTest.updatePush({ phase: 'ready', message: '任务结束后可安装更新。' }); return structuredClone(update); }
          if (command === 'set_update_preference') { window.relayTest.updatePush({ autoCheck: args.autoCheck as boolean }); return structuredClone(update); }
          if (command === 'plugin:app|version') return '0.1.0';
          if (command === 'plugin:opener|open_url') { window.relayTest.openedUrls.push(args.url as string); return; }
          if (command === 'plugin:event|listen') { listeners.set(args.handler as number, args.event as string); return args.handler; }
          if (command === 'plugin:event|unlisten') { listeners.delete(args.eventId as number); return; }
          if (command === 'plugin:window|is_always_on_top') return pinned;
          if (command === 'plugin:window|set_always_on_top') { pinned = args.value as boolean; return; }
          if (command.startsWith('plugin:window|')) return command.endsWith('is_maximized') ? false : null;
          if (command === 'sync_draft') { window.relayTest.draft = args.draft as Draft; return; }
          if (command === 'start_task') {
            window.relayTest.draft = args.draft as Draft;
            window.relayTest.push({ phase: 'countdown', remainingSeconds: 5, total: Array.from(window.relayTest.draft.text).length, message: '等待输入，请在倒计时结束前选择输入位置' });
          }
          if (command === 'cancel_task') window.relayTest.push({ phase: 'stopped', remainingSeconds: 0, message: '已取消，尚未发送文本' });
          if (command === 'save_settings') window.relayTest.push({ settings: args.settings as Snapshot['settings'] });
          return structuredClone(state);
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (_event: string, id: number) => { callbacks.delete(id); listeners.delete(id); } },
    });
  });
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: '开始输入' })).toBeEnabled();
}

test('update confirmation remains usable at 320px and preserves the editor after cancellation', async ({ page }) => {
  await openApp(page);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.locator('#source').fill('保留更新前文本');
  const height = (await page.locator('.window').boundingBox())!.height;
  await page.locator('#about-tab').click();
  await page.getByRole('button', { name: '检查更新' }).click();
  await expect(page.getByText('发现新版本 0.3.0')).toBeVisible();
  expect(await page.evaluate(() => window.relayTest.calls.includes('download_update'))).toBe(false);
  await page.getByRole('button', { name: '下载更新' }).click();
  await page.getByRole('button', { name: '安装并重启', exact: true }).click();
  await expect(page.getByText('重启后将清除编辑框中的全部文本，请先保存需要保留的内容。')).toBeVisible();
  await page.locator('.window').screenshot({ path: 'test-results/update-confirmation-320.png' });
  expect((await page.locator('.window').boundingBox())!.height).toBe(height);
  expect(await page.locator('.about-content').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.getByRole('button', { name: '暂不安装' }).click();
  expect(await page.evaluate(() => window.relayTest.calls.includes('install_update'))).toBe(false);
  await page.locator('#input-tab').click();
  await expect(page.locator('#source')).toHaveValue('保留更新前文本');
  await page.evaluate(() => window.relayTest.updatePush({ phase: 'available', installed: false }));
  await page.locator('#about-tab').click();
  await expect(page.getByRole('button', { name: '下载更新' })).toHaveCount(0);
  await page.getByRole('link', { name: '前往下载' }).click();
  expect(await page.evaluate(() => window.relayTest.openedUrls.at(-1))).toBe('https://github.com/sunnyx11/key-relay/releases/latest');
});

test('native editor clear, undo, redo and subsequent editing', async ({ page }) => {
  await openApp(page);
  const source = page.getByRole('textbox', { name: '待输入文本' });
  await source.fill('中文 abc');
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await expect(source).toHaveValue('');
  await page.keyboard.press('Control+z'); await expect(source).toHaveValue('中文 abc');
  await expect(page.locator('#text-count')).toHaveText('6 个字符');
  await page.keyboard.press('Control+y'); await expect(source).toHaveValue('');
  await page.keyboard.press('Control+z'); await page.keyboard.press('End'); await page.keyboard.type('!');
  await page.keyboard.press('Control+z'); await expect(source).toHaveValue('中文 abc');
});

test('invalid fields, restoration and countdown operation', async ({ page }) => {
  await openApp(page); await page.locator('#source').fill('ab');
  await page.getByRole('tab', { name: '设置' }).click(); await page.locator('#interval').fill('1.5');
  await expect(page.locator('#interval-error')).toBeVisible();
  await page.getByRole('tab', { name: '输入' }).click(); await page.locator('#start').click();
  await expect(page.locator('#interval')).toBeFocused();
  await page.getByRole('button', { name: '恢复默认' }).click();
  await expect(page.locator('#interval-error')).toHaveCount(0);
  await page.getByRole('tab', { name: '输入' }).click();
  await page.locator('#start').click(); await expect(page.locator('#settings-tab')).toBeDisabled();
  await expect(page.locator('#start')).toHaveText('取消输入（剩余 5 秒）');
  await page.locator('#start').click(); await expect(page.locator('#settings-tab')).toBeEnabled();
});

test('disabled control gesture only interrupts and preserves source', async ({ page }) => {
  await openApp(page); await page.locator('#source').fill('preserve');
  await page.evaluate(() => window.relayTest.push({ phase: 'typing', sent: 1, total: 8, message: '已发送 1 / 8 字符' }));
  const clear = page.locator('#clear'); await expect(clear).toBeDisabled();
  const box = (await clear.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.evaluate(() => window.relayTest.push({ phase: 'stopped', message: '已中止，剩余内容已取消' }));
  await page.mouse.up(); await expect(page.locator('#source')).toHaveValue('preserve');
  await clear.click(); await expect(page.locator('#source')).toHaveValue('');
});

test('layout matches widths, breakpoints, editor resizing and zoom', async ({ page }) => {
  await openApp(page);
  for (const width of [600, 563, 562, 521, 520, 421, 420, 390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    for (const height of [184, 320]) {
      await page.locator('#source').evaluate((el, value) => { el.style.height = value + 'px'; }, height);
      const inputHeight = (await page.locator('.window').boundingBox())!.height;
      await page.locator('#settings-tab').click();
      expect((await page.locator('.window').boundingBox())!.height).toBe(inputHeight);
      await expect(page.locator('#start')).not.toBeVisible();
      if (width <= 420) {
        expect(await page.locator('.setting-row').evaluateAll(rows => rows.every(row => row.children[1].getBoundingClientRect().top >= row.children[0].getBoundingClientRect().bottom))).toBe(true);
      }
      await page.locator('#about-tab').click();
      expect((await page.locator('.window').boundingBox())!.height).toBe(inputHeight);
      await expect(page.getByText('版本 0.1.0 · Windows 64 位')).toBeVisible();
      expect(await page.locator('.about-content').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.getByRole('button', { name: 'MIT 许可证' }).click();
      expect((await page.locator('.window').boundingBox())!.height).toBe(inputHeight);
      expect(await page.locator('.about-content').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.getByRole('button', { name: '返回关于' }).click();
      await page.locator('#input-tab').click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  await page.setViewportSize({ width: 960, height: 1200 });
  await page.evaluate(() => { document.body.style.zoom = '1.5'; });
  const before = (await page.locator('.window').boundingBox())!.height;
  await page.locator('#settings-tab').click(); expect((await page.locator('.window').boundingBox())!.height).toBe(before);
  await page.screenshot({ path: 'test-results/settings-150.png', fullPage: true });
  await page.locator('#about-tab').click();
  expect((await page.locator('.window').boundingBox())!.height).toBe(before);
  await page.screenshot({ path: 'test-results/about-150.png', fullPage: true });
});

test('about links, keyboard navigation and offline license retain the editor state', async ({ page }) => {
  await openApp(page); await page.setViewportSize({ width: 600, height: 600 });
  await page.locator('#source').fill('保留文本');
  await page.locator('#input-tab').focus(); await page.keyboard.press('End');
  await expect(page.locator('#about-tab')).toBeFocused();
  await page.locator('.window').screenshot({ path: 'test-results/about-600.png' });
  expect(await page.locator('.about-content').evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true);
  const status = (await page.locator('.update-status').boundingBox())!;
  const preference = (await page.locator('.update-preference').boundingBox())!;
  expect(Math.abs(status.y - preference.y)).toBeLessThan(4);
  expect(preference.x).toBeGreaterThan(status.x);
  const windowBox = (await page.locator('.window').boundingBox())!;
  const contentBox = (await page.locator('.about-content').boundingBox())!;
  expect(windowBox.y + windowBox.height - contentBox.y - contentBox.height).toBeLessThanOrEqual(8);
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: '检查更新' })).toBeFocused();
  for (const name of ['项目主页', '使用说明', '问题反馈', 'hkhl888@foxmail.com']) await page.getByRole('link', { name }).click();
  expect(await page.evaluate(() => window.relayTest.openedUrls)).toEqual(['https://github.com/sunnyx11/key-relay', 'https://github.com/sunnyx11/key-relay#readme', 'https://github.com/sunnyx11/key-relay/issues', 'mailto:hkhl888@foxmail.com']);
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'MIT 许可证' }).click();
  await expect(page.getByLabel('MIT 许可证全文')).toContainText('Permission is hereby granted');
  await expect(page.getByRole('button', { name: '返回关于' })).toBeFocused();
  expect(await page.locator('.about-content').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  expect((await page.locator('.window').boundingBox())!.height).toBe(windowBox.height);
  const licenseBox = (await page.locator('.about-content').boundingBox())!;
  expect(licenseBox.height).toBe(contentBox.height);
  await page.locator('.about-content').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(page.getByLabel('MIT 许可证全文')).toContainText('SOFTWARE.');
  await page.getByRole('button', { name: '返回关于' }).click();
  await expect(page.getByRole('button', { name: 'MIT 许可证' })).toBeFocused();
  await page.locator('#about-tab').focus(); await page.keyboard.press('Home');
  await expect(page.locator('#source')).toHaveValue('保留文本');
  await page.keyboard.press('Tab'); await expect(page.locator('#source')).toBeFocused();
});

test('about update states use the available space at narrow widths and zoom', async ({ page }) => {
  await openApp(page);
  for (const zoom of [1, 1.5]) {
    for (const width of [600, 320]) {
      await page.setViewportSize({ width, height: 1200 });
      await page.evaluate(value => { document.body.style.zoom = String(value); }, zoom);
      await page.locator('#input-tab').click();
      const height = (await page.locator('.window').boundingBox())!.height;
      await page.locator('#about-tab').click();
      for (const phase of ['idle', 'current', 'checking', 'available', 'downloading', 'ready', 'error'] as const) {
        await page.evaluate(phase => window.relayTest.updatePush({
          phase, version: '0.3.0', downloaded: 50, total: 100,
          notes: ['available', 'downloading', 'ready'].includes(phase) ? '更新说明与较长文本。'.repeat(80) : '',
          message: phase === 'error' ? '检查更新失败，请检查网络连接后重试。'.repeat(8) : '',
        }), phase);
        const content = page.locator('.about-content');
        await expect(page.getByLabel('更新说明', { exact: true })).toHaveCount(0);
        await expect(content).not.toContainText('更新说明与较长文本。');
        await expect(page.locator('.update-indicator')).toHaveCount(['available', 'ready'].includes(phase) ? 1 : 0);
        await expect(content).toHaveJSProperty('scrollTop', 0);
        expect(await content.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        expect((await page.locator('.window').boundingBox())!.height).toBe(height);
        const windowBox = (await page.locator('.window').boundingBox())!;
        const contentBox = (await content.boundingBox())!;
        expect(windowBox.y + windowBox.height - contentBox.y - contentBox.height).toBeLessThanOrEqual(8 * zoom);
        const status = (await page.locator('.update-status').boundingBox())!;
        const preference = (await page.locator('.update-preference').boundingBox())!;
        expect(preference.x >= status.x + status.width - 1 || preference.y >= status.y + status.height - 1).toBe(true);
        await page.getByRole('button', { name: 'MIT 许可证' }).click();
        await expect(page.getByRole('button', { name: '返回关于' })).toBeFocused();
        await page.getByRole('button', { name: '返回关于' }).click();
        await content.evaluate(el => { el.scrollTop = 0; });
      }
    }
  }
});

test('about tab protects the stop gesture and task start returns to input', async ({ page }) => {
  await openApp(page); await page.locator('#source').fill('preserve');
  await page.locator('#about-tab').click();
  await page.evaluate(() => window.relayTest.push({ phase: 'arming' }));
  await expect(page.locator('#input-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#about-tab')).toBeDisabled();
  const box = (await page.locator('#about-tab').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.evaluate(() => window.relayTest.push({ phase: 'stopped' }));
  await page.mouse.up();
  await expect(page.locator('#input-tab')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#about-tab').click();
  await expect(page.locator('#about-tab')).toHaveAttribute('aria-selected', 'true');
});

test('task states preserve typography and footer positions', async ({ page }) => {
  await openApp(page); await page.setViewportSize({ width: 600, height: 900 });
  const appearance = () => page.locator('#status-message').evaluate(el => {
    const style = getComputedStyle(el); const rect = el.getBoundingClientRect();
    return { font: [style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight], x: rect.x, width: rect.width };
  });
  const baseline = await appearance(); const clear = await page.locator('#clear').boundingBox();
  for (const [phase, message] of [['arming', '等待按键释放，松开快捷键后开始输入'], ['countdown', '等待输入，请在倒计时结束前选择输入位置'], ['typing', '已发送 1 / 3 字符 · 按键或点击停止'], ['done', '已完成，已发送 3 个字符'], ['stopped', '已中止，剩余内容已取消'], ['failed', '系统输入提交失败，请检查本地权限。']] as const) {
    await page.evaluate(({ phase, message }) => window.relayTest.push({ phase, message, remainingSeconds: 5 }), { phase, message });
    await expect(page.locator('#status-message')).toHaveText(message); expect(await appearance()).toEqual(baseline);
    expect((await page.locator('#clear').boundingBox())!.x).toBe(clear!.x);
  }
  await page.screenshot({ path: 'test-results/input-600.png', fullPage: true });
});

test('pin uses independent clicks and keeps the stopping gesture protected', async ({ page }) => {
  await openApp(page);
  const pin = page.getByRole('button', { name: '置顶窗口' });
  await pin.click();
  await expect(page.getByRole('button', { name: '取消置顶' })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.relayTest.push({ phase: 'stopped', interactionBlocked: true }));
  const pinned = page.getByRole('button', { name: '取消置顶' });
  await expect(pinned).toBeDisabled();
  const box = (await pinned.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.evaluate(() => window.relayTest.push({ interactionBlocked: false }));
  await page.mouse.up();
  await expect(pinned).toHaveAttribute('aria-pressed', 'true');
  await pinned.click(); await expect(pin).toHaveAttribute('aria-pressed', 'false');
});

test('hidden settings exit focus order and title buttons invoke native actions', async ({ page }) => {
  await openApp(page); await page.locator('#input-tab').focus(); await page.keyboard.press('Tab');
  await expect(page.locator('#source')).toBeFocused();
  for (const name of ['最小化', '最大化或还原', '关闭']) await page.getByRole('button', { name }).click();
  const calls = await page.evaluate(() => window.relayTest.calls);
  expect(calls).toContain('plugin:window|minimize'); expect(calls).toContain('plugin:window|toggle_maximize'); expect(calls).toContain('plugin:window|close');
});
