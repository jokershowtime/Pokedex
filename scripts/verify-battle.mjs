import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), qa = path.join(root, '.qa');
mkdirSync(qa, { recursive: true });
const folder = mkdtempSync(path.join(qa, 'battle-ui-user-'));
const { createDataService } = require('../electron/data-service.cjs'), { createStrategyService } = require('../electron/strategy-service.cjs');
const { createTeamService } = require('../electron/team-service.cjs'), { createUserStore } = require('../electron/user-store.cjs');
const data = createDataService(path.join(root, 'data/pokedex.sqlite')), strategies = createStrategyService(data, path.join(folder, 'strategy-cache'));
const teams = createTeamService(strategies, path.join(folder, 'team-cache')), store = createUserStore(folder);
const fixture = require('../tests/fixtures/teams.json'), source = teams.model.normalize(fixture, 'gen9ou', new Date().toISOString()).teams[0];
store.saveTeam(teams.model.validate({ ...source, title: '我的雨天对照队' }, 27));
store.favorite(25); store.note(25, '计算器上线前的笔记'); store.settings({ shortcut: 'Ctrl+Alt+Shift+F10', uiScale: 125 });
data.close();
for (const [key, payload] of [['index', { gen9ou: [2000, 500] }], ['gen9ou', fixture]]) {
  writeFileSync(path.join(folder, 'team-cache', key + '.json'), JSON.stringify({ schemaVersion: 1, key, fetchedAt: new Date().toISOString(), data: payload }));
}
const env = { ...process.env, POKEDEX_USER_DATA: folder, POKEDEX_TEST: '1', POKEDEX_HEADLESS: '1', POKEDEX_TEAM_SOURCES: 'samples' };
delete env.ELECTRON_RUN_AS_NODE; delete env.POKEDEX_DEV_URL;
const errors = [], checks = []; let desktop, page, originalPlans;
async function capture(name) {
  const screenshot = () => desktop.evaluate(async ({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(value => value.webContents.getURL() === url);
    return (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64');
  }, page.url());
  await screenshot(); await page.waitForTimeout(150); await screenshot(); await page.waitForTimeout(150);
  writeFileSync(path.join(qa, name + '.png'), Buffer.from(await screenshot(), 'base64'));
}
async function check(name, action) { await action(); checks.push(name); console.log('PASS ' + name); }
try {
  desktop = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env, timeout: 45000 });
  page = await desktop.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.pokemon-panel h1', { timeout: 45000 });
  originalPlans = (await page.evaluate(() => window.pokedex.user('get'))).plans;
  await check('道具图鉴在朱紫、ORAS、BDSP、绿宝石与初代均非空，可直接切换版本并显示引用说明', async () => {
    await page.getByRole('button', { name: '道具图鉴', exact: true }).click(); await page.waitForSelector('.dictionary-row');
    expect(await page.locator('.dictionary-row').count()).toBeGreaterThan(2000);
    await expect(page.locator('.dictionary-scope-note')).toContainText('第 9 世代');
    for (const [id, minimum] of [[16, 700], [23, 1500], [6, 300], [2, 100]]) {
      await page.getByLabel('道具图鉴资料版本').selectOption(String(id));
      await expect(page.locator('.dictionary-scope-note')).toContainText('第 ' + ({16:6,23:8,6:3,2:1})[id] + ' 世代');
      await page.waitForFunction(min => document.querySelectorAll('.dictionary-row').length > min, minimum);
    }
  });
  await capture('items-fixed-preview');
  await check('能力值、性格、个体值、等级与速度条件即时联动，原培养方案不被修改', async () => {
    await page.getByRole('button', { name: '对战计算器', exact: true }).click();
    await page.getByLabel('计算世代', { exact: true }).selectOption('9');
    await page.waitForSelector('.battle-stat-grid');
    await page.getByLabel('左侧速度努力值', { exact: true }).fill('252');
    await page.getByLabel('左侧性格', { exact: true }).selectOption('Timid');
    await expect(page.locator('.fighter-editor').first().locator('.battle-speed-number strong')).toHaveText('167');
    await page.getByLabel('左侧等级', { exact: true }).fill('100');
    await expect(page.locator('.fighter-editor').first().locator('.battle-speed-number strong')).toHaveText('328');
    await page.getByLabel('左侧攻击个体值', { exact: true }).fill('0'); await page.getByLabel('左侧道具', { exact: true }).selectOption('Choice Scarf');
    await expect(page.locator('.fighter-editor').first().locator('.battle-speed-number strong')).toHaveText('492');
    await page.locator('.fighter-editor').first().locator('.fighter-advanced summary').click(); await page.getByLabel('左侧己方顺风', { exact: true }).check();
    await expect(page.locator('.fighter-editor').first().locator('.battle-speed-number strong')).toHaveText('984');
    expect((await page.evaluate(() => window.pokedex.user('get'))).plans).toEqual(originalPlans);
  });
  await capture('battle-stats-preview');
  await check('伤害计算显示实际范围与击倒概率，天气、残血和超额努力值均有正确反馈', async () => {
    await page.getByLabel('左侧等级', { exact: true }).fill('50'); await page.getByLabel('左侧性格', { exact: true }).selectOption('Serious');
    await page.getByLabel('左侧速度努力值', { exact: true }).fill('0'); await page.getByLabel('左侧道具', { exact: true }).selectOption('');
    await page.getByLabel('左侧己方顺风', { exact: true }).uncheck();
    await page.getByLabel('左侧第1招式', { exact: true }).selectOption('Flamethrower');
    for (const index of [2,3,4]) await page.getByLabel('左侧第' + index + '招式', { exact: true }).selectOption('');
    await page.getByRole('button', { name: '伤害计算', exact: true }).click(); await expect(page.locator('.damage-range strong')).toHaveText('110～132');
    await page.getByLabel('计算天气', { exact: true }).selectOption('Sun'); await expect(page.locator('.damage-range strong')).not.toHaveText('110～132');
    await page.locator('.fighter-editor').nth(1).locator('.fighter-advanced summary').click();
    await page.getByLabel('右侧当前HP百分比', { exact: true }).fill('50'); await expect(page.locator('.damage-result')).toContainText('100%');
    await page.getByLabel('左侧HP努力值', { exact: true }).fill('252'); await page.getByLabel('左侧攻击努力值', { exact: true }).fill('252'); await page.getByLabel('左侧防御努力值', { exact: true }).fill('252');
    await expect(page.locator('.build-errors')).toContainText('510'); await expect(page.locator('.damage-result')).toHaveCount(0);
    await page.getByLabel('带入我的培养方案', { exact: true }).selectOption(originalPlans[0].id);
    await expect(page.locator('.fighter-editor')).toHaveCount(2); await expect(page.locator('.build-errors')).toHaveCount(0);
    await page.waitForSelector('.damage-result'); expect((await page.evaluate(() => window.pokedex.user('get'))).plans).toEqual(originalPlans);
    await page.getByLabel('带入对手培养方案', { exact: true }).selectOption(originalPlans[1].id);
    await expect(page.getByLabel('带入我的培养方案', { exact: true })).toHaveValue(originalPlans[0].id);
    await expect(page.getByLabel('带入对手培养方案', { exact: true })).toHaveValue(originalPlans[1].id);
    await expect(page.locator('.fighter-editor')).toHaveCount(2);
  });
  await capture('battle-damage-preview');
  await check('队伍体检显示完整防御矩阵与打击面；实数等级、顺风和参照对手可比较', async () => {
    await page.evaluate(() => window.pokedex.user('settings', { versionId: 27 }));
    await page.getByRole('button', { name: '队伍推荐', exact: true }).click(); await page.getByRole('button', { name: /^我的队伍/ }).click();
    await page.getByRole('button', { name: '查看整队配置' }).click(); await page.locator('.team-analysis-disclosure > summary').click();
    await expect(page.locator('.team-defense-table tbody tr')).toHaveCount(18); await expect(page.locator('.team-offense-grid details')).toHaveCount(18);
    await page.getByRole('button', { name: '能力实数与速度', exact: true }).click(); await page.getByLabel('队伍计算等级').selectOption('50');
    await expect(page.locator('.team-speed-table tbody tr')).toHaveCount(6);
    const fish = page.locator('.team-speed-table tbody tr').filter({ hasText: '戽斗尖梭' });
    await expect(fish.locator('.final-speed')).toHaveText('376'); await page.getByLabel('戽斗尖梭顺风', { exact: true }).check(); await expect(fish.locator('.final-speed')).toHaveText('752');
    await page.getByLabel('队伍速度参照宝可梦').selectOption('6:Charizard'); await expect(page.locator('.team-counter-picker')).toContainText('120');
  });
  await capture('team-analysis-preview');
  await check('整队培养清单与成员进度同步；一键把配招、配速和场地带入伤害计算', async () => {
    await page.getByRole('button', { name: '整队培养清单', exact: true }).click();
    await expect(page.locator('.team-task-grid article')).toHaveCount(6); await page.getByLabel('大嘴鸥道具培养完成', { exact: true }).check();
    await expect(page.locator('.team-task-total')).toContainText('已完成 1 /');
    await page.getByRole('button', { name: '能力实数与速度', exact: true }).click(); await page.getByLabel('计算戽斗尖梭的伤害', { exact: true }).click();
    await expect(page.locator('.battle-page')).toBeVisible(); await expect(page.getByLabel('计算天气')).toHaveValue('Rain');
    await expect(page.locator('.fighter-editor').first().locator('.battle-speed-number strong')).toHaveText('752');
    const state = await page.evaluate(() => window.pokedex.user('get')); expect(state.plans[0].progress.item).toBe(true);
    expect(state.plans[0].selection.ivs.atk).toBe(0); expect(state.teams[0].members[0].progress.item).toBe(true);
  });
  await check('深色主题与175%缩放下计算器能操作，页面不出现外部横向溢出', async () => {
    await page.evaluate(() => window.pokedex.user('settings', { theme: 'dark', uiScale: 175 }));
    await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: '伤害计算', exact: true }).click(); await page.waitForSelector('.damage-result'); await capture('battle-large-dark-preview');
  });
  await check('备份通过预览与令牌恢复，保留当前数据副本及本机显示设置；设置入口可见', async () => {
    await page.getByRole('button', { name: '设置', exact: true }).click(); await expect(page.locator('.backup-card')).toBeVisible();
    await expect(page.getByRole('button', { name: '导出个人资料备份', exact: true })).toBeVisible();
    const file = path.join(folder, 'roundtrip.json');
    const result = await page.evaluate(async filePath => {
      const before = await window.pokedex.user('get');
      await window.pokedex.backup('export', { path: filePath });
      await window.pokedex.user('note', { id: 25, text: '恢复前的新笔记' });
      const preview = await window.pokedex.backup('preview', { path: filePath });
      const restored = await window.pokedex.backup('restore', { token: preview.token });
      const after = await window.pokedex.user('get');
      return { before, after, preview, restored };
    }, file);
    expect(result.preview.summary.teams).toBe(1); expect(result.preview.summary.plans).toBe(6);
    expect(result.after.notes[25]).toBe(result.before.notes[25]); expect(result.after.settings).toEqual(result.before.settings);
    expect(result.after.plans[0].progress.item).toBe(true); expect(existsSync(result.restored.recovery)).toBe(true);
    await capture('backup-settings-preview');
  });
  expect(errors).toEqual([]); writeFileSync(path.join(qa, 'battle-ui-report.json'), JSON.stringify({ checks, rendererErrors: errors, userDirectory: folder }, null, 2));
  console.log('完成 ' + checks.length + ' 项计算与道具桌面验证。');
} catch (failure) { if (desktop) await capture('battle-failure').catch(() => {}); console.error(failure); process.exitCode = 1; }
finally { if (desktop) await desktop.close(); }
