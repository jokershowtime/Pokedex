const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDataService } = require('../electron/data-service.cjs');
const { createStrategyService } = require('../electron/strategy-service.cjs');
const { createTeamService } = require('../electron/team-service.cjs');
const { createBattleService } = require('../electron/battle-service.cjs');
const { createUserStore } = require('../electron/user-store.cjs');
const { sourceURL, readRemote, readPaste } = require('../electron/team-network.cjs');
const { PROVIDERS, inferFormat, forumIndex, archiveIndex, forumPost, victoryIndex, collectRecord } = require('../electron/team-providers.cjs');
const fixture = require('./fixtures/teams.json');
let data;
before(() => { data = createDataService(path.join(__dirname, '../data/pokedex.sqlite')); });
after(() => data.close());
const json = value => new Response(JSON.stringify(value));
const html = value => new Response(value, { headers: { 'Content-Type': 'text/html' } });
function service(fetcher = async () => { throw new Error('offline'); }, options = {}) {
  const root = path.join(__dirname, '../.qa/team-library-tests'); fs.mkdirSync(root, { recursive: true });
  const folder = options.folder || fs.mkdtempSync(path.join(root, 'case-'));
  const strategies = createStrategyService(data, path.join(folder, 'strategies'));
  const teams = createTeamService(strategies, path.join(folder, 'teams'), fetcher, { providers: [], ...options });
  return { folder, strategies, teams };
}
const index = { gen9ou: [1, 1], gen9uu: [1, 1], gen9doublesou: [1, 1], gen3ou: [1, 1] };
const article = 'https://www.smogon.com/forums/threads/fixture.9999999/';
const paste = 'https://pokepast.es/0123456789abcdef';
const showcase = PROVIDERS[0];
function forumHTML(title = 'SV OU Fixture', url = paste) {
  return '<h1 class="p-title-value">' + title + '</h1><article class="message--post" data-author="Original Author"><time datetime="2025-01-02T00:00:00Z"></time><div class="bbWrapper"><p>Original gameplay notes</p><blockquote><a href="https://pokepast.es/ffffffffffffffff">Quoted old team</a></blockquote><a href="' + url + '">Importable</a></div></article>';
}
const catalogHTML = '<div class="structItem--thread" data-author="Original Author"><div class="structItem-title"><span class="label">SV OU</span><a href="' + article + '">Rain Sample</a></div><time datetime="2025-01-02T00:00:00Z"></time></div>';
const record = (overrides = {}) => ({ providerId: 'showcase', provider: 'Smogon 精选展示', title: '精选队伍', originalName: 'Rain',
  author: 'Original Author', url: article, pasteUrl: paste, format: 'gen9ou', data: structuredClone(fixture[0].data), open: false,
  fetchedAt: '2026-10-11T00:00:00Z', publishedAt: '2025-01-02T00:00:00Z', ...overrides });

test('同世代跨规则同步、进度可跨IPC传递，初次浏览不等待联网；重启完全离线可读', async () => {
  const updates = [];
  const fetcher = async url => {
    await new Promise(resolve => setTimeout(resolve, 5));
    return json(url.endsWith('/index.json') ? index : fixture);
  };
  const { teams, folder } = service(fetcher, { onUpdate: progress => updates.push(structuredClone(progress)) });
  const initial = teams.browse({ generation: 9, versionId: 27 });
  assert.equal(initial.teams.length, 0); assert.equal(initial.sync.state, 'running'); structuredClone(initial);
  assert.equal(teams.sync({ generation: 9 }).state, 'running');
  await teams.library.settle(9);
  const result = teams.browse({ generation: 9, versionId: 27 });
  assert.deepEqual(result.teams.map(team => team.format).sort(), ['gen9doublesou', 'gen9ou', 'gen9uu']);
  assert.ok(updates.some(progress => progress.completed < progress.total));
  assert.equal(result.sync.state, 'complete');
  const offline = service(undefined, { folder }).teams.browse({ generation: 9, versionId: 27 });
  assert.equal(offline.teams.length, 3); assert.equal(offline.sync.state, 'idle');
});

