const { Worker } = require('node:worker_threads');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { constraints, ROLES, STYLES } = require('./team-solver.cjs');
const { describeFormat } = require('./team-model.cjs');

function createTeamAssistantService({ databasePath, directory, onUpdate = () => {} }) {
  let job = null;
  const inspecting = () => job && ['running', 'cancelling'].includes(job.state.inspection?.state);
  const searching = () => job && ['running', 'cancelling'].includes(job.state.state);
  const active = () => searching() || inspecting();
  function summary(state) {
    return state ? { runId: state.runId, state: inspecting() ? state.inspection.state : state.state,
      phase: inspecting() ? 'inspection' : state.phase, percent: inspecting() ? state.inspection.percent : state.percent, found: state.found } : null;
  }
  function notify() { onUpdate(summary(job?.state)); }
  function status(_owner, runId, summaryOnly = false) {
    if (!job) { if (runId) throw new Error('计算记录已过期，请重新计算。'); return null; }
    if (runId && job.state.runId !== runId) throw new Error('计算记录已过期，请重新计算。');
    const state = { ...job.state, elapsedMs: searching() ? Date.now() - job.began : job.state.elapsedMs,
      ...(job.state.inspection ? { inspection: { ...job.state.inspection, elapsedMs: inspecting() ? Date.now() - job.inspectionBegan : job.state.inspection.elapsedMs } } : {}) };
    return summaryOnly ? summary(state) : state;
  }
  function stop() {
    if (!job || !active()) return Promise.resolve(status());
    if (inspecting()) {
      const target = job;
      if (target.inspectionStopping) return target.inspectionStopping;
      target.state.inspection = { ...target.state.inspection, state: 'cancelling' }; notify();
      target.inspectionStopping = target.inspector.terminate().then(() => {
        if (job === target) { target.state.inspection = { ...target.state.inspection, state: 'cancelled', elapsedMs: Date.now() - target.inspectionBegan }; notify(); }
        return status();
      });
      return target.inspectionStopping;
    }
    if (job.stopping) return job.stopping;
    const target = job;
    target.state = { ...target.state, previews: [], state: 'cancelling', message: '正在取消计算…' }; notify();
    target.stopping = target.worker.terminate().then(() => {
      if (job === target) {
        target.state = { ...target.state, state: 'cancelled', message: '计算已取消，可修改条件后重新计算。', elapsedMs: Date.now() - target.began };
        notify();
      }
      return status();
    }, error => {
      if (job === target) {
        target.state = { ...target.state, state: 'error', message: '取消计算失败：' + error.message, elapsedMs: Date.now() - target.began }; notify();
      }
      return status();
    });
    return target.stopping;
  }
  return {
    metadata(knownFormats = []) {
      const formats = new Map(knownFormats.filter(format => format.tier !== '1v1').map(format => [format.id, format]));
      for (let gen = 1; gen <= 9; gen++) for (const tier of ['ou', 'ubers', 'uu', 'ru', 'nu', 'pu', 'zu', 'lc', 'monotype', 'nationaldex', ...(gen >= 3 ? ['doublesou', 'doublesuu'] : [])]) {
        const rule = describeFormat('gen' + gen + tier); if (!formats.has(rule.id)) formats.set(rule.id, rule);
      }
      return { formats: [...formats.values()], roles: ROLES, styles: STYLES };
    },
    start(owner, input, user) {
      if (active()) throw new Error('已有阵容计算正在运行，请等待完成或先取消计算。');
      const c = constraints(input), runId = randomUUID(), began = Date.now();
      let lockedSets = [], rebuildPokemonIds = [];
      if (input.rebuild) {
        const request = input.rebuild, source = job?.state;
        if (!source || source.state !== 'complete' || job.owner !== owner || source.runId !== request.runId || !Number.isInteger(request.index) ||
          !Array.isArray(request.memberIds) || !request.memberIds.length || request.memberIds.length > 6 || new Set(request.memberIds).size !== request.memberIds.length)
          throw new Error('锁定来源无效或已过期，请重新选择计算结果。');
        const team = source.results[request.index]?.team;
        if (!team || request.memberIds.some(id => !team.members.some(member => member.id === id))) throw new Error('锁定成员不属于所选队伍。');
        if (c.generation !== source.constraints.generation || c.category !== source.constraints.category || c.level !== source.constraints.level)
          throw new Error('锁定配置需要沿用原计算的世代、玩法和等级。');
        lockedSets = structuredClone(team.members.filter(member => request.memberIds.includes(member.id)));
        rebuildPokemonIds = team.members.map(member => member.pokemonId);
        constraints({ ...c, requiredIds: [...new Set([...c.requiredIds, ...lockedSets.map(set => set.pokemonId)])] });
      }
      const state = { runId, state: 'running', phase: 'starting', message: '正在启动计算…', elapsedMs: 0,
        constraints: c, prepared: 0, examined: 0, found: 0, total: '0', processed: '0', evaluated: '0', prunedCombinations: '0', percent: 0,
        results: [], opponents: [], previews: [], previewRevision: 0, issues: [], diagnostics: [], warnings: [], lockedPokemonIds: lockedSets.map(set => set.pokemonId) };
      const worker = new Worker(path.join(__dirname, 'team-assistant-worker.cjs'), {
        workerData: { databasePath, directory, input: c, user: { plans: user.plans, teams: user.teams, versionId: user.versionId || user.settings?.versionId }, runId, lockedSets, rebuildPokemonIds },
      });
      const target = { worker, owner, began, state, saved: new Map() }; job = target; notify();
      const fail = message => {
        if (job !== target || target.state.state !== 'running') return;
        target.state = { ...target.state, previews: [], state: 'error', message, elapsedMs: Date.now() - began }; notify(); void worker.terminate();
      };
      worker.on('message', message => {
        if (job !== target || target.state.state !== 'running') return;
        if (message.progress) { target.state = { ...target.state, ...message.progress }; notify(); }
        if (message.error) fail(message.error);
        if (message.result) {
          target.state = { ...target.state, ...message.result, previews: [], state: 'complete', phase: 'finished',
            message: message.result.results.length ? '搜索完成。' : message.result.issues?.some(issue => issue.kind === 'data') ? '资料不足，暂时无法完成这些条件的核对。' : '没有符合条件的队伍。', elapsedMs: Date.now() - began };
          notify(); void worker.terminate();
        }
      });
      worker.on('error', error => fail(error.message));
      worker.on('exit', () => { if (target.state.state === 'running') fail('计算进程已结束，请重试。'); });
      return status(owner, runId);
    },
    status,
    inspect(owner, runId, index) {
      status(owner, runId);
      if (active()) throw new Error('已有计算正在运行，请先等待或取消。');
      if (job.owner !== owner || job.state.state !== 'complete' || !Number.isInteger(index) || !job.state.results[index]) throw new Error('计算结果无效或已过期。');
      if (!job.state.opponents.length) throw new Error('请先指定对手并计算队伍，再检查伤害。');
      if (job.inspections?.has(index)) { job.state.inspection = job.inspections.get(index); return status(); }
      const target = job, began = Date.now();
      target.inspectionBegan = began; target.inspectionStopping = null;
      target.state.inspection = { state: 'running', index, processed: 0, total: 0, percent: 0, elapsedMs: 0, report: null };
      const worker = new Worker(path.join(__dirname, 'team-inspection-worker.cjs'), { workerData: { databasePath, directory,
        team: target.state.results[index].team, opponents: target.state.opponents, conditions: target.state.constraints } });
      target.inspector = worker; notify();
      const fail = error => {
        if (job !== target || target.inspector !== worker || target.state.inspection.state !== 'running') return;
        target.state.inspection = { ...target.state.inspection, state: 'error', error, elapsedMs: Date.now() - began }; notify(); void worker.terminate();
      };
      worker.on('message', message => {
        if (job !== target || target.inspector !== worker || target.state.inspection.state !== 'running') return;
        if (message.progress) { target.state.inspection = { ...target.state.inspection, ...message.progress }; notify(); }
        if (message.error) fail(message.error);
        if (message.result) {
          target.state.inspection = { ...target.state.inspection, state: 'complete', percent: 100, report: message.result, elapsedMs: Date.now() - began };
          if (!target.inspections) target.inspections = new Map(); target.inspections.set(index, target.state.inspection);
          notify(); void worker.terminate();
        }
      });
      worker.on('error', error => fail(error.message));
      worker.on('exit', () => fail('伤害检查进程已结束，请重试。'));
      return status();
    },
    async cancel(owner, runId) {
      status(owner, runId);
      if (job.owner !== owner) throw new Error('请在启动计算的窗口取消任务。');
      return stop();
    },
    result(owner, runId, index) {
      status(owner, runId);
      if (job.owner !== owner || job.state.state !== 'complete' || !Number.isInteger(index) || !job.state.results[index]) throw new Error('计算结果无效或已过期。');
      return { team: structuredClone(job.state.results[index].team), savedId: job.saved.get(index) };
    },
    saved(owner, runId, index, id) { status(owner, runId); if (job.owner !== owner) throw new Error('计算结果无效。'); job.saved.set(index, id); },
    dispose() { return stop(); },
  };
}
module.exports = { createTeamAssistantService };
