import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = path.join(root, '.qa/strategy-ui-user');
mkdirSync(folder, { recursive: true });
writeFileSync(path.join(folder, 'preferences.json'), JSON.stringify({ favorites: [25], history: [], notes: { 25: '旧版笔记仍然保留' }, settings: { versionId: 27, theme: 'light', imageStyle: 'artwork', shortcut: 'Ctrl+Alt+Shift+F12', keepOnTop: false, uiScale: 125 } }));
const env = { ...process.env, POKEDEX_USER_DATA: folder, POKEDEX_TEST: '1', POKEDEX_HEADLESS: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.POKEDEX_DEV_URL;
const errors = [], checks = [];
let desktop, page;
async function launch() {
  desktop = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env, timeout: 45000 });
  page = await desktop.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.pokemon-panel h1', { timeout: 45000 });
}
async function check(name, action) { await action(); checks.push(name); console.log(`PASS ${name}`); }
async function screenshot(name) {
  const capture = () => desktop.evaluate(async ({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL() === url);
    const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    return image.toPNG().toString('base64');
  }, page.url());
  await capture(); await page.waitForTimeout(200); await capture(); await page.waitForTimeout(150);
  writeFileSync(path.join(root, `.qa/${name}.png`), Buffer.from(await capture(), 'base64'));
}
try {
  await launch();
  await page.getByRole('button', { name: '配招培育', exact: true }).click();
  await check('真实来源可同步，喷火龙显示多路线和中文配置', async () => {
    await page.waitForSelector('.strategy-card', { timeout: 45000 });
    expect(await page.locator('.strategy-card').count()).toBeGreaterThan(1);
    await expect(page.locator('.strategy-cache')).toContainText('已缓存');
    const first = page.locator('.strategy-card').first();
    await expect(first).toContainText('太阳之力'); await expect(first).toContainText('胆小');
    await expect(first).toContainText('气象球'); await expect(first).toContainText('日光束');
    const result = await page.evaluate(async () => window.pokedex.strategy('list', { pokemonId: 6, generation: 9 }));
    expect(result.error).toBeNull(); expect(result.cache.totalSets).toBeGreaterThan(1000);
  });
  await screenshot('strategy-source-preview');
  await check('按单打、双打和规则筛选；备选道具保持成套配置', async () => {
    await page.getByLabel('配招玩法筛选', { exact: true }).selectOption('doubles');
    expect(await page.locator('.strategy-card').count()).toBeGreaterThan(0);
    const categories = await page.locator('.strategy-card .strategy-tags').allTextContents();
    expect(categories.every(text => /双打|VGC/.test(text))).toBe(true);
    await page.getByLabel('配招玩法筛选', { exact: true }).selectOption('all');
    const first = page.locator('.strategy-card').first();
    await first.locator('select').filter({ has: page.locator('option[value="Heavy-Duty Boots"]') }).selectOption('Heavy-Duty Boots');
    await first.getByRole('button', { name: '存为我的方案', exact: true }).click();
    await expect(first.getByRole('button', { name: '已收藏', exact: true })).toBeDisabled();
    const state = await page.evaluate(() => window.pokedex.user('get')); expect(state.plans).toHaveLength(1);
    expect(state.plans[0].selection.item).toBe('Heavy-Duty Boots');
  });
  await check('个人方案可编辑，0 攻击个体值和备注保留，培养进度可勾选', async () => {
    await page.getByRole('button', { name: /^我的方案/ }).click();
    await page.getByLabel('道具已准备', { exact: true }).check();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '编辑培养方案' });
    await dialog.getByLabel('培养方案名称').fill('我自己的晴天路线');
    await dialog.getByLabel('攻击个体值', { exact: true }).fill('0');
    await dialog.getByLabel('培养方案第4招式').selectOption('Fire Blast');
    await dialog.getByLabel('培养方案备注').fill('保留自己的改法，先准备厚底靴。');
    await dialog.getByRole('button', { name: '保存培养方案' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('.strategy-card h3')).toHaveText('我自己的晴天路线');
    await expect(page.locator('.strategy-card')).toContainText('大字爆炎');
    await expect(page.getByLabel('道具已准备', { exact: true })).toBeChecked();
    const state = await page.evaluate(() => window.pokedex.user('get')); expect(state.plans[0].selection.ivs.atk).toBe(0);
    expect(state.plans[0].notes).toContain('保留自己的改法');
  });
  await check('方案数值校验会阻止超额努力值保存', async () => {
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '编辑培养方案' });
    await dialog.getByLabel('HP努力值', { exact: true }).fill('252');
    await expect(dialog.locator('.build-errors')).toContainText('510');
    await expect(dialog.getByRole('button', { name: '保存培养方案' })).toBeDisabled();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
  });
  await check('中文与 Showdown 导出可直接往返导入，且不会改动系统剪贴板', async () => {
    const texts = await page.evaluate(async () => {
      const set = (await window.pokedex.strategy('personal', { pokemonId: 6 }))[0];
      return { chinese: await window.pokedex.strategy('export', { set, language: 'chinese', copy: false }),
        showdown: await window.pokedex.strategy('export', { set, language: 'showdown', copy: false }) };
    });
    expect(texts.chinese).toContain('个体值: 31 HP / 0 攻击');
    expect(texts.showdown).toContain('IVs: 0 Atk'); expect(texts.showdown).toContain('- Fire Blast');
    await page.getByRole('button', { name: '导入作业', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '导入配招文本' });
    await dialog.getByLabel('配招导入文本').fill(texts.showdown);
    await dialog.getByRole('button', { name: '导入为我的方案' }).click();
    await expect(dialog).not.toBeVisible();
    const state = await page.evaluate(() => window.pokedex.user('get')); expect(state.plans).toHaveLength(2); expect(state.plans[0].selection.ivs.atk).toBe(0);
  });
  await check('来源重新同步不会覆盖自己的路线、笔记和进度', async () => {
    await page.getByRole('button', { name: /^来源方案/ }).click();
    await page.getByRole('button', { name: '联网更新', exact: true }).click();
    await page.waitForSelector('.strategy-card', { timeout: 45000 });
    const state = await page.evaluate(() => window.pokedex.user('get'));
    const own = state.plans.find(plan => plan.title === '我自己的晴天路线');
    expect(own).toBeTruthy(); expect(own.progress.item).toBe(true); expect(own.selection.ivs.atk).toBe(0);
  });
  await check('侧栏培养方案库可搜索、查看资料和删除指定方案', async () => {
    await page.getByRole('button', { name: '我的培养', exact: true }).click();
    await page.getByRole('tab', { name: '单只培养', exact: true }).click();
    await expect(page.locator('.personal-strategy-grid .strategy-card')).toHaveCount(2);
    await page.getByLabel('搜索我的培养方案').fill('我自己的');
    await expect(page.locator('.personal-strategy-grid .strategy-card')).toHaveCount(1);
    await page.getByLabel('查看气象球的学习资料').click();
    await expect(page.getByRole('dialog', { name: '资料详情' })).toBeVisible();
    await page.getByRole('button', { name: '关闭资料详情' }).click();
    await page.getByLabel('搜索我的培养方案').fill('导入方案');
    await page.getByRole('button', { name: /^删除/ }).click();
    await page.getByRole('button', { name: '确认删除', exact: true }).click();
    const state = await page.evaluate(() => window.pokedex.user('get')); expect(state.plans).toHaveLength(1);
    await page.getByLabel('搜索我的培养方案').fill('');
  });
  await screenshot('strategy-personal-preview');
  await check('重启后保留个人路线、培养进度、旧收藏笔记及来源缓存', async () => {
    await desktop.close(); desktop = null; await launch();
    await page.getByRole('button', { name: '我的培养', exact: true }).click();
    await page.getByRole('tab', { name: '单只培养', exact: true }).click();
    await expect(page.locator('.strategy-card h3')).toHaveText('我自己的晴天路线');
    await expect(page.getByLabel('道具已准备', { exact: true })).toBeChecked();
    const state = await page.evaluate(() => window.pokedex.user('get')); expect(state.favorites).toEqual([25]); expect(state.notes[25]).toBe('旧版笔记仍然保留');
    await page.getByRole('button', { name: '宝可梦图鉴', exact: true }).click();
    await page.getByRole('button', { name: '配招培育', exact: true }).click();
    await page.waitForSelector('.strategy-card'); await expect(page.locator('.strategy-cache')).toContainText('已缓存');
  });
  expect(errors).toEqual([]);
  writeFileSync(path.join(root, '.qa/strategy-ui-report.json'), JSON.stringify({ checks, rendererErrors: errors }, null, 2));
  console.log(`完成 ${checks.length} 项配招培育桌面验证。`);
} catch (error) { if (desktop) await screenshot('strategy-failure').catch(() => {}); console.error(error); process.exitCode = 1; }
finally { if (desktop) await desktop.close(); }
