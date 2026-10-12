const calc = require('@smogon/calc');
const { pinyin } = require('pinyin-pro');
const { getFinalSpeed, getMoveEffectiveness, isGrounded } = require('@smogon/calc/dist/mechanics/util');
const { STATS, STAT_NAMES, DEFAULT_VERSIONS, vector } = require('./strategy-model.cjs');

const WEATHERS = ['', 'Sun', 'Rain', 'Sand', 'Hail', 'Snow', 'Harsh Sunshine', 'Heavy Rain', 'Strong Winds'];
const TERRAINS = ['', 'Electric', 'Grassy', 'Psychic', 'Misty'];
const STAT_KEYS = ['atk', 'def', 'spa', 'spd', 'spe'];
function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(label + '应为 ' + min + '～' + max + '。');
  return value;
}
function generation(value) { return integer(Number(value), 1, 9, '计算世代'); }
function createBattleService(data, strategies, teams) {
  const model = strategies.model, refs = strategies.references(), referenceCache = new Map();
  function speciesFor(id, name, gen) {
    const base = refs.pokemon.find(pokemon => pokemon.id === Number(id));
    if (!base) throw new Error('请选择有效的宝可梦。');
    const named = name ? model.resolve('pokemon', name) : base;
    if (!named || named.id !== base.id) throw new Error('宝可梦与形态名称不一致。');
    if (named.generation > gen) throw new Error(named.name + '在第 ' + gen + ' 世代尚未登场。');
    const dex = calc.Generations.get(gen);
    for (const candidate of [model.showdownName(named), named.english, named.identifier]) {
      const species = dex.species.get(calc.toID(candidate));
      if (species) return { species, ref: named };
    }
    throw new Error(named.name + '的这个形态尚未收录于第 ' + gen + ' 世代的计算数据。');
  }
  function canonical(kind, value, dex, allowEmpty = true) {
    if (!value && allowEmpty) return '';
    const ref = model.resolve(kind, value), name = ref?.english || value;
    if (typeof name !== 'string' || name.length > 100) throw new Error('配置名称无效。');
    const resolved = dex[kind].get(calc.toID(name));
    if (!resolved) throw new Error('第 ' + dex.num + ' 世代计算数据未收录：' + (ref?.name || value || '空配置') + '。');
    return resolved.name;
  }
  function conditions(input = {}, gen) {
    if (!input || typeof input !== 'object') throw new Error('场地设置无效。');
    const weather = input.weather || '', terrain = input.terrain || '';
    if (!WEATHERS.includes(weather) || !TERRAINS.includes(terrain)) throw new Error('天气或场地无效。');
    if (weather && gen === 1) throw new Error('第一世代没有天气机制。');
    if (weather === 'Hail' && gen < 3 || weather === 'Snow' && gen < 9 || ['Harsh Sunshine', 'Heavy Rain', 'Strong Winds'].includes(weather) && gen < 6) throw new Error('所选天气在这个世代尚未引入。');
    if (terrain && gen < 6) throw new Error('场地机制从第六世代引入。');
    if (input.gravity && gen < 4 || input.trickRoom && gen < 4) throw new Error('重力和戏法空间从第四世代引入。');
    if (input.gameType && !['Singles', 'Doubles'].includes(input.gameType)) throw new Error('请选择单打或双打。');
    if (input.gameType === 'Doubles' && gen < 3) throw new Error('双打从第三世代引入。');
    return { weather, terrain, gravity: input.gravity === true, trickRoom: input.trickRoom === true, gameType: input.gameType || 'Singles' };
  }
  function build(input, gen, options = {}) {
    if (!input || typeof input !== 'object' || JSON.stringify(input).length > 20000) throw new Error('宝可梦配置无效或过长。');
    if (input.missingFields?.length) throw new Error('来源未公开完整培养数值，无法计算能力或伤害。');
    const dex = calc.Generations.get(gen), selected = input.selection;
    if (!selected) throw new Error('缺少培养配置。');
    const { species, ref } = speciesFor(input.pokemonId, input.showdownSpecies, gen);
    integer(selected.level, 1, 100, '等级');
    for (const key of STATS) {
      integer(selected.ivs?.[key], 0, 31, STAT_NAMES[key] + '个体值');
      integer(selected.evs?.[key], 0, gen <= 5 ? 255 : 252, STAT_NAMES[key] + '努力值');
    }
    if (gen >= 3 && STATS.reduce((sum, key) => sum + selected.evs[key], 0) > 510) throw new Error('努力值总和不能超过 510。');
    const state = input.state || {}, boosts = vector(state.boosts, 0);
    if (selected.moves !== undefined && (!Array.isArray(selected.moves) || selected.moves.length > 4 || selected.moves.some(move => typeof move !== 'string' || move.length > 100))) throw new Error('招式配置无效。');
    for (const key of STAT_KEYS) integer(boosts[key], -6, 6, STAT_NAMES[key] + '能力等级');
    if (state.status && !['slp', 'psn', 'brn', 'frz', 'par', 'tox'].includes(state.status)) throw new Error('异常状态无效。');
    if (state.tailwind && gen < 4) throw new Error('顺风从第四世代引入。');
    if (state.teraActive && gen !== 9) throw new Error('太晶化仅适用于第九世代。');
    if (state.dynamax && gen !== 8) throw new Error('极巨化仅适用于第八世代。');
    const warnings = [];
    let ability = '', item = '';
    if (gen >= 3) ability = canonical('abilities', selected.ability || species.abilities?.[0], dex);
    if (gen >= 2 && selected.item) {
      try { item = canonical('items', selected.item, dex); }
      catch (error) { if (!options.allowUnknownItem) throw error; warnings.push(error.message + '能力值表忽略该道具的战斗修正。'); }
    }
    const nature = gen >= 3 ? canonical('natures', selected.nature, dex, false) : 'Serious';
    const teraType = state.teraActive ? canonical('types', selected.teraType, dex, false) : undefined;
    const ivs = structuredClone(selected.ivs), evs = structuredClone(selected.evs);
    if (gen === 1) { ivs.spd = ivs.spa; evs.spd = evs.spa; }
    if (gen === 2 && ivs.spd !== ivs.spa) { ivs.spd = ivs.spa; warnings.push('第二世代特攻与特防共用特殊 DV，已按特攻个体值计算。'); }
    const pokemon = new calc.Pokemon(dex, species.name, { level: selected.level, ivs, evs, ability, item, nature, boosts,
      gender: selected.gender, status: state.status || '', abilityOn: state.abilityOn === true,
      teraType, isDynamaxed: state.dynamax === true ? (selected.gigantamax ? 'gmax' : true) : undefined, dynamaxLevel: selected.dynamaxLevel,
      alliesFainted: integer(state.alliesFainted ?? 0, 0, 5, '已倒下队友数') });
    const hpPercent = integer(state.hpPercent ?? 100, 1, 100, '当前 HP 百分比');
    pokemon.originalCurHP = Math.max(1, Math.floor(pokemon.rawStats.hp * hpPercent / 100));
    if (gen <= 2) warnings.push('早期世代按 Showdown 的努力值等效值计算；HP 的 DV 由其他 DV 推导，性格不参与。');
    if (ability && !ref.abilityIds?.includes(model.resolve('abilities', ability)?.id)) warnings.push('当前形态的本地特性记录不含所选特性，请核对方案规则。');
    return { pokemon, ref, dex, warnings, state };
  }
  function side(state = {}) {
    return { isTailwind: state.tailwind === true, isReflect: state.reflect === true, isLightScreen: state.lightScreen === true,
      isAuroraVeil: state.auroraVeil === true, isHelpingHand: state.helpingHand === true, isFriendGuard: state.friendGuard === true,
      isProtected: state.protected === true, isSR: state.stealthRock === true, spikes: integer(state.spikes ?? 0, 0, 3, '撒菱层数') };
  }
  function fieldFor(common, attacker, defender) {
    return new calc.Field({ gameType: common.gameType, weather: common.weather || undefined, terrain: common.terrain || undefined,
      isGravity: common.gravity, attackerSide: side(attacker?.state), defenderSide: side(defender?.state) });
  }
  function report(fighter, gen, common, field) {
    const pokemon = fighter.pokemon, speed = getFinalSpeed(calc.Generations.get(gen), pokemon, field || fieldFor(common, fighter), side(fighter.state));
    return { pokemonId: fighter.ref.id, name: fighter.ref.name, engineName: pokemon.name, level: pokemon.level,
      stats: { ...pokemon.rawStats }, baseStats: { ...pokemon.species.baseStats }, finalSpeed: speed,
      types: (pokemon.teraType && pokemon.teraType !== 'Stellar' ? [pokemon.teraType] : pokemon.types).map(type => ({ id: model.resolve('types', type)?.id || 0, name: model.display('types', type) })),
      ivsUsed: { ...pokemon.ivs }, warnings: fighter.warnings };
  }
  function moveFor(name, fighter, args = {}) {
    if (typeof name !== 'string' || !name || name.length > 100) throw new Error('请选择有效的招式。');
    const ref = model.resolve('moves', name);
    let canonicalName = /^hidden power\b/i.test(name) ? name : ref?.english || name;
    if (!fighter.dex.moves.get(calc.toID(canonicalName))) throw new Error('这个世代的计算数据未收录招式：' + (ref?.name || name) + '。');
    const pokemon = fighter.pokemon;
    const definition = fighter.dex.moves.get(calc.toID(canonicalName));
    let hits;
    if (definition.multihit && args.hits !== undefined) {
      const max = Array.isArray(definition.multihit) ? definition.multihit[1] : definition.multihit;
      hits = integer(args.hits, 1, max, '该招式连续命中次数');
    }
    return new calc.Move(fighter.dex, canonicalName, { isCrit: args.critical === true, useZ: args.useZ === true,
      hits,
      ability: pokemon.ability, item: pokemon.item, species: pokemon.name,
      useMax: fighter.state.dynamax === true ? (fighter.pokemon.isDynamaxed === 'gmax' ? 'gmax' : true) : false });
  }
  function referenceList(input) {
    const gen = generation(input);
    if (referenceCache.has(gen)) return referenceCache.get(gen);
    const dex = calc.Generations.get(gen), pokemon = [], used = new Set();
    for (const ref of [...refs.pokemon, ...(refs.pokemonForms || [])]) {
      try {
        const { species } = speciesFor(ref.id, ref.english, gen), key = ref.id + ':' + species.name;
        if (used.has(key)) continue; used.add(key);
        const searchKey = [ref.name, ref.english, species.name, ref.id, pinyin(ref.name, { toneType: 'none' }), pinyin(ref.name, { pattern: 'first', toneType: 'none' })].join('').toLowerCase().replace(/\s/g, '');
        pokemon.push({ ...ref, engineName: species.name, searchKey });
      } catch { /* Keep unsupported forms out of the calculator pickers. */ }
    }
    const filter = kind => [...dex[kind]].map(entry => {
      const ref = model.resolve(kind, entry.name);
      return ref ? { ...ref, english: entry.name } : { id: -1, identifier: entry.id, english: entry.name, name: entry.name };
    });
    const value = { generation: gen, pokemon, items: filter('items'), abilities: gen >= 3 ? filter('abilities') : [], natures: refs.natures,
      moves: filter('moves'), types: filter('types').filter(type => type.english !== '???') };
    referenceCache.set(gen, value); return value;
  }
  function draft({ pokemonId, generation: input, speciesName }) {
    const gen = generation(input), { species, ref } = speciesFor(pokemonId, speciesName, gen);
    const detail = model.pokemonDetail(ref.id, DEFAULT_VERSIONS[gen]), dex = calc.Generations.get(gen);
    const learned = detail.learnset.filter(move => move.damageClass !== 1 && dex.moves.get(calc.toID(refs.moves.find(entry => entry.id === move.id)?.english || '')));
    const moves = [...new Set(learned.map(move => refs.moves.find(entry => entry.id === move.id)?.english).filter(Boolean))].slice(0, 4);
    return { pokemonId: ref.id, showdownSpecies: model.showdownName(ref),
      selection: { level: 50, ability: gen >= 3 ? species.abilities?.[0] || '' : '', nature: 'Serious', item: '', teraType: '',
        evs: vector(null, gen <= 2 ? 252 : 0), ivs: vector(null, 31), moves },
      state: { hpPercent: 100, boosts: vector(null, 0), status: '', tailwind: false, abilityOn: false } };
  }
  function stats({ fighter, generation: input, field = {} }) {
    const gen = generation(input), common = conditions(field, gen), built = build(fighter, gen, { allowUnknownItem: true });
    return report(built, gen, common);
  }
  function damage(args) {
    const gen = generation(args.generation), common = conditions(args.field, gen);
    if (args.useZ && gen < 7) throw new Error('Z 招式从第七世代引入。');
    const attacker = build(args.attacker, gen), defender = build(args.defender, gen), field = fieldFor(common, attacker, defender);
    const chosenMoves = args.move ? [args.move] : args.attacker.selection.moves?.filter(Boolean);
    if (!chosenMoves?.length || chosenMoves.length > 4) throw new Error('请选择 1～4 个攻击招式。');
    let effectiveField = field;
    const results = chosenMoves.map(name => {
      const move = moveFor(name, attacker, args), result = calc.calculate(gen, attacker.pokemon.clone(), defender.pokemon.clone(), move, field.clone());
      effectiveField = result.field;
      const [min, max] = result.range(), hp = result.defender.maxHP();
      let ko; try { ko = max > 0 && result.move.category !== 'Status' ? result.kochance(false) : null; } catch { ko = null; }
      const flat = Array.isArray(result.damage) ? result.damage.flat() : [result.damage];
      const oneHitChance = flat.length && !Array.isArray(result.damage?.[0]) ? flat.filter(value => value >= result.defender.curHP()).length / flat.length : null;
      return { move: model.display('moves', name), englishMove: name, type: model.display('types', result.move.type), category: result.move.category,
        min, max, minPercent: Math.floor(min / hp * 1000) / 10, maxPercent: Math.floor(max / hp * 1000) / 10,
        targetHP: hp, currentHP: result.defender.curHP(), oneHitChance: ko?.n === 1 && ko.chance !== undefined ? ko.chance : oneHitChance,
        ko: ko ? { n: ko.n, chance: ko.chance ?? null, originalText: ko.text } : null,
        rolls: Array.isArray(result.damage?.[0]) ? null : flat, description: max > 0 && result.move.category !== 'Status' ? result.fullDesc('%', false) : '该招式没有直接伤害，或在当前条件下无效。' };
    });
    const speedA = report(attacker, gen, common, effectiveField), speedD = report(defender, gen, common, effectiveField);
    return { generation: gen, attacker: speedA, defender: speedD, results,
      speed: { attacker: speedA.finalSpeed, defender: speedD.finalSpeed, tie: speedA.finalSpeed === speedD.finalSpeed,
        first: speedA.finalSpeed === speedD.finalSpeed ? 'tie' : (common.trickRoom ? speedA.finalSpeed < speedD.finalSpeed : speedA.finalSpeed > speedD.finalSpeed) ? 'attacker' : 'defender' },
      note: '击倒概率以招式命中为前提，双打群攻按命中多目标计算。速度顺序按相同优先度比较；临时特性触发、招式连用和特殊状态请按实际战况设置。' };
  }
  function defensiveMultiplier(gen, fighter, attackType, field) {
    const pokemon = fighter.pokemon;
    const types = pokemon.teraType && pokemon.teraType !== 'Stellar' ? [pokemon.teraType] : pokemon.types;
    const chart = calc.Generations.get(gen).types.get(calc.toID(attackType)).effectiveness;
    let value = types.reduce((product, type) => product * (attackType === 'Ground' && type === 'Flying' && (field.isGravity || pokemon.hasItem('Iron Ball')) ? 1 : chart[type] ?? 1), 1);
    const immunities = { Water: ['Water Absorb', 'Storm Drain', 'Dry Skin'], Electric: ['Volt Absorb', 'Lightning Rod', 'Motor Drive'], Fire: ['Flash Fire', 'Well-Baked Body'], Grass: ['Sap Sipper'], Ground: ['Earth Eater'] };
    if (immunities[attackType]?.includes(pokemon.ability) && !(gen < 5 && ['Storm Drain', 'Lightning Rod'].includes(pokemon.ability))) value = 0;
    if (attackType === 'Ground' && !isGrounded(pokemon, field)) value = 0;
    if (pokemon.hasAbility('Thick Fat') && ['Fire', 'Ice'].includes(attackType)) value *= .5;
    if (pokemon.hasAbility('Heatproof') && attackType === 'Fire') value *= .5;
    if (pokemon.hasAbility('Dry Skin') && attackType === 'Fire') value *= 1.25;
    if (pokemon.hasAbility('Wonder Guard') && value <= 1) value = 0;
    return value;
  }
  function analyze({ team, level = 'source', field = {} }) {
    const gen = generation(team?.generation), common = conditions({ ...field, gameType: team?.category === 'doubles' ? 'Doubles' : 'Singles' }, gen);
    const snapshot = teams.model.validate(team, DEFAULT_VERSIONS[gen]);
    if (!['source', 50, 100].includes(level)) throw new Error('请选择原配置等级、50 级或 100 级。');
    const members = snapshot.members.map(member => {
      const fighter = { ...member, selection: { ...member.selection, level: level === 'source' ? member.selection.level : level }, state: field.members?.[member.id] || {} };
      const built = build(fighter, gen, { allowUnknownItem: true });
      return { ...report(built, gen, common), id: member.id, fighter, built, roles: teams.model.roles(member) };
    });
    const types = refs.types.filter(type => type.id <= 18 && (!type.generation || type.generation <= gen));
    const defensive = types.map(type => {
      const values = members.map(member => defensiveMultiplier(gen, member.built, type.english, fieldFor(common, member.built)));
      return { id: type.id, name: type.name, values, weak: values.filter(value => value > 1).length,
        resist: values.filter(value => value > 0 && value < 1).length, immune: values.filter(value => value === 0).length };
    });
    const offensive = types.map(type => {
      const moves = members.flatMap(member => member.fighter.selection.moves.flatMap(name => {
        try {
          const move = moveFor(name, member.built);
          if (move.category === 'Status') return [];
          return getMoveEffectiveness(member.built.dex, move, type.english, false, common.gravity, false) > 1 ?
            [{ pokemon: member.name, move: model.display('moves', name), type: model.display('types', move.type) }] : [];
        } catch { return []; }
      }));
      return { id: type.id, name: type.name, moves };
    });
    const observations = [];
    for (const row of defensive) if (row.weak >= 3) observations.push({ kind: row.resist + row.immune ? 'review' : 'weakness',
      text: row.weak + ' 位成员弱' + row.name + '；' + (row.resist + row.immune ? '有 ' + (row.resist + row.immune) + ' 位抗性／免疫成员可以参考。' : '没有对应抗性或免疫成员。') });
    const roles = [...new Set(members.flatMap(member => member.roles))];
    if (!roles.includes('速度控制')) observations.push({ kind: 'review', text: '配置中未识别到顺风、空间或常见降速招式，请结合成员速度与规则判断是否需要补充。' });
    if (snapshot.category === 'singles' && !roles.includes('清理场地')) observations.push({ kind: 'review', text: '未识别到清理场地招式，可结合厚底靴、进攻节奏和规则判断是否需要调整。' });
    const sorted = [...members].sort((a, b) => common.trickRoom ? a.finalSpeed - b.finalSpeed : b.finalSpeed - a.finalSpeed);
    return { generation: gen, level, members: members.map(({ built, ...member }) => member), defensive, offensive, observations, roles,
      speedOrder: sorted.map(member => member.id), warnings: [...new Set(members.flatMap(member => member.warnings))],
      note: '防御表按常态属性与常见固定免疫／减伤整理，默认特性生效、气球未破；不计其他天气、场地、无视特性和接触招式等特例。打击面按单属性目标和招式基础属性统计，不等于实战能击倒对手。' };
  }
  return { references: referenceList, draft, stats, damage, analyze };
}
module.exports = { createBattleService };
