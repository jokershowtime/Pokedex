const { createHash } = require('node:crypto');
const { formatLabel, DEFAULT_VERSIONS } = require('./strategy-model.cjs');

const RULES = /^(?:ubers|ubersuu|ou|uu|ru|nu|pu|zu|lc|nfe|1v1|monotype|doublesou|doublesuu|battlestadiumsingles|battlestadiumdoubles|battlespotsingles|battlespotdoubles|nationaldex|nationaldexdoubles|nationaldexmonotype|nationaldexuu|nationaldexubers|bdspou|letsgoou|anythinggoes|vgc\d{4}[a-z0-9]*)$/;
const TAGS = [
  { id: 'rain', label: '雨天', pattern: /\brain\b|雨天/i, abilities: ['Drizzle', 'Primordial Sea'], moves: ['Rain Dance'] },
  { id: 'sun', label: '晴天', pattern: /\bsun\b|晴天/i, abilities: ['Drought', 'Desolate Land', 'Orichalcum Pulse'], moves: ['Sunny Day'] },
  { id: 'sand', label: '沙暴', pattern: /\bsand\b|沙暴/i, abilities: ['Sand Stream'], moves: ['Sandstorm'] },
  { id: 'snow', label: '雪天／冰雹', pattern: /\b(?:snow|hail)\b|雪天|冰雹/i, abilities: ['Snow Warning'], moves: ['Snowscape', 'Hail'] },
  { id: 'room', label: '空间', pattern: /trick\s*room|semi[- ]?room|full[- ]?room|\btr\b|空间/i, moves: ['Trick Room'] },
  { id: 'tailwind', label: '顺风', pattern: /tailwind|\btw\b|顺风/i, moves: ['Tailwind'] },
  { id: 'screens', label: '双墙／极光幕', pattern: /\b(?:screens?|veils?)\b|双墙|极光幕/i, moves: ['Aurora Veil'], pair: ['Reflect', 'Light Screen'] },
  { id: 'webs', label: '黏黏网', pattern: /\bwebs?\b|黏黏网/i, moves: ['Sticky Web'] },
  { id: 'balance', label: '平衡', pattern: /\bbalance[d]?\b|平衡/i },
  { id: 'offense', label: '强化进攻', pattern: /hyper[- ]?offen[cs]e|\bho\b|强化进攻/i },
  { id: 'bulky', label: '耐久进攻', pattern: /bulky[- ]?offen[cs]e|\bbo\b|耐久进攻/i },
  { id: 'stall', label: '受队／消耗', pattern: /\bstall\b|受队|消耗队/i },
];
function stableJSON(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJSON).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJSON(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function describeFormat(id) {
  const match = typeof id === 'string' && id.match(/^gen([1-9])([a-z0-9]+)$/);
  if (!match || !RULES.test(match[2])) throw new Error('请选择支持的官方宝可梦对战规则。');
  const tier = match[2];
  const extra = { bdspou: '晶灿钻石／明亮珍珠 · OU', letsgoou: 'Let’s Go · OU', anythinggoes: '无限制 · AG' };
  return { id, generation: Number(match[1]), tier, label: extra[tier] || formatLabel(tier), category: /double|vgc/.test(tier) ? 'doubles' : 'singles' };
}
function pasteURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请粘贴有效的 PokéPaste 分享链接。'); }
  if (url.protocol !== 'https:' || url.hostname !== 'pokepast.es' || url.port || url.username || url.password ||
      !/^\/[a-f0-9]{16}\/?(?:raw|json)?$/.test(url.pathname)) throw new Error('仅支持 https://pokepast.es/ 加 16 位分享编号的链接。');
  return 'https://pokepast.es/' + url.pathname.split('/')[1];
}
function createTeamModel(strategies) {
  const model = strategies.model;
  function fingerprint(team) {
    const canonical = (kind, value) => model.resolve(kind, value)?.identifier || value.toLowerCase();
    const members = team.members.map(member => ({ pokemonId: member.pokemonId, species: model.resolve('pokemon', member.showdownSpecies)?.identifier || String(member.pokemonId),
      level: member.selection.level, ability: canonical('abilities', member.selection.ability), item: canonical('items', member.selection.item), nature: canonical('natures', member.selection.nature),
      teraType: canonical('types', member.selection.teraType), evs: member.selection.evs, ivs: member.selection.ivs,
      gender: member.selection.gender || '', happiness: member.selection.happiness ?? 255, hpType: member.selection.hpType || '',
      gigantamax: member.selection.gigantamax || false, dynamaxLevel: member.selection.dynamaxLevel ?? 10,
      moves: [...member.selection.moves].map(value => /^hidden power.+/i.test(value) ? value.toLowerCase() : canonical('moves', value)).sort(), missingFields: [...(member.missingFields || [])].sort() }));
    return createHash('sha256').update(team.format + ':' + stableJSON(members.map(stableJSON).sort())).digest('hex').slice(0, 28);
  }
  function completeness(team) {
    const missing = team.members.flatMap((member, index) => (member.missingFields || []).map(field => '成员 ' + (index + 1) + '：' + ({ evs: '努力值', ivs: '个体值', nature: '性格' })[field] + '未公开'));
    const expected = team.format.endsWith('1v1') ? 3 : 6;
    return { status: missing.length ? 'partial' : team.members.length < expected ? 'short' : 'complete', members: team.members.length, missing,
      label: missing.length ? '培养数值未公开' : team.members.length < expected ? team.members.length + ' 位成员配置' : '完整培育配置' };
  }
  function classify(team) {
    const tags = TAGS.flatMap(tag => {
      if (tag.pattern.test(team.originalName || '')) return [{ id: tag.id, label: tag.label, origin: 'source', reason: '队伍原名包含“' + tag.label + '”对应的体系词。' }];
      const signals = team.members.flatMap(member => {
        const reasons = [];
        if (tag.abilities?.includes(member.selection.ability)) reasons.push(model.display('abilities', member.selection.ability));
        for (const move of tag.moves || []) if (member.selection.moves.includes(move)) reasons.push(model.display('moves', move));
        if (tag.pair?.every(move => member.selection.moves.includes(move))) reasons.push('反射壁＋光墙');
        return reasons.map(reason => model.refs.pokemon.find(p => p.id === member.pokemonId)?.name + '：' + reason);
      });
      return signals.length ? [{ id: tag.id, label: tag.label, origin: 'inferred', reason: signals.join('；') }] : [];
    });
    if (team.generation >= 3 && team.members.length >= 5 && !team.members.some(member => member.missingFields?.length)) {
      const recovery = ['Recover', 'Roost', 'Slack Off', 'Soft-Boiled', 'Wish', 'Milk Drink', 'Synthesis', 'Rest', 'Strength Sap'];
      const bulk = team.members.filter(member => member.selection.evs.hp + member.selection.evs.def + member.selection.evs.spd >= 200);
      const heals = bulk.filter(member => member.selection.moves.some(move => recovery.includes(move)));
      const residual = team.members.filter(member => member.selection.moves.some(move => ['Toxic', 'Will-O-Wisp', 'Leech Seed', 'Spikes', 'Toxic Spikes'].includes(move)));
      const attackers = team.members.filter(member => member.selection.evs.atk + member.selection.evs.spa >= 160);
      const has = id => tags.some(tag => tag.id === id);
      if (heals.length >= 4 && residual.length >= 2 && !has('stall')) tags.push({ id: 'stall', label: '受队／消耗', origin: 'inferred', reason: heals.length + ' 位成员同时配置耐久与回复，' + residual.length + ' 位成员有持续消耗招式。' });
      else if (bulk.length >= 2 && attackers.length >= 2 && !has('balance') && !has('offense') && !has('bulky')) tags.push({ id: 'balance', label: '平衡', origin: 'inferred', reason: bulk.length + ' 位耐久配置与 ' + attackers.length + ' 位输出配置共同构成队伍；具体风格仍需结合原作者说明。' });
    }
    return tags;
  }
  function roles(member) {
    const chosen = member.selection, result = [];
    const has = names => chosen.moves.some(move => names.includes(move));
    if (['Drizzle', 'Primordial Sea', 'Drought', 'Desolate Land', 'Orichalcum Pulse', 'Sand Stream', 'Snow Warning'].includes(chosen.ability) ||
        has(['Rain Dance', 'Sunny Day', 'Sandstorm', 'Snowscape', 'Hail'])) result.push('天气启动');
    if (has(['Trick Room', 'Tailwind', 'Icy Wind', 'Electroweb', 'Thunder Wave'])) result.push('速度控制');
    if (has(['Stealth Rock', 'Spikes', 'Toxic Spikes', 'Sticky Web'])) result.push('场地布置');
    if (has(['Rapid Spin', 'Defog', 'Mortal Spin', 'Tidy Up'])) result.push('清理场地');
    if (has(['U-turn', 'Volt Switch', 'Flip Turn', 'Parting Shot', 'Chilly Reception', 'Teleport'])) result.push('轮转中转');
    if (has(['Follow Me', 'Rage Powder', 'Fake Out', 'Helping Hand', 'Wide Guard', 'Reflect', 'Light Screen', 'Aurora Veil'])) result.push('队友辅助');
    if (has(['Swords Dance', 'Dragon Dance', 'Nasty Plot', 'Calm Mind', 'Quiver Dance', 'Shell Smash', 'Bulk Up', 'Iron Defense'])) result.push('强化路线');
    if (member.evsSpecified && chosen.evs.atk > chosen.evs.spa && chosen.evs.atk >= 100) result.push('物理输出');
    if (member.evsSpecified && chosen.evs.spa > chosen.evs.atk && chosen.evs.spa >= 100) result.push('特殊输出');
    if (member.evsSpecified && chosen.evs.hp + chosen.evs.def + chosen.evs.spd > 300) result.push('耐久配置');
    return result.length ? result : ['功能配置'];
  }
  function normalizedMember(raw, format, index, fetchedAt) {
    if (!raw || typeof raw.species !== 'string' || !model.resolve('pokemon', raw.species)) throw new Error('第 ' + (index + 1) + ' 位成员未识别：' + (raw?.species || '缺少名称'));
    const member = model.fromSource(raw.species, 'ou', '队伍成员', raw, format.generation, fetchedAt);
    if (!member || member.moveOptions.some(slot => slot.length !== 1)) throw new Error('第 ' + (index + 1) + ' 位成员配置不完整，整队未收录。');
    if (raw.level === undefined) member.selection.level = member.level = /vgc|battlestadium|battlespot/.test(format.tier) ? 50 : format.tier === 'lc' ? 5 : 100;
    member.tier = format.tier; member.format = format.id; member.formatLabel = format.label; member.category = format.category;
    member.source = { provider: 'Smogon 样例队伍', url: null, fetchedAt };
    const errors = model.validate(member, DEFAULT_VERSIONS[format.generation]).errors;
    if (errors.length) throw new Error('第 ' + (index + 1) + ' 位成员：' + errors.join(' '));
    return member;
  }
  function normalize(payload, formatId, fetchedAt) {
    const format = describeFormat(formatId);
    if (!Array.isArray(payload) || payload.length > 1000) throw new Error('来源队伍数据格式不正确，原有缓存已保留。');
    const teams = [], skipped = [];
    payload.forEach((raw, index) => {
      try {
        if (!raw || !Array.isArray(raw.data) || raw.data.length < 1 || raw.data.length > 6) throw new Error('队伍需要 1～6 位完整成员。');
        const members = raw.data.map((set, slot) => normalizedMember(set, format, slot, fetchedAt));
        const id = 'smogon-team-' + createHash('sha256').update(formatId + ':' + stableJSON(raw.data)).digest('hex').slice(0, 24);
        members.forEach((set, slot) => {
          set.id = id + '-' + slot; set.title = model.resolve('pokemon', set.showdownSpecies).name + ' · 成员 ' + (slot + 1); set.originalTitle = '';
          if (format.generation >= 3 && !raw.data[slot].evs) set.missingFields = ['evs'];
          // All 31 IVs produce Dark Hidden Power; an omitted special spread
          // must not become a complete breeding recipe through a text parser.
          if (format.generation >= 2 && Object.values(set.selection.ivs).every(value => value === 31) && set.selection.moves.some(move => /^Hidden Power\s+\[?(?!Dark\b)[A-Za-z]+/i.test(move))) {
            set.missingFields = [...(set.missingFields || []), 'ivs'];
          }
        });
        const originalName = typeof raw.name === 'string' ? raw.name.slice(0, 160) : '';
        const team = { id, title: originalName || format.label + ' · 样例 ' + (index + 1), originalName, author: typeof raw.author === 'string' ? raw.author.slice(0, 160) : '',
          generation: format.generation, format: formatId, formatLabel: format.label, category: format.category, members,
          notes: '', sourceNotes: '', source: { provider: 'Smogon 样例队伍', url: 'https://data.pkmn.cc/teams/' + formatId + '.json', fetchedAt } };
        team.tags = classify(team); team.fingerprint = fingerprint(team); team.completeness = completeness(team); teams.push(team);
      } catch (error) { skipped.push({ name: raw?.name || '样例 ' + (index + 1), reason: error.message }); }
    });
    if (payload.length && !teams.length) throw new Error('来源没有可完整识别的队伍，原有缓存已保留。' + (skipped[0]?.reason || ''));
    return { teams, skipped };
  }
  function validate(input, versionId) {
    if (!input || typeof input !== 'object' || JSON.stringify(input).length > 350000) throw new Error('队伍内容无效或过长。');
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 160) throw new Error('队名需要 1～160 字。');
    for (const field of ['notes', 'sourceNotes']) if (input[field] !== undefined && (typeof input[field] !== 'string' || input[field].length > 10000)) throw new Error('队伍说明最多 10000 字。');
    const format = describeFormat(input.format);
    if (input.generation !== format.generation) throw new Error('队伍世代与所选规则不一致。');
    if (!Array.isArray(input.members) || input.members.length < 1 || input.members.length > 6) throw new Error('每队需要 1～6 位成员。');
    if (input.members.some(member => member.missingFields?.length)) throw new Error('作者没有公开完整培养数值，这份阵容仅供查看，不能按默认值保存或导出为完整作业。');
    if (new Set(input.members.map(member => member.id)).size !== input.members.length) throw new Error('成员配置编号重复，请重新导入队伍。');
    const members = input.members.map((member, index) => {
      if (member.generation !== input.generation) throw new Error('第 ' + (index + 1) + ' 位成员的世代与队伍不一致。');
      try { return strategies.validatePersonal({ ...member, tier: format.tier, format: format.id, formatLabel: format.label, category: format.category }, versionId); }
      catch (error) { throw new Error('第 ' + (index + 1) + ' 位成员：' + error.message); }
    });
    const team = { ...structuredClone(input), title: input.title.trim(), members, category: format.category, formatLabel: format.label };
    if (typeof team.author !== 'string') team.author = ''; else team.author = team.author.slice(0, 160);
    team.originalName = typeof team.originalName === 'string' ? team.originalName.slice(0, 160) : '';
    if (!team.source || typeof team.source !== 'object') team.source = { provider: '导入', url: null, fetchedAt: null };
    team.tags = classify(team); team.fingerprint = fingerprint(team); team.completeness = completeness(team); delete team.validation; delete team.roles; delete team.linkedPlanIds;
    return team;
  }
  function decorate(team, versionId, plans = []) {
    const members = team.members.map(member => model.decorate(plans.find(plan => plan.id === member.id) || member, versionId));
    const tags = classify({ ...team, members });
    const warnings = [], errors = [];
    for (let index = 0; index < members.length; index++) {
      for (const message of members[index].validation.errors) errors.push('成员 ' + (index + 1) + '：' + message);
      if (members[index].generation !== team.generation) errors.push('成员 ' + (index + 1) + ' 已被改为其他世代，请恢复后再导出整队。');
    }
    if (new Set(members.map(member => model.pokemonDetail(member.pokemonId, DEFAULT_VERSIONS[team.generation]).speciesId)).size < members.length) warnings.push('队伍含重复物种；是否允许取决于对战规则。');
    if (members.length < 6) warnings.push('这份队伍收录了 ' + members.length + ' 位成员，请结合对应规则的队伍人数使用。');
    warnings.push('本地检查覆盖成员数值与资料记录；出战人数、禁限名单、道具条款和赛季限制请核对原规则。');
    const complete = completeness({ ...team, members });
    if (complete.status === 'partial') warnings.push(...complete.missing);
    return { ...team, members, tags, completeness: complete, fingerprint: fingerprint({ ...team, members }), roles: members.map(roles), linkedPlanIds: members.filter(member => plans.some(plan => plan.id === member.id)).map(member => member.id),
      validation: { errors: [...new Set(errors)], warnings } };
  }
  function fromImport(sets, formatId, metadata = {}) {
    const format = describeFormat(formatId);
    if (sets.length < 1 || sets.length > 6) throw new Error('一次导入一支队伍，需要 1～6 位成员。');
    const team = { id: 'import-team', title: metadata.title || '我的导入队伍', originalName: metadata.originalName || '', author: metadata.author || '',
      generation: format.generation, format: formatId, formatLabel: format.label, category: format.category,
      notes: '', sourceNotes: metadata.notes || '', source: metadata.source || { provider: '文本导入', url: null, fetchedAt: null },
      members: sets.map((set, index) => ({ ...set, title: model.resolve('pokemon', set.showdownSpecies).name + ' · 成员 ' + (index + 1), originalTitle: '',
        tier: format.tier, format: formatId, formatLabel: format.label, category: format.category })) };
    return validate(team, DEFAULT_VERSIONS[format.generation]);
  }
  function fromRecord(record) {
    const format = describeFormat(record.format);
    const team = normalize([{ name: record.title, author: record.author, data: record.data }], record.format, record.fetchedAt).teams[0];
    team.id = 'source-team-' + createHash('sha256').update(record.providerId + ':' + record.url + ':' + (record.pasteUrl || '') + ':' + team.fingerprint).digest('hex').slice(0, 24);
    team.members.forEach((member, index) => {
      member.id = team.id + '-' + index;
      const missingFields = [...(member.missingFields || [])];
      if (format.generation >= 3 && !record.data[index].evs) missingFields.push('evs');
      if (record.open) { missingFields.push('ivs'); if (format.generation >= 3) missingFields.push('nature'); }
      if (missingFields.length) member.missingFields = [...new Set(missingFields)];
      member.source.provider = record.provider;
    });
    team.originalName = record.originalName || record.title; team.sourceNotes = (record.notes || '').slice(0, 6000);
    team.source = { provider: record.provider, providerId: record.providerId, url: record.url, pasteUrl: record.pasteUrl || record.url,
      fetchedAt: record.fetchedAt, publishedAt: record.publishedAt || null, achievement: record.achievement || null,
      ruleConfidence: record.ruleConfidence || 'source', sourcePage: record.sourcePage || null };
    team.tags = classify(team); team.fingerprint = fingerprint(team); team.completeness = completeness(team); return team;
  }
  return { normalize, validate, decorate, fromImport, fromRecord, classify, roles, fingerprint, completeness };
}
module.exports = { createTeamModel, describeFormat, pasteURL, TAGS };
