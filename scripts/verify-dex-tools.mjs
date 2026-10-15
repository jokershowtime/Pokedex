import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url), root = path.resolve(import.meta.dirname, '..'), qa = path.join(root, '.qa');
mkdirSync(qa, { recursive: true }); const directory = mkdtempSync(path.join(qa, 'dex-tools-'));
const { createUserStore } = require('../electron/user-store.cjs');
createUserStore(directory).settings({ versionId: 6, uiScale: 125, theme: 'light', shortcut: 'Ctrl+Alt+Shift+F5' });
const env = { ...process.env, POKEDEX_USER_DATA: directory, POKEDEX_TEST: '1', POKEDEX_HEADLESS: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.POKEDEX_DEV_URL;
let desktop, page; const checks = [], errors = [];
const selectedCheck = process.argv.find(value => value.startsWith('--only='))?.slice(7);
if (selectedCheck && !['discovery', 'compare', 'search'].includes(selectedCheck)) throw new Error('--only 可选择 discovery、compare、search。');
async function capture(target, name) {
  const snapshot = () => desktop.evaluate(async ({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(value => value.webContents.getURL() === url);
    return (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64');
  }, target.url());
  await snapshot(); await target.waitForTimeout(150); await snapshot(); await target.waitForTimeout(150);
  writeFileSync(path.join(qa, name + '.png'), Buffer.from(await snapshot(), 'base64'));
}
async function check(id, name, action) { if (selectedCheck && selectedCheck !== id) return; await action(); checks.push(name); console.log('PASS ' + name); }
async function addMove(id) {
  await page.getByLabel('搜索反查招式', { exact: true }).fill(String(id));
  await page.getByLabel('添加反查招式', { exact: true }).selectOption(String(id));
}
async function noOverflow(target, selector) {
  expect(await target.locator(selector).evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(2);
  const title = await target.locator('.titlebar, .mini-titlebar').evaluate(element => ({ top: element.getBoundingClientRect().top, right: element.getBoundingClientRect().right, width: innerWidth }));
  expect(title.top).toBeGreaterThanOrEqual(-1); expect(title.right).toBeLessThanOrEqual(title.width + 1);
}
async function searchBounds(target) {
  const bounds = await target.locator('.unified-search-dialog').evaluate(element => {
    const rect = value => { const r = value.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
    return { modal: rect(element), close: rect(element.querySelector('.unified-search-heading .icon-button')), width: innerWidth, height: innerHeight };
  });
  for (const r of [bounds.modal, bounds.close]) {
    expect(r.left).toBeGreaterThanOrEqual(0); expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeLessThanOrEqual(bounds.width); expect(r.bottom).toBeLessThanOrEqual(bounds.height);
  }
  await noOverflow(target, '.unified-search-dialog');
}
try {
  desktop = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env, timeout: 45000 });
  page = await desktop.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.pokemon-panel h1', { timeout: 45000 });
  await check('discovery', '组合反查匹配多个条件、附学习方式并可加入对比，版本引用和缺失有明确说明', async () => {
    await page.getByRole('button', { name: '组合反查', exact: true }).click();
    await page.getByLabel('反查属性一').selectOption('13');
    await page.getByLabel('速度种族值下限').fill('90');
    await page.getByLabel('搜索需要的特性', { exact: true }).fill('静电');
    await page.getByLabel('添加需要的特性', { exact: true }).selectOption('9');
    await addMove(85); await addMove(98);
    await page.getByRole('button', { name: '查询符合条件的宝可梦', exact: true }).click();
    await expect(page.locator('.discovery-results h2')).toContainText('找到 5 只');
    await expect(page.locator('.discovery-result')).toHaveCount(5);
    await expect(page.locator('.discovery-learning').first()).toContainText('十万伏特');
    for (const name of ['皮卡丘', '雷丘']) await page.locator('.discovery-result').filter({ has: page.getByRole('heading', { name, exact: true }) }).getByRole('button', { name: '加入对比', exact: true }).click();
    await noOverflow(page, '.discovery-page'); await capture(page, 'dex-discovery');
    await page.getByLabel('反查资料版本').selectOption('27'); await addMove(85);
    await page.getByRole('button', { name: '查询符合条件的宝可梦', exact: true }).click();
    await expect(page.locator('.dex-learning-notice')).toContainText('学习记录引用：朱／紫');
    await page.getByLabel('反查资料版本').selectOption('30'); await addMove(85);
    await page.getByRole('button', { name: '查询符合条件的宝可梦', exact: true }).click();
    await expect(page.locator('.discovery-results h2')).toContainText('学习资料不足');
    await expect(page.locator('.dex-learning-notice')).toContainText('空记录不代表不能学习');
    await page.getByLabel('反查资料版本').selectOption('6');
  });
  await check('compare', '并排对比支持四位成员、属性抗性及共同独有招式，历史版本与 200% 字号正确', async () => {
    await page.getByRole('button', { name: '宝可梦对比', exact: true }).click();
    if (selectedCheck === 'compare') for (const id of [25, 26]) {
      await page.getByLabel('搜索对比宝可梦', { exact: true }).fill(String(id));
      await page.getByLabel('添加对比宝可梦', { exact: true }).selectOption(String(id));
    }
    await expect(page.locator('.dex-comparison-table')).toContainText('300');
    for (const id of [130, 149]) {
      await page.getByLabel('搜索对比宝可梦', { exact: true }).fill(String(id));
      await page.getByLabel('添加对比宝可梦', { exact: true }).selectOption(String(id));
    }
    await expect(page.getByLabel('添加对比宝可梦', { exact: true })).toBeDisabled();
    await expect(page.locator('.dex-comparison-table thead th')).toHaveCount(5);
    await page.getByRole('tab', { name: '弱点与抗性', exact: true }).click();
    const electric = page.locator('.dex-comparison-table tbody tr').filter({ has: page.getByText('电', { exact: true }) });
    await expect(electric.locator('td').nth(2)).toHaveText('×4');
    await page.getByRole('tab', { name: '招式学习对比', exact: true }).click();
    await expect(page.locator('.dex-comparison-table tbody tr').first()).toBeVisible();
    await page.getByLabel('对比招式显示范围').selectOption('unique');
    await expect(page.locator('.dex-comparison-table tbody tr').first()).toBeVisible();
    await page.evaluate(() => window.pokedex.user('settings', { uiScale: 200, theme: 'dark' }));
    await page.getByRole('tab', { name: '基础资料', exact: true }).click();
    await page.locator('.dex-comparison-table').evaluate(element => {
      const parent = element.closest('.dex-compare-page'); parent.scrollTo({ top: parent.scrollTop + element.getBoundingClientRect().top - parent.getBoundingClientRect().top });
    });
    await noOverflow(page, '.dex-compare-page'); await capture(page, 'dex-compare-large');
    await page.getByLabel('对比资料版本').selectOption('1');
    await expect(page.locator('.dex-comparison-table')).toContainText('特殊种族值');
    await expect(page.locator('.dex-comparison-table')).not.toContainText('特防种族值');
    await page.getByLabel('对比资料版本').selectOption('30');
    await page.getByRole('tab', { name: '招式学习对比', exact: true }).click();
    await expect(page.locator('.dex-learning-notice')).toContainText('当前版本缺少学习表');
    await page.getByLabel('对比资料版本').selectOption('6');
  });
  await check('search', '统一搜索支持四类资料和键盘操作，主窗口与迷你图鉴的版本、跳转及大字号一致', async () => {
    await page.getByRole('button', { name: '宝可梦对比', exact: true }).click();
    await page.evaluate(() => window.pokedex.user('settings', { uiScale: 200, theme: 'dark', versionId: 6 }));
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: '统一搜索', exact: true })).toBeVisible();
    const search = page.getByRole('combobox', { name: '统一搜索内容', exact: true });
    await search.fill('地震');
    await expect(page.getByRole('option', { name: '打开招式地震', exact: true })).toBeVisible();
    await searchBounds(page);
    await search.press('Enter');
    await expect(page.getByRole('dialog', { name: '资料详情' }).getByRole('heading', { name: '地震', exact: true })).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.locator('.dex-compare-page')).toBeVisible();
    await page.keyboard.press('Control+k'); await search.fill('#25');
    await expect(page.locator('.unified-search-group')).toHaveCount(4);
    await searchBounds(page);
    await capture(page, 'dex-unified-search-large');
    await page.getByRole('dialog', { name: '统一搜索' }).getByRole('button', { name: '特性', exact: true }).click();
    await search.fill('weihe'); await expect(page.getByRole('option', { name: '打开特性威吓', exact: true })).toBeVisible();
    await search.press('Enter'); await expect(page.locator('.entity-modal h1')).toHaveText('威吓'); await page.keyboard.press('Escape');
    const waiting = desktop.waitForEvent('window'); await page.getByRole('button', { name: '迷你图鉴', exact: true }).click();
    const mini = await waiting; mini.setDefaultTimeout(15000); mini.on('pageerror', error => errors.push(error.message));
    await mini.waitForSelector('.mini-panel');
    const quick = mini.getByRole('combobox', { name: '迷你统一搜索', exact: true });
    await quick.fill('雷之石'); await mini.getByRole('option', { name: '打开道具雷之石', exact: true }).click();
    await expect(mini.locator('.entity-modal h1')).toHaveText('雷之石');
    await noOverflow(mini, '.entity-modal'); await mini.keyboard.press('Escape');
    await mini.keyboard.press('Control+k'); await expect(quick).toBeFocused(); await quick.fill('#25');
    await expect(mini.locator('.unified-search-group')).toHaveCount(4);
    await noOverflow(mini, '.mini-shell'); await capture(mini, 'dex-mini-unified-large');
    await mini.getByRole('option', { name: '打开宝可梦皮卡丘', exact: true }).click();
    await expect(mini.locator('.pokemon-panel h1')).toHaveText('皮卡丘');
    await mini.getByLabel('迷你图鉴规则版本').selectOption('27'); await expect(quick).toHaveValue('');
    await quick.fill('仙子伊布'); await mini.getByRole('option', { name: '打开宝可梦仙子伊布', exact: true }).click();
    await expect(mini.locator('.pokemon-panel h1')).toHaveText('仙子伊布');
    await mini.getByLabel('迷你图鉴规则版本').selectOption('6'); await quick.fill('仙子伊布');
    await expect(mini.locator('.dex-search-message')).toContainText('当前资料版本没有匹配结果');
  });
  expect(errors).toEqual([]);
} catch (error) { if (page) await capture(page, 'dex-tools-failure').catch(() => {}); errors.push(error.message); throw error; }
finally { writeFileSync(path.join(qa, 'dex-tools-ui-report.json'), JSON.stringify({ directory, checks, errors }, null, 2)); await desktop?.close(); }