test('相同规则与配置跨来源合并，成员和招式换序不会丢失来源，原队成员顺序保留', () => {
  const { teams } = service();
  const original = teams.model.normalize(fixture, 'gen9ou', '').teams[0];
  const changed = record(); changed.data.reverse(); changed.data.forEach(member => member.moves.reverse());
  const duplicate = teams.model.fromRecord(changed);
  assert.equal(teams.model.fingerprint(original), teams.model.fingerprint(duplicate));
  const otherRule = teams.model.fromRecord({ ...changed, format: 'gen9uu' });
  assert.notEqual(teams.model.fingerprint(original), teams.model.fingerprint(otherRule));
  duplicate.members[0].selection.happiness = 0;
  assert.notEqual(teams.model.fingerprint(original), teams.model.fingerprint(duplicate));
});

test('精选原帖保留作者、规则、日期、说明；引用他人队伍不当成作者配置，档案按世代标题读取', () => {
  const found = forumIndex(catalogHTML, showcase.url).entries[0];
  assert.equal(found.format, 'gen9ou'); assert.equal(found.author, 'Original Author');
  const post = forumPost(forumHTML(), found);
  assert.equal(post.format, 'gen9ou'); assert.equal(post.author, 'Original Author');
  assert.equal(post.publishedAt, '2025-01-02T00:00:00Z'); assert.equal(post.ruleConfidence, 'source');
  assert.deepEqual(post.pastes, [paste]); assert.match(post.notes, /Original gameplay notes/);
  assert.equal(inferFormat('OU Fixture', undefined, '2021-01-01').id, 'gen8ou');
  assert.equal(inferFormat('OU Fixture', undefined, '2021-01-01').confidence, 'inferred');
  assert.equal(inferFormat('ORAS Balanced Hackmons'), null);
  const archive = '<article class="message--post"><div class="bbWrapper"><b>ADV OU</b><a href="' + article + '">Historic Rain</a></div></article>';
  assert.equal(archiveIndex(archive, 'https://www.smogon.com/forums/threads/index.9999998/', 9)[0].format, 'gen3ou');
  const historic = '<article class="message--post"><div class="bbWrapper"><b>RBY<br><a href="http://www.smogon.com/forums/threads/fixture.9000001/">First era</a></b><b>GSC<br><a href="http://www.smogon.com/forums/threads/fixture.9000002/">Second era</a></b><b>ADV</b><a href="http://www.smogon.com/forums/threads/n%C3%A6r.9000003">Third era</a></div></article>';
  const eras = archiveIndex(historic, 'https://www.smogon.com/forums/threads/index.9999998/', 3);
  assert.deepEqual(eras.map(entry => entry.format), ['gen1ou', 'gen2ou', 'gen3ou']);
  assert.ok(eras.every(entry => entry.url.startsWith('https:') && entry.ruleConfidence === 'inferred'));
});

test('Victory Road 的公开分享读取为只读请求，规则、作者和比赛出处独立保留', async () => {
  const entries = victoryIndex('<table><tr><td>1</td><td><strong>Fixture Player</strong></td><td>Regional Finalist (2 Jan 2025)</td><td><a href="https://www.vrpastes.com/abc12345">Team</a></td></tr></table>', PROVIDERS[2].url);
  assert.equal(entries[0].author, 'Fixture Player'); assert.match(entries[0].achievement, /Regional Finalist/);
  const requests = [];
  const closed = await readPaste(async (url, options) => { requests.push({ url, method: options.method || 'GET' }); return json({ teams: fixture[0].data, format: 'gen9vgc2025regg', is_public: false, title: 'Shared Team', hasPassword: false }); }, entries[0].url);
  assert.equal(closed.open, false); assert.equal(closed.data[0].ivs.atk, 0); assert.equal(closed.format, 'gen9vgc2025regg');
  assert.ok(requests[0].url.startsWith('https://vrpaste-backend.vercel.app/api/paste/abc12345?lang=english'));
  assert.equal(requests[0].method, 'GET');
  const { teams } = service();
  const importer = service(async () => json({ teams: fixture[0].data, format: closed.format, is_public: false, title: 'Shared Team', notes: 'Public battle notes' })).teams;
  const imported = await importer.import({ text: entries[0].url, format: closed.format });
  assert.equal(imported.members[0].selection.level, 50); assert.equal(imported.members[0].selection.ivs.atk, 0);
  assert.equal(imported.source.provider, 'VR Pastes 导入'); assert.equal(imported.sourceNotes, 'Public battle notes');
  await assert.rejects(importer.import({ text: entries[0].url, format: 'gen9ou' }), /相同规则/);
});

