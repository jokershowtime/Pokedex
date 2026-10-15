import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url), root = path.resolve(import.meta.dirname, '..'), qa = path.join(root, '.qa');
mkdirSync(qa, { recursive: true }); const directory = mkdtempSync(path.join(qa, 'mini-entity-'));
const { createUserStore } = require('../electron/user-store.cjs');
createUserStore(directory).settings({ versionId: 27, uiScale: 125, theme: 'light', shortcut: 'Ctrl+Alt+Shift+F6' });
const env = { ...process.env, POKEDEX_USER_DATA: directory, POKEDEX_TEST: '1', POKEDEX_HEADLESS: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.POKEDEX_DEV_URL;
const records = [], errors = []; let desktop, mini;
async function screenshot(name) {
  const capture = () => desktop.evaluate(async ({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url);
    return (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64');
  }, mini.url());
  await capture(); await mini.waitForTimeout(150);
  writeFileSync(path.join(qa, name + '.png'), Buffer.from(await capture(), 'base64'));
}
async function bounds() {
  return mini.evaluate(() => {
    const modal = document.querySelector('.entity-modal'), close = modal.querySelector('.modal-close'), grid = modal.querySelector('.learner-grid');
    const rect = element => { const value = element.getBoundingClientRect(); return { x: value.x, y: value.y, right: value.right, bottom: value.bottom, width: value.width, height: value.height }; };
    return { viewport: { width: innerWidth, height: innerHeight }, modal: rect(modal), close: rect(close),
      overflow: modal.scrollWidth - modal.clientWidth, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      grid: rect(grid), cards: [...grid.querySelectorAll('button')].map(element => ({ ...rect(element), overflow: element.scrollWidth - element.clientWidth })) };
  });
}
function checkBounds(value) {
  expect(value.modal.x).toBeGreaterThanOrEqual(0); expect(value.modal.right).toBeLessThanOrEqual(value.viewport.width);
  expect(value.modal.y).toBeGreaterThanOrEqual(0); expect(value.modal.bottom).toBeLessThanOrEqual(value.viewport.height + 1);
  expect(value.close.x).toBeGreaterThanOrEqual(value.modal.x); expect(value.close.right).toBeLessThanOrEqual(value.modal.right);
  expect(value.close.y).toBeGreaterThanOrEqual(0); expect(value.close.bottom).toBeLessThanOrEqual(value.viewport.height);
  expect(value.overflow).toBeLessThanOrEqual(2); expect(value.pageOverflow).toBeLessThanOrEqual(2);
  for (const card of value.cards) {
    expect(card.x).toBeGreaterThanOrEqual(value.grid.x - 1); expect(card.right).toBeLessThanOrEqual(value.grid.right + 1);
    expect(card.overflow).toBeLessThanOrEqual(2);
  }
}
try {
  desktop = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env, timeout: 45000 });
  const main = await desktop.firstWindow(); main.on('pageerror', error => errors.push(error.message));
  await main.waitForSelector('.pokemon-panel h1', { state: 'attached', timeout: 45000 });
  const waiting = desktop.waitForEvent('window'); await main.getByRole('button', { name: '迷你图鉴', exact: true }).click();
  mini = await waiting; mini.setDefaultTimeout(15000); mini.on('pageerror', error => errors.push(error.message));
  await mini.waitForSelector('.mini-panel');
  const search = mini.getByRole('combobox', { name: '迷你统一搜索', exact: true });
  await search.fill('130'); await mini.getByRole('option', { name: '打开宝可梦暴鲤龙', exact: true }).click();
  await mini.getByRole('button', { name: '基础资料', exact: true }).click();
  for (const [scale, theme] of [[125, 'light'], [200, 'dark']]) {
    await main.evaluate(settings => window.pokedex.user('settings', settings), { uiScale: scale, theme });
    await expect.poll(() => mini.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
    for (const minimum of [false, true]) {
      if (minimum) await desktop.evaluate(({ BrowserWindow }, url) => {
        const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url);
        window.setSize(...window.getMinimumSize());
      }, mini.url());
      await mini.locator('.ability-card').filter({ hasText: '威吓' }).click();
      await expect(mini.getByRole('dialog', { name: '资料详情' }).getByRole('heading', { name: '威吓', exact: true })).toBeVisible();
      const before = await bounds(); records.push({ scale, theme, minimum, before });
      await screenshot('mini-ability-' + scale + (minimum ? '-minimum' : ''));
      if (process.argv.includes('--probe')) { console.log(JSON.stringify(before)); break; }
      checkBounds(before);
      await mini.locator('.entity-modal').evaluate(element => { element.scrollTop = element.scrollHeight; });
      const after = await bounds(); records.at(-1).after = after; checkBounds(after);
      await expect(mini.locator('.learner-grid button').last()).toBeInViewport();
      await screenshot('mini-ability-' + scale + (minimum ? '-minimum' : '') + '-scrolled');
      await mini.getByRole('button', { name: '关闭资料详情', exact: true }).click();
      await expect(mini.getByRole('dialog')).toHaveCount(0);
      console.log('PASS 迷你特性详情 ' + scale + '% ' + theme + (minimum ? ' 最小窗口' : ' 默认窗口'));
    }
    if (process.argv.includes('--probe')) break;
  }
  if (!process.argv.includes('--probe')) {
    await mini.locator('.ability-card').filter({ hasText: '威吓' }).click();
    const pokemonName = await mini.locator('.learner-grid button').first().locator('span').textContent();
    await mini.locator('.learner-grid button').first().click();
    await expect(mini.getByRole('dialog')).toHaveCount(0);
    await expect(mini.locator('.hero-info h1')).toContainText(pokemonName);
    expect(errors).toEqual([]); console.log('PASS 特性拥有者可跳转，关闭弹窗后继续查询');
  }
} catch (error) { if (mini) await screenshot('mini-entity-failure').catch(() => {}); records.push({ failure: error.message }); throw error; }
finally {
  writeFileSync(path.join(qa, 'mini-entity-report.json'), JSON.stringify({ directory, records, errors }, null, 2));
  await desktop?.close();
}
