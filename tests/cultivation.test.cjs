const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDataService } = require('../electron/data-service.cjs');
const { createStrategyService } = require('../electron/strategy-service.cjs');
const { createTeamService } = require('../electron/team-service.cjs');
const { createUserStore } = require('../electron/user-store.cjs');
const fixture = require('./fixtures/teams.json');
let data;
before(() => { data = createDataService(path.join(__dirname, '../data/pokedex.sqlite')); });
after(() => data.close());
function setup() {
  const root = path.join(__dirname, '../.qa/cultivation-tests'); fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'case-')), store = createUserStore(directory);
  const strategies = createStrategyService(data, path.join(directory, 'strategy-cache'));
  const teams = createTeamService(strategies, path.join(directory, 'team-cache'), async () => { throw new Error('offline'); }, { providers: [] });
  const source = teams.model.normalize(fixture, 'gen9ou', '').teams[0];
  store.saveTeam(teams.model.validate(source, 27));
  return { directory, store, strategies, teams, source };
}

test('删掉六个成员仍保留队伍作业与笔记，保存笔记不重新创建培养计划', () => {
  const { store, teams } = setup();
  const team = store.get().teams[0];
  for (const member of team.members) store.deletePlan(member.id);
  assert.equal(store.get().plans.length, 0); assert.equal(store.get().teams.length, 1);
  const edited = store.get().teams[0]; edited.notes = '保留这套作业，暂时不培养'; edited.title = '队伍笔记';
  store.saveTeam(teams.model.validate(edited, 27));
  assert.equal(store.get().plans.length, 0);
  assert.equal(store.get().teams[0].notes, edited.notes);
  assert.deepEqual(store.get().teams[0].members.map(member => member.id), team.members.map(member => member.id));
});

test('按成员恢复只添加缺少的计划，原配置、0个体值与进度保留，已存在的成员不被覆盖', () => {
  const { store, strategies } = setup(); const team = store.get().teams[0];
  const member = store.get().plans[0]; member.notes = '自定义路线'; member.selection.nature = 'Calm'; member.selection.ivs.atk = 0;
  store.savePlan(strategies.validatePersonal(member, 27)); store.progress(member.id, 'nature', true); store.progress(member.id, 'item', true);
  const snapshot = store.get().teams[0].members.find(value => value.id === member.id);
  store.deletePlan(member.id); store.deletePlan(team.members[1].id);
  const untouched = store.get().plans;
  store.restoreTeamPlans(team.id, member.id);
  const restored = store.get().plans.find(value => value.id === member.id);
  assert.equal(store.get().plans.length, 5);
  assert.deepEqual(restored.selection, snapshot.selection); assert.deepEqual(restored.progress, snapshot.progress); assert.equal(restored.notes, snapshot.notes);
  for (const plan of untouched) assert.deepEqual(store.get().plans.find(value => value.id === plan.id), plan);
  store.restoreTeamPlans(team.id); assert.equal(store.get().plans.length, 6);
  const stable = store.get(); store.restoreTeamPlans(team.id); assert.deepEqual(store.get(), stable);
});

test('取消收藏保留成员为独立方案，再收藏同一来源沿用修改和进度且不重复创建六份计划', () => {
  const { store, strategies, source } = setup(); const team = store.get().teams[0], ids = store.get().plans.map(plan => plan.id);
  const changed = store.get().plans[0]; changed.selection.ivs.atk = 1;
  store.savePlan(strategies.validatePersonal(changed, 27)); store.progress(changed.id, 'item', true);
  store.deleteTeam(team.id, false);
  assert.equal(store.get().teams.length, 0); assert.equal(store.get().plans.length, 6);
  assert.ok(store.get().plans.every(plan => !plan.teamId));
  store.saveTeam(source);
  assert.equal(store.get().teams.length, 1); assert.equal(store.get().plans.length, 6);
  assert.deepEqual(store.get().plans.map(plan => plan.id).sort(), [...ids].sort());
  assert.equal(store.get().plans.find(plan => plan.id === changed.id).selection.ivs.atk, 1);
  assert.equal(store.get().plans.find(plan => plan.id === changed.id).progress.item, true);
  assert.ok(store.get().teams[0].members.every(member => member.teamId === store.get().teams[0].id));
});

test('同物种在不同队伍的培养相互独立，整队清理不删除其他队伍或独立路线', () => {
  const { store, strategies, teams } = setup();
  const another = structuredClone(fixture); another[0].name = '另一条路线'; another[0].data[0].item = 'Leftovers';
  store.saveTeam(teams.model.validate(teams.model.normalize(another, 'gen9ou', '').teams[0], 27));
  const [second, first] = store.get().teams;
  const independent = { ...first.members[0], id: 'new', teamId: undefined, title: '独立路线' };
  store.savePlan(strategies.validatePersonal(independent, 27));
  store.progress(first.members[0].id, 'item', true);
  assert.equal(store.get().plans.find(plan => plan.id === second.members[0].id).progress.item, undefined);
  store.deleteTeam(first.id, true);
  assert.equal(store.get().plans.length, 7); assert.equal(store.get().teams.length, 1);
  assert.equal(store.get().teams[0].id, second.id);
  assert.ok(store.get().plans.some(plan => plan.title === '独立路线'));
});

test('旧版本成员来源编号可恢复，重启和取消后重新收藏仍保留原计划与进度', () => {
  const { directory, store, source } = setup(); const original = store.get();
  store.progress(original.plans[0].id, 'item', true);
  const legacy = store.get();
  for (const member of legacy.teams[0].members) delete member.originId;
  for (const plan of legacy.plans) delete plan.originId;
  const file = path.join(directory, 'preferences.json'), encoded = JSON.stringify(legacy); fs.writeFileSync(file, encoded);
  const restarted = createUserStore(directory);
  assert.equal(fs.readFileSync(file, 'utf8'), encoded); // Reading does not rewrite the profile.
  restarted.deleteTeam(legacy.teams[0].id, false); restarted.saveTeam(source);
  assert.deepEqual(restarted.get().plans.map(plan => plan.id).sort(), original.plans.map(plan => plan.id).sort());
  assert.equal(restarted.get().plans.find(plan => plan.id === original.plans[0].id).progress.item, true);
});

test('超额恢复和错误成员编号不产生半支培养队伍，已收藏状态与原快照保持', () => {
  const { directory, store } = setup(); const team = store.get().teams[0];
  for (const member of team.members) store.deletePlan(member.id);
  const state = store.get();
  state.plans = Array.from({ length: 1995 }, (_, index) => ({ ...team.members[0], id: 'standalone-' + index, teamId: undefined }));
  fs.writeFileSync(path.join(directory, 'preferences.json'), JSON.stringify(state));
  const full = createUserStore(directory), before = full.get();
  assert.throws(() => full.restoreTeamPlans(team.id), /2000/);
  assert.deepEqual(full.get(), before);
  assert.throws(() => full.restoreTeamPlans(team.id, 'missing-member'), /找不到/);
  assert.deepEqual(full.get(), before);
});

test('培养页元数据从本地读取，不要求联网或重新同步来源', () => {
  const { teams } = setup(); const metadata = teams.metadata();
  assert.ok(metadata.tags.some(tag => tag.id === 'rain')); assert.ok(metadata.formats.length);
  assert.equal(metadata.error, null);
});
