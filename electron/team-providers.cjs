const cheerio = require('cheerio');
const { readRemote, readPaste, shareURL, sourceURL } = require('./team-network.cjs');
const { describeFormat } = require('./team-model.cjs');
const { importSets } = require('./strategy-text.cjs');
const PROVIDERS = [
  { id: 'showcase', name: 'Smogon 精选展示', kind: 'forum', url: 'https://www.smogon.com/forums/forums/team-showcase.314/' },
  { id: 'archive', name: 'Smogon 经典档案', kind: 'archive', url: 'https://www.smogon.com/forums/forums/rmt-archive.84/' },
  { id: 'victoryroad', name: 'Victory Road 比赛队伍', kind: 'victoryroad', generation: 9, url: 'https://victoryroad.pro/sv-rental-teams/' },
];
const ERA = { SV: 9, SS: 8, SWSH: 8, SM: 7, USUM: 7, ORAS: 6, XY: 6, BW: 5, DPP: 4, ADV: 3, GSC: 2, RBY: 1, BDSP: 8 };
const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9 };
const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
function forumURL(href, base) {
  const url = new URL(href, base);
  // Old archive posts link to the same public forum over HTTP. Upgrade only
  // Smogon's known forum host; all subsequent requests still require HTTPS.
  if (url.protocol === 'http:' && ['www.smogon.com', 'smogon.com'].includes(url.hostname) && !url.port) url.protocol = 'https:';
  return sourceURL(url.href);
}
function exportText(node) {
  const content = node.clone(); content.find('script,style').remove(); content.find('br').replaceWith('__POKEDEX_BR__');
  return content.text().replace(/__POKEDEX_BR__\s*/g, '\n').replace(/\r/g, '').split('\n').map(line => line.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
function exportedSets(text, gen, strategies) {
  // Older Showdown exports use Spd for speed and SDef for special defense.
  // Translate those explicit legacy tokens without changing modern SpD.
  if (gen <= 5 && /^(?:Trait:|.+ Nature \()/m.test(text)) {
    text = text.split('\n').map(line => {
      if (/^(?:EVs|IVs):/.test(line)) return line.replace(/\bSAtk\b/g, 'SpA').replace(/\bSDef\b/g, 'SpD').replace(/\bSpd\b/g, 'Spe');
      return line.replace(/^Trait:/, 'Ability:').replace(/^(\w+ Nature)\s+\([^)]+\)\s*$/, '$1');
    }).join('\n');
  }
  return importSets(text, gen, strategies.model).map(set => ({
    species: set.showdownSpecies, ...set.selection, name: set.selection.nickname,
    ...(set.evsSpecified ? {} : { evs: undefined }),
    ...(set.defaults.some(message => message.includes('个体值按导出惯例')) ? { ivs: undefined } : {}),
  }));
}
function inferFormat(text, hintGeneration, publishedAt) {
  if (/hackmons|almost any ability|balanced hack|(?:^|\W)cap(?:\W|$)|mix and mega|inheritance|godly gift/i.test(text)) return null;
  const era = text.match(/\b(SV|SS|SWSH|SM|USUM|ORAS|XY|BW|DPP|ADV|GSC|RBY|BDSP)\b/i);
  const explicit = text.match(/\bgen(?:eration)?\s*([1-9])\b/i);
  let gen = explicit ? Number(explicit[1]) : era ? ERA[era[1].toUpperCase()] : hintGeneration;
  let confidence = explicit || era || hintGeneration ? 'source' : 'inferred';
  if (!gen && publishedAt) {
    const timestamp = Date.parse(publishedAt);
    for (const [date, generation] of [['2022-11-18', 9], ['2019-11-15', 8], ['2016-11-18', 7], ['2013-10-12', 6], ['2010-09-18', 5], ['2006-09-28', 4], ['2002-11-21', 3]]) {
      if (timestamp >= Date.parse(date)) { gen = generation; break; }
    }
  }
  if (!gen) return null;
  let tier;
  if (/national dex/i.test(text)) tier = /ubers/i.test(text) ? 'nationaldexubers' : /monotype/i.test(text) ? 'nationaldexmonotype' : /doubles/i.test(text) ? 'nationaldexdoubles' : /\bUU\b/.test(text) ? 'nationaldexuu' : 'nationaldex';
  else if (/monotype/i.test(text)) tier = 'monotype';
  else if (/battle stadium/i.test(text)) tier = /double/i.test(text) ? 'battlestadiumdoubles' : 'battlestadiumsingles';
  else if (/battle spot/i.test(text)) tier = /double/i.test(text) ? 'battlespotdoubles' : 'battlespotsingles';
  else if (/doubles|(?:^|\W)DOU(?:\W|$)/i.test(text)) tier = 'doublesou';
  else if (/anything goes|\bAG\b/i.test(text)) tier = 'anythinggoes';
  else {
    const match = text.match(/\b(Ubers|OU|UU|RU|NU|PU|ZU|LC|NFE|1v1)\b/i);
    tier = match?.[1].toLowerCase();
  }
  if (!tier) return null;
  try { return { ...describeFormat('gen' + gen + tier), confidence }; } catch { return null; }
}
function forumIndex(html, url) {
  const $ = cheerio.load(html), entries = [];
  $('.structItem--thread').each((_, element) => {
    const titleNode = $(element).find('.structItem-title'), anchor = titleNode.find('a').last();
    const title = clean(anchor.text()), prefix = clean(titleNode.find('.label').text());
    const href = anchor.attr('href');
    if (!href || /rules|welcome to|how to/i.test(title)) return;
    let target; try { target = forumURL(href, url); } catch { return; }
    const publishedAt = $(element).find('time').first().attr('datetime') || null;
    const roman = title.match(/Generation\s+([IVX]+)\s+RMT Archive/i)?.[1];
    const hintGeneration = roman ? ROMAN[roman] : undefined;
    const rule = inferFormat(prefix + ' ' + title, undefined, publishedAt);
    entries.push({ url: target, title, prefix, publishedAt, author: $(element).attr('data-author') || '',
      index: /rmt archive index/i.test(title), hintGeneration, format: rule?.id || null, ruleConfidence: rule?.confidence || null });
  });
  return { entries, next: $('.pageNav-jump--next').first().attr('href') ? new URL($('.pageNav-jump--next').first().attr('href'), url).href : null };
}
function archiveIndex(html, url, gen) {
  const $ = cheerio.load(html), body = $('.message--post').first().find('.bbWrapper').first(), entries = [];
  let hint = gen, currentRule = null;
  body.find('b,strong,h2,h3,a').each((_, element) => {
    const text = clean(exportText($(element)));
    if (!$(element).is('a')) {
      if (text.length < 100) {
        const rule = inferFormat(text, hint); if (rule) { currentRule = rule; hint = rule.generation; }
        const era = text.match(/^(ADV|GSC|RBY)(?:\s|$)/);
        if (era) { hint = ERA[era[1]]; if (!rule) currentRule = { ...describeFormat('gen' + hint + 'ou'), confidence: 'inferred' }; }
      }
      return;
    }
    const href = $(element).attr('href'); if (!href) return;
    let target; try { target = forumURL(href, url); } catch { return; }
    if (target === url || /archive-index|post-\d+/.test(target) || !target.includes('/threads/')) return;
    const rule = inferFormat(text, hint) || currentRule;
    let owner = $(element), inlineText = '';
    while (owner.parent().length && owner.parent()[0] !== body[0]) owner = owner.parent();
    for (const sibling of owner.nextAll().toArray()) {
      const node = $(sibling);
      if (node.is('.bbCodeSpoiler') && /import|export/i.test(node.find('.bbCodeSpoiler-button-title').first().text())) {
        inlineText = exportText(node.find('.bbCodeSpoiler-content').first()); break;
      }
      if (node.find('a[href*="/threads/"]').length || node.is('a[href*="/threads/"]')) break;
    }
    entries.push({ url: target, title: text, prefix: '', hintGeneration: hint, format: rule?.id || null,
      ruleConfidence: rule?.confidence || 'source', index: false, inlineText: inlineText || undefined,
      sourcePage: url, author: text.match(/\s[-–]\s+([^-]+)$/)?.[1]?.trim() || '' });
  });
  return entries;
}
function forumPost(html, entry) {
  const $ = cheerio.load(html), post = $('.message--post').first(), body = post.find('.bbWrapper').first().clone();
  if (!post.length || !body.length) throw new Error('原帖正文未读取到。');
  body.find('script,style,blockquote,.bbCodeBlock--quote').remove();
  const heading = clean($('.p-title-value').text()) || entry.prefix + ' ' + entry.title;
  const publishedAt = post.find('time').first().attr('datetime') || entry.publishedAt || null;
  const replay = body.find('a[href*="pokemonshowdown.com/"]').map((_, element) => $(element).attr('href')).get().map(url => url.match(/\/(?:smogtours-)?(gen[1-9][a-z0-9]+)-\d+/)?.[1]).filter(Boolean);
  let rule = inferFormat(heading, entry.hintGeneration, publishedAt);
  if ((!rule || rule.confidence === 'inferred') && new Set(replay).size === 1) {
    try { rule = { ...describeFormat(replay[0]), confidence: 'source' }; } catch {}
  }
  if (!rule && entry.format) rule = { ...describeFormat(entry.format), confidence: entry.ruleConfidence || 'source' };
  if (!rule) throw new Error('原帖未标明可识别的对战规则。');
  const links = body.find('a[href]').map((_, element) => shareURL($(element).attr('href'))).get().filter(Boolean), counts = new Map();
  links.forEach(link => counts.set(link, (counts.get(link) || 0) + 1));
  let pastes = [];
  body.find('.bbCodeSpoiler').each((_, element) => {
    const label = clean($(element).find('.bbCodeSpoiler-button-title').first().text());
    if (/import|export|paste|team/i.test(label) && !/old|previous|opponent/i.test(label)) {
      $(element).find('a[href]').each((_, anchor) => { const link = shareURL($(anchor).attr('href')); if (link) pastes.push(link); });
    }
  });
  if (!pastes.length) pastes = [...counts.keys()].filter(link => counts.get(link) > 1);
  if (!pastes.length) pastes = [...counts.keys()];
  pastes = [...new Set(pastes)].slice(0, 4);
  const code = [];
  body.find('.bbCodeCode').each((_, element) => {
    const node = $(element).clone(); node.find('br').replaceWith('\n');
    const text = node.text().replace(/\r/g, '');
    if (/(?:Ability|EVs|Nature):| Nature\b|\n-\s+/.test(text)) code.push(text.trim());
  });
  if (!code.length) body.find('.bbCodeSpoiler').each((_, element) => {
    if (code.length) return;
    const node = $(element), label = clean(node.find('.bbCodeSpoiler-button-title').first().text());
    if (/import|export|paste/i.test(label) && !/old|previous|opponent/i.test(label)) {
      const text = exportText(node.find('.bbCodeSpoiler-content').first());
      if (/\n-\s+/.test(text)) code.push(text);
    }
  });
  body.find('br').replaceWith('\n'); body.find('p,div').append('\n');
  const notes = body.text().replace(/\n{3,}/g, '\n\n').trim().slice(0, 6000);
  const by = heading.match(/\bby\s+(.+?)(?:\s*[-–]\s*|$)/i)?.[1];
  return { title: entry.title || heading, originalName: heading, author: by || post.attr('data-author') || entry.author || '',
    publishedAt, format: rule.id, ruleConfidence: rule.confidence, pastes, text: code.join('\n\n'), notes, url: entry.url };
}
function victoryIndex(html, url) {
  const $ = cheerio.load(html), entries = [];
  $('tr').each((_, element) => {
    const row = $(element), columns = row.children('td');
    const links = row.find('a[href]').map((_, anchor) => shareURL($(anchor).attr('href'))).get().filter(Boolean);
    if (!links.length || columns.length < 3) return;
    const author = clean(columns.eq(1).find('b,strong').first().text()) || clean(columns.eq(1).text());
    const detail = columns.eq(2).clone(); detail.find('br').replaceWith(' '); detail.find('p,div,li').append(' ');
    const text = clean(detail.text()), date = text.match(/\d{1,2}\s+[A-Z][a-z]{2,8}\s+\d{4}/)?.[0];
    const publishedAt = date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : null;
    const achievement = clean(text.replace(/\([^)]*\)/g, ''));
    for (const link of [...new Set(links)]) entries.push({ url: link, title: author + ' · ' + achievement, author, publishedAt, achievement,
      sourcePage: url, generation: 9, index: false });
  });
  return entries;
}
function slimSets(sets) {
  const keys = ['species', 'name', 'item', 'ability', 'nature', 'moves', 'evs', 'ivs', 'level', 'gender', 'teraType', 'hpType', 'shiny', 'happiness', 'gigantamax', 'dynamaxLevel'];
  return sets.map(set => Object.fromEntries(keys.filter(key => set[key] !== undefined).map(key => [key, set[key]])));
}
async function collectRecord(provider, entry, fetcher, strategies) {
  const records = [], skipped = [];
  if (provider.kind === 'archive' && entry.inlineText && entry.format) {
    const rule = describeFormat(entry.format);
    records.push({ ...entry, originalName: entry.title, data: slimSets(exportedSets(entry.inlineText, rule.generation, strategies)),
      notes: '经典档案中的公开 Importable 配置。', open: false, providerId: provider.id, provider: provider.name, fetchedAt: new Date().toISOString() });
    return { records, skipped };
  }
  if (provider.kind === 'victoryroad') {
    const paste = await readPaste(fetcher, entry.url);
    const format = paste.format && describeFormat(paste.format);
    if (!format || format.generation !== 9 || format.category !== 'doubles') throw new Error('分享没有标明支持的 VGC 双打规则。');
    const sets = paste.data || importSets(paste.text, format.generation, strategies.model).map(set => ({
      species: set.showdownSpecies, ...set.selection, name: set.selection.nickname,
    }));
    records.push({ ...entry, format: format.id, title: paste.title || entry.title, originalName: paste.title || entry.title, notes: paste.notes, data: slimSets(sets),
      open: paste.open, ruleConfidence: 'source', providerId: provider.id, provider: provider.name, fetchedAt: new Date().toISOString() });
  } else {
    const post = forumPost(await readRemote(fetcher, entry.url), entry);
    for (const url of post.pastes) {
      try {
        const paste = await readPaste(fetcher, url), format = paste.format || post.format;
        const rule = describeFormat(format);
        const sets = paste.data || exportedSets(paste.text, rule.generation, strategies);
        records.push({ ...post, url: post.url, pasteUrl: url, format, title: paste.title || post.title, originalName: post.originalName,
          author: paste.author || post.author, data: slimSets(sets), open: paste.open, providerId: provider.id, provider: provider.name,
          fetchedAt: new Date().toISOString() });
      } catch (failure) { skipped.push({ name: post.title, reason: failure.message, url }); }
    }
    if (!records.length && post.text) {
      const sets = exportedSets(post.text, describeFormat(post.format).generation, strategies);
      records.push({ ...post, data: slimSets(sets), open: false, providerId: provider.id, provider: provider.name, fetchedAt: new Date().toISOString() });
    }
    if (!records.length && !skipped.length) throw new Error('精选帖子未提供可导入的完整配招文本或分享链接。');
  }
  return { records, skipped };
}
module.exports = { PROVIDERS, inferFormat, forumIndex, archiveIndex, forumPost, victoryIndex, collectRecord, slimSets };
