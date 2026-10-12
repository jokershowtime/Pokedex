import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const qa = path.join(root, '.qa'); mkdirSync(qa, { recursive: true });
const folder = mkdtempSync(path.join(qa, 'cultivation-ui-'));
const { createDataService } = require('../electron/data-service.cjs'), { createStrategyService } = require('../electron/strategy-service.cjs');
const { createTeamService } = require('../electron/team-service.cjs'), { createUserStore } = require('../electron/user-store.cjs');
const data = createDataService(path.join(root, 'data/pokedex.sqlite'));
const strategies = createStrategyService(data, path.join(folder, 'strategy-cache'));
const teams = createTeamService(strategies, path.join(folder, 'team-cache'), undefined, { providers: [] });
const fixture = require('../tests/fixtures/teams.json'), store = createUserStore(folder);
const base = teams.model.normalize(fixture, 'gen9ou', '').teams[0];
store.savePlan(strategies.validatePersonal({ ...base.members[0], id: 'new', title: '独立大嘴鸥路线', teamId: undefined }, 27));
store.favorite(25); store.note(25, '培养视图改版前的笔记'); store.settings({ versionId: 27, uiScale: 125, theme: 'light', shortcut: 'Ctrl+Alt+Shift+F6' });
for (const [key, payload] of [['index', { gen9ou: [1, 1] }], ['gen9ou', fixture]]) {
  writeFileSync(path.join(folder, 'team-cache', key + '.json'), JSON.stringify({ schemaVersion: 1, key, fetchedAt: new Date().toISOString(), data: payload }));
}
data.close();
const env = { ...process.env, POKEDEX_USER_DATA: folder, POKEDEX_TEST: '1', POKEDEX_HEADLESS: '1', POKEDEX_TEAM_SOURCES: 'samples' };
delete env.ELECTRON_RUN_AS_NODE; delete env.POKEDEX_DEV_URL;
let desktop, page, teamId, memberId, savedPlanIds, changedMember;
const errors = [], checks = [];
async function launch() {
  desktop = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env, timeout: 45000 });
  page = await desktop.firstWindow(); page.setDefaultTimeout(18000); page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.pokemon-panel h1', { state: 'attached', timeout: 45000 });
}
async function check(name, action) { await action(); checks.push(name); console.log('PASS ' + name); }
const state = () => page.evaluate(() => window.pokedex.user('get'));
const sourceCard = () => page.locator('.team-card').first();
const singleView = () => page.getByRole('tab', { name: '单只培养', exact: true }).click();
const teamView = () => page.getByRole('tab', { name: '整队培养', exact: true }).click();
async function recommendations() {
  await page.getByRole('button', { name: '队伍推荐', exact: true }).click();
  await page.waitForSelector('.team-card', { timeout: 45000 });
}
async function capture(name) {
  const screenshot = () => desktop.evaluate(async ({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(value => value.webContents.getURL() === url);
    return (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64');
  }, page.url());
  await screenshot(); await page.waitForTimeout(170); await screenshot(); await page.waitForTimeout(150);
  writeFileSync(path.join(qa, name + '.png'), Buffer.from(await screenshot(), 'base64'));
}
try {
  await launch();
  await check('我的培养默认整队视图，单只视图可独立管理；没有队伍也能显示原独立方案', async () => {
    await page.getByRole('button', { name: '我的培养', exact: true }).click();
    await expect(page.getByRole('tab', { name: '整队培养' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.empty-state')).toContainText('还没有收藏');
    await singleView(); await expect(page.locator('.personal-plan-entry')).toHaveCount(1);
    await expect(page.locator('.plan-standalone')).toHaveText('独立方案');
    await page.getByLabel('单只培养所属队伍').selectOption('standalone');
    await expect(page.locator('.personal-plan-entry')).toHaveCount(1);
  });
  await check('收藏后推荐页显示独立的收藏与6/6培养状态，查看培养直接打开整队', async () => {
    await recommendations(); await sourceCard().getByRole('button', { name: '收藏整队', exact: true }).click();
    await expect(sourceCard()).toContainText('已收藏整队');
    await expect(sourceCard().locator('.team-training-status')).toContainText('培养计划 6/6');
    const saved = await state(); expect(saved.teams).toHaveLength(1); expect(saved.plans).toHaveLength(7);
    teamId = saved.teams[0].id; memberId = saved.teams[0].members[0].id; savedPlanIds = saved.teams[0].members.map(member => member.id);
    await sourceCard().getByRole('button', { name: '查看培养', exact: true }).click();
    await expect(page.locator('.cultivation-heading h1')).toHaveText('我的培养');
    await expect(page.locator('.team-member-build')).toHaveCount(6);
  });
  await check('两个视图沿用同一成员计划，修改性格与0个体值、勾选进度在整队同步', async () => {
    await singleView(); await page.getByLabel('单只培养所属队伍').selectOption(teamId);
    await expect(page.locator('.personal-plan-entry')).toHaveCount(6);
    const member = page.locator('.personal-plan-entry').first();
    await expect(member.locator('.plan-team-link')).toContainText('Rain Balance');
    await member.getByRole('button', { name: '编辑', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑培养方案' });
    await editor.getByLabel('培养方案名称').fill('我的大嘴鸥路线');
    await editor.getByLabel('培养方案性格').selectOption('Calm');
    await editor.getByLabel('攻击个体值', { exact: true }).fill('0');
    await editor.getByRole('button', { name: '保存培养方案', exact: true }).click();
    await expect(editor).not.toBeVisible();
    const boxes = member.locator('.cultivation-progress input');
    for (let index = 0; index < await boxes.count(); index++) await boxes.nth(index).check();
    changedMember = (await state()).plans.find(plan => plan.id === memberId);
    expect(changedMember.selection.ivs.atk).toBe(0);
    await member.locator('.plan-team-link').click();
    await expect(page.locator('.team-member-build').first()).toContainText('我的大嘴鸥路线');
    await expect(page.locator('.team-detail > .team-training-status')).toContainText('培养完成 1/6');
    expect((await state()).plans).toHaveLength(7);
  });
  await capture('cultivation-team-preview');
  await check('逐个删除六份培养计划后队伍仍收藏，单只页明确提示，推荐页显示0/6并可管理', async () => {
    await singleView(); await page.getByLabel('单只培养所属队伍').selectOption(teamId);
    for (let index = 0; index < 6; index++) {
      const member = page.locator('.personal-plan-entry').first();
      await member.locator('button.delete-plan').click();
      await expect(member.locator('.strategy-delete-context')).toContainText('队伍收藏');
      await member.getByRole('button', { name: '确认删除', exact: true }).click();
      await expect(page.locator('.personal-plan-entry')).toHaveCount(5 - index);
    }
    await expect(page.locator('.strategy-message')).toContainText('培养计划 0/6');
    const empty = await state(); expect(empty.plans).toHaveLength(1); expect(empty.teams).toHaveLength(1);
    await recommendations();
    await expect(sourceCard().locator('.team-training-status')).toContainText('培养计划 0/6');
    await expect(sourceCard().locator('.team-training-status')).toContainText('培养完成 0/6');
    await expect(sourceCard().getByRole('button', { name: '取消收藏', exact: true })).toBeEnabled();
  });
  await capture('cultivation-source-zero-preview');
  await check('编辑队伍笔记不会复活已删除的六份计划，单成员恢复与整队恢复保留原配置和进度', async () => {
    await sourceCard().getByRole('button', { name: '查看培养', exact: true }).click();
    await page.getByRole('button', { name: '队伍笔记', exact: true }).click();
    const notes = page.getByRole('dialog', { name: '编辑队伍笔记' });
    await notes.getByLabel('队伍打法笔记').fill('先保存作业，之后再培养');
    await notes.getByRole('button', { name: '保存队伍笔记', exact: true }).click();
    await expect(notes).not.toBeVisible(); expect((await state()).plans).toHaveLength(1);
    await page.locator('.team-analysis-disclosure > summary').click();
    await page.getByRole('button', { name: '整队培养清单', exact: true }).click();
    await expect(page.locator('.team-task-total')).toContainText('已完成 0 / 54 项');
    expect(await page.locator('.team-task-grid input').evaluateAll(boxes => boxes.every(box => box.disabled && !box.checked))).toBe(true);
    await page.locator('.team-member-build').first().getByRole('button', { name: '重新加入这位成员' }).click();
    await expect(page.locator('.team-detail > .team-training-status')).toContainText('培养计划 1/6');
    const restored = (await state()).plans.find(plan => plan.id === memberId);
    expect(restored.selection).toEqual(changedMember.selection); expect(restored.progress).toEqual(changedMember.progress);
    await expect(page.locator('.team-task-total')).toContainText('已完成 9 / 54 项');
    await page.locator('.team-detail-actions').getByRole('button', { name: '重新加入培养', exact: true }).click();
    await expect(page.locator('.team-detail > .team-training-status')).toContainText('培养计划 6/6');
    expect((await state()).plans).toHaveLength(7);
  });
  await check('推荐页取消收藏保留七份单只方案，再收藏不会重复六份计划或覆盖改法', async () => {
    await recommendations(); await sourceCard().getByRole('button', { name: '取消收藏', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '管理队伍收藏' });
    await expect(dialog).toContainText('当前有 6 位成员');
    await dialog.getByRole('button', { name: '取消收藏，保留培养方案' }).click();
    await expect(dialog).not.toBeVisible(); await expect(sourceCard().getByRole('button', { name: '收藏整队', exact: true })).toBeEnabled();
    const detached = await state(); expect(detached.teams).toHaveLength(0); expect(detached.plans).toHaveLength(7);
    expect(detached.plans.every(plan => !plan.teamId)).toBe(true);
    await sourceCard().getByRole('button', { name: '收藏整队', exact: true }).click();
    const recollected = await state(); expect(recollected.plans).toHaveLength(7); teamId = recollected.teams[0].id;
    expect(recollected.teams[0].members.map(member => member.id)).toEqual(savedPlanIds);
    expect(recollected.plans.find(plan => plan.id === memberId).selection).toEqual(changedMember.selection);
    expect(recollected.plans.find(plan => plan.id === memberId).progress).toEqual(changedMember.progress);
  });
  await check('200%深色显示下整队与单只列表、收藏管理弹窗可操作且无横向溢出', async () => {
    await page.evaluate(() => window.pokedex.user('settings', { uiScale: 200, theme: 'dark' }));
    await page.getByRole('button', { name: '我的培养', exact: true }).click();
    await page.waitForSelector('.team-card'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await singleView(); await page.waitForSelector('.personal-plan-entry');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await capture('cultivation-single-large-preview');
    await teamView(); await sourceCard().getByRole('button', { name: '取消收藏', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '管理队伍收藏' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await capture('cultivation-removal-large-preview');
    await page.getByRole('button', { name: '关闭队伍收藏管理' }).click();
  });
  await check('重启默认整队培养，原计划编号、所属队伍、修改、进度及旧收藏笔记保持', async () => {
    await desktop.close(); desktop = null; await launch();
    await page.getByRole('button', { name: '我的培养', exact: true }).click();
    await expect(page.getByRole('tab', { name: '整队培养' })).toHaveAttribute('aria-selected', 'true');
    await page.waitForSelector('.team-card'); await expect(sourceCard().locator('.team-training-status')).toContainText('培养计划 6/6');
    const restarted = await state(); expect(restarted.teams[0].id).toBe(teamId);
    expect(restarted.teams[0].members.map(member => member.id)).toEqual(savedPlanIds);
    expect(restarted.plans.find(plan => plan.id === memberId).progress).toEqual(changedMember.progress);
    expect(restarted.notes[25]).toBe('培养视图改版前的笔记'); expect(restarted.favorites).toEqual([25]);
  });
  await check('删除整队及培养方案只移除这六份计划，独立方案仍可在单只视图查看', async () => {
    await sourceCard().getByRole('button', { name: '取消收藏', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '管理队伍收藏' });
    await dialog.getByRole('button', { name: '删除整队及培养方案', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const removed = await state(); expect(removed.teams).toHaveLength(0); expect(removed.plans).toHaveLength(1);
    await singleView(); await page.getByLabel('单只培养所属队伍').selectOption('standalone');
    await expect(page.locator('.personal-plan-entry')).toHaveCount(1); await expect(page.locator('.personal-plan-entry')).toContainText('独立大嘴鸥路线');
    await recommendations(); await expect(sourceCard().getByRole('button', { name: '收藏整队', exact: true })).toBeEnabled();
  });
  expect(errors).toEqual([]);
  writeFileSync(path.join(qa, 'cultivation-ui-report.json'), JSON.stringify({ checks, rendererErrors: errors, userDirectory: folder }, null, 2));
  console.log('完成 ' + checks.length + ' 项培养与收藏桌面验证。');
} catch (error) { if (desktop) await capture('cultivation-failure').catch(() => {}); console.error(error); process.exitCode = 1; }
finally { if (desktop) await desktop.close(); }
