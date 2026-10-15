const { createHash } = require('node:crypto');

const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const STAT_NAMES = { hp: 'HP', atk: '攻击', def: '防御', spa: '特攻', spd: '特防', spe: '速度' };
const normalizeId = value => String(value || '').replace(/♀/g, 'f').replace(/♂/g, 'm').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const vector = (input, fallback = 0) => Object.fromEntries(STATS.map(stat => [stat, input?.[stat] ?? fallback]));
const options = value => [...new Set((Array.isArray(value) ? value : value ? [value] : []).filter(x => typeof x === 'string' && x.length <= 100))];
const spreads = (value, fallback) => (Array.isArray(value) ? value : [value || {}]).map(row => vector(row, fallback));
const DEFAULT_VERSIONS = { 1: 2, 2: 4, 3: 6, 4: 10, 5: 14, 6: 16, 7: 18, 8: 22, 9: 27 };
const GEN_SLUG = { 1: 'rb', 2: 'gs', 3: 'rs', 4: 'dp', 5: 'bw', 6: 'xy', 7: 'sm', 8: 'ss', 9: 'sv' };
const STANDARD_FORMAT = /^(?:ubers|ubersuu|ou|uu|ru|nu|pu|zu|lc|nfe|1v1|monotype|doublesou|doublesuu|battlestadiumsingles|battlestadiumdoubles|battlespotsingles|battlespotdoubles|nationaldex|nationaldexdoubles|nationaldexmonotype|nationaldexuu|nationaldexubers|vgc\d{4}[a-z0-9]*)$/;

