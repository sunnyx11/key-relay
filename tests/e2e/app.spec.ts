import { test, expect, type Page } from '@playwright/test';
import type { Snapshot, Draft, UpdateSnapshot, TextState, TextAction } from '../../src/bridge';

declare global {
  interface Window { relayTest: { state: Snapshot; push: (state: Partial<Snapshot>) => void; calls: string[]; openedUrls: string[]; draft?: Draft; update: UpdateSnapshot; updatePush: (state: Partial<UpdateSnapshot>) => void; text: TextState; textPush: (state: Partial<TextState>) => void } }
}

async function openApp(page: Page, saved?: Partial<TextState>) {
  await page.addInitScript(initialText => {
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, string>();
    let next = 1;
    let pinned = false;
    const state: Snapshot = { sequence: 1, phase: 'idle', sent: 0, total: 0, target: { x: -900, y: 240, title: '记事本' }, message: '', settings: { intervalMs: 50, shortcut: 'F8' }, shortcutError: null };
    const update: UpdateSnapshot = { sequence: 1, phase: 'idle', installed: true, autoCheck: true, version: null, notes: '', downloaded: 0, total: null, message: '' };
    const text: TextState = { sequence: 1, draft: '', entries: [], restoreDraft: true, saveHistory: true, error: null, ...JSON.parse(localStorage.getItem('relay-text-test') || JSON.stringify(initialText || {})) };
    window.relayTest = { state, update, text, textPush: patch => {
      Object.assign(text, patch, { sequence: text.sequence + 1 });
      localStorage.setItem('relay-text-test', JSON.stringify(text));
      for (const [id, event] of listeners) if (event === 'text-state') callbacks.get(id)?.({ event, id, payload: structuredClone(text) });
    }, updatePush: patch => {
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
          if (command === 'get_text_state' || command === 'flush_text') return structuredClone(text);
          if (command === 'change_text_state') {
            const action = args.action as TextAction;
            if (action.kind === 'preferences') Object.assign(text, { restoreDraft: action.restoreDraft, saveHistory: action.saveHistory });
            if (action.kind === 'delete') text.entries = text.entries.filter(entry => entry.id !== action.id);
            if (action.kind === 'pin') {
              const entry = text.entries.find(entry => entry.id === action.id);
              if (entry) entry.pinned = action.pinned;
            }
            if (action.kind === 'clear') text.entries = text.entries.filter(entry => entry.pinned && !action.includePinned);
            if (action.kind === 'clearDraft') text.draft = '';
            window.relayTest.textPush({ error: null });
            return structuredClone(text);
          }
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
          if (command === 'sync_draft') { window.relayTest.draft = args.draft as Draft; if (text.restoreDraft) window.relayTest.textPush({ draft: window.relayTest.draft.text }); return; }
          if (command === 'start_task') {
            window.relayTest.draft = args.draft as Draft;
            window.relayTest.push({ phase: 'targeting', total: Array.from(window.relayTest.draft.text).length, message: '正在返回已记录的输入位置' });
          }
          if (command === 'cancel_task') window.relayTest.push({ phase: 'stopped', message: '已取消，尚未发送文本' });
          if (command === 'save_settings') window.relayTest.push({ settings: args.settings as Snapshot['settings'] });
          return structuredClone(state);
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (_event: string, id: number) => { callbacks.delete(id); listeners.delete(id); } },
    });
  }, saved || null);
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: '开始输入' })).toBeEnabled();
}

test('saved draft survives reload, clear stays empty and disabled saving preserves the stored copy', async ({ page }) => {
  await openApp(page, { draft: '上次\n  草稿😀' });
  const source = page.locator('#source');
  await expect(source).toHaveValue('上次\n  草稿😀');
  await source.fill('尚未发送\n  最新😀');
  await page.reload();
  await expect(source).toHaveValue('尚未发送\n  最新😀');
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await page.reload();
  await expect(source).toHaveValue('');
  await source.fill('保留的草稿');
  await page.locator('#settings-tab').click();
  await page.getByRole('checkbox', { name: '保存并恢复上次编辑内容' }).uncheck();
  await page.locator('#input-tab').click();
  await source.fill('关闭保存后的编辑');
  await page.reload();
  await expect(source).toHaveValue('');
  expect(await page.evaluate(() => window.relayTest.text.draft)).toBe('保留的草稿');
  await page.locator('#settings-tab').click();
  await page.getByRole('button', { name: '清除已保存草稿', exact: true }).click();
  await page.getByRole('button', { name: '确认清除草稿' }).click();
  await expect.poll(() => page.evaluate(() => window.relayTest.text.draft)).toBe('');
});