test('开放队单即使服务器带上数值仍隐藏EV、IV和性格，受密码保护的分享只检查一次', async () => {
  const result = await readPaste(async () => json({ teams: fixture[0].data, is_public: true, format: 'gen9vgc2025regg' }), 'https://www.vrpastes.com/abc12345');
  assert.equal(result.open, true);
  for (const member of result.data) for (const key of ['evs', 'ivs', 'nature']) assert.equal(member[key], undefined);
  const { teams, strategies } = service(), battle = createBattleService(data, strategies, teams);
  const partial = teams.model.fromRecord(record({ providerId: 'victoryroad', format: result.format, data: result.data, open: true }));
  assert.equal(partial.completeness.status, 'partial'); assert.deepEqual(partial.members[0].missingFields, ['evs', 'ivs', 'nature']);
  assert.throws(() => teams.model.validate(partial, 27), /没有公开/);
  assert.throws(() => teams.export(partial, 'showdown', 27), /没有公开/);
  assert.throws(() => strategies.validatePersonal(partial.members[0], 27), /未公开/);
  assert.throws(() => strategies.export(partial.members[0]), /未公开/);
  assert.throws(() => battle.stats({ generation: 9, fighter: partial.members[0] }), /未公开/);
  let requests = 0;
  await assert.rejects(readPaste(async () => { requests++; return json({ hasPassword: true, teams: fixture[0].data }); }, 'https://www.vrpastes.com/abc12345'), /密码保护/);
  assert.equal(requests, 1);
});

test('来源缺少EV分配时标为部分配置，保持完整成员数；合法的31默认个体值和0个体值区分', () => {
  const { teams } = service(); const missing = record(); delete missing.data[0].evs;
  const team = teams.model.fromRecord(missing); assert.equal(team.members.length, 6); assert.equal(team.completeness.status, 'partial');
  assert.deepEqual(team.members[0].missingFields, ['evs']); assert.equal(team.members[0].selection.ivs.atk, 0);
  assert.equal(team.members[1].selection.ivs.hp, 31);
  assert.equal(teams.model.normalize([{ data: missing.data }], 'gen9ou', '').teams[0].completeness.status, 'partial');
  const hp = { species: 'Pikachu', ability: 'Static', nature: 'Timid', evs: { spa: 252, spe: 252 }, moves: ['Hidden Power Ice'] };
  const unknown = teams.model.normalize([{ data: [hp] }], 'gen3ou', '').teams[0];
  assert.deepEqual(unknown.members[0].missingFields, ['ivs']);
  assert.deepEqual(teams.model.normalize([{ data: [{ ...hp, moves: ['Hidden Power [Ice]'] }] }], 'gen3ou', '').teams[0].members[0].missingFields, ['ivs']);
  assert.throws(() => teams.model.validate(unknown, 6), /没有公开/);
  const known = teams.model.normalize([{ data: [{ ...hp, ivs: { atk: 30, def: 30 } }] }], 'gen3ou', '').teams[0];
  assert.equal(known.members[0].missingFields, undefined); assert.equal(known.members[0].selection.ivs.def, 30);
});

