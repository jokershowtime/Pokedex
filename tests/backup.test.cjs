const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDataService } = require('../electron/data-service.cjs');
const { createStrategyService } = require('../electron/strategy-service.cjs');
const { createTeamService } = require('../electron/team-service.cjs');
const { createBackupService } = require('../electron/backup-service.cjs');
const { createUserStore } = require('../electron/user-store.cjs');
let data, strategies, teams, backup;
function directory() { const root = path.join(__dirname, '../.qa/backup-tests'); fs.mkdirSync(root, { recursive: true }); return fs.mkdtempSync(path.join(root, 'case-')); }
before(() => {
  data = createDataService(path.join(__dirname, '../data/pokedex.sqlite'));
  const folder = directory(); strategies = createStrategyService(data, path.join(folder, 'strategies'));
  teams = createTeamService(strategies, path.join(folder, 'teams')); backup = createBackupService(data, strategies, teams);
});
after(() => data.close());
function personal() {
  const store = createUserStore(directory());
  const team = teams.model.normalize(require('./fixtures/teams.json'), 'gen9ou', '').teams[0];
  store.saveTeam(teams.model.validate(team, 27)); store.favorite(25); store.note(25, '自己的培养笔记');
  store.progress(store.get().plans[0].id, 'item', true); return store.get();
}
test('备份完整往返保留收藏、笔记、队伍、成员关联、0个体值与培养进度', () => {
  const original = personal(), decoded = backup.decode(backup.encode(original));
  assert.equal(decoded.summary.teams, 1); assert.equal(decoded.summary.plans, 6);
  assert.deepEqual(decoded.state.favorites, [25]); assert.equal(decoded.state.notes[25], '自己的培养笔记');
  assert.equal(decoded.state.plans[0].selection.ivs.atk, 0); assert.equal(decoded.state.plans[0].progress.item, true);
  assert.equal(decoded.state.teams[0].members[0].id, decoded.state.plans[0].id);
  assert.equal(decoded.state.teams[0].members[0].teamId, decoded.state.teams[0].id);
});
test('恢复先保存当前数据副本，重启仍保留恢复内容与本机显示、版本和快捷键设置', () => {
  const folder = directory(), store = createUserStore(folder);
  store.favorite(6); store.note(6, '恢复前的资料'); store.settings({ uiScale: 175, theme: 'dark', versionId: 6, shortcut: 'F10' });
  const before = store.get(), result = store.restorePersonal(backup.decode(backup.encode(personal())).state);
  assert.deepEqual(JSON.parse(fs.readFileSync(result.recovery, 'utf8')), before);
  const after = createUserStore(folder).get();
  assert.deepEqual(after.settings, before.settings); assert.deepEqual(after.favorites, [25]); assert.equal(after.plans.length, 6);
  assert.equal(after.teams[0].members[0].progress.item, true);
});
test('损坏备份、超额努力值、重复方案和错误队伍关联在预览时被拒绝，不修改个人资料', () => {
  const state = personal(), document = JSON.parse(backup.encode(state));
  assert.throws(() => backup.decode('{broken'), /JSON/); assert.throws(() => backup.decode(JSON.stringify(state)), /本图鉴/);
  const badStats = structuredClone(document); badStats.data.plans[0].selection.evs.atk = 252;
  assert.throws(() => backup.decode(JSON.stringify(badStats)), /510/);
  const duplicate = structuredClone(document); duplicate.data.plans.push(duplicate.data.plans[0]); assert.throws(() => backup.decode(JSON.stringify(duplicate)), /重复方案/);
  const orphan = structuredClone(document); orphan.data.plans[0].teamId = 'missing-team'; assert.throws(() => backup.decode(JSON.stringify(orphan)), /关联不一致/);
  const unknown = structuredClone(document); unknown.data.favorites = [999999]; assert.throws(() => backup.decode(JSON.stringify(unknown)), /未收录/);
  assert.equal(state.favorites[0], 25); assert.equal(state.plans[0].selection.ivs.atk, 0);
});
