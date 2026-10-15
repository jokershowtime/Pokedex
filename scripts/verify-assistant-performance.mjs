import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, copyFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url), root = path.resolve(import.meta.dirname, '..');
const cache = path.resolve(process.argv[2] || path.join(root, '.qa/strategy-ui-user/strategy-cache/gen9.json'));
const qa = path.join(root, '.qa'); mkdirSync(qa, { recursive: true });
const directory = mkdtempSync(path.join(qa, 'assistant-progress-performance-'));
mkdirSync(path.join(directory, 'strategy-cache')); mkdirSync(path.join(directory, 'team-cache'));
copyFileSync(cache, path.join(directory, 'strategy-cache/gen9.json'));
if (process.argv[3]) for (let gen = 1; gen <= 9; gen++)
  copyFileSync(path.join(path.resolve(process.argv[3]), 'gen' + gen + '.json'), path.join(directory, 'strategy-cache/gen' + gen + '.json'));
const fixture = require('../tests/fixtures/teams.json');
writeFileSync(path.join(directory, 'team-cache/gen9ou.json'), JSON.stringify({ schemaVersion: 1, key: 'gen9ou', fetchedAt: '', data: fixture }));
const { createTeamAssistantService } = require('../electron/team-assistant-service.cjs');
const events = [];
const assistant = createTeamAssistantService({ databasePath: path.join(root, 'data/pokedex.sqlite'), directory, onUpdate: event => events.push(event) });
let heartbeat = 0; const timer = setInterval(() => heartbeat++, 10);
const records = [];
async function run(name, input, cancelAfter) {
  const before = heartbeat, began = performance.now(), task = assistant.start(1, input, { plans: [], teams: [] });
  assert.throws(() => assistant.start(2, input, { plans: [], teams: [] }), /已有/);
  let status;
  while (true) {
    status = assistant.status(1, task.runId);
    if (status.state !== 'running') break;
    if (cancelAfter && performance.now() - began >= cancelAfter) {
      const stoppedAt = performance.now(); status = await assistant.cancel(1, task.runId);
      assert.equal(status.state, 'cancelled'); status.cancelMs = Math.round(performance.now() - stoppedAt); break;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    if (!cancelAfter && performance.now() - began > 45000) {
      console.error(JSON.stringify({ name, phase: status.phase, stage: status.stage, prepared: status.prepared, examined: status.examined, found: status.found }));
      await assistant.cancel(1, task.runId); throw new Error(name + ' test did not complete');
    }
  }
  assert.ok(heartbeat - before > (cancelAfter ? 0 : 5));
  if (!cancelAfter) {
    assert.equal(status.state, 'complete', status.message); assert.ok(status.results.length);
    const target = input.requiredIds?.length === 6 ? 1 : input.resultCount ?? 20;
    assert.equal(status.results.length, target);
    assert.equal(new Set(status.results.map(result => result.team.members.map(member => member.pokemonId).sort((a, b) => a - b).join(','))).size, target);
    assert.equal(status.processed, status.total); assert.equal(status.percent, 100);
    if (status.strategy === 'exact') assert.equal(BigInt(status.evaluated) + BigInt(status.prunedCombinations), BigInt(status.total));
    for (const result of status.results) for (const check of result.checks) {
      if (check.required !== undefined) assert.ok(check.count >= check.required);
      if (check.maximum !== undefined) assert.ok(check.count <= check.maximum);
    }
  }
  const record = { name, state: status.state, elapsedMs: status.elapsedMs, searchMs: status.searchMs, configurations: status.prepared,
    dataMs: status.dataMs, prepareMs: status.prepareMs, cacheHit: status.cacheHit, minDifference: status.constraints.minDifference,
    total: status.total, processed: status.processed, evaluated: status.evaluated, prunedCombinations: status.prunedCombinations,
    strategy: status.strategy, stage: status.stage, requested: status.constraints.resultCount, found: status.found, percent: status.percent, heartbeat: heartbeat - before, cancelMs: status.cancelMs };
  records.push(record); console.log(JSON.stringify(record));
  return status;
}
try {
  await run('六位必带成员不限来源规则，完整组合计数与保存前配置检查', {
    format: 'all', scopeGeneration: 9, requiredIds: [279, 847, 598, 145, 984, 983], maxWeak: 6, roles: ['removal'], style: 'rain',
  });
  await run('宽范围直接生成队伍，不遍历全部组合', { format: 'all', scopeGeneration: 9, maxWeak: 3 });
  const warm = await run('宽范围返回 50 个不同成员组合并复用预计算', { format: 'all', scopeGeneration: 9, maxWeak: 3, resultCount: 50 });
  assert.equal(warm.cacheHit, true);
  if (process.argv[3]) {
    await run('全部世代不限规则，复现实际大范围资料', { format: 'all', scopeGeneration: 0, maxWeak: 3 });
    const repeated = await run('全部世代调整排序后复用配置预计算', { format: 'all', scopeGeneration: 0, maxWeak: 3, preference: 'defense' });
    assert.equal(repeated.cacheHit, true);
  }
  await run('手动取消异步任务', { format: 'all', scopeGeneration: 9, maxWeak: 3 }, 50);
} finally { clearInterval(timer); await assistant.dispose(); }
writeFileSync(path.join(qa, 'assistant-progress-performance-report.json'), JSON.stringify({
  cache, sourceSpecies: Object.values(JSON.parse(readFileSync(cache, 'utf8')).data).length, records, progressEvents: events.length, directory,
}, null, 2));