test('额外来源联网缓存与样例合并，出错刷新保留已有队伍和个人修改；收藏别名不会重复建六份计划', async () => {
  const context = service(undefined, { providers: [showcase] });
  const text = context.teams.export(context.teams.model.normalize(fixture, 'gen9ou', '').teams[0], 'showdown', 27);
  const fetcher = async url => url === showcase.url ? html(catalogHTML) : url === article ? html(forumHTML()) :
    url.startsWith(paste) ? json({ title: 'Shared Team', author: 'Paste Author', paste: text }) : json(url.endsWith('/index.json') ? { gen9ou: [1, 1] } : fixture);
  const { teams, folder, strategies } = service(fetcher, { folder: context.folder, providers: [showcase] });
  teams.sync({ generation: 9 }); await teams.library.settle(9);
  const result = teams.browse({ generation: 9, versionId: 27 });
  assert.equal(result.teams.length, 1); assert.equal(result.duplicateCount, 1); assert.equal(result.teams[0].sources.length, 2);
  assert.equal(result.sources.find(value => value.id === 'showcase').count, 1);
  const team = result.teams[0], store = createUserStore(folder);
  store.saveTeam(teams.model.validate(team, 27));
  const member = store.get().plans[0]; member.selection.ivs.atk = 1;
  store.savePlan(strategies.validatePersonal(member, 27)); store.progress(member.id, 'item', true);
  const duplicate = teams.model.fromRecord(record({ title: 'Renamed team' })); duplicate.aliases = team.aliases;
  store.saveTeam(teams.model.validate(duplicate, 27));
  assert.equal(store.get().teams.length, 1); assert.equal(store.get().plans.length, 6);
  const offline = service(undefined, { folder, providers: [showcase] }).teams;
  offline.sync({ generation: 9 }); await offline.library.settle(9);
  assert.equal(offline.browse({ generation: 9, versionId: 27 }).teams.length, 1);
  assert.equal(offline.library.status(9).state, 'partial');
  const restarted = createUserStore(folder).get();
  assert.equal(restarted.plans[0].selection.ivs.atk, 1); assert.equal(restarted.plans[0].progress.item, true);
});

test('下一批先读取未检查条目，无法识别的帖子记录原因后跳过，不一直重试同一篇', async () => {
  const rows = Array.from({ length: 14 }, (_, i) => catalogHTML.replaceAll('9999999', String(9000000 + i)));
  const seen = [], { teams } = service(async url => {
    if (url.endsWith('/index.json')) return json({ gen9ou: [1, 1] });
    if (url.endsWith('/gen9ou.json')) return json(fixture);
    if (url === showcase.url) return html(rows.join(''));
    seen.push(url); return html(forumHTML('Unsupported format', 'https://example.com/no-team'));
  }, { providers: [showcase] });
  teams.sync({ generation: 9 }); await teams.library.settle(9);
  assert.equal(seen.length, 12);
  teams.sync({ generation: 9, refresh: false, more: true }); await teams.library.settle(9);
  assert.equal(seen.length, 14); assert.equal(new Set(seen).size, 14);
  assert.equal(teams.browse({ generation: 9, versionId: 27 }).sources[1].remaining, 0);
});

test('受队伍配置支持的平衡和消耗标签标为推断，部分队单不根据占位数值判断风格', () => {
  const { teams } = service(); const team = teams.model.fromRecord(record({ originalName: 'Sample' }));
  assert.equal(team.tags.find(tag => tag.id === 'balance').origin, 'inferred');
  const stall = structuredClone(team);
  stall.members.forEach(member => { member.selection.evs = { hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0 }; member.selection.moves = ['Recover', 'Toxic']; });
  assert.equal(teams.model.classify(stall).find(tag => tag.id === 'stall').origin, 'inferred');
  stall.members[0].missingFields = ['evs'];
  assert.equal(teams.model.classify(stall).some(tag => ['stall', 'balance'].includes(tag.id)), false);
  const early = structuredClone(team); early.generation = 1; early.originalName = 'Sample';
  assert.equal(teams.model.classify(early).some(tag => ['stall', 'balance'].includes(tag.id)), false);
});

