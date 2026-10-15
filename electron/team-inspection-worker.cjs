const { isMainThread, parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');
const { createDataService } = require('./data-service.cjs');
const { createStrategyService } = require('./strategy-service.cjs');
const { createTeamService } = require('./team-service.cjs');
const { createBattleService, UNSUPPORTED_MOVES } = require('./battle-service.cjs');
const { inScenario, normal } = require('./assistant-scenario.cjs');
function inspectTeam({ team, opponents, conditions: c }, battle, send = () => {}) {
  const began = performance.now(), field = { ...c.scenario.field, gameType: c.category === 'doubles' ? 'Doubles' : 'Singles' };
  const total = team.members.reduce((count, member) => count + opponents.reduce((sum, opponent) =>
    sum + (member.selection.moves.length + opponent.reference.selection.moves.length) * 2, 0), 0);
  let processed = 0, last = -Infinity;
  function progress(force = false) {
    if (force || performance.now() - last >= 75) {
      send({ processed, total, percent: total ? processed / total * 100 : 100 }); last = performance.now();
    }
  }
  const baseEvaluate = battle.opponentEvaluator({ opponents: opponents.map(value => normal(value.reference)), generation: c.generation, category: c.category });
  const evaluate = battle.opponentEvaluator({ opponents: opponents.map(value => inScenario(value.reference, value.state)), generation: c.generation, category: c.category, scenario: c.scenario });
  const rows = []; progress(true);
  for (const member of team.members) {
    const baseSpeeds = baseEvaluate(normal(member)), speeds = evaluate(member);
    for (let index = 0; index < opponents.length; index++) {
      const opponent = opponents[index], reference = opponent.reference;
      const own = inScenario(member, c.scenario.teamState), foe = inScenario(reference, opponent.state);
      function moves(attacker, defender, activeAttacker, activeDefender) {
        return attacker.selection.moves.map(move => {
          const value = { move, baseline: null, active: null, unknown: '' };
          for (const baseline of [true, false]) {
            try {
              if (UNSUPPORTED_MOVES.includes(move)) throw new Error('需要反击前提或一击必杀规则，当前检查不估算该招式。');
              const result = battle.damage({ generation: c.generation, move, attacker: baseline ? normal(attacker) : activeAttacker,
                defender: baseline ? normal(defender) : activeDefender, field: baseline ? { gameType: field.gameType } : field }).results[0];
              value[baseline ? 'baseline' : 'active'] = result;
            } catch (error) { value.unknown = error.message; }
            processed++; progress();
          }
          return value;
        });
      }
      const current = speeds[index], baseline = baseSpeeds[index];
      rows.push({ memberId: member.id, pokemonId: member.pokemonId, name: member.pokemonName || current.name || String(member.pokemonId),
        targetId: opponent.targetId, opponentName: opponent.name, title: reference.title,
        speed: current.speed, normalSpeed: baseline.speed, targetSpeed: current.targetSpeed, normalTargetSpeed: baseline.targetSpeed,
        first: current.speed === current.targetSpeed ? 'tie' : current.faster ? 'member' : 'opponent',
        outgoing: moves(member, reference, own, foe), incoming: moves(reference, member, foe, own) });
    }
  }
  progress(true);
  return { rows, total, processed, elapsedMs: Math.round(performance.now() - began),
    note: '常态为满血、无异常与能力变化、无天气场地或墙；战况列采用本次条件。击倒概率以命中为前提，不包含命中率与实际回合的换人、追加效果；连续命中按引擎默认次数。承伤逐招独立计算，不能视为安全换入保证。' };
}
function calculate(input, send) {
  const data = createDataService(input.databasePath);
  try {
    const strategies = createStrategyService(data, path.join(input.directory, 'strategy-cache'));
    const teams = createTeamService(strategies, path.join(input.directory, 'team-cache'));
    return inspectTeam(input, createBattleService(data, strategies, teams), send);
  } finally { data.close(); }
}
if (!isMainThread) {
  try { parentPort.postMessage({ result: calculate(workerData, progress => parentPort.postMessage({ progress })) }); }
  catch (error) { parentPort.postMessage({ error: error.message }); }
}
module.exports = { inspectTeam };
