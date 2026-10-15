const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { pinyin } = require('pinyin-pro');
const { createDexQueries } = require('./dex-queries.cjs');

const VERSION_NAMES = {
  1: '红／蓝', 2: '皮卡丘', 3: '金／银', 4: '水晶', 5: '红宝石／蓝宝石',
  6: '绿宝石', 7: '火红／叶绿', 8: '钻石／珍珠', 9: '白金', 10: '心金／魂银',
  11: '黑／白', 12: '竞技场', 13: 'XD', 14: '黑２／白２', 15: 'X／Y',
  16: '欧米伽红宝石／阿尔法蓝宝石', 17: '太阳／月亮', 18: '究极之日／究极之月',
  19: 'Let’s Go! 皮卡丘／伊布', 20: '剑／盾', 21: '剑／盾 · 铠之孤岛',
  22: '剑／盾 · 冠之雪原', 23: '晶灿钻石／明亮珍珠', 24: '传说 阿尔宙斯',
  25: '朱／紫', 26: '朱／紫 · 碧之假面', 27: '朱／紫 · 蓝之圆盘',
  28: '红／绿（日版）', 29: '蓝（日版）', 30: '传说 Z-A', 31: 'Z-A · 超次元', 32: 'Champions',
};
const METHOD_NAMES = { 1: '升级', 2: '遗传', 3: '教学', 4: '招式机', 5: '活动',
  6: '电气球遗传', 7: '净化', 8: '暗影', 9: '净化', 10: '形态变化', 11: '特殊', 12: '训练' };
