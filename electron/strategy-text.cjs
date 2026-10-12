const { STATS, STAT_NAMES, vector, DEFAULT_VERSIONS } = require('./strategy-model.cjs');
const ENGLISH_STATS = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
const STAT_IDS = { hp: 'hp', atk: 'atk', def: 'def', spa: 'spa', spd: 'spd', spe: 'spe', speed: 'spe', spatk: 'spa', spdef: 'spd',
  HP: 'hp', 攻击: 'atk', 防御: 'def', 特攻: 'spa', 特防: 'spd', 速度: 'spe' };
function statVector(text, fallback) {
  const result = vector(null, fallback);
  for (const part of text.split('/')) {
    const match = part.trim().match(/^(\d+)\s+(.+)$/);
    const stat = match && (STAT_IDS[match[2].trim()] || STAT_IDS[match[2].trim().toLowerCase()]);
    if (!stat) throw new Error(`无法识别数值分配：${part.trim()}`);
    result[stat] = Number(match[1]);
  }
  return result;
}
function canonical(model, kind, value) {
  if (!value || /^(none|无|不携带)$/i.test(value)) return '';
  const ref = model.resolve(kind, value);
  if (!ref) throw new Error(`无法识别${({ pokemon: '宝可梦', abilities: '特性', items: '道具', natures: '性格', moves: '招式', types: '属性' })[kind]}：${value}`);
  if (kind === 'moves' && /^(?:hidden power|觉醒力量).+/i.test(value)) {
    const suffix = value.replace(/^(?:hidden power|觉醒力量)[\s·・\[]*/i, '').replace(/\]$/, '');
    const type = model.resolve('types', suffix);
    if (type) return `Hidden Power ${type.english}`;
  }
  return ref.english;
}
function importSets(text, generation, model) {
  if (typeof text !== 'string' || text.length > 120000) throw new Error('导入文本为空或超过 120000 字。');
  if (!Number.isInteger(generation) || !DEFAULT_VERSIONS[generation]) throw new Error('请选择有效的方案世代。');
  const cleaned = text.replace(/\r/g, '').trim();
  if (!cleaned) throw new Error('请粘贴配招文本。');
  let rawSets;
  if (/^[\[{]/.test(cleaned)) {
    let parsed;
    try { parsed = JSON.parse(cleaned); } catch { throw new Error('JSON 格式不正确。'); }
    rawSets = Array.isArray(parsed) ? parsed : [parsed];
    rawSets = rawSets.map(raw => ({ ...raw, species: raw.species || raw.name }));
  } else {
    rawSets = cleaned.split(/\n\s*\n/).filter(block => block.trim()).map(block => {
      const lines = block.split('\n').map(line => line.trim()).filter(line => line && !/^(#|\/\/)/.test(line));
      if (!lines.length) return null;
      const header = lines.shift().split(/\s*@\s*/);
      let species = header[0].trim();
      const gender = species.match(/\s*\(([MF])\)$/)?.[1];
      if (gender) species = species.replace(/\s*\([MF]\)$/, '').trim();
      const nickname = species.match(/\(([^()]+)\)$/);
      const nicknameText = nickname && model.resolve('pokemon', nickname[1]) ? species.replace(/\s*\([^()]+\)$/, '').trim() : undefined;
      if (nicknameText) species = nickname[1];
      const raw = { species, name: nicknameText, item: header[1]?.trim() || '', gender, moves: [] };
      for (const line of lines) {
        if (/^[-–]\s*/.test(line)) { raw.moves.push(line.replace(/^[-–]\s*/, '')); continue; }
        const nature = line.match(/^(.+?)\s+Nature$/i);
        if (nature) { raw.nature = nature[1]; continue; }
        const pair = line.match(/^([^:：]+)[:：]\s*(.*)$/);
        if (!pair) throw new Error(`无法识别这行配招：${line}`);
        const key = pair[1].trim().toLowerCase(), value = pair[2].trim();
        if (['ability', '特性'].includes(key)) raw.ability = value;
        else if (['nature', '性格'].includes(key)) raw.nature = value;
        else if (['item', '道具'].includes(key)) raw.item = value;
        else if (['evs', '努力值'].includes(key)) raw.evs = statVector(value, 0);
        else if (['ivs', '个体值'].includes(key)) raw.ivs = statVector(value, 31);
        else if (['level', '等级'].includes(key)) raw.level = Number(value);
        else if (['tera type', '太晶属性'].includes(key)) raw.teraType = value;
        else if (['happiness', '亲密度'].includes(key)) raw.happiness = Number(value);
        else if (['shiny', '异色'].includes(key)) raw.shiny = /^(yes|true|是)$/i.test(value);
        else if (['gigantamax', '超极巨化'].includes(key)) raw.gigantamax = /^(yes|true|是)$/i.test(value);
        else if (['dynamax level', '极巨化等级'].includes(key)) raw.dynamaxLevel = Number(value);
        else if (['hidden power', '觉醒力量属性'].includes(key)) raw.hpType = value;
        else if (['pokeball', '精灵球'].includes(key)) raw.pokeball = value;
        else throw new Error(`暂不支持的配招字段：${pair[1]}`);
      }
      return raw;
    }).filter(Boolean);
  }
  if (!rawSets.length || rawSets.length > 100) throw new Error('一次可导入 1～100 套配招。');
  return rawSets.map((raw, index) => {
    const pokemon = model.resolve('pokemon', raw.species);
    if (!pokemon) throw new Error(`无法识别第 ${index + 1} 套的宝可梦：${raw.species || '未填写'}`);
    if (!Array.isArray(raw.moves) || raw.moves.length < 1 || raw.moves.length > 4) throw new Error('每套配招需要 1～4 个招式。');
    const set = model.fromSource(pokemon.english, 'ou', '导入方案', {
      ...raw, species: model.showdownName(pokemon), item: canonical(model, 'items', raw.item), ability: canonical(model, 'abilities', raw.ability),
      nature: raw.nature ? canonical(model, 'natures', raw.nature) : undefined,
      hpType: raw.hpType ? canonical(model, 'types', raw.hpType) : undefined,
      teratypes: raw.teraType ? canonical(model, 'types', raw.teraType) : undefined,
      moves: raw.moves.map(move => canonical(model, 'moves', move)),
    }, generation, new Date().toISOString());
    if (!set) throw new Error('无法建立导入方案。');
    set.id = `import-${index}`; set.title = `${pokemon.name} · 导入方案`; set.originalTitle = 'Imported set'; set.tier = 'custom';
    set.format = `gen${generation}custom`; set.formatLabel = '自定义／导入'; set.category = 'custom';
    set.source = { provider: '导入', url: null, fetchedAt: null };
    const validation = model.validate(set, DEFAULT_VERSIONS[generation]);
    if (validation.errors.length) throw new Error(`第 ${index + 1} 套：${validation.errors.join(' ')}`);
    return set;
  });
}
function exportSet(set, model, language = 'showdown') {
  const chinese = language === 'chinese';
  const pokemon = model.refs.pokemon.find(p => p.id === set.pokemonId);
  if (!pokemon || !set.selection) throw new Error('方案不完整，无法导出。');
  const validation = model.validate(set, DEFAULT_VERSIONS[set.generation]);
  if (validation.errors.length) throw new Error(validation.errors.join(' '));
  const value = set.selection;
  const translate = (kind, name) => chinese ? model.display(kind, name) : model.resolve(kind, name)?.english || name;
  const form = model.resolve('pokemon', set.showdownSpecies) || pokemon;
  const species = chinese ? form.name : model.showdownName(form);
  const lines = [`${value.nickname ? `${value.nickname} (${species})` : species}${value.gender ? ` (${value.gender})` : ''}${value.item ? ` @ ${translate('items', value.item)}` : ''}`];
  if (set.generation >= 3 && value.ability) lines.push(`${chinese ? '特性' : 'Ability'}: ${translate('abilities', value.ability)}`);
  lines.push(`${chinese ? '等级' : 'Level'}: ${value.level}`);
  if (set.generation >= 3) lines.push(chinese ? `性格: ${translate('natures', value.nature)}` : `${translate('natures', value.nature)} Nature`);
  const stats = chinese ? STAT_NAMES : ENGLISH_STATS;
  const evs = STATS.filter(stat => value.evs[stat] > 0).map(stat => `${value.evs[stat]} ${stats[stat]}`);
  if (evs.length) lines.push(`${chinese ? '努力值' : 'EVs'}: ${evs.join(' / ')}`);
  const ivs = STATS.filter(stat => chinese || value.ivs[stat] !== 31).map(stat => `${value.ivs[stat]} ${stats[stat]}`);
  if (ivs.length) lines.push(`${chinese ? '个体值' : 'IVs'}: ${ivs.join(' / ')}`);
  if (value.teraType) lines.push(`${chinese ? '太晶属性' : 'Tera Type'}: ${translate('types', value.teraType)}`);
  if (value.happiness !== undefined) lines.push(`${chinese ? '亲密度' : 'Happiness'}: ${value.happiness}`);
  if (value.shiny) lines.push(`${chinese ? '异色: 是' : 'Shiny: Yes'}`);
  if (value.hpType) lines.push(`${chinese ? '觉醒力量属性' : 'Hidden Power'}: ${translate('types', value.hpType)}`);
  if (value.dynamaxLevel !== undefined) lines.push(`${chinese ? '极巨化等级' : 'Dynamax Level'}: ${value.dynamaxLevel}`);
  if (value.gigantamax) lines.push(chinese ? '超极巨化: 是' : 'Gigantamax: Yes');
  if (value.pokeball) lines.push(`${chinese ? '精灵球' : 'Pokeball'}: ${value.pokeball}`);
  for (const move of value.moves.filter(Boolean)) lines.push(`- ${/^hidden power\b/i.test(move) && !chinese ? move : translate('moves', move)}`);
  return lines.join('\n');
}
module.exports = { importSets, exportSet };