test('history viewing preserves edits, search and list scroll before an explicit restoration', async ({ page }) => {
  const original = '首行\n  缩进😀\n\t末行\n' + '完整正文\n'.repeat(80);
  await openApp(page, { draft: '当前编辑', entries: Array.from({ length: 30 }, (_, index) => ({ pinned: false, id: 30 - index, time: Date.now(), text: index === 20 ? original : `正文 ${index}` })) });
  await page.locator('#history-tab').click();
  const preview = page.getByRole('button', { name: /^查看记录：首行/ });
  await preview.scrollIntoViewIfNeeded();
  const top = await page.locator('.history-list').evaluate(el => el.scrollTop);
  await preview.click();
  await expect(page.getByRole('region', { name: '历史全文' })).toBeVisible();
  expect(await page.getByLabel('历史记录全文').textContent()).toBe(original);
  expect(await page.getByLabel('历史记录全文').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect(page.locator('#source')).toHaveValue('当前编辑');
  expect(await page.evaluate(() => window.relayTest.text.entries.length)).toBe(30);
  await page.getByRole('button', { name: '返回历史' }).click();
  await expect(preview).toBeFocused();
  expect(await page.locator('.history-list').evaluate(el => el.scrollTop)).toBe(top);
  await page.getByRole('searchbox').fill('末行');
  await preview.click();
  await page.getByRole('button', { name: '返回历史' }).click();
  await expect(page.getByRole('searchbox')).toHaveValue('末行');
  await page.getByRole('button', { name: /^恢复记录/ }).click();
  await expect(page.locator('#source')).toHaveValue(original);
  await page.keyboard.press('Control+z');
  await expect(page.locator('#source')).toHaveValue('当前编辑');
});

test('history restores the entire original as one native undo step and then returns to target status', async ({ page }) => {
  const original = '第一行\n  中😀e\u0301\n末行';
  await openApp(page, { entries: [{ pinned: false, id: 1, text: original, time: Date.now() }] });
  const source = page.locator('#source');
  await source.fill('当前编辑');
  await page.evaluate(() => window.relayTest.push({ phase: 'done', message: '已完成', sent: 1, total: 1 }));
  await page.locator('#history-tab').click();
  await page.getByRole('button', { name: /^恢复记录/ }).click();
  await expect(source).toHaveValue(original);
  await expect(source).toBeFocused();
  expect(await source.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([original.length, original.length]);
  await expect(page.locator('#status-message')).toHaveText('已恢复历史内容 · Ctrl+Z 可撤销');
  await expect(page.locator('#status-message')).toHaveText('已记录输入位置', { timeout: 5000 });
  await page.keyboard.press('Control+z');
  await expect(source).toHaveValue('当前编辑');
  await page.keyboard.press('Control+y');
  await expect(source).toHaveValue(original);
  await expect.poll(() => page.evaluate(() => window.relayTest.draft?.text)).toBe(original);
  expect(await page.evaluate(() => window.relayTest.text.entries.length)).toBe(1);
});

test('history searches complete originals and keeps immediate deletion and clear separate from restoration', async ({ page }) => {
  const today = Date.now();
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  await openApp(page, { draft: '当前草稿', entries: [
    { pinned: false, id: 2, time: today, text: '第一行\n  第二行\n隐藏在预览之后的匹配内容😀' },
    { pinned: false, id: 1, time: yesterday.getTime(), text: '昨天的内容' },
  ] });
  await page.locator('#history-tab').click();
  await expect(page.getByRole('heading', { name: '今天' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '昨天' })).toBeVisible();
  await page.getByRole('searchbox').fill('预览之后');
  await expect(page.locator('.history-entry')).toHaveCount(1);
  await page.getByRole('searchbox').fill('');
  await page.locator('.history-entry').first().getByRole('button', { name: /^删除记录/ }).click();
  await expect(page.locator('.history-entry')).toHaveCount(1);
  await expect(page.locator('#history-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: '撤销删除' })).toHaveCount(0);
  await page.getByRole('button', { name: '清空历史', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.history-entry')).toHaveCount(1);
  await page.getByRole('button', { name: '清空历史', exact: true }).click();
  await page.getByRole('button', { name: '确认' }).click();
  await expect(page.locator('.history-entry')).toHaveCount(0);
  expect(await page.evaluate(() => window.relayTest.text.draft)).toBe('当前草稿');
  await page.locator('#input-tab').click();
  await expect(page.locator('#source')).toHaveValue('当前草稿');
});

test('pin order persists across reload and clear counts include records outside search', async ({ page }) => {
  await openApp(page, { draft: '保留草稿', entries: [
    { id: 3, time: 300, text: '最新普通', pinned: false },
    { id: 2, time: 200, text: '较旧普通', pinned: false },
    { id: 1, time: 100, text: '较早置顶\n完整内容', pinned: true },
  ] });
  await page.locator('#history-tab').click();
  const ids = () => page.locator('.history-entry').evaluateAll(entries => entries.map(entry => entry.getAttribute('data-entry-id')));
  expect(await ids()).toEqual(['1', '3', '2']);
  await page.getByRole('button', { name: '置顶记录：较旧普通', exact: true }).click();
  expect(await ids()).toEqual(['2', '1', '3']);
  await page.reload();
  await page.locator('#history-tab').click();
  expect(await ids()).toEqual(['2', '1', '3']);
  await page.getByRole('button', { name: /^取消置顶记录：较早/ }).click();
  expect(await ids()).toEqual(['2', '3', '1']);
  expect(await page.evaluate(() => window.relayTest.text.entries.map(({ id, time }) => [id, time]))).toEqual([[3, 300], [2, 200], [1, 100]]);
  await page.getByRole('searchbox').fill('最新');
  await page.getByRole('button', { name: '清空历史', exact: true }).click();
  await expect(page.getByRole('group', { name: '清空历史确认' })).toContainText('删除 2 条记录，保留 1 条置顶记录');
  await expect(page.getByRole('checkbox', { name: '同时删除置顶记录' })).not.toBeChecked();
  for (const [width, zoom] of [[600, 1], [320, 1.5]]) {
    await page.setViewportSize({ width, height: 600 });
    await page.evaluate(value => { document.body.style.zoom = String(value); }, zoom);
    await page.locator('.window').screenshot({ path: `test-results/history-confirmation-${width}-${zoom}.png` });
  }
  await page.getByRole('button', { name: '确认' }).click();
  await page.getByRole('searchbox').fill('');
  expect(await ids()).toEqual(['2']);
  await page.getByRole('button', { name: '清空历史', exact: true }).click();
  await page.getByRole('checkbox', { name: '同时删除置顶记录' }).check();
  await page.getByRole('button', { name: '确认' }).click();
  await expect(page.locator('.history-entry')).toHaveCount(0);
  await page.locator('#input-tab').click();
  await expect(page.locator('#source')).toHaveValue('保留草稿');
});

test('a full pinned archive keeps capacity guidance visible during a task at minimum width', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 340 });
  await openApp(page, { entries: Array.from({ length: 100 }, (_, index) => ({ id: index + 1, time: index, text: `置顶 ${index}`, pinned: true })) });
  const notice = page.getByText(/历史记录已满且全部置顶/);
  await expect(notice).toBeVisible();
  await page.locator('#source').fill('继续输入');
  await page.locator('#start').click();
  await expect(page.locator('#status-message')).toContainText('正在返回');
  await expect(notice).toBeVisible();
  expect(await page.locator('.window').evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true);
  await page.screenshot({ path: 'test-results/history-full-pinned-320.png' });
  await page.evaluate(() => window.relayTest.push({ phase: 'done', message: '已完成' }));
  await expect(notice).toBeVisible();
  await page.locator('#history-tab').click();
  await page.getByRole('button', { name: /^取消置顶记录/ }).first().click();
  await expect(notice).toHaveCount(0);
});

test('history rows and text preferences fit narrow widths and zoom without changing editor height', async ({ page }) => {
  test.setTimeout(60_000);
  await openApp(page, { entries: Array.from({ length: 100 }, (_, index) => ({ pinned: false, id: 100 - index, time: Date.now() - index * 86400000, text: `  记录 ${index}\n第二行😀\n第三行` })) });
  for (const width of [600, 320]) for (const zoom of [1, 1.5]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.evaluate(value => { document.body.style.zoom = String(value); }, zoom);
    await page.locator('#input-tab').click();
    const height = (await page.locator('.window').boundingBox())!.height;
    for (const tab of ['history', 'settings', 'about', 'input']) {
      await page.locator(`#${tab}-tab`).click();
      expect((await page.locator('.window').boundingBox())!.height).toBe(height);
      const overflow = await page.locator('.window').evaluate(root => [...root.querySelectorAll('*')].filter(el => getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().right > root.getBoundingClientRect().right + 1).map(el => el.id || el.className));
      expect(await page.locator('.window').evaluate(el => el.scrollWidth <= el.clientWidth), `${width}px/${zoom}/${tab}: ${overflow.join(', ')}`).toBe(true);
    }
    await page.locator('#history-tab').click();
    expect(await page.locator('.history-list').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    expect(await page.locator('.history-list').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.locator('.history-preview').first().evaluate(el => getComputedStyle(el).whiteSpace)).toBe('nowrap');
    expect(await page.locator('.history-preview').first().evaluate(el => getComputedStyle(el).textOverflow)).toBe('ellipsis');
    expect(await page.locator('.history-preview').first().evaluate(el => el.clientWidth)).toBeGreaterThanOrEqual(100);
    expect(await page.locator('.history-meta').first().evaluate(el => el.clientHeight)).toBeLessThanOrEqual(20);
    const button = page.getByRole('button', { name: '清空历史', exact: true });
    expect(await button.evaluate(el => [getComputedStyle(el).height, getComputedStyle(el).borderRadius])).toEqual(['26px', '0px']);
    const clearRight = (await button.boundingBox())!;
    const toolbar = (await page.locator('.history-toolbar').boundingBox())!;
    expect(Math.abs(toolbar.x + toolbar.width - clearRight.x - clearRight.width - 2 * zoom), `${width}px/${zoom}: clear history at toolbar right edge`).toBeLessThanOrEqual(1);
    const deleteButton = page.locator('.history-entry').first().getByRole('button', { name: /^删除记录/ });
    const restore = page.locator('.history-entry').first().getByRole('button', { name: /^恢复记录/ });
    await expect(restore).toHaveAttribute('title', '恢复记录');
    await expect(deleteButton).toHaveAttribute('title', '删除记录');
    expect(await page.locator('.history-entry').first().locator('.history-actions > button').evaluateAll(buttons => buttons.map(el => [getComputedStyle(el).width, getComputedStyle(el).height]))).toEqual(Array.from({ length: 3 }, () => ['26px', '26px']));
    await page.locator('.history-entry').first().getByRole('button', { name: /^查看记录/ }).click();
    expect((await page.locator('.window').boundingBox())!.height).toBe(height);
    await expect(page.getByLabel('历史记录全文')).toContainText('第三行');
    expect(await page.getByLabel('历史记录全文').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.getByRole('button', { name: '返回历史' }).click();
    const list = page.locator('.history-list');
    await expect(list).toHaveCSS('scrollbar-width', 'none');
    for (const count of [0, 1, 100]) {
      await page.evaluate(count => window.relayTest.textPush({ entries: Array.from({ length: count }, (_, index) => ({ pinned: false, id: count - index, time: Date.now() - index * 86400000, text: `  记录 ${index}\n第二行😀\n第三行` })) }), count);
      await expect(page.locator('.history-entry')).toHaveCount(count);
      const layout = await list.evaluate((el: HTMLElement) => ({ scrolling: el.scrollHeight > el.clientHeight, gutter: el.offsetWidth - el.clientWidth, fitsWidth: el.scrollWidth <= el.clientWidth }));
      expect(layout.scrolling, `${width}px/${zoom}/${count}: history scrolling`).toBe(count === 100);
      expect(layout.fitsWidth).toBe(true);
      expect(layout.gutter, `${width}px/${zoom}/${count}: hidden scrollbar occupies no space`).toBe(0);
      const clearBox = (await button.boundingBox())!;
      expect(clearBox).toEqual(clearRight);
      if (count) await expect(button).toBeEnabled();
      else await expect(button).toBeDisabled();
      if (count) {
        const entry = (await page.locator('.history-entry').first().boundingBox())!;
        expect(Math.abs(clearBox.x + clearBox.width - entry.x - entry.width), `${width}px/${zoom}/${count}: record right edge`).toBeLessThanOrEqual(1);
      }
      if (count === 100) {
        await list.hover();
        await page.mouse.wheel(0, 300);
        await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
        await list.focus();
        await list.press('Home');
        await expect.poll(() => list.evaluate(el => el.scrollTop)).toBe(0);
        await list.press('PageDown');
        await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
        await list.press('End');
        await expect.poll(() => list.evaluate(el => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop))).toBeLessThanOrEqual(1);
        await list.press('PageUp');
        await expect.poll(() => list.evaluate(el => el.scrollTop + el.clientHeight < el.scrollHeight)).toBe(true);
        await list.press('Home');
        await expect.poll(() => list.evaluate(el => el.scrollTop)).toBe(0);
      }
      expect((await page.locator('.window').boundingBox())!.height).toBe(height);
      await page.locator('.window').screenshot({ path: `test-results/history-${count}-${width}-${zoom}.png` });
    }
    await page.locator('#settings-tab').click();
    await page.getByRole('checkbox', { name: '保存历史输入记录' }).scrollIntoViewIfNeeded();
    expect(await page.locator('.settings-content').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
});

test('native task transitions protect history and consume the same stopping click', async ({ page }) => {
  await openApp(page, { draft: 'current', entries: [{ pinned: false, id: 1, time: Date.now(), text: 'saved' }] });
  await page.locator('#history-tab').click();
  await page.evaluate(() => window.relayTest.push({ phase: 'typing' }));
  await expect(page.locator('#input-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#history-tab')).toBeDisabled();
  await page.locator('#history-tab').dispatchEvent('pointerdown');
  await page.evaluate(() => window.relayTest.push({ phase: 'stopped' }));
  await page.locator('#history-tab').dispatchEvent('click', { detail: 1 });
  await expect(page.locator('#input-tab')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#history-tab').click();
  await expect(page.locator('#history-tab')).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => window.relayTest.push({ interactionBlocked: true }));
  await expect(page.getByRole('button', { name: /^恢复记录/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /^删除记录/ })).toBeDisabled();
  await page.evaluate(() => window.relayTest.push({ interactionBlocked: false }));
  await expect(page.getByRole('button', { name: /^恢复记录/ })).toBeEnabled();
});

test('recorded negative coordinates survive editing and invalidation disables button startup', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.relayTest.push({ target: null }));
  await expect(page.locator('#start')).toBeDisabled();
  await expect(page.locator('#status-message')).toHaveText('请先点击外部输入位置');
  await page.evaluate(() => window.relayTest.push({ target: { x: -900, y: -240, title: '远程桌面连接' } }));
  await expect(page.locator('#status-message')).toHaveText('已记录输入位置');
  await page.locator('#status-message').hover();
  await expect(page.getByRole('tooltip')).toContainText('远程桌面连接');
  await expect(page.getByRole('tooltip')).toContainText('(-900, -240)');
  await page.locator('#source').fill('a  ');
  await page.locator('#trim-trailing').click();
  await page.locator('#clear').click();
  await page.locator('#settings-tab').click();
  await expect(page.getByLabel('等待时间')).toHaveCount(0);
  await page.locator('#input-tab').click();
  await expect(page.locator('#start')).toBeEnabled();
  expect(await page.evaluate(() => window.relayTest.state.target)).toEqual({ x: -900, y: -240, title: '远程桌面连接' });
  await page.evaluate(() => window.relayTest.push({ phase: 'failed', target: null, message: '目标窗口或显示器位置、缩放已变化，请重新选择输入位置。' }));
  await expect(page.locator('#start')).toBeDisabled();
  await expect(page.locator('#status-message')).toContainText('请重新选择输入位置');
  await page.locator('.window').screenshot({ path: 'test-results/invalid-target.png' });
});

test('target details preserve compact layout and support hover, focus and dismissal', async ({ page }) => {
  await openApp(page);
  await page.locator('#source').fill('text');
  const title = 'cpub-SAS94M7_DEV-SAS94M7_DEV-CmsRdsh-S105V009.CORP.Q2BI.COM - 远程桌面连接';
  const status = page.locator('#status-message');
  const details = page.locator('#target-details');
  for (const zoom of [1, 1.5]) {
    for (const width of [600, 390, 320]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.evaluate(value => { document.body.style.zoom = String(value); }, zoom);
      await page.locator('#source').focus();
      await page.mouse.move(0, 0);
      const before = (await page.locator('.window').boundingBox())!;
      await page.evaluate(title => window.relayTest.push({ target: { title, x: -2358, y: -584 } }), title);
      await expect(status).toHaveText('已记录输入位置');
      await expect(details).toBeHidden();
      if (zoom === 1 && width === 600) await page.locator('.window').screenshot({ path: 'test-results/target-summary.png' });
      await status.hover();
      await expect(details).toBeVisible();
      await expect(details).toContainText(title);
      await expect(details).toContainText('(-2358, -584)');
      if (zoom === 1 && width === 600) await page.locator('.window').screenshot({ path: 'test-results/target-details.png' });
      const box = (await details.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect((await page.locator('.window').boundingBox())!.height).toBe(before.height);
      expect(await details.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await details.hover();
      await expect(details).toBeVisible();
      await page.mouse.move(0, 0);
      await expect(details).toBeHidden();
      await page.locator('#source').focus();
      await page.keyboard.press('Tab');
      await expect(status).toBeFocused();
      await expect(details).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(details).toBeHidden();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: '清理', exact: true })).toBeFocused();
    }
  }
  await page.evaluate(() => window.relayTest.push({ phase: 'targeting', message: '正在激活已记录的输入位置…' }));
  await expect(details).toHaveCount(0);
  await expect(status).not.toHaveAttribute('tabindex');
});

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
  await expect(page.getByText('安装前将保存当前草稿，重启后自动恢复。外部输入位置需要重新选择。')).toBeVisible();
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

test('cleanup preserves indentation, internal whitespace, line breaks and Unicode', async ({ page }) => {
  await openApp(page);
  const source = page.locator('#source');
  for (const [input, output] of [
    ['\t第一行  \t\n  第二行 \t\n\n末行  ', '\t第一行\n  第二行\n\n末行'],
    ['  a b\t c  \r\n\t中😀e\u0301\t\r\n', '  a b\t c\n\t中😀e\u0301\n'],
    ['a\u00a0  \nb\u3000\t', 'a\u00a0\nb\u3000'],
    [' \t\n\t\n', '\n\n'],
    ['   ', ''],
    ['abc', 'abc'],
  ]) {
    await source.fill(input);
    await page.getByRole('button', { name: '清理', exact: true }).click();
    await expect(source).toHaveValue(output);
    await expect(page.locator('#text-count')).toHaveText(`${Array.from(output).length} 个字符`);
    await expect.poll(() => page.evaluate(() => window.relayTest.draft?.text)).toBe(output);
    if (!output) {
      await expect(page.locator('#trim-trailing')).toBeDisabled();
      await expect(page.locator('#clear')).toBeDisabled();
    }
  }
  await expect(page.locator('#status-message')).toHaveText('当前文本没有行尾空格。');
});

test('cleanup undo and redo preserve each line and synchronize an immediate start', async ({ page }) => {
  await openApp(page);
  const source = page.locator('#source');
  await source.fill('a  \nb\t');
  await page.locator('#trim-trailing').click();
  await expect(source).toHaveValue('a\nb');
  await expect(source).toBeFocused();
  for (const [key, text] of [
    ['Control+z', 'a  \nb'], ['Control+z', 'a  \nb\t'],
    ['Control+y', 'a  \nb'], ['Control+y', 'a\nb'],
  ]) {
    await page.keyboard.press(key);
    await expect(source).toHaveValue(text);
    await expect.poll(() => page.evaluate(() => window.relayTest.draft?.text)).toBe(text);
    await expect(page.locator('#text-count')).toHaveText(`${text.length} 个字符`);
  }
  await page.keyboard.press('Control+End'); await page.keyboard.type('!');
  await page.keyboard.press('Control+z'); await expect(source).toHaveValue('a\nb');
  await page.locator('#start').click();
  await expect(page.locator('#start')).toHaveText('取消输入');
  expect(await page.evaluate(() => window.relayTest.draft?.text)).toBe('a\nb');
  expect(await page.evaluate(() => window.relayTest.state.total)).toBe(3);
  await page.locator('#start').click();
  await page.locator('#clear').click();
  await page.keyboard.press('Control+z'); await expect(source).toHaveValue('a\nb');
  await page.keyboard.press('Control+y'); await expect(source).toHaveValue('');
});

test('cleanup with no trailing whitespace preserves the existing undo history', async ({ page }) => {
  await openApp(page);
  const source = page.locator('#source');
  await source.fill('abc'); await source.press('End'); await page.keyboard.type('!');
  await page.locator('#trim-trailing').click();
  await expect(page.locator('#status-message')).toHaveText('当前文本没有行尾空格。');
  await source.focus(); await page.keyboard.press('Control+z');
  await expect(source).toHaveValue('abc');
  await page.keyboard.press('Control+y'); await expect(source).toHaveValue('abc!');
});

test('cleanup failure preserves completed edits and synchronizes the actual draft', async ({ page }) => {
  await openApp(page);
  await page.locator('#source').fill('a  \nb\t\nc  ');
  await page.evaluate(() => {
    const execute = document.execCommand.bind(document);
    let deletions = 0;
    document.execCommand = (command, ...args) => command === 'delete' && ++deletions === 2 ? false : execute(command, ...args);
  });
  await page.locator('#trim-trailing').click();
  await expect(page.locator('#source')).toHaveValue('a  \nb\t\nc');
  await expect(page.locator('#status-message')).toContainText('去除行尾空格未完成');
  await expect(page.locator('#status-message')).toHaveAttribute('data-state', 'error');
  await expect.poll(() => page.evaluate(() => window.relayTest.draft?.text)).toBe('a  \nb\t\nc');
  await page.keyboard.press('Control+z'); await expect(page.locator('#source')).toHaveValue('a  \nb\t\nc  ');
});

test('footer keeps status beside actions until the compact breakpoint', async ({ page }) => {
  await openApp(page, { draft: '字'.repeat(1000) });
  for (const zoom of [1, 1.5]) {
    for (const width of [600, 564, 510, 423, 422, 421, 390, 320]) {
      await page.setViewportSize({ width: Math.round(width * zoom), height: Math.round(340 * zoom) });
      await page.evaluate(value => { document.body.style.zoom = String(value); }, zoom);
      // CSS zoom rounds borders to device pixels; measure the actual content box.
      const contentWidth = await page.locator('.window').evaluate(el => {
        const style = getComputedStyle(el);
        return parseFloat(style.width) - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
      });
      const status = (await page.locator('#status-message').boundingBox())!;
      const actions = (await page.locator('.footer-actions').boundingBox())!;
      if (contentWidth > 420) {
        expect(Math.abs(status.y + status.height / 2 - actions.y - actions.height / 2)).toBeLessThanOrEqual(zoom);
        expect(status.x + status.width).toBeLessThan(actions.x);
      } else expect(actions.y).toBeGreaterThanOrEqual(status.y + status.height);
      expect(await page.locator('#status-message').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (zoom === 1 && width === 510) await page.screenshot({ path: 'test-results/footer-510.png' });
    }
  }
});

test('footer actions remain compact and keyboard accessible across widths and zoom', async ({ page }) => {
  await openApp(page); await page.locator('#source').fill('text  ');
  for (const zoom of [1, 1.5]) {
    for (const width of [600, 510, 423, 422, 390, 320]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.evaluate(value => { document.body.style.zoom = String(value); }, zoom);
      const boxes = await page.locator('.button-group > button').evaluateAll(els => els.map(el => {
        const box = el.getBoundingClientRect();
        return { x: box.x, right: box.right, y: box.y, height: box.height, width: box.width };
      }));
      expect(boxes).toHaveLength(3);
      for (const [index, box] of boxes.entries()) {
        expect(box.height).toBeCloseTo(26 * zoom, 1);
        expect(box.width).toBeCloseTo([44, 44, 72][index] * zoom, 1);
        expect(box.y).toBe(boxes[0].y);
        if (index) expect(box.x - boxes[index - 1].right).toBeCloseTo(4 * zoom, 1);
      }
      const start = boxes[2];
      await page.locator('#start').click();
      await expect(page.locator('#start')).toHaveText('取消输入');
      await expect(page.locator('#status-message')).toHaveText('正在返回已记录的输入位置');
      await page.evaluate(() => window.relayTest.push({ message: '正在返回已记录的输入位置' }));
      await expect(page.locator('#status-message')).toHaveText('正在返回已记录的输入位置');
      const targeting = (await page.locator('#start').boundingBox())!;
      expect(targeting.x).toBe(start.x); expect(targeting.y).toBe(start.y); expect(targeting.width).toBe(start.width);
      await page.locator('#start').click();
    }
  }
  await page.evaluate(() => { document.body.style.zoom = '1'; });
  await page.setViewportSize({ width: 600, height: 900 });
  await page.locator('#source').focus(); await page.keyboard.press('Tab');
  await expect(page.locator('#status-message')).toBeFocused();
  await page.keyboard.press('Tab');
  const cleanup = page.getByRole('button', { name: '清理', exact: true });
  await expect(cleanup).toBeFocused();
  expect(await cleanup.evaluate(el => getComputedStyle(el, '::after').visibility)).toBe('visible');
  await cleanup.hover(); await expect(cleanup).toHaveAccessibleName('清理');
  await page.keyboard.press('Enter'); await expect(page.locator('#source')).toHaveValue('text');
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '清空', exact: true })).toBeFocused();
  await page.keyboard.press('Space'); await expect(page.locator('#source')).toHaveValue('');
});

test('invalid fields, restoration and targeting operation', async ({ page }) => {
  await openApp(page); await page.locator('#source').fill('ab');
  await page.getByRole('tab', { name: '设置' }).click(); await page.locator('#interval').fill('1.5');
  await expect(page.locator('#interval-error')).toBeVisible();
  await page.getByRole('tab', { name: '输入' }).click(); await page.locator('#start').click();
  await expect(page.locator('#interval')).toBeFocused();
  await page.getByRole('button', { name: '恢复默认' }).click();
  await expect(page.locator('#interval-error')).toHaveCount(0);
  await page.getByRole('tab', { name: '输入' }).click();
  await page.locator('#start').click(); await expect(page.locator('#settings-tab')).toBeDisabled();
  await expect(page.locator('#start')).toHaveText('取消输入');
  await page.locator('#start').click(); await expect(page.locator('#settings-tab')).toBeEnabled();
});

for (const selector of ['#trim-trailing', '#clear']) {
  test(`${selector} stopping gesture preserves source until an independent click`, async ({ page }) => {
    await openApp(page); await page.locator('#source').fill('preserve  ');
    await page.evaluate(() => window.relayTest.push({ phase: 'typing', sent: 1, total: 10, message: '已发送 1 / 10 字符' }));
    const action = page.locator(selector); await expect(action).toBeDisabled();
    const box = (await action.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.evaluate(() => window.relayTest.push({ phase: 'stopped', message: '已中止，剩余内容已取消' }));
    await page.mouse.up(); await expect(page.locator('#source')).toHaveValue('preserve  ');
    await action.click(); await expect(page.locator('#source')).toHaveValue(selector === '#clear' ? '' : 'preserve');
  });
}

test('layout fills viewport heights at all widths, breakpoints and zoom', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page, { draft: '滚动内容\n'.repeat(200), entries: Array.from({ length: 100 }, (_, index) => ({ pinned: false, id: index + 1, time: Date.now(), text: `历史 ${index}\n完整正文` })) });
  for (const width of [600, 564, 521, 520, 510, 423, 422, 421, 420, 390, 320]) {
    let previous: { viewport: number; editor: number; footer: number } | undefined;
    for (const height of [340, 450, 881]) {
      await page.setViewportSize({ width, height });
      await page.locator('#input-tab').click();
      const editor = (await page.locator('#source').boundingBox())!;
      const footer = (await page.locator('.footer').boundingBox())!;
      expect(editor.height).toBeGreaterThan(0);
      await expect(page.locator('#source')).toHaveCSS('resize', 'none');
      expect(Math.abs(footer.y - editor.y - editor.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(footer.y + footer.height - height)).toBeLessThanOrEqual(1);
      if (previous) {
        expect(editor.height - previous.editor).toBeCloseTo(height - previous.viewport, 1);
        expect(footer.height).toBe(previous.footer);
      }
      previous = { viewport: height, editor: editor.height, footer: footer.height };
      for (const tab of ['history', 'settings', 'about', 'input']) {
        await page.locator(`#${tab}-tab`).click();
        const box = (await page.locator('.window').boundingBox())!;
        expect(box.width).toBe(width);
        expect(box.height).toBe(height);
        expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (tab !== 'input') await expect(page.locator('#start')).not.toBeVisible();
      }
      await page.locator('#history-tab').click();
      expect(await page.locator('.history-list').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
      await page.locator('.history-view').first().click();
      const fullText = (await page.locator('.history-full-text').boundingBox())!;
      expect(fullText.height).toBeGreaterThan(0);
      expect(fullText.y + fullText.height).toBeLessThan(height);
      await page.getByRole('button', { name: '返回历史' }).click();
      await page.locator('#settings-tab').click();
      if (width <= 420) expect(await page.locator('.setting-row').evaluateAll(rows => rows.every(row => row.children[1].getBoundingClientRect().top >= row.children[0].getBoundingClientRect().bottom))).toBe(true);
      await page.locator('#about-tab').click();
      await page.getByRole('button', { name: 'MIT 许可证' }).click();
      expect((await page.locator('.window').boundingBox())!.height).toBe(height);
      expect(await page.locator('.about-content').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.getByRole('button', { name: '返回关于' }).click();
    }
  }
  await page.setViewportSize({ width: 960, height: 720 });
  await page.evaluate(() => { document.body.style.zoom = '1.5'; });
  for (const tab of ['input', 'history', 'settings', 'about']) {
    await page.locator(`#${tab}-tab`).click();
    expect((await page.locator('.window').boundingBox())!.height).toBe(720);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    await page.screenshot({ path: `test-results/${tab}-viewport-150.png` });
  }
});

test('storage and long task errors stay inside the viewport with fixed input controls', async ({ page }) => {
  await openApp(page);
  await page.setViewportSize({ width: 320, height: 340 });
  const footer = (await page.locator('.footer').boundingBox())!;
  await page.evaluate(() => {
    window.relayTest.textPush({ error: '内容暂未保存，请重试。' });
    window.relayTest.push({ phase: 'failed', message: '较长的错误说明，请重新选择输入位置。'.repeat(20) });
  });
  await expect(page.locator('.storage-notice')).toBeVisible();
  const after = (await page.locator('.footer').boundingBox())!;
  expect(after.height).toBe(footer.height);
  expect(after.y + after.height).toBeLessThanOrEqual(340);
  expect((await page.locator('#source').boundingBox())!.height).toBeGreaterThan(0);
  expect((await page.locator('.window').boundingBox())!.height).toBe(340);
  expect(await page.locator('#status-message').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await page.getByRole('button', { name: '重试保存' }).click();
  await expect(page.locator('.storage-notice')).toHaveCount(0);
});

for (const height of [340, 450]) {
test(`about links, keyboard navigation and offline license retain the editor state at ${height}px`, async ({ page }) => {
  await openApp(page); await page.setViewportSize({ width: 600, height });
  await page.locator('#source').fill('保留文本');
  await page.locator('#input-tab').focus(); await page.keyboard.press('End');
  await expect(page.locator('#about-tab')).toBeFocused();
  await page.locator('.window').screenshot({ path: `test-results/about-600-${height}.png` });
  expect(await page.locator('.about-content').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(height === 340);
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
}

test('about update states use the available space at narrow widths and zoom', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.relayTest.updatePush({ autoCheck: false }));
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
  await page.evaluate(() => window.relayTest.push({ phase: 'targeting' }));
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
  for (const [phase, message] of [['targeting', '正在返回已记录的输入位置'], ['typing', '已发送 1 / 3 字符 · 按 Esc 或点击鼠标停止'], ['done', '已完成，已发送 3 个字符'], ['stopped', '已中止，剩余内容已取消'], ['failed', '系统输入提交失败，请检查本地权限。']] as const) {
    await page.evaluate(({ phase, message }) => window.relayTest.push({ phase, message }), { phase, message });
    await expect(page.locator('#status-message')).toHaveText(phase === 'targeting' ? '正在返回已记录的输入位置' : message); expect(await appearance()).toEqual(baseline);
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

test('shared buttons match across panels while other controls retain their colors', async ({ page }) => {
  await openApp(page); await page.setViewportSize({ width: 600, height: 900 });
  await page.locator('#source').fill('预览文本  ');
  const appearance = (name: string) => page.getByRole('button', { name, exact: true }).evaluate(el => {
    const style = getComputedStyle(el);
    return [el.getBoundingClientRect().height, style.backgroundColor, style.color, style.borderTopColor, style.fontSize, style.lineHeight];
  });
  const secondary = await appearance('清理');
  const primary = await appearance('开始输入');
  expect(secondary).toEqual([26, 'rgb(229, 229, 229)', 'rgb(37, 37, 37)', 'rgb(170, 170, 170)', '13px', '20px']);
  expect(primary).toEqual([26, 'rgb(50, 103, 152)', 'rgb(255, 255, 255)', 'rgb(36, 78, 117)', '13px', '20px']);
  await page.locator('.window').screenshot({ path: 'test-results/approved-input.png' });
  await page.locator('#settings-tab').click();
  expect(await appearance('恢复默认')).toEqual(secondary);
  await expect(page.locator('#shortcut')).toHaveCSS('background-color', 'rgb(250, 250, 250)');
  await page.locator('.window').screenshot({ path: 'test-results/approved-settings.png' });
  await page.locator('#about-tab').click();
  expect(await appearance('检查更新')).toEqual(secondary);
  expect(await appearance('MIT 许可证')).toEqual(secondary);
  await page.getByRole('button', { name: 'MIT 许可证' }).click();
  expect(await appearance('返回关于')).toEqual(secondary);
  await page.getByRole('button', { name: '返回关于' }).click();
  await page.getByRole('button', { name: '检查更新' }).click();
  expect(await appearance('下载更新')).toEqual(primary);
  await page.getByRole('button', { name: '下载更新' }).click();
  await page.mouse.move(0, 0);
  expect(await appearance('安装并重启')).toEqual(primary);
  await page.locator('.window').screenshot({ path: 'test-results/approved-about.png' });
  await page.getByRole('button', { name: '安装并重启', exact: true }).click();
  expect(await appearance('暂不安装')).toEqual(secondary);
  expect(await appearance('确认安装并重启')).toEqual(primary);
  const confirmation = (await page.locator('.update-confirmation').boundingBox())!;
  const confirmButton = (await page.getByRole('button', { name: '确认安装并重启' }).boundingBox())!;
  expect(confirmButton.x + confirmButton.width).toBeCloseTo(confirmation.x + confirmation.width, 1);
  await expect(page.locator('.update-actions')).toHaveCSS('gap', '4px');
  await page.getByRole('button', { name: '暂不安装' }).click();
  await page.locator('#input-tab').click();
  await page.locator('#clear').hover();
  await expect(page.locator('#clear')).toHaveCSS('background-color', 'rgb(249, 234, 232)');
  await page.locator('#start').hover();
  await expect(page.locator('#start')).toHaveCSS('border-color', 'rgb(30, 66, 100)');
  await page.mouse.down();
  await expect(page.locator('#start')).toHaveCSS('border-color', 'rgb(25, 55, 82)');
  await page.mouse.move(0, 0); await page.mouse.up();
  await page.evaluate(() => window.relayTest.push({ phase: 'typing' }));
  await expect(page.locator('#source')).toHaveCSS('background-color', 'rgb(250, 250, 250)');
  await expect(page.locator('#start')).toHaveCSS('color', 'rgb(133, 133, 133)');
});

test('hidden settings exit focus order and title buttons invoke native actions', async ({ page }) => {
  await openApp(page); await page.locator('#input-tab').focus(); await page.keyboard.press('Tab');
  await expect(page.locator('#source')).toBeFocused();
  for (const name of ['最小化', '最大化或还原', '关闭']) await page.getByRole('button', { name }).click();
  const calls = await page.evaluate(() => window.relayTest.calls);
  expect(calls).toContain('plugin:window|minimize'); expect(calls).toContain('plugin:window|toggle_maximize'); expect(calls).toContain('plugin:window|close');
});