test('首次继续收录同样读取历史世代的置顶档案，不把后续目录页当作历史索引', async () => {
  const archive = PROVIDERS[1], sticky = 'https://www.smogon.com/forums/threads/generation-i-iii-rmt-archive-index.3573615/';
  const requests = [], classic = 'Pikachu @ Light Ball\nAbility: Static\nTimid Nature\nEVs: 252 SpA / 4 SpD / 252 Spe\n- Thunderbolt';
  const { teams } = service(async url => {
    requests.push(url);
    if (url.endsWith('/index.json')) return json({ gen3ou: [1, 1] });
    if (url.endsWith('/gen3ou.json')) return json([]);
    if (url === archive.url) return html('<div class="structItem--thread"><div class="structItem-title"><a href="' + sticky + '">Generation I-III RMT Archive Index</a></div></div>');
    if (url === sticky) return html('<article class="message--post"><div class="bbWrapper"><b>ADV OU</b><a href="' + article + '">Classic Example</a></div></article>');
    if (url === article) return html(forumHTML('ADV OU Classic Example'));
    if (url.startsWith(paste)) return json({ paste: classic });
    throw new Error('Unexpected URL');
  }, { providers: [archive] });
  teams.sync({ generation: 3, refresh: false, more: true }); await teams.library.settle(3);
  assert.ok(requests.includes(sticky));
  assert.equal(teams.browse({ generation: 3, versionId: 6 }).teams[0].generation, 3);
});

test('经典档案内嵌的旧导出保留特性、性格与数值，Spd速度和SDef特防不会互换', async () => {
  const legacy = 'Pikachu @ Light Ball<br>\nTrait: Static<br>\nEVs: 252 SAtk / 4 SDef / 252 Spd<br>\nTimid Nature (+Spd, -Atk)<br>\n- Thunderbolt<br>\n- Hidden Power [Ice]<br><br>\nCharizard @ Leftovers<br>\nTrait: Blaze<br>\nEVs: 4 HP / 252 SAtk / 252 Spd<br>\nModest Nature (+SAtk, -Atk)<br>\n- Flamethrower';
  const page = '<article class="message--post"><div class="bbWrapper"><b>ADV</b><b><a href="' + article + '">Old team - Author</a></b><div class="bbCodeSpoiler"><span class="bbCodeSpoiler-button-title">Importable</span><div class="bbCodeSpoiler-content">' + legacy + '</div></div></div></article>';
  const entry = archiveIndex(page, 'https://www.smogon.com/forums/threads/index.9999998/', 3)[0];
  const { teams, strategies } = service();
  const records = await collectRecord(PROVIDERS[1], entry, () => { throw new Error('inline export should need no network'); }, strategies);
  const team = teams.model.fromRecord(records.records[0]);
  assert.deepEqual(team.members[0].missingFields, ['ivs']);
  assert.equal(team.members.length, 2); assert.equal(team.author, 'Author');
  assert.equal(team.members[0].selection.evs.spe, 252); assert.equal(team.members[0].selection.evs.spd, 4);
  assert.equal(team.members[0].selection.nature, 'Timid'); assert.equal(team.members[1].selection.ability, 'Blaze');
  assert.equal(team.source.sourcePage, 'https://www.smogon.com/forums/threads/index.9999998/');
});

test('来源链接限定HTTPS与指定路径，跳转到其他主机在第二次请求前拒绝', async () => {
  for (const url of ['http://www.smogon.com/forums/threads/example.123456/', 'https://www.smogon.com/account/password', 'https://evil.test/', 'https://www.vrpastes.com:4433/abc12345']) assert.throws(() => sourceURL(url));
  let requests = 0;
  await assert.rejects(readRemote(async () => { requests++; return new Response(null, { status: 302, headers: { Location: 'https://evil.test/secrets' } }); }, article), /仅允许/);
  assert.equal(requests, 1);
});
