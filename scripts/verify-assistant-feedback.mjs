import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url), root = path.resolve(import.meta.dirname, '..'), qa = path.join(root, '.qa');
mkdirSync(qa, { recursive: true }); const directory = mkdtempSync(path.join(qa, 'assistant-feedback-'));
const { createUserStore } = require('../electron/user-store.cjs');
createUserStore(directory).settings({ versionId: 27, uiScale: 125, theme: 'light', shortcut: 'Ctrl+Alt+Shift+F7' });
mkdirSync(path.join(directory, 'strategy-cache'));
const realCache = path.join(qa, 'strategy-ui-user/strategy-cache/gen9.json');
if (!existsSync(realCache)) throw new Error('请先准备第九世代公开配招缓存，再运行本次真实资料界面验证。');
copyFileSync(realCache, path.join(directory, 'strategy-cache/gen9.json'));
const env = { ...process.env, POKEDEX_USER_DATA: directory, POKEDEX_TEST: '1', POKEDEX_HEADLESS: '1', POKEDEX_TEAM_SOURCES: 'samples' };
delete env.ELECTRON_RUN_AS_NODE; delete env.POKEDEX_DEV_URL;
let desktop, page; const checks = [], errors = [], runs = [];
const selectedChecks = process.argv.find(value => value.startsWith('--only='))?.slice(7).split(',');
if (selectedChecks?.some(value => !['presets', 'conflicts', 'preview', 'targeting'].includes(value))) throw new Error('--only 可选择 presets、conflicts、preview、targeting。');
async function capture(name) {
  const screenshot = () => desktop.evaluate(async ({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url);
    return (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64');
  }, page.url());
  await screenshot(); await page.waitForTimeout(150); await screenshot(); await page.waitForTimeout(150);
  writeFileSync(path.join(qa, name + '.png'), Buffer.from(await screenshot(), 'base64'));
}
const state = () => page.evaluate(() => window.pokedex.user('get'));
const status = () => page.evaluate(() => window.pokedex.team('assistant-status'));
async function check(id, name, action) { if (selectedChecks && !selectedChecks.includes(id)) return; await action(); checks.push(name); console.log('PASS ' + name); }
try {
  desktop = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env, timeout: 45000 });
  page = await desktop.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.pokemon-panel h1', { state: 'attached', timeout: 45000 });
  await page.getByRole('button', { name: '阵容助手', exact: true }).click();
  await expect(page.getByRole('button', { name: '计算队伍', exact: true })).toBeEnabled();
  await check('presets', '条件模板保存、应用、更新与删除，只保存手动设置的条件', async () => {
    await page.getByLabel('助手世代').selectOption('9');
    await page.getByLabel('返回队伍数量', { exact: true }).selectOption('10');
    await page.getByLabel('条件模板名称').fill('验收模板');
    await page.getByRole('button', { name: '保存为新模板', exact: true }).click();
    await expect(page.locator('.assistant-presets')).toContainText('已保存条件模板');
    expect((await state()).assistantPresets).toHaveLength(1);
    await page.getByRole('button', { name: '重置条件', exact: true }).click();
    await page.getByRole('button', { name: '应用模板', exact: true }).click();
    await expect(page.getByLabel('助手世代')).toHaveValue('9');
    await expect(page.getByLabel('返回队伍数量', { exact: true })).toHaveValue('10');
    await page.getByLabel('返回队伍数量', { exact: true }).selectOption('5');
    await page.getByRole('button', { name: '更新所选模板', exact: true }).click();
    await expect.poll(async () => (await state()).assistantPresets[0].conditions.resultCount).toBe(5);
    await page.getByRole('button', { name: '删除所选模板', exact: true }).click();
    await expect.poll(async () => (await state()).assistantPresets.length).toBe(0);
  });
  await check('conflicts', '属性互斥时直接指出冲突条件与调整建议，无需展开搜索', async () => {
    await page.getByText('成员属性条件', { exact: true }).click();
    await page.getByLabel('必须有对应属性成员·水', { exact: true }).check();
    await page.getByLabel('排除对应属性成员·水', { exact: true }).check();
    await page.getByRole('button', { name: '计算队伍', exact: true }).click();
    await expect(page.locator('.assistant-status.complete')).toBeVisible();
    await expect(page.getByRole('region', { name: '条件冲突与资料诊断' })).toContainText('水属性成员要求互相冲突');
    await expect(page.locator('.assistant-diagnostics')).toContainText('取消其中一项属性条件');
    const run = await status(); expect(run.examined).toBe(0); expect(run.strategy).toBe('checks');
    await capture('assistant-condition-conflict');
    await page.getByRole('button', { name: '返回调整条件', exact: true }).click();
  });
  await check('preview', '200%界面可预览已验证六人队伍，取消清空预览，完成后展示正式结果', async () => {
    await page.getByRole('button', { name: '重置条件', exact: true }).click();
    await page.getByLabel('助手世代').selectOption('9');
    await page.getByLabel('返回队伍数量', { exact: true }).selectOption('50');
    await page.evaluate(() => window.pokedex.user('settings', { uiScale: 200, theme: 'dark' }));
    await page.getByRole('button', { name: '计算队伍', exact: true }).click();
    await expect(page.locator('.assistant-live-preview')).toBeVisible({ timeout: 30000 });
    const previewed = await status(); expect(previewed.state).toBe('running'); expect(previewed.previews.length).toBeGreaterThan(0);
    expect(previewed.previews.length).toBeLessThanOrEqual(3); expect(previewed.results).toHaveLength(0);
    for (const row of previewed.previews) expect(row.members).toHaveLength(6);
    await page.locator('.assistant-live-preview').evaluate(element => {
      const parent = element.closest('.assistant-page'); parent.scrollTo({ top: parent.scrollTop + element.getBoundingClientRect().top - parent.getBoundingClientRect().top });
    });
    await capture('assistant-live-preview-large');
    expect(await page.locator('.assistant-page').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(2);
    await expect(page.getByRole('button', { name: '保存到我的培养', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '取消预览中的计算', exact: true }).click();
    await expect(page.locator('.assistant-status.cancelled')).toBeVisible();
    await expect(page.locator('.assistant-live-preview')).toHaveCount(0);
    expect((await status()).previews).toHaveLength(0); expect((await state()).teams).toHaveLength(0);
    await page.evaluate(() => window.pokedex.user('settings', { uiScale: 125, theme: 'light' }));
    await page.getByLabel('返回队伍数量', { exact: true }).selectOption('5');
    await page.getByRole('button', { name: '计算队伍', exact: true }).click();
    await expect(page.locator('.assistant-status.complete')).toBeVisible({ timeout: 30000 });
    const complete = await status(); runs.push({ elapsedMs: complete.elapsedMs, searchMs: complete.searchMs, prepared: complete.prepared, revisions: complete.previewRevision });
    expect(complete.results).toHaveLength(5); expect(complete.previews).toHaveLength(0);
    await expect(page.getByRole('button', { name: '保存到我的培养', exact: true })).toBeEnabled();
  });
  await check('targeting', '战况、手动配招与同物种多路线生效，异步伤害可取消，模板与笔记保留信息，大字号可用', async () => {
    await page.getByRole('button', { name: '重置条件', exact: true }).click();
    await page.getByLabel('助手世代').selectOption('9');
    await page.getByLabel('返回队伍数量', { exact: true }).selectOption('5');
    await page.getByLabel('必须具备轮转中转', { exact: true }).check();
    await page.getByLabel('至少几位具备轮转中转', { exact: true }).selectOption('2');
    await page.getByLabel('必须具备回复续航', { exact: true }).check();
    await page.getByLabel('至少几位具备回复续航', { exact: true }).selectOption('2');
    const references = await page.evaluate(() => window.pokedex.strategy('references'));
    const rotomId = references.pokemon.find(value => value.identifier === 'rotom-wash' || value.english === 'Rotom-Wash').id;
    for (const id of [445, rotomId]) {
      await page.getByLabel('搜索需要应对的宝可梦', { exact: true }).fill(String(id));
      await page.getByLabel('添加需要应对的宝可梦', { exact: true }).selectOption(String(id));
    }
    await page.getByLabel('对手' + rotomId + '路线2战况先手人数', { exact: true }).selectOption('1');
    await page.getByLabel('助手战况天气').selectOption('Rain');
    await page.getByLabel('助手战况场地').selectOption('Electric');
    await page.getByLabel('助手战况戏法空间').check();
    await page.getByText('我方统一状态', { exact: true }).click();
    await page.getByLabel('我方顺风', { exact: true }).check();
    await page.getByLabel('我方HP百分比', { exact: true }).fill('80');
    await page.getByLabel('我方光墙', { exact: true }).check();
    await page.getByLabel('对手445参考配招', { exact: true }).selectOption('manual');
    const specific = page.getByLabel('对手445选择具体配招', { exact: true });
    await expect(specific).toBeEnabled();
    await expect.poll(() => specific.locator('option:not(:disabled)').count()).toBeGreaterThan(1);
    const choice = await specific.locator('option:not(:disabled)').evaluateAll(options => options.find(option => option.value !== '').value);
    await specific.selectOption(choice);
    await expect(page.locator('.assistant-manual-reference')).toContainText('已指定');
    await page.locator('.assistant-opponent-condition').first().getByRole('button', { name: '添加另一条路线', exact: true }).click();
    await expect(page.locator('.assistant-opponent-condition')).toHaveCount(3);
    await page.locator('.assistant-opponent-condition').last().getByRole('button', { name: /移除路线/ }).click();
    await page.getByText('粘贴导入对手配招', { exact: true }).click();
    await page.getByLabel('对手配招导入文本').fill('Garchomp @ Choice Scarf\nAbility: Rough Skin\nEVs: 252 Atk / 4 SpD / 252 Spe\nJolly Nature\n- Earthquake\n- Dragon Claw\n- Rock Slide\n- Swords Dance');
    await page.getByRole('button', { name: '加入对手路线', exact: true }).click();
    await expect(page.locator('.assistant-opponent-condition')).toHaveCount(3);
    await page.getByLabel('条件模板名称').fill('指定对手验收');
    await page.getByRole('button', { name: '保存为新模板', exact: true }).click();
    await expect(page.locator('.assistant-presets')).toContainText('已保存条件模板');
    await page.getByRole('button', { name: '重置条件', exact: true }).click();
    await page.getByRole('button', { name: '应用模板', exact: true }).click();
    await expect(page.getByLabel('至少几位具备轮转中转', { exact: true })).toHaveValue('2');
    await expect(page.locator('.assistant-opponent-condition')).toHaveCount(3);
    await expect(page.getByLabel('助手战况天气')).toHaveValue('Rain');
    await expect(page.getByLabel('助手战况戏法空间')).toBeChecked();
    await page.getByRole('button', { name: '计算队伍', exact: true }).click();
    await expect(page.locator('.assistant-status.complete')).toBeVisible({ timeout: 45000 });
    const complete = await status();
    expect(complete.results.length).toBeGreaterThan(0); expect(complete.opponents).toHaveLength(3);
    expect(complete.opponents[0].method).toBe('manual');
    expect(complete.opponents[2].reference.selection.item).toBe('Choice Scarf');
    expect(new Set(complete.opponents.map(opponent => opponent.targetId)).size).toBe(3);
    for (const result of complete.results) {
      expect(result.assessment.roles.find(value => value.id === 'pivot').count).toBeGreaterThanOrEqual(2);
      expect(result.assessment.roles.find(value => value.id === 'recovery').count).toBeGreaterThanOrEqual(2);
      for (const row of result.opponentMatchups) expect(row.attackers.length).toBeGreaterThanOrEqual(1);
      expect(result.opponentMatchups.find(row => row.pokemonId === rotomId).faster.length).toBeGreaterThanOrEqual(1);
      expect(result.plan.opening.length).toBeGreaterThan(0);
    }
    runs.push({ elapsedMs: complete.elapsedMs, prepareMs: complete.prepareMs, searchMs: complete.searchMs, prepared: complete.prepared, opponents: 3 });
    // Cancellation must keep completed rosters and share the global job lock.
    const cancelled = await page.evaluate(async runId => {
      await window.pokedex.team('assistant-inspect', { runId, index: 0 });
      let blocked = false;
      try { await window.pokedex.team('assistant-start', { scopeGeneration: 9 }); } catch { blocked = true; }
      const status = await window.pokedex.team('assistant-cancel', { runId });
      return { blocked, state: status.state, inspection: status.inspection.state, teams: status.results.length };
    }, complete.runId);
    expect(cancelled).toEqual({ blocked: true, state: 'complete', inspection: 'cancelled', teams: complete.results.length });
    await page.getByRole('button', { name: '检查本队伤害', exact: true }).click();
    await expect.poll(async () => (await status()).inspection?.state, { timeout: 30000 }).toBe('complete');
    await expect(page.getByRole('region', { name: '伤害与承伤核对' })).toContainText('检查完成');
    const inspected = (await status()).inspection;
    expect(inspected.report.rows).toHaveLength(18); expect(inspected.processed).toBe(inspected.total);
    runs[0].inspectionMs = inspected.elapsedMs;
    await page.getByLabel('伤害核对对手路线').selectOption(complete.opponents[2].targetId);
    await expect(page.locator('.assistant-damage-detail')).toContainText('战况');
    await expect(page.getByRole('region', { name: '指定对手应对核对' })).toBeVisible();
    await expect(page.getByRole('region', { name: '队伍打法参考' })).toContainText('轮转与续航');
    await page.evaluate(() => window.pokedex.user('settings', { uiScale: 200, theme: 'dark' }));
    await page.locator('.assistant-opponent-checks').evaluate(element => {
      const parent = element.closest('.assistant-page'); parent.scrollTo({ top: parent.scrollTop + element.getBoundingClientRect().top - parent.getBoundingClientRect().top });
    });
    await capture('assistant-opponents-large');
    expect(await page.locator('.assistant-page').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(2);
    await page.locator('.assistant-damage').evaluate(element => {
      const parent = element.closest('.assistant-page'); parent.scrollTo({ top: parent.scrollTop + element.getBoundingClientRect().top - parent.getBoundingClientRect().top });
    });
    await capture('assistant-damage-large');
    expect(await page.locator('.assistant-page').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(2);
    await page.locator('.assistant-playbook').evaluate(element => {
      const parent = element.closest('.assistant-page'); parent.scrollTo({ top: parent.scrollTop + element.getBoundingClientRect().top - parent.getBoundingClientRect().top });
    });
    await capture('assistant-playbook-large');
    await page.evaluate(() => window.pokedex.user('settings', { uiScale: 125, theme: 'light' }));
    await page.getByRole('button', { name: '保存到我的培养', exact: true }).click();
    const saved = await state(); expect(saved.teams).toHaveLength(1); expect(saved.plans).toHaveLength(6);
    expect(saved.teams[0].notes).toContain('打法参考'); expect(saved.teams[0].notes).toContain('对手参考配置');
    expect(saved.assistantPresets[0].conditions.roleCounts.pivot).toBe(2); expect(saved.assistantPresets[0].conditions.opponents).toHaveLength(3);
    expect(saved.teams[0].notes).toContain('战况条件'); expect(saved.teams[0].notes).toContain('顺风');
    expect(saved.assistantPresets[0].conditions.scenario.teamState.hpPercent).toBe(80);
    await page.getByRole('button', { name: '阵容助手', exact: true }).click();
    await page.getByRole('button', { name: '重置条件', exact: true }).click();
    await page.getByLabel('助手世代').selectOption('9');
    await page.getByLabel('搜索需要应对的宝可梦', { exact: true }).fill('10');
    await page.getByLabel('添加需要应对的宝可梦', { exact: true }).selectOption('10');
    await page.getByRole('button', { name: '计算队伍', exact: true }).click();
    await expect(page.locator('.assistant-status.complete')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.assistant-diagnostics')).toContainText('对手“绿毛虫”缺少完整的参考配招');
    expect((await status()).issues[0].kind).toBe('data'); expect((await state()).teams).toHaveLength(1);
  });
  expect(errors).toEqual([]);
} catch (error) { if (page) await capture('assistant-feedback-failure').catch(() => {}); errors.push(error.message); throw error; }
finally { writeFileSync(path.join(qa, 'assistant-feedback-ui-report.json'), JSON.stringify({ directory, checks, errors, runs }, null, 2)); await desktop?.close(); }