const STAT_NAMES = { 1: 'HP', 2: '攻击', 3: '防御', 4: '特攻', 5: '特防', 6: '速度', 9: '特殊' };
const GENERATION_NAMES = ['', '关都', '城都', '丰缘', '神奥', '合众', '卡洛斯', '阿罗拉', '伽勒尔／洗翠', '帕底亚'];
const CLASS_NAMES = { 1: '变化', 2: '物理', 3: '特殊' };
const cleanText = value => (value || '').replace(/[\n\r\f]+/g, '').replace(/\s+/g, ' ').trim();
const normalize = value => String(value || '').toLowerCase().replace(/[\s·・\-_'’./＇]/g, '');

function historicalRows(current, past, generation, valueKey) {
  return current.map(row => {
    const previous = past.filter(entry => entry[valueKey] === row[valueKey] && entry.generation_id >= generation)
      .sort((a, b) => a.generation_id - b.generation_id)[0];
    return previous ? { ...row, ...previous } : row;
  });
}

function createDataService(databasePath, aliasPath = path.join(path.dirname(databasePath), 'aliases.json')) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  db.exec('PRAGMA busy_timeout=5000');
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const versions = all('SELECT * FROM version_groups ORDER BY "order"').map(v => ({
    id: v.id, name: VERSION_NAMES[v.id] || v.identifier, generation: v.generation_id, order: v.order,
    learnsetCount: one('SELECT COUNT(*) AS count FROM pokemon_moves WHERE version_group_id=?', v.id).count,
  }));
  const versionMap = new Map(versions.map(v => [v.id, v]));
  const aliases = JSON.parse(readFileSync(aliasPath, 'utf8'));
  const localNames = (table, key, field = 'name') => {
    const values = new Map();
    for (const language of [9, 4, 12]) for (const row of all(`SELECT ${key}, ${field} FROM ${table} WHERE local_language_id=?`, language)) {
      if (row[field]) values.set(row[key], row[field]);
    }
    return values;
  };
  const typeNames = localNames('type_names', 'type_id');
  const abilityNames = localNames('ability_names', 'ability_id');
  const moveNames = localNames('move_names', 'move_id');
  const itemNames = localNames('item_names', 'item_id');
  const eggNames = localNames('egg_group_prose', 'egg_group_id');
  const locationNames = localNames('location_names', 'location_id');
  const regionNames = localNames('region_names', 'region_id');
  const rawPokemon = all('SELECT payload FROM dex_entries ORDER BY species_id, is_default DESC, id').map(row => JSON.parse(row.payload));
  const pokemonMap = new Map(rawPokemon.map(poke => [poke.id, poke]));
  const defaultPokemon = new Map(rawPokemon.filter(poke => poke.isDefault).map(poke => [poke.speciesId, poke]));
  const cachedCatalog = new Map();
  const typeRecords = all('SELECT * FROM types WHERE id <=18').map(row => ({ id: row.id, name: typeNames.get(row.id), generation: row.generation_id }));
  const moves = new Map(all('SELECT * FROM moves').map(row => [row.id, row]));
  const moveChanges = new Map();
  for (const row of all('SELECT * FROM move_changelog')) {
    if (!moveChanges.has(row.move_id)) moveChanges.set(row.move_id, []);
    moveChanges.get(row.move_id).push(row);
  }
  const machineMap = new Map(all('SELECT * FROM machines').map(row => [`${row.version_group_id}:${row.move_id}`, row.machine_number]));
  const versionToGroup = new Map(all('SELECT id, version_group_id FROM versions').map(row => [row.id, row.version_group_id]));
  const effectiveness = all('SELECT * FROM type_efficacy');
  const pastEffectiveness = all('SELECT * FROM type_efficacy_past');
  const entityCache = new Map();
  let itemGenerations = null;
  try {
    const payload = JSON.parse(readFileSync(path.join(path.dirname(databasePath), 'item-generations.json'), 'utf8'));
    if (payload.schemaVersion === 1 && payload.generations && Object.values(payload.generations).every(ids => Array.isArray(ids) && ids.every(Number.isInteger))) {
      itemGenerations = new Map(Object.entries(payload.generations).map(([generation, ids]) => [Number(generation), new Set(ids)]));
    }
  } catch { /* Older data packs can still show the full item reference library. */ }
  const searchKeys = new Map(rawPokemon.map(poke => {
    const Chinese = `${poke.name}${poke.formName}`;
    const romanized = pinyin(Chinese, { toneType: 'none', type: 'array' });
    return [poke.id, normalize([Chinese, poke.englishName, poke.identifier, ...(aliases[poke.speciesId] || []),
      romanized.join(''), romanized.map(part => part[0]).join('')].join(' '))];
  }));

  function getVersion(id) {
    const version = versionMap.get(Number(id));
    if (!version) throw new Error('请选择有效的资料规则版本。');
    return version;
  }
  function learnsetVersion(version) {
    if (version.learnsetCount) return version;
    const inherited = ({ 21: 20, 22: 20, 26: 25, 27: 25 })[version.id];
    return inherited ? versionMap.get(inherited) : null;
  }
  function resolvedPokemon(id, versionId) {
    const version = getVersion(versionId);
    const raw = pokemonMap.get(Number(id));
    if (!raw) throw new Error('未找到这只宝可梦。');
    const pastType = raw.pastTypes.filter(row => row.generation_id >= version.generation)
      .sort((a, b) => a.generation_id - b.generation_id)[0];
    const types = (pastType ? raw.pastTypes.filter(row => row.generation_id === pastType.generation_id) : raw.types)
      .sort((a, b) => a.slot - b.slot).map(row => row.type_id);
    let stats = historicalRows(raw.stats, raw.pastStats, version.generation, 'stat_id')
      .filter(row => row.stat_id <= 6).sort((a, b) => a.stat_id - b.stat_id)
      .map(row => ({ id: row.stat_id, name: STAT_NAMES[row.stat_id], value: row.base_stat, effort: row.effort }));
    if (version.generation === 1) {
      const special = raw.pastStats.find(row => row.stat_id === 9 && row.generation_id === 1);
      stats = stats.filter(row => row.id !== 5).map(row => row.id === 4 ? { ...row, id: 9, name: '特殊', value: special?.base_stat ?? row.value } : row);
    }
    const abilities = version.generation < 3 ? [] : historicalRows(raw.abilities, raw.pastAbilities, version.generation, 'slot')
      .filter(row => row.ability_id && one('SELECT generation_id FROM abilities WHERE id=?', row.ability_id)?.generation_id <= version.generation)
      .map(row => ({ id: row.ability_id, name: abilityNames.get(row.ability_id), hidden: Boolean(row.is_hidden) }));
    const { pastTypes, pastStats, pastAbilities, ...base } = raw;
    return { ...base, types, stats, abilities, total: stats.reduce((sum, stat) => sum + stat.value, 0),
      searchKey: searchKeys.get(raw.id), aliases: aliases[raw.speciesId] || [],
      available: raw.generation <= version.generation && raw.introducedOrder <= version.order };
  }
  function catalog(versionId) {
    const version = getVersion(versionId);
    if (!cachedCatalog.has(version.id)) cachedCatalog.set(version.id, rawPokemon.map(poke => resolvedPokemon(poke.id, version.id)).filter(poke => poke.available));
    return cachedCatalog.get(version.id);
  }
  function flavor(table, key, id, version, species = false) {
    const rows = all(`SELECT * FROM ${table} WHERE ${key}=? AND language_id IN (12,4)`, id);
    const getGroup = row => species ? versionToGroup.get(row.version_id) : row.version_group_id;
    const matching = rows.filter(row => getGroup(row) === version.id).sort((a, b) => b.language_id - a.language_id)[0];
    if (matching) return { text: cleanText(matching.flavor_text), referenceVersion: null };
    const fallback = rows.filter(row => versionMap.has(getGroup(row))).sort((a, b) =>
      (b.language_id - a.language_id) || Math.abs(versionMap.get(getGroup(a)).order - version.order) - Math.abs(versionMap.get(getGroup(b)).order - version.order))[0];
    if (fallback) return { text: cleanText(fallback.flavor_text), referenceVersion: versionMap.get(getGroup(fallback)).name };
    return { text: '这项资料暂未提供中文说明。', referenceVersion: null };
  }
  function moveAt(id, versionId) {
    const version = getVersion(versionId);
    const current = moves.get(Number(id));
    if (!current) throw new Error('未找到这个招式。');
    const move = { ...current };
    const changes = (moveChanges.get(move.id) || []).filter(change => versionMap.get(change.changed_in_version_group_id).order > version.order)
      .sort((a, b) => versionMap.get(a.changed_in_version_group_id).order - versionMap.get(b.changed_in_version_group_id).order);
    for (const field of ['type_id', 'power', 'pp', 'accuracy', 'priority', 'target_id', 'effect_id', 'effect_chance']) {
      const old = changes.find(change => change[field] !== null);
      if (old) move[field] = old[field];
    }
    if (version.generation <= 3 && move.damage_class_id !== 1) {
      move.damage_class_id = [10, 11, 12, 13, 14, 15, 16, 17].includes(move.type_id) ? 3 : 2;
    }
    return { id: move.id, name: moveNames.get(move.id) || move.identifier, identifier: move.identifier,
      generation: move.generation_id, type: move.type_id, power: move.power, pp: move.pp, accuracy: move.accuracy,
      priority: move.priority, damageClass: move.damage_class_id, className: CLASS_NAMES[move.damage_class_id], effectChance: move.effect_chance };
  }
  function matchup(types, versionId) {
    const version = getVersion(versionId);
    if (!Array.isArray(types) || types.length < 1 || types.length > 2 || new Set(types).size !== types.length || types.some(id => !typeRecords.some(t => t.id === id && t.generation <= version.generation))) {
      throw new Error('请选择一至两个不同的有效属性。');
    }
    return typeRecords.filter(type => type.generation <= version.generation).map(type => {
      let multiplier = 1;
      for (const defenseType of types) {
        const current = effectiveness.find(row => row.damage_type_id === type.id && row.target_type_id === defenseType)?.damage_factor ?? 100;
        const past = pastEffectiveness.filter(row => row.damage_type_id === type.id && row.target_type_id === defenseType && row.generation_id >= version.generation)
          .sort((a, b) => a.generation_id - b.generation_id)[0];
        multiplier *= (past?.damage_factor ?? current) / 100;
      }
      return { id: type.id, name: type.name, multiplier };
    });
  }
  function entityList(kind, versionId) {
    const version = getVersion(versionId);
    const cacheKey = `${kind}:${version.id}`;
    if (entityCache.has(cacheKey)) return entityCache.get(cacheKey);
    let list;
    if (kind === 'moves') list = [...moves.values()].filter(row => row.generation_id <= version.generation).map(row => moveAt(row.id, version.id));
    else if (kind === 'abilities') list = all('SELECT * FROM abilities WHERE is_main_series=1 AND generation_id<=?', version.generation)
      .map(row => ({ id: row.id, name: abilityNames.get(row.id) || row.identifier, identifier: row.identifier, generation: row.generation_id }));
    else if (kind === 'items') list = all('SELECT * FROM items').filter(row => !itemGenerations?.has(version.generation) || itemGenerations.get(version.generation).has(row.id))
      .map(row => ({ id: row.id, name: itemNames.get(row.id) || row.identifier, identifier: row.identifier, category: row.category_id, cost: row.cost }));
    else throw new Error('未知的资料分类。');
    list = list.map(entry => {
      const parts = pinyin(entry.name, { toneType: 'none', type: 'array' });
      return { ...entry, searchKey: normalize(`${entry.name} ${entry.identifier} ${parts.join('')} ${parts.map(part => part[0]).join('')}`) };
    });
    entityCache.set(cacheKey, list);
    return list;
  }
  function itemScope(versionId) {
    const version = getVersion(versionId), indexed = Boolean(itemGenerations?.has(version.generation));
    return { generation: version.generation, indexed, notice: indexed ?
      '道具列表按第 ' + version.generation + ' 世代的游戏索引整理；同世代游戏的可获得性可能不同。说明引用其他版本时会注明。' :
      '资料包缺少这个世代的道具索引，当前显示完整道具资料库；说明中的参考版本不代表道具在当前游戏可获得。' };
  }
  function entityDetail(kind, id, versionId) {
    const version = getVersion(versionId);
    id = Number(id);
    if (!Number.isInteger(id)) throw new Error('无效的资料编号。');
    if (kind === 'moves') {
      const move = moveAt(id, version.id);
      const learningVersion = learnsetVersion(version);
      return { ...move, kind, ...flavor('move_flavor_text', 'move_id', id, version),
        meta: one('SELECT * FROM move_meta WHERE move_id=?', id) || null,
        machineNumber: machineMap.get(`${learningVersion?.id || version.id}:${id}`) ?? null,
        learners: all('SELECT DISTINCT d.payload FROM pokemon_moves pm JOIN dex_entries d ON pm.pokemon_id=d.id WHERE pm.move_id=? AND pm.version_group_id=? ORDER BY d.species_id, d.is_default DESC LIMIT 36', id, learningVersion?.id || version.id)
          .map(row => resolvedPokemon(JSON.parse(row.payload).id, version.id)),
        learnsetReference: learningVersion && learningVersion.id !== version.id ? learningVersion.name : null };
    }
    if (kind === 'abilities') {
      const ability = one('SELECT * FROM abilities WHERE id=?', id);
      if (!ability) throw new Error('未找到这个特性。');
      return { ...ability, name: abilityNames.get(id) || ability.identifier, kind,
        ...flavor('ability_flavor_text', 'ability_id', id, version),
        learners: catalog(version.id).filter(poke => poke.abilities.some(a => a.id === id)).slice(0, 36) };
    }
    if (kind === 'items') {
      const item = one('SELECT * FROM items WHERE id=?', id);
      if (!item) throw new Error('未找到这个道具。');
      const categoryNames = localNames('item_category_prose', 'item_category_id');
      return { ...item, name: itemNames.get(id) || item.identifier, kind,
        categoryName: categoryNames.get(item.category_id) || '道具',
        image: `assets/items/${id}.png`, ...flavor('item_flavor_text', 'item_id', id, version) };
    }
    throw new Error('未知的资料分类。');
  }
  function evolutionCondition(row) {
    const parts = [];
    const trigger = row.evolution_trigger_id;
    if (trigger === 1) parts.push(row.minimum_level ? `等级达到 ${row.minimum_level}` : '等级提升');
    else if (trigger === 2) parts.push('通信交换');
    else if (trigger === 3) parts.push(`使用${itemNames.get(row.trigger_item_id) || '进化道具'}`);
    else if (trigger === 4) parts.push('进化时队伍留有空位，并持有精灵球');
    else parts.push(({ 5: '旋转角色', 6: '挑战恶之塔', 7: '挑战水之塔', 8: '一场战斗中击中要害 3 次',
      9: '受到足够伤害后前往指定地点', 10: '战斗中提升等级', 11: '使用迅疾招式', 12: '使用刚猛招式',
      13: '累积反作用力伤害后升级', 14: '使用指定招式', 15: '击败 3 只持有头领凭证的劈斩司令后升级',
      16: '收集 999 枚索财灵的硬币后升级', 17: '使用 400 个美录坦的糖果', 18: '特殊进化条件' })[trigger] || '特殊进化条件');
    if (row.held_item_id) parts.push(`携带${itemNames.get(row.held_item_id) || '指定道具'}`);
    if (row.gender_id) parts.push(({ 1: '雌性', 2: '雄性', 3: '无性别' })[row.gender_id]);
    if (row.minimum_happiness) parts.push(`亲密度 ≥ ${row.minimum_happiness}`);
    if (row.minimum_beauty) parts.push(`美丽度 ≥ ${row.minimum_beauty}`);
    if (row.minimum_affection) parts.push(`友好度 ≥ ${row.minimum_affection}`);
    if (row.time_of_day) parts.push(({ day: '白天', night: '夜晚', dusk: '黄昏' })[row.time_of_day] || '指定时段');
    if (row.location_id) parts.push(`在${locationNames.get(row.location_id) || '指定地点'}`);
    if (row.known_move_id) parts.push(`学会${moveNames.get(row.known_move_id) || '指定招式'}`);
    if (row.known_move_type_id) parts.push(`学会${typeNames.get(row.known_move_type_id)}属性招式`);
    if (row.relative_physical_stats !== null) parts.push(({ '-1': '攻击低于防御', '0': '攻击等于防御', '1': '攻击高于防御' })[row.relative_physical_stats]);
    if (row.party_species_id) parts.push(`队伍中有${defaultPokemon.get(row.party_species_id)?.name || '指定宝可梦'}`);
    if (row.party_type_id) parts.push(`队伍中有${typeNames.get(row.party_type_id)}属性宝可梦`);
    if (row.trade_species_id) parts.push(`与${defaultPokemon.get(row.trade_species_id)?.name || '指定宝可梦'}交换`);
    if (row.needs_overworld_rain) parts.push('下雨时');
    if (row.turn_upside_down) parts.push('倒转游戏设备');
    if (row.needs_multiplayer) parts.push('多人游玩时');
    if (row.near_special_rock) parts.push(row.near_special_rock === 1 ? '苔藓岩石附近' : '冰冻岩石附近');
    if (row.region_id) parts.push(`${regionNames.get(row.region_id) || '指定'}地区`);
    if (row.used_move_id) parts.push(`使用${moveNames.get(row.used_move_id) || '指定招式'}${row.minimum_move_count ? ` ${row.minimum_move_count} 次` : ''}`);
    if (row.minimum_steps) parts.push(`同行 ${row.minimum_steps} 步`);
    if (row.minimum_damage_taken) parts.push(`累积受到 ${row.minimum_damage_taken} 点伤害`);
    if (row.percentage_chance) parts.push(`出现概率 ${row.percentage_chance}%`);
    if (row.nature_bitmask) parts.push('符合指定性格');
    if (row.condition_expression) parts.push('还需满足游戏中的特殊条件');
    return parts.filter(Boolean).join(' · ');
  }
  function evolution(pokemon, versionId) {
    const version = getVersion(versionId);
    const family = catalog(version.id).filter(poke => poke.chainId === pokemon.chainId && poke.isDefault);
    const availableSpecies = new Set(family.map(poke => poke.speciesId));
    const edges = [];
    for (const target of family.filter(poke => poke.parentSpeciesId && availableSpecies.has(poke.parentSpeciesId))) {
      const eligible = all('SELECT * FROM pokemon_evolution WHERE evolved_species_id=?', target.speciesId)
        .filter(row => versionMap.has(row.version_group_id) && versionMap.get(row.version_group_id).order <= version.order);
      let relevant = eligible.filter(row => row.is_default || versionMap.get(row.version_group_id).generation === version.generation);
      if (!relevant.length && eligible.length) {
        const newest = Math.max(...eligible.map(row => versionMap.get(row.version_group_id).order));
        relevant = eligible.filter(row => versionMap.get(row.version_group_id).order === newest);
      }
      const groups = new Map();
      for (const row of relevant) {
        const key = `${row.evolution_trigger_id}:${row.evolved_pokemon_form_id || 0}:${row.required_pokemon_form_id || 0}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
      }
      for (let rows of groups.values()) {
        const newest = Math.max(...rows.map(row => versionMap.get(row.version_group_id).order));
        rows = rows.filter(row => versionMap.get(row.version_group_id).order === newest);
        const form = rows[0].evolved_pokemon_form_id ? one('SELECT pokemon_id FROM pokemon_forms WHERE id=?', rows[0].evolved_pokemon_form_id) : null;
        const to = form ? resolvedPokemon(form.pokemon_id, version.id) : target;
        if (!to.available) continue;
        edges.push({ from: target.parentSpeciesId, to: to.id, pokemon: to,
          conditions: [...new Set(rows.map(evolutionCondition))],
          referenceVersion: !rows[0].is_default && rows[0].version_group_id !== version.id ? versionMap.get(rows[0].version_group_id).name : null });
      }
    }
    return { roots: family.filter(poke => !poke.parentSpeciesId || !availableSpecies.has(poke.parentSpeciesId)), edges };
  }
  function pokemonDetail(id, versionId) {
    const version = getVersion(versionId);
    const pokemon = resolvedPokemon(id, version.id);
    const learningVersion = learnsetVersion(version);
    const learnset = all('SELECT move_id, pokemon_move_method_id, level FROM pokemon_moves WHERE pokemon_id=? AND version_group_id=? ORDER BY pokemon_move_method_id, level, move_id', pokemon.id, learningVersion?.id || version.id)
      .map(row => ({ ...moveAt(row.move_id, version.id), methodId: row.pokemon_move_method_id,
        method: METHOD_NAMES[row.pokemon_move_method_id] || '特殊', level: row.level,
        machineNumber: machineMap.get(`${learningVersion?.id || version.id}:${row.move_id}`) ?? null }));
    const descriptions = flavor('pokemon_species_flavor_text', 'species_id', pokemon.speciesId, version, true);
    return { ...pokemon, ...descriptions, version, learnset,
      learnsetReference: learningVersion && learningVersion.id !== version.id ? learningVersion.name : null,
      eggGroups: all('SELECT egg_group_id FROM pokemon_egg_groups WHERE species_id=?', pokemon.speciesId).map(row => eggNames.get(row.egg_group_id)),
      forms: catalog(version.id).filter(poke => poke.speciesId === pokemon.speciesId),
      matchup: matchup(pokemon.types, version.id), evolution: evolution(pokemon, version.id) };
  }
  const manifest = JSON.parse(readFileSync(path.join(path.dirname(databasePath), 'manifest.json'), 'utf8'));
  let strategyReferences;
  function references() {
    if (strategyReferences) return strategyReferences;
    const entities = (table, namesTable, key, chinese) => {
      const englishNames = new Map(all(`SELECT ${key}, name FROM ${namesTable} WHERE local_language_id=9`).map(row => [row[key], row.name]));
      return all(`SELECT * FROM ${table}`).map(row => ({ id: row.id, identifier: row.identifier,
        name: chinese.get(row.id) || row.identifier, english: englishNames.get(row.id) || row.identifier,
        generation: row.generation_id || null, type: row.type_id || null }));
    };
    strategyReferences = {
      pokemon: rawPokemon.map(p => ({ id: p.id, speciesId: p.speciesId, name: p.formName ? `${p.name} · ${p.formName}` : p.name,
        english: p.isDefault ? p.englishName : p.identifier, identifier: p.identifier,
        generation: Math.max(p.generation, versions.find(version => version.order === p.introducedOrder)?.generation || p.generation),
        isDefault: p.isDefault, aliases: aliases[p.speciesId] || [],
        abilityIds: [...new Set([...p.abilities, ...p.pastAbilities].map(ability => ability.ability_id).filter(Boolean))] })),
      moves: entities('moves', 'move_names', 'move_id', moveNames),
      abilities: entities('abilities', 'ability_names', 'ability_id', abilityNames),
      items: entities('items', 'item_names', 'item_id', itemNames),
      types: entities('types', 'type_names', 'type_id', typeNames).filter(type => type.id <= 18 || type.identifier === 'stellar'),
      natures: JSON.parse(readFileSync(path.join(path.dirname(databasePath), 'natures.json'), 'utf8')),
    };
    const pokemonReferences = new Map(strategyReferences.pokemon.map(pokemon => [pokemon.id, pokemon]));
    strategyReferences.pokemonForms = all('SELECT f.*, cn.form_name AS chinese_name FROM pokemon_forms f LEFT JOIN pokemon_form_names cn ON cn.pokemon_form_id=f.id AND cn.local_language_id=12').flatMap(form => {
      const pokemon = pokemonReferences.get(form.pokemon_id);
      if (!pokemon || form.identifier === pokemon.identifier) return [];
      const type = strategyReferences.types.find(type => type.identifier === form.form_identifier);
      const label = type ? type.name + '属性' : form.chinese_name || form.form_identifier;
      return [{ ...pokemon, formId: form.id, defaultForm: Boolean(form.is_default), identifier: form.identifier, english: form.identifier, name: pokemon.name + (label ? ' · ' + label : ''),
        generation: Math.max(pokemon.generation, versions.find(version => version.id === form.introduced_in_version_group_id)?.generation || pokemon.generation) }];
    });
    return strategyReferences;
  }
  const dexQueries = createDexQueries({ getVersion, catalog, entityList, learnsetVersion, moveAt, matchup, all, machineMap });
  function query(action, args = {}) {
    switch (action) {
      case 'bootstrap': return { manifest, versions, types: typeRecords, generations: GENERATION_NAMES, methods: METHOD_NAMES };
      case 'catalog': return catalog(args.versionId);
      case 'pokemon': return pokemonDetail(args.id, args.versionId);
      case 'entities': return entityList(args.kind, args.versionId);
      case 'itemScope': return itemScope(args.versionId);
      case 'entity': return entityDetail(args.kind, args.id, args.versionId);
      case 'matchup': return matchup(args.types, args.versionId);
      case 'discover': return dexQueries.discover(args);
      case 'compare': return dexQueries.compare(args);
      case 'search': return dexQueries.search(args);
      default: throw new Error('不支持的查询。');
    }
  }
  return { query, references, close: () => db.close(), hasPokemon: id => pokemonMap.has(Number(id)), normalize };
}

module.exports = { createDataService, normalize, historicalRows };
