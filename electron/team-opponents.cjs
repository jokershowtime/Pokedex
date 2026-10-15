const { structureFlags } = require('./team-quality.cjs');
const { inScenario, canonicalSelection } = require('./assistant-scenario.cjs');
const { DEFAULT_VERSIONS } = require('./strategy-model.cjs');
function manualReference(condition, c, strategies, battle) {
  const build = condition.build;
  if (build.generation <= 2 && c.generation >= 3) throw new Error('第一、二世代培养数值不能直接转换到现代世代，请导入现代培养配置。');
  const ref = strategies.references().pokemon.find(value => value.id === condition.pokemonId);
  if (!ref) throw new Error('宝可梦不存在。');
  const selection = canonicalSelection(build.selection, strategies.model);
  const raw = { ...selection, species: build.showdownSpecies || strategies.model.showdownName(ref) };
  const set = strategies.model.fromSource(ref.english, c.category === 'doubles' ? 'doublesou' : 'ou', build.title, raw, c.generation, null);
  set.selection = { ...selection, level: c.level };
  set.title = build.title; set.referenceGeneration = build.generation; set.format = c.outputFormat;
  set.source = { provider: build.source, url: null, fetchedAt: null };
  const validated = strategies.validatePersonal(set, DEFAULT_VERSIONS[c.generation]);
  const speed = battle.teamFeatures({ fighter: validated, generation: c.generation }).finalSpeed;
  return { pokemonId: ref.id, name: ref.name, id: condition.id, speed, set: validated, method: 'manual' };
}
function equivalenceKey(entry, c, precise = false) {
  const selection = entry.set.selection;
  return JSON.stringify([entry.pokemonId, entry.typeMask, entry.weakIds, entry.fourfold, entry.attackMask, entry.moveMask,
    entry.resistMask, entry.immuneMask, entry.traits, c.uniqueItems ? entry.item : '',
    c.fastCount ? entry.speed >= c.fastSpeed : false, c.slowCount ? entry.speed <= c.slowSpeed : false, structureFlags(entry),
    c.requiredMoves.map(name => entry.moves.some(move => move === name || name === 'Hidden Power' && /^Hidden Power(?:\s|$)/i.test(move))),
    entry.opponentAttackMask || 0, entry.opponentResistMask || 0, entry.opponentFasterMask || 0,
    precise ? [selection.ability, selection.item, selection.moves, entry.battleStats, selection.ivs, selection.happiness, selection.hpType] : null]);
}
function prepareOpponents(prepared, c, { battle, strategies, onProgress = () => {}, references: fixedReferences, names = {} }) {
  if (!c.opponents?.length) return prepared;
  const references = fixedReferences || [], issues = [];
  for (const condition of fixedReferences ? [] : c.opponents) {
    if (condition.reference === 'manual') {
      try { references.push({ ...manualReference(condition, c, strategies, battle), targetId: condition.id, state: condition.state }); }
      catch (error) { issues.push({ kind: 'data', title: '指定对手配招无法计算', conditions: [condition.build.title], explanation: error.message,
        suggestions: ['核对形态、特性、道具、招式及培养数值与计算世代是否匹配。'] }); }
      continue;
    }
    const options = prepared.pool.filter(entry => entry.pokemonId === condition.pokemonId).sort((a, b) =>
      (condition.reference === 'fastest' ? b.speed - a.speed : 0) ||
      (b.set.referenceGeneration || b.set.generation) - (a.set.referenceGeneration || a.set.generation) || a.id.localeCompare(b.id));
    const selected = options[0];
    if (!selected) issues.push({ kind: 'data', title: '对手“' + (names.pokemon?.[condition.pokemonId] || condition.pokemonId) + '”缺少完整的参考配招', conditions: ['对手参考配置'],
      explanation: '当前资料范围没有这位对手的完整可计算配置，无法可靠比较特性、招式和速度。',
      suggestions: ['扩大资料世代或来源规则，补充完整配招，或移除这个对手条件。'] });
    else references.push({ pokemonId: selected.pokemonId, name: selected.name, id: selected.id, targetId: condition.id, state: condition.state, speed: selected.speed, set: selected.set, method: condition.reference });
  }
  for (const reference of references) {
    try { battle.stats({ fighter: inScenario(reference.set, reference.state), generation: c.generation, field: c.scenario?.field }); }
    catch (error) { issues.push({ kind: 'data', title: reference.name + '的对手状态无法计算', conditions: ['对手路线状态'], explanation: error.message,
      suggestions: ['检查太晶属性、状态和配招是否适用于本次计算世代。'] }); }
  }
  if (issues.length) return { ...prepared, opponentReferences: references, opponentIssues: issues };
  const evaluate = battle.opponentEvaluator({ opponents: references.map(value => inScenario(value.set, value.state)), generation: c.generation, category: c.category, scenario: c.scenario });
  const total = prepared.pool.length * references.length, pool = [], seen = new Set();
  let processed = 0, last = -Infinity, unknown = 0;
  const report = force => {
    const now = performance.now();
    if (force || now - last >= 250) {
      onProgress({ phase: 'matchups', stage: '对手应对预计算', message: '按选定战况比较对手的属性、特性、招式与行动顺序…',
        total: String(total), processed: String(processed), percent: total ? processed / total * 100 : 100 }); last = now;
    }
  };
  report(true);
  for (const entry of prepared.pool) {
    const matchups = evaluate(entry.set);
    entry.opponentAttackMask = 0; entry.opponentResistMask = 0; entry.opponentFasterMask = 0;
    matchups.forEach((row, index) => {
      const flag = 1 << index;
      if (row.attackMoves.length) entry.opponentAttackMask |= flag;
      if (row.resistsAll) entry.opponentResistMask |= flag;
      if (row.faster) entry.opponentFasterMask |= flag;
      if (row.uncertain) unknown++;
    });
    processed += references.length; report();
    const key = equivalenceKey(entry, c); delete entry.battleStats;
    if (!seen.has(key)) { seen.add(key); pool.push(entry); }
  }
  report(true);
  return { ...prepared, pool, opponentReferences: references, opponentIssues: [], unknownMatchups: unknown,
    duplicates: String(BigInt(prepared.duplicates) + BigInt(prepared.pool.length - pool.length)) };
}
function opponentReport(members, references, c, battle, evaluator) {
  if (!references?.length) return [];
  const evaluate = evaluator || battle.opponentEvaluator({ opponents: references.map(value => inScenario(value.set, value.state)), generation: c.generation, category: c.category, scenario: c.scenario });
  const matrix = members.map(member => evaluate(member.set));
  return references.map((reference, index) => ({ pokemonId: reference.pokemonId, targetId: reference.targetId,
    attackers: members.flatMap((member, slot) => matrix[slot][index].attackMoves.length ? [{ pokemonId: member.pokemonId, name: member.name, moves: matrix[slot][index].attackMoves }] : []),
    resistors: members.filter((_, slot) => matrix[slot][index].resistsAll).map(member => ({ pokemonId: member.pokemonId, name: member.name })),
    faster: members.flatMap((member, slot) => matrix[slot][index].faster ? [{ pokemonId: member.pokemonId, name: member.name, speed: matrix[slot][index].speed }] : []),
    uncertain: matrix.some(rows => rows[index].uncertain),
    speeds: members.map((member, slot) => ({ pokemonId: member.pokemonId, name: member.name, normal: member.speed,
      current: matrix[slot][index].speed, opponent: matrix[slot][index].targetSpeed,
      first: matrix[slot][index].speed === matrix[slot][index].targetSpeed ? 'tie' : matrix[slot][index].faster ? 'member' : 'opponent' })),
  }));
}
module.exports = { equivalenceKey, prepareOpponents, opponentReport };
