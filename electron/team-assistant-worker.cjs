const { isMainThread, parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { createDataService } = require('./data-service.cjs');
const { createStrategyService } = require('./strategy-service.cjs');
const { createTeamService } = require('./team-service.cjs');
const { createBattleService } = require('./battle-service.cjs');
const { DEFAULT_VERSIONS, normalizeId } = require('./strategy-model.cjs');
const { constraints, traits, mask, solve } = require('./team-solver.cjs');
const { percentage } = require('./team-search.cjs');
const { equivalenceKey, prepareOpponents, opponentReport } = require('./team-opponents.cjs');
const { cachedPreparation, sourcePreparationKey, readPreparation } = require('./team-assistant-cache.cjs');
const { diagnoseConditions, diagnosticReport } = require('./team-diagnostics.cjs');
const { playbook, playbookText } = require('./team-playbook.cjs');
const { inScenario, scenarioText, stateText, canonicalSelection } = require('./assistant-scenario.cjs');

function dimensions(set) {
  return [
    ['ability', set.abilityOptions], ['item', set.itemOptions], ['nature', set.natureOptions],
    ['evs', set.evSpreads], ['ivs', set.ivSpreads],
    ...set.moveOptions.map((options, index) => ['move-' + index, options]),
  ].map(([key, options]) => [key, options?.length ? options : [key.startsWith('move-') ? set.selection.moves[Number(key.slice(5))] : set.selection[key]]]);
}
function variationCount(set, expand) { return expand ? dimensions(set).reduce((count, [, options]) => count * BigInt(options.length), 1n) : 1n; }
function* variations(set, expand) {
  if (!expand) { yield set.selection; return; }
  const choices = dimensions(set);
  function* expandAt(index, selected) {
    if (index === choices.length) { yield selected; return; }
    const [key, options] = choices[index];
    for (const value of options) {
      const next = { ...selected, moves: [...selected.moves] };
      if (key.startsWith('move-')) next.moves[Number(key.slice(5))] = value; else next[key] = value;
      yield* expandAt(index + 1, next);
    }
  }
  yield* expandAt(0, set.selection);
}
function sourceMatches(set, c) {
  return (!c.scopeGeneration || set.generation === c.scopeGeneration) && (c.format === 'all' || set.format === c.format) && set.category === c.category;
}
function prepare(records, c, { strategies, battle, onProgress = () => {} }) {
  const began = performance.now(), seen = new Set(), equivalent = new Set(), pool = [], refs = strategies.references(), model = strategies.model;
  const byId = new Map(refs.pokemon.map(p => [p.id, p]));
  const speciesForms = new Map();
  refs.pokemon.forEach(ref => { if (!speciesForms.has(ref.speciesId)) speciesForms.set(ref.speciesId, []); speciesForms.get(ref.speciesId).push(ref.id); });
  const excludedSpecies = new Set(c.excludedIds.map(id => byId.get(id)?.speciesId));
  const eligible = records.filter(record => sourceMatches(record.set, c));
  const total = eligible.reduce((count, record) => count + variationCount(record.set, record.expand), 0n);
  let processed = 0n, skipped = 0n, duplicates = 0n, earlyMechanics = 0n, checked = 0, lastUpdate = began;
  const notify = force => {
    if (force || performance.now() - lastUpdate >= 250) {
      onProgress({ phase: 'preparing', message: '预计算完整配招的打击面、抗性和速度…', prepared: pool.length,
        total: total.toString(), processed: processed.toString(), percent: percentage(processed, total),
        evaluated: '0', prunedCombinations: '0', found: 0 });
      lastUpdate = performance.now();
    }
  };
  notify(true);
  for (const { set, expand = false } of eligible) {
    const ref = byId.get(set.pokemonId), count = variationCount(set, expand);
    if (!ref || excludedSpecies.has(ref.speciesId) || set.missingFields?.length ||
      !set.personal && set.generation >= 3 && (!set.evsSpecified || !set.natureOptions.length)) {
      skipped += count; processed += count; notify(); continue;
    }
    if (set.generation <= 2 && c.generation >= 3) {
      earlyMechanics += count; skipped += count; processed += count; notify(); continue;
    }
    const detail = model.pokemonDetail(set.pokemonId, DEFAULT_VERSIONS[c.generation]);
    if (c.excludeLegendary && detail.isLegendary || c.excludeMythical && detail.isMythical) {
      skipped += count; processed += count; notify(); continue;
    }
    for (const rawSelection of variations(set, expand)) {
      processed++; checked++; notify();
      const selection = canonicalSelection(rawSelection, model);
      if (c.generation >= 3 && !model.resolve('abilities', selection.ability) ||
        new Set(selection.moves.map(normalizeId)).size !== selection.moves.length ||
        c.generation >= 2 && Object.values(selection.ivs || {}).every(value => value === 31) &&
        selection.moves.some(move => /^Hidden Power\s+\[?(?!Dark\b)[A-Za-z]+/i.test(move))) { skipped++; continue; }
      const fighter = { ...set, generation: c.generation, format: c.outputFormat, referenceGeneration: set.referenceGeneration || set.generation,
        selection: { ...selection, level: c.level }, id: 'assistant-member', progress: {}, personal: false, originId: set.originId || set.id };
      delete fighter.teamId; delete fighter.createdAt; delete fighter.updatedAt;
      delete fighter.state;
      const signature = JSON.stringify([fighter.pokemonId, fighter.showdownSpecies, fighter.selection]);
      if (seen.has(signature)) { duplicates++; continue; } seen.add(signature);
      try {
        const validated = strategies.validatePersonal(fighter, DEFAULT_VERSIONS[c.generation]);
        const features = battle.teamFeatures({ fighter: validated, generation: c.generation });
        const attack = features.attacks.filter(move => move.category !== 'Status');
        const entry = { id: createHash('sha256').update(signature).digest('hex').slice(0, 20), set: validated, name: ref.name,
          pokemonId: ref.id, speciesId: ref.speciesId, excludedBy: speciesForms.get(ref.speciesId), legendary: detail.isLegendary, mythical: detail.isMythical,
          typeIds: features.types.map(type => type.id - 1), typeMask: mask(features.types.map(type => type.id)),
          weakIds: features.defensive.filter(row => row.value > 1).map(row => row.id - 1),
          fourfold: features.defensive.some(row => row.value >= 4), speed: features.finalSpeed,
          attackMask: mask([...new Set(attack.flatMap(move => move.effective))]), moveMask: mask(attack.map(move => move.typeId).filter(Boolean)),
          resistMask: mask(features.defensive.filter(row => row.value < 1).map(row => row.id)),
          immuneMask: mask(features.defensive.filter(row => row.value === 0).map(row => row.id)),
          traits: traits(validated, features), moves: validated.selection.moves, item: normalizeId(validated.selection.item),
          ...(c.opponents?.length ? { battleStats: features.stats } : {}) };
        // Merge configurations that are indistinguishable to the chosen conditions and ranking.
        const functionalKey = equivalenceKey(entry, c, Boolean(c.opponents?.length));
        if (equivalent.has(functionalKey)) { duplicates++; continue; }
        equivalent.add(functionalKey); pool.push(entry);
      } catch { skipped++; }
    }
  }
  notify(true);
  return { pool, skipped: skipped.toString(), duplicates: duplicates.toString(), earlyMechanics: earlyMechanics.toString(),
    checked, total: total.toString(), processed: processed.toString(), elapsedMs: Math.round(performance.now() - began) };
}
async function calculate({ databasePath, directory, input, user, runId, lockedSets = [], rebuildPokemonIds = [] }, send = () => {}) {
  if (!Array.isArray(user.plans)) {
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(path.join(directory, 'preferences.json'), 'utf8')); } catch { /* A new profile has no personal plans yet. */ }
    user = { ...user, plans: Array.isArray(saved.plans) ? saved.plans : [], teams: Array.isArray(saved.teams) ? saved.teams : [] };
  }
  const c = constraints(input), data = createDataService(databasePath);
  try {
    const strategies = createStrategyService(data, path.join(directory, 'strategy-cache'));
    const teams = createTeamService(strategies, path.join(directory, 'team-cache'), globalThis.fetch, { providers: [] });
    const library = createTeamService(strategies, path.join(directory, 'team-cache')).library;
    const battle = createBattleService(data, strategies, teams), beganData = performance.now(), refs = strategies.references();
    for (const id of [...c.requiredIds, ...c.excludedIds, ...c.opponents.map(value => value.pokemonId)]) if (!refs.pokemon.some(pokemon => pokemon.id === id)) throw new Error('所选宝可梦不存在，请重新选择。');
    c.requiredMoves = c.requiredMoves.map(name => {
      const move = strategies.model.resolve('moves', name);
      if (!move || move.generation > c.generation) throw new Error('必备招式不存在于计算世代：' + name);
      return /^Hidden Power\b/.test(name) ? name : move.english;
    });
    const names = { pokemon: Object.fromEntries(refs.pokemon.map(p => [p.id, p.name])),
      types: Object.fromEntries(refs.types.map(type => [type.id, type.name])),
      moves: Object.fromEntries(refs.moves.map(move => [move.english, move.name])),
      abilities: Object.fromEntries(refs.abilities.map(value => [value.english, value.name])),
      items: Object.fromEntries(refs.items.map(value => [value.english, value.name])),
      natures: Object.fromEntries(refs.natures.map(value => [value.english, value.name])) };
    const searchConditions = constraints({ ...c, requiredIds: [...new Set([...c.requiredIds, ...lockedSets.map(set => set.pokemonId)])] });
    const directIssues = diagnoseConditions([], searchConditions, { names, references: refs.pokemon, availability: false });
    if (directIssues.length) return { ...diagnosticReport(directIssues), constraints: c, warnings: [], prepared: 0, found: 0,
      dataMs: Math.round(performance.now() - beganData), prepareMs: 0, searchMs: 0, lockedPokemonIds: lockedSets.map(set => set.pokemonId) };
    const preparationConditions = { ...c, excludedIds: [], excludeLegendary: false, excludeMythical: false };
    const generations = c.scopeGeneration ? [c.scopeGeneration] : c.format !== 'all' ? [c.generation] : [9, 8, 7, 6, 5, 4, 3, 2, 1];
    const own = [...(user.plans || []), ...(user.teams || []).flatMap(team => team.members)];
    const context = { strategies, battle, names, onProgress: send };
    send({ phase: 'data', message: '检查本地资料与配置缓存…', total: '1', processed: '0', percent: 0 });
    let prepared = readPreparation(sourcePreparationKey(preparationConditions, own, generations, directory, databasePath), directory, context);
    if (prepared?.sourceWarnings?.length) prepared = null;
    let dataMs = Math.max(0, Math.round(performance.now() - beganData) - (prepared?.elapsedMs || 0));
    const warnings = [...(prepared?.sourceWarnings || [])];
    if (!prepared) {
      const requests = generations.map(gen => async () => strategies.dataset(gen));
      if (c.format !== 'all') requests.push(async () => teams.list({ format: c.format, versionId: DEFAULT_VERSIONS[c.generation] }));
      let completed = 0, next = 0;
      const loaded = [];
      const dataProgress = () => send({ phase: 'data', message: '准备配招资料（' + completed + '/' + requests.length + '）；已有缓存优先使用…',
        total: String(requests.length), processed: String(completed), percent: percentage(BigInt(completed), BigInt(requests.length)),
        evaluated: '0', prunedCombinations: '0', found: 0 });
      dataProgress();
      await Promise.all(Array.from({ length: Math.min(3, requests.length) }, async () => {
        while (next < requests.length) {
          const index = next++;
          try {
            const value = await requests[index](); loaded.push(value);
            if (value.error) warnings.push(value.error);
          } catch (error) { warnings.push(error.message); }
          completed++; dataProgress();
        }
      }));
      const records = own.map(set => ({ set }));
      for (const value of loaded) {
        if (value.sets) records.push(...value.sets.map(set => ({ set, expand: true })));
        if (value.teams) records.push(...value.teams.flatMap(team => team.members.map(set => ({ set }))));
      }
      for (const gen of generations) records.push(...library.snapshot(gen, DEFAULT_VERSIONS[gen], false).teams.flatMap(team => team.members.map(set => ({ set }))));
      dataMs = Math.round(performance.now() - beganData);
      prepared = cachedPreparation(records, preparationConditions, context, { directory, databasePath,
        key: sourcePreparationKey(preparationConditions, own, generations, directory, databasePath),
      compile: (records, condition, context) => ({ ...prepareOpponents(prepare(records, condition, context), condition, context), sourceWarnings: [...warnings] }) });
    }
    let locked = prepare(lockedSets.map(set => ({ set: { ...set, personal: true } })), { ...preparationConditions, format: 'all', scopeGeneration: 0 }, { strategies, battle });
    if (lockedSets.length && c.opponents.length && !prepared.opponentIssues?.length) locked = prepareOpponents(locked, c, { battle, references: prepared.opponentReferences });
    const lockedSpecies = new Set(lockedSets.map(set => refs.pokemon.find(ref => ref.id === set.pokemonId)?.speciesId));
    const pool = lockedSets.length ? [...locked.pool, ...prepared.pool.filter(entry => !lockedSpecies.has(entry.speciesId))] : prepared.pool;
    const opponents = (prepared.opponentReferences || []).map(reference => ({ pokemonId: reference.pokemonId, targetId: reference.targetId, state: reference.state,
      name: reference.name, speed: reference.speed, method: reference.method, reference: strategies.decorate(reference.set, DEFAULT_VERSIONS[c.generation]) }));
    send({ phase: 'searching', message: '搜索满足条件的六人队伍…', opponents, prepared: prepared.pool.length, dataMs, prepareMs: prepared.elapsedMs });
    const excludedRosters = rebuildPokemonIds.length ? [[...new Set(rebuildPokemonIds.map(id => refs.pokemon.find(pokemon => pokemon.id === id)?.speciesId))].sort((a, b) => a - b).join(',')] : [];
    let previewRevision = 0;
    const found = prepared.opponentIssues?.length ? diagnosticReport(prepared.opponentIssues, pool) : solve(pool, searchConditions, { names, references: refs.pokemon, excludedRosters,
      onPreview: results => send({ previewRevision: ++previewRevision, previews: results.map(result => ({
        key: result.members.map(entry => entry.id).sort().join(','), score: result.assessment.score, metrics: result.metrics,
        members: result.members.map(entry => ({ pokemonId: entry.pokemonId, name: entry.name, selection: entry.set.selection, speed: entry.speed })),
      })) }),
      onProgress: progress => send({ message: progress.phase === 'improving' ? '已找到可行队伍，正在改进与补充结果…' : '按条件搜索可行队伍…', ...progress }) });
    const issues = found.issues || (!found.results.length ? [{ kind: 'search', title: '当前条件组合未找到可行队伍', conditions: [],
      explanation: found.diagnostics.join(' ') || '目前无法定位到单独的冲突条件组合。', suggestions: ['可优先检查必带成员、共同弱点、速度和功能要求，逐项调整后重新计算。'] }] : []);
    if (BigInt(prepared.skipped)) warnings.push(prepared.skipped + ' 份缺少数值、被排除或无法用于当前机制的配置已跳过。');
    if (BigInt(prepared.earlyMechanics)) warnings.push('第一、二世代的培养机制不同，未自动转换这些培养数值；对应宝可梦可使用其他世代的完整配置。');
    if (BigInt(prepared.duplicates)) warnings.push('合并 ' + prepared.duplicates + ' 份对当前条件和排序等价的配置。');
    if (prepared.unknownMatchups) warnings.push('有 ' + prepared.unknownMatchups + ' 次对手比较含条件招式或未确认结果，未知项未计为已满足的打点或抗性。');
    const evaluate = opponents.length ? battle.opponentEvaluator({ opponents: prepared.opponentReferences.map(value => inScenario(value.set, value.state)), generation: c.generation, category: c.category, scenario: c.scenario }) : null;
    const results = found.results.map((result, index) => {
      const opponentMatchups = opponentReport(result.members, prepared.opponentReferences, c, battle, evaluate);
      const plan = playbook(result.members, c, names, prepared.opponentReferences, opponentMatchups);
      const title = '条件配队 · ' + (index + 1), id = 'assistant-' + runId + '-' + index;
      const members = result.members.map((entry, slot) => ({ ...entry.set, id: id + '-member-' + slot }));
      const summary = result.checks.map(check => check.label + '：' + check.count + (check.members.length ? '（' + check.members.join('、') + '）' : '')).join('\n');
      const scopeNote = '资料范围：' + (c.scopeGeneration ? '第 ' + c.scopeGeneration + ' 世代' : '全部世代') + '；' +
        (c.format === 'all' ? '不限来源规则' : c.format) + '。按第 ' + c.generation + ' 世代统一计算。';
      const team = teams.model.validate({ id, title, generation: c.generation, format: c.outputFormat, members,
        originalName: '', author: '', notes: scopeNote + '\n战况条件：' + scenarioText(c.scenario) + '\n按以下条件计算，后续编辑配置时请重新核对：\n' + summary +
          (opponents.length ? '\n\n对手参考配置：\n' + opponents.map(opponent => opponent.name + ' · ' + opponent.reference.title + ' · 常态速度 ' + opponent.speed + ' · ' +
            (names.abilities[opponent.reference.selection.ability] || opponent.reference.selection.ability) + ' · ' + (names.items[opponent.reference.selection.item] || opponent.reference.selection.item || '无道具') + ' · ' +
            opponent.reference.selection.moves.map(move => names.moves[move] || move).join('／') + ' · 性格 ' + (names.natures[opponent.reference.selection.nature] || opponent.reference.selection.nature) +
            ' · 努力值 ' + ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map(stat => opponent.reference.selection.evs[stat]).join('/') +
            ' · 个体值 ' + ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map(stat => opponent.reference.selection.ivs[stat]).join('/') +
            (opponent.reference.selection.teraType ? ' · 太晶属性 ' + (refs.types.find(type => type.english === opponent.reference.selection.teraType)?.name || opponent.reference.selection.teraType) : '') +
            ' · 状态 ' + stateText(opponent.state)).join('\n') + '\n对手努力值／个体值顺序：HP／攻击／防御／特攻／特防／速度。' : '') + '\n\n打法参考：\n' + playbookText(plan),
        sourceNotes: scopeNote + '\n成员使用完整来源配招。跨世代与跨规则组合需要核对学习方式、具体赛季和禁限名单；条件满足不代表实战胜率。',
        source: { provider: '条件配队助手', url: null, fetchedAt: new Date().toISOString() }, personal: false, originId: null }, DEFAULT_VERSIONS[c.generation]);
      return { team: teams.model.decorate(team, user.versionId || DEFAULT_VERSIONS[c.generation]), checks: result.checks, metrics: result.metrics, assessment: result.assessment,
        opponentMatchups, plan, scenarioSpeeds: result.members.map(entry => ({ pokemonId: entry.pokemonId, name: entry.name, normal: entry.speed,
          current: battle.stats({ fighter: inScenario(entry.set, c.scenario.teamState), generation: c.generation, field: c.scenario.field }).finalSpeed })) };
    });
    return { results, opponents, issues, diagnostics: found.diagnostics, warnings: [...new Set(warnings)], constraints: c, reason: found.reason,
      dataMs, prepareMs: prepared.elapsedMs, cacheHit: prepared.cacheHit, lockedPokemonIds: lockedSets.map(set => set.pokemonId), searchMs: found.elapsedMs, examined: found.examined,
      total: found.total, processed: found.processed, evaluated: found.evaluated, prunedCombinations: found.prunedCombinations,
      percent: found.percent, strategy: found.strategy, stage: found.stage, round: found.round,
      prepared: prepared.pool.length, species: found.availableSpecies, found: results.length };
  } finally { data.close(); }
}
if (!isMainThread) calculate(workerData, progress => parentPort.postMessage({ progress })).then(
  result => parentPort.postMessage({ result }), error => parentPort.postMessage({ error: error.message }));
module.exports = { calculate, prepare, variations, variationCount, sourceMatches };