function formatLabel(tier) {
  const names = { free: '自由组队 · 单打', freedoubles: '自由组队 · 双打', ubers: '单打 · Uber', ubersuu: '单打 · Uber UU', ou: '单打 · OU', uu: '单打 · UU', ru: '单打 · RU',
    nu: '单打 · NU', pu: '单打 · PU', zu: '单打 · ZU', lc: '小杯 · LC', nfe: '未完全进化 · NFE', '1v1': '单打 · 1对1',
    monotype: '单属性队伍', doublesou: '双打 · OU', doublesuu: '双打 · UU', battlestadiumsingles: '对战竞技场 · 单打',
    battlestadiumdoubles: '对战竞技场 · 双打', battlespotsingles: '对战点 · 单打', battlespotdoubles: '对战点 · 双打',
    nationaldex: '全国规则 · 单打', nationaldexdoubles: '全国规则 · 双打', nationaldexmonotype: '全国规则 · 单属性',
    nationaldexuu: '全国规则 · UU', nationaldexubers: '全国规则 · Uber' };
  return names[tier] || (/^vgc\d{4}/.test(tier) ? `VGC ${tier.slice(3, 7)}${tier.length > 7 ? ` · ${tier.slice(7).toUpperCase()}` : ''}` : tier);
}
function titleLabel(title) {
  const words = { 'Swords Dance': '剑舞强化', 'Dragon Dance': '龙舞强化', 'Calm Mind': '冥想强化', 'Nasty Plot': '诡计强化',
    'Choice Band': '讲究头带', 'Choice Specs': '讲究眼镜', 'Choice Scarf': '讲究围巾', 'Life Orb': '生命宝珠',
    'Heavy-Duty Boots': '厚底靴', 'Loaded Dice': '机变骰子', 'Focus Sash': '气势披带', 'Sun': '晴天', 'Rain': '雨天',
    'Wallbreaker': '破盾输出', 'Sweeper': '清场输出', 'Attacker': '输出', 'Defensive': '耐久', 'Offensive': '进攻',
    'Specially Defensive': '特耐', 'Physically Defensive': '物耐', 'Entry Hazard Setter': '撒钉辅助', 'Setup': '强化',
    'Mixed': '双刀', 'Support': '辅助', 'Utility': '功能辅助', 'TankChomp': '耐久撒钉', 'All-Out': '全力',
    'Fast': '高速', 'Bulky': '耐久', 'Pivot': '中转', 'Stall': '消耗', 'Lead': '首发', 'Revenge Killer': '收割',
    'RestTalk': '睡梦消耗', 'Substitute': '替身', 'Roost': '羽栖', 'Protect': '守住', 'Stealth Rock': '隐形岩',
    'Trick Room': '戏法空间', 'Assault Vest': '突击背心', 'Baton Pass': '接棒', 'Belly Drum': '腹鼓', 'Fire': '火',
    'Water': '水', 'Dragon': '龙', 'Flying': '飞行', 'Ground': '地面' };
  let result = title;
  for (const [english, chinese] of Object.entries(words).sort((a, b) => b[0].length - a[0].length)) result = result.replaceAll(english, chinese);
  return /[\u3400-\u9fff]/.test(result) ? result : `来源方案 · ${title}`;
}
function createStrategyModel(data) {
  const refs = data.references();
  const detailCache = new Map();
  function pokemonDetail(id, versionId) {
    const key = `${id}:${versionId}`;
    if (!detailCache.has(key)) detailCache.set(key, data.query('pokemon', { id, versionId }));
    return detailCache.get(key);
  }
  const maps = {};
  for (const [kind, entries] of Object.entries(refs)) {
    const map = new Map();
    for (const entry of entries) {
      for (const name of [entry.identifier, entry.english, entry.name, ...(entry.aliases || [])]) if (name && (!map.has(normalizeId(name)) || entry.isDefault)) map.set(normalizeId(name), entry);
    }
    maps[kind] = map;
  }
  for (const form of refs.pokemonForms || []) {
    for (const name of [form.identifier, form.name]) if (!maps.pokemon.has(normalizeId(name))) maps.pokemon.set(normalizeId(name), form);
  }
  // Names used by Showdown differ from PokéAPI for these forms.
  const showdownForms = {
    'Ogerpon-Wellspring': 'ogerpon-wellspring-mask', 'Ogerpon-Hearthflame': 'ogerpon-hearthflame-mask',
    'Ogerpon-Cornerstone': 'ogerpon-cornerstone-mask', 'Indeedee-F': 'indeedee-female',
    'Meowstic-F': 'meowstic-female', 'Basculegion-F': 'basculegion-female',
    'Tauros-Paldea-Combat': 'tauros-paldea-combat-breed', 'Tauros-Paldea-Blaze': 'tauros-paldea-blaze-breed',
    'Tauros-Paldea-Aqua': 'tauros-paldea-aqua-breed', 'Maushold-Four': 'maushold-family-of-four',
    'Necrozma-Dusk-Mane': 'necrozma-dusk', 'Necrozma-Dawn-Wings': 'necrozma-dawn',
  };
  for (const [showdown, identifier] of Object.entries(showdownForms)) {
    const ref = maps.pokemon.get(normalizeId(identifier));
    if (ref) maps.pokemon.set(normalizeId(showdown), ref);
  }
  function showdownName(pokemon) {
    if (pokemon.defaultForm) return refs.pokemon.find(value => value.id === pokemon.id)?.english || pokemon.english;
    return Object.entries(showdownForms).find(([, identifier]) => identifier === pokemon.identifier)?.[0] || pokemon.english;
  }
  function resolve(kind, name) {
    if (kind === 'moves' && /^(?:hidden\s*power\b|觉醒力量)/i.test(name || '')) return maps.moves.get('hiddenpower');
    return maps[kind]?.get(normalizeId(name));
  }
  const display = (kind, name) => {
    if (!name) return '无';
    const found = resolve(kind, name);
    if (kind === 'moves' && /^(?:hidden power|觉醒力量).+/i.test(name)) {
      const type = resolve('types', name.replace(/^(?:hidden power|觉醒力量)[\s·・\[]*/i, '').replace(/\]$/, ''));
      return `${found?.name || '觉醒力量'}${type ? ` · ${type.name}` : ''}`;
    }
    return found?.name || name;
  };
  function defaultSelection(set) {
    const used = new Set();
    const moves = set.moveOptions.map(slot => {
      const choice = slot.find(move => !used.has(normalizeId(move))) || slot[0] || '';
      if (choice) used.add(normalizeId(choice)); return choice;
    });
    return { ability: set.abilityOptions[0] || '', item: set.itemOptions[0] || '', nature: set.natureOptions[0] || 'Serious',
      teraType: set.teraOptions[0] || '', moves, evs: structuredClone(set.evSpreads[0]), ivs: structuredClone(set.ivSpreads[0]), level: set.level };
  }
  function fromSource(species, tier, title, raw, generation, fetchedAt) {
    const pokemon = resolve('pokemon', species);
    if (!pokemon || !STANDARD_FORMAT.test(tier) || !raw || !Array.isArray(raw.moves) || raw.moves.length > 4 || !raw.moves.length) return null;
    const fallback = pokemonDetail(pokemon.id, DEFAULT_VERSIONS[generation]);
    const defaults = [];
    let abilityOptions = options(raw.ability);
    if (generation >= 3 && !abilityOptions.length) {
      const first = fallback.abilities.find(ability => !ability.hidden);
      const definition = first && refs.abilities.find(ability => ability.id === first.id);
      if (definition) { abilityOptions = [definition.english]; defaults.push('特性未注明，按普通特性第一栏显示'); }
    }
    if (!raw.ivs) defaults.push(generation <= 2 ? '个体值按导出惯例补全，早期世代原作对应 DV 15' : '未注明的个体值按导出惯例补全为 31');
    if (!raw.evs) defaults.push(generation <= 2 ? '早期世代未注明的努力值按 Showdown 导出惯例补全为每项 252' : '来源未注明努力值分配');
    if (generation >= 3 && !raw.nature) defaults.push('性格未注明，按导出默认认真显示');
    const set = {
      id: `smogon-${createHash('sha256').update(`${generation}:${species}:${tier}:${title}`).digest('hex').slice(0, 20)}`,
      pokemonId: pokemon.id, generation, tier, format: `gen${generation}${tier}`, formatLabel: formatLabel(tier),
      showdownSpecies: raw.species || species,
      category: /double|vgc/.test(tier) ? 'doubles' : 'singles', title: titleLabel(title), originalTitle: title,
      abilityOptions, itemOptions: options(raw.item), natureOptions: options(raw.nature), teraOptions: options(raw.teratypes || raw.teraType),
      moveOptions: raw.moves.map(options), evSpreads: spreads(raw.evs, generation <= 2 ? 252 : 0), ivSpreads: spreads(raw.ivs, 31),
      evsSpecified: Boolean(raw.evs) || generation <= 2, level: raw.level ?? (/vgc|battlestadium|battlespot/.test(tier) ? 50 : 100), defaults,
      source: { provider: 'Smogon', url: `https://www.smogon.com/dex/${GEN_SLUG[generation]}/pokemon/${pokemon.identifier}/`, fetchedAt },
    };
    set.selection = defaultSelection(set);
    if (raw.gender) set.selection.gender = raw.gender;
    if (raw.happiness !== undefined) set.selection.happiness = raw.happiness;
    if (raw.shiny) set.selection.shiny = true;
    for (const field of ['name', 'hpType', 'pokeball']) if (typeof raw[field] === 'string' && raw[field].length <= 100) set.selection[field === 'name' ? 'nickname' : field] = raw[field];
    if (raw.gigantamax !== undefined) set.selection.gigantamax = raw.gigantamax;
    if (raw.dynamaxLevel !== undefined) set.selection.dynamaxLevel = raw.dynamaxLevel;
    if (raw.hpType) set.selection.moves = set.selection.moves.map(move => /^hidden power$/i.test(move) ? 'Hidden Power ' + (resolve('types', raw.hpType)?.english || raw.hpType) : move);
    return set;
  }
  function normalizeDataset(payload, generation, fetchedAt) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('配招来源返回的数据格式不正确。');
    const result = [];
    const add = (species, tier, builds) => {
      if (!builds || typeof builds !== 'object' || Array.isArray(builds)) return;
      for (const [title, raw] of Object.entries(builds)) { const set = fromSource(species, tier, title, raw, generation, fetchedAt); if (set) result.push(set); }
    };
    for (const [key, value] of Object.entries(payload)) {
      if (!value || typeof value !== 'object') continue;
      // Current data has species -> tier -> set; older snapshots may have tier -> species -> set.
      if (resolve('pokemon', key)) for (const [tier, builds] of Object.entries(value)) add(key, tier, builds);
      else if (STANDARD_FORMAT.test(key)) for (const [species, builds] of Object.entries(value)) add(species, key, builds);
    }
    if (!result.length) throw new Error('配招来源没有可识别的官方宝可梦方案，原有缓存已保留。');
    return result;
  }
  function validate(set, versionId) {
    const errors = [], warnings = [];
    if (!set || typeof set !== 'object') return { errors: ['方案内容无效。'], warnings };
    if (set.missingFields?.length) errors.push('来源未公开完整培养数值，不能保存或导出为培养方案。');
    const selected = set.selection;
    if (!selected || !data.hasPokemon(set.pokemonId)) return { errors: ['请选择有效的宝可梦。'], warnings };
    const current = pokemonDetail(set.pokemonId, versionId);
    if (!Number.isInteger(set.generation) || set.generation < 1 || set.generation > 9) errors.push('世代应为 1～9。');
    const sourcePokemon = resolve('pokemon', set.showdownSpecies) || refs.pokemon.find(p => p.id === set.pokemonId);
    if ((sourcePokemon?.generation || 1) > set.generation) errors.push('这只宝可梦或形态在方案世代尚未登场。');
    if (!Number.isInteger(selected.level) || selected.level < 1 || selected.level > 100) errors.push('等级应为 1～100。');
    if (!Array.isArray(selected.moves)) return { errors: ['招式列表无效。'], warnings };
    if (selected.happiness !== undefined && (!Number.isInteger(selected.happiness) || selected.happiness < 0 || selected.happiness > 255)) errors.push('亲密度应为 0～255。');
    if (selected.gender && !['M', 'F'].includes(selected.gender)) errors.push('性别应为 M 或 F。');
    if (selected.dynamaxLevel !== undefined && (!Number.isInteger(selected.dynamaxLevel) || selected.dynamaxLevel < 0 || selected.dynamaxLevel > 10)) errors.push('极巨化等级应为 0～10。');
    if (selected.gigantamax !== undefined && typeof selected.gigantamax !== 'boolean') errors.push('超极巨化标记无效。');
    for (const stat of STATS) {
      if (!Number.isInteger(selected.ivs?.[stat]) || selected.ivs[stat] < 0 || selected.ivs[stat] > 31) errors.push(`${STAT_NAMES[stat]}个体值应为 0～31。`);
      if (!Number.isInteger(selected.evs?.[stat]) || selected.evs[stat] < 0 || selected.evs[stat] > (set.generation <= 5 ? 255 : 252)) errors.push(`${STAT_NAMES[stat]}努力值超出范围。`);
    }
    if (set.generation >= 3 && STATS.reduce((sum, stat) => sum + (selected.evs?.[stat] || 0), 0) > 510) errors.push('努力值总和不能超过 510。');
    const chosenMoves = (selected.moves || []).filter(Boolean);
    if (!chosenMoves.length || chosenMoves.length > 4) errors.push('请选择 1～4 个招式。');
    if (new Set(chosenMoves.map(move => resolve('moves', move)?.id || normalizeId(move))).size !== chosenMoves.length) errors.push('招式不能重复。');
    if (set.generation !== current.version.generation) warnings.push(`方案属于第 ${set.generation} 世代；当前图鉴使用第 ${current.version.generation} 世代。`);
    if ([19, 24, 30, 31, 32].includes(current.version.id)) warnings.push('当前游戏有不同于常规主系列的培养或战斗机制，请按方案原始规则核对。');
    if (/nationaldex/.test(set.tier)) warnings.push('全国规则包含跨游戏机制，不能直接视为当前游戏中的合法配置。');
    if (set.generation <= 2) warnings.push('早期世代的努力值和个体值机制不同，请同时参考原文。');
    if (set.generation >= 3) {
      const ability = resolve('abilities', selected.ability);
      if (!ability) warnings.push('特性未识别或尚未选择。');
      else if (!current.abilities.some(value => value.id === ability.id)) warnings.push(`${ability.name}不在当前形态／版本的特性记录中。`);
      if (!resolve('natures', selected.nature)) errors.push('请选择有效的性格。');
    }
    if (selected.teraType && set.generation < 9) errors.push('太晶属性仅适用于第九世代方案。');
    if ((selected.gigantamax || selected.dynamaxLevel !== undefined) && set.generation !== 8) warnings.push('极巨化／超极巨化配置需要核对原规则是否包含该机制。');
    if (selected.item && !resolve('items', selected.item)) warnings.push(`道具“${selected.item}”未在本地资料中识别。`);
    for (const name of chosenMoves) {
      const move = resolve('moves', name);
      if (!move) warnings.push(`招式“${name}”未在本地资料中识别。`);
      else if (move.generation > set.generation) warnings.push(`${move.name}在方案世代之后才登场。`);
      else if (!current.learnset.length) warnings.push('当前游戏缺少学习表，无法确认学习方式。');
      else if (!current.learnset.some(entry => entry.id === move.id)) warnings.push(`${move.name}未出现在当前游戏的学习记录中。`);
    }
    return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], note: '这里只检查数值和本地记录，尚未验证遗传、活动招式组合及赛季规则的全部限制。' };
  }
  function decorate(set, versionId) {
    const labels = {};
    for (const kind of ['abilities', 'items', 'natures', 'moves', 'types']) labels[kind] = {};
    for (const [kind, names] of [['abilities', set.abilityOptions], ['items', set.itemOptions], ['natures', set.natureOptions], ['types', set.teraOptions], ['moves', set.moveOptions.flat()]]) {
      for (const name of names || []) labels[kind][name] = { name: display(kind, name), id: resolve(kind, name)?.id || null };
    }
    const selection = set.selection;
    for (const [kind, names] of [['abilities', [selection.ability]], ['items', [selection.item]], ['natures', [selection.nature]], ['types', [selection.teraType]], ['moves', selection.moves]]) {
      for (const name of names.filter(Boolean)) labels[kind][name] = { name: display(kind, name), id: resolve(kind, name)?.id || null };
    }
    const current = pokemonDetail(set.pokemonId, versionId);
    for (const entry of Object.values(labels.moves)) {
      entry.learning = [...new Set(current.learnset.filter(move => move.id === entry.id).map(move => {
        if (move.methodId === 1) return move.level ? `Lv.${move.level} 升级` : '进化／回忆记录';
        if (move.methodId === 4 && move.machineNumber !== null) {
          const hm = current.version.generation <= 6 && move.machineNumber > 100;
          return `${hm ? 'HM' : 'TM'}${String(hm ? move.machineNumber - 100 : move.machineNumber).padStart(2, '0')}`;
        }
        return move.method;
      }))];
    }
    return { ...set, labels, learningReference: current.learnsetReference, pokemonName: (resolve('pokemon', set.showdownSpecies) || refs.pokemon.find(p => p.id === set.pokemonId))?.name || '', validation: validate(set, versionId) };
  }
  return { refs, resolve, display, showdownName, fromSource, normalizeDataset, defaultSelection, validate, decorate, pokemonDetail };
}
module.exports = { createStrategyModel, STATS, STAT_NAMES, normalizeId, vector, formatLabel, DEFAULT_VERSIONS };
