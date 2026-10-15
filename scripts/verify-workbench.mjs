import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const qa = path.join(root, '.qa'); mkdirSync(qa, { recursive: true });
const folder = mkdtempSync(path.join(qa, 'workbench-ui-'));
const { createDataService } = require('../electron/data-service.cjs'), { createStrategyService } = require('../electron/strategy-service.cjs');
const { createTeamService } = require('../electron/team-service.cjs'), { createUserStore } = require('../electron/user-store.cjs');
const data = createDataService(path.join(root, 'data/pokedex.sqlite')), strategies = createStrategyService(data, path.join(folder, 'strategy-cache'));
const teams = createTeamService(strategies, path.join(folder, 'team-cache'), undefined, { providers: [] }), store = createUserStore(folder);
const fixture = require('../tests/fixtures/teams.json'), source = teams.model.normalize(fixture, 'gen9ou', '').teams[0];
store.savePlans(source.members.map(member => strategies.validatePersonal({ ...member, id: 'new', title: '工作台' + member.title }, 27)));
const originalPlans = store.get().plans;
const charizard = strategies.import('Charizard @ Heavy-Duty Boots\nAbility: Blaze\nTimid Nature\nEVs: 252 SpA / 4 SpD / 252 Spe\nIVs: 0 Atk\n- Flamethrower\n- Air Slash\n- Roost\n- Dragon Pulse', 9)[0];
store.savePlan(strategies.validatePersonal({ ...charizard, title: '喷火龙替补方案' }, 27));
const replacement = store.get().plans[0];
store.progress(originalPlans[0].id, 'item', true); store.favorite(25); store.note(25, '工作台改版前的笔记');
store.settings({ versionId: 27, uiScale: 125, theme: 'light', shortcut: 'Ctrl+Alt+Shift+F5' });
writeFileSync(path.join(folder, 'team-cache', 'index.json'), JSON.stringify({ schemaVersion: 1, key: 'index', fetchedAt: new Date().toISOString(), data: { gen9ou: [1, 1], gen9doublesou: [1, 1] } }));
data.close();
const env = { ...process.env, POKEDEX_USER_DATA: folder, POKEDEX_TEST: '1', POKEDEX_HEADLESS: '1', POKEDEX_TEAM_SOURCES: 'samples' };
delete env.ELECTRON_RUN_AS_NODE; delete env.POKEDEX_DEV_URL;
let desktop, page, teamId, branchId, reorderedIds;
const errors = [], checks = [];
const dialog = () => page.getByRole('dialog', { name: '队伍工作台' });
const state = () => page.evaluate(() => window.pokedex.user('get'));
async function launch() {
  desktop = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env, timeout: 45000 });
  page = await desktop.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.pokemon-panel h1', { state: 'attached', timeout: 45000 });
  await page.getByRole('button', { name: '我的培养', exact: true }).click();
}
async function check(name, action) { await action(); checks.push(name); console.log('PASS ' + name); }
async function capture(name) {
  const screenshot = () => desktop.evaluate(async ({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(value => value.webContents.getURL() === url);
    return (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64');
  }, page.url());
  await screenshot(); await page.waitForTimeout(150); await screenshot(); await page.waitForTimeout(150);
  writeFileSync(path.join(qa, name + '.png'), Buffer.from(await screenshot(), 'base64'));
}
try {
  await launch();
  await check('从已有单只方案选择六人，保存前显示体检与配速，预览不写个人资料', async () => {
    await page.getByRole('button', { name: '新建队伍', exact: true }).click();
    await dialog().getByLabel('工作台队伍名称').fill('我的自由组队');
    for (let index = 0; index < 6; index++) await dialog().getByLabel('工作台成员' + (index + 1), { exact: true }).selectOption('plan:' + originalPlans[index].id);
    await expect(dialog().getByRole('button', { name: '保存队伍', exact: true })).toBeEnabled();
    await expect(dialog().locator('.team-health-report')).toBeVisible();
    expect((await state()).teams).toHaveLength(0); expect((await state()).plans).toHaveLength(7);
    await dialog().getByRole('button', { name: '能力实数与速度', exact: true }).click();
    await expect(dialog().locator('.team-speed-table tbody tr')).toHaveCount(6);
    await capture('workbench-preview');
    await dialog().getByRole('button', { name: '保存队伍', exact: true }).click();
    await expect(dialog()).not.toBeVisible(); await expect(page.locator('.team-detail-heading h1')).toHaveText('我的自由组队');
    const saved = await state(); teamId = saved.teams[0].id;
    expect(saved.plans).toHaveLength(7); expect(saved.teams[0].members.map(member => member.id)).toEqual(originalPlans.map(plan => plan.id));
    expect(saved.teams[0].members[0].progress.item).toBe(true);
  });
  await check('调整成员顺序后编号、0个体值与进度保留，体检使用新顺序', async () => {
    await page.getByRole('button', { name: '调整成员', exact: true }).click();
    await dialog().getByRole('button', { name: '下移第1位成员', exact: true }).click();
    await expect(dialog().getByLabel('工作台成员1', { exact: true })).toHaveValue('member:' + originalPlans[1].id);
    await expect(dialog().getByRole('button', { name: '保存队伍', exact: true })).toBeEnabled();
    await dialog().getByRole('button', { name: '保存队伍', exact: true }).click(); await expect(dialog()).not.toBeVisible();
    const saved = await state(); reorderedIds = saved.teams[0].members.map(member => member.id);
    expect(reorderedIds.slice(0, 2)).toEqual([originalPlans[1].id, originalPlans[0].id]);
    expect(saved.teams[0].members[1].selection.ivs.atk).toBe(0); expect(saved.teams[0].members[1].progress.item).toBe(true);
  });
  await check('替换宝可梦后防御与速度预览更新，原成员保留为独立培养方案', async () => {
    await page.getByRole('button', { name: '调整成员', exact: true }).click();
    await dialog().getByLabel('搜索工作台培养方案').fill('pen huo long');
    await dialog().getByLabel('工作台成员1', { exact: true }).selectOption('plan:' + replacement.id);
    await dialog().getByLabel('搜索工作台培养方案').fill('');
    await expect(dialog().getByRole('button', { name: '保存队伍', exact: true })).toBeEnabled();
    await expect(dialog().locator('.team-defense-table thead')).toContainText('喷火龙');
    await dialog().getByRole('button', { name: '能力实数与速度', exact: true }).click();
    await expect(dialog().locator('.team-speed-table')).toContainText('喷火龙');
    await dialog().getByRole('button', { name: '保存队伍', exact: true }).click(); await expect(dialog()).not.toBeVisible();
    const saved = await state(); expect(saved.plans).toHaveLength(7);
    expect(saved.teams[0].members[0].id).toBe(replacement.id);
    expect(saved.plans.find(plan => plan.id === reorderedIds[0]).teamId).toBeUndefined();
    reorderedIds = saved.teams[0].members.map(member => member.id);
  });
  await check('同一方案重复选择不能保存，关闭未保存工作台不修改已存在的队伍', async () => {
    const before = await state();
    await page.getByRole('button', { name: '调整成员', exact: true }).click();
    await dialog().getByLabel('工作台成员2', { exact: true }).selectOption('member:' + replacement.id);
    await expect(dialog().locator('.build-errors')).toContainText('重复选择');
    await expect(dialog().getByRole('button', { name: '保存队伍', exact: true })).toBeDisabled();
    await dialog().getByRole('button', { name: '取消', exact: true }).click();
    expect(await state()).toEqual(before);
  });
  await check('复制整队建立独立分支，配置相同、进度清零，原队保留', async () => {
    const before = await state();
    await page.getByRole('button', { name: '复制队伍', exact: true }).click();
    await dialog().getByLabel('工作台队伍名称').fill('我的队伍第二路线');
    await expect(dialog().getByRole('button', { name: '保存队伍', exact: true })).toBeEnabled();
    await dialog().getByRole('button', { name: '保存队伍', exact: true }).click(); await expect(dialog()).not.toBeVisible();
    const saved = await state(); expect(saved.teams).toHaveLength(2); expect(saved.plans).toHaveLength(13);
    branchId = saved.teams[0].id; expect(branchId).not.toBe(teamId);
    expect(saved.teams[0].members.every(member => !reorderedIds.includes(member.id))).toBe(true);
    expect(saved.teams[0].members.every(member => Object.keys(member.progress).length === 0)).toBe(true);
    expect(saved.teams.find(team => team.id === teamId)).toEqual(before.teams[0]);
  });
  await check('200%深色缩放下工作台六个位置、预览与保存按钮可用，页面无横向溢出', async () => {
    await page.evaluate(() => window.pokedex.user('settings', { theme: 'dark', uiScale: 200 }));
    await page.getByRole('button', { name: '调整成员', exact: true }).click();
    await expect(dialog().locator('.workbench-slot')).toHaveCount(6);
    await expect(dialog().getByRole('button', { name: '保存队伍', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const bounds = await dialog().boundingBox(), viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
    await capture('workbench-large-dark-preview');
    await dialog().getByRole('button', { name: '取消', exact: true }).click();
  });
  await check('工作台队伍与独立替补重启后完整保留，导出仍保留六人顺序', async () => {
    await desktop.close(); desktop = null; await launch();
    await page.waitForSelector('.team-card');
    const saved = await state(); expect(saved.teams).toHaveLength(2); expect(saved.plans).toHaveLength(13);
    expect(saved.teams.find(team => team.id === teamId).members.map(member => member.id)).toEqual(reorderedIds);
    expect(saved.teams.some(team => team.id === branchId)).toBe(true);
    expect(saved.favorites).toEqual([25]); expect(saved.notes[25]).toBe('工作台改版前的笔记');
    const text = await page.evaluate(async id => window.pokedex.team('export', { team: (await window.pokedex.team('personal')).find(team => team.id === id), copy: false }), teamId);
    expect(text.split(/\n\s*\n/)).toHaveLength(6); expect(text.split('\n')[0]).toContain('Charizard');
  });
  expect(errors).toEqual([]);
  writeFileSync(path.join(qa, 'workbench-ui-report.json'), JSON.stringify({ checks, rendererErrors: errors, userDirectory: folder }, null, 2));
  console.log('完成 ' + checks.length + ' 项工作台桌面验证。');
} catch (error) { if (desktop) await capture('workbench-failure').catch(() => {}); console.error(error); process.exitCode = 1; }
finally { if (desktop) await desktop.close(); }
