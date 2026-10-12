const HOSTS = new Set(['www.smogon.com', 'smogon.com', 'victoryroad.pro', 'www.victoryroad.pro',
  'victoryroadvgc.com', 'www.victoryroadvgc.com', 'pokepast.es', 'www.vrpastes.com', 'vrpastes.com',
  'vrpaste-backend.vercel.app', 'pkmn.github.io', 'data.pkmn.cc']);
function sourceURL(value) {
  let url; try { url = new URL(value); } catch { throw new Error('队伍来源地址无效。'); }
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.port || url.username || url.password) throw new Error('仅允许读取已接入的公开队伍来源。');
  const host = url.hostname, pathname = url.pathname;
  const allowed = /smogon\.com$/.test(host) ? /^\/forums\/(?:threads|forums)\/[a-z0-9%_.-]+(?:\/page-\d+)?\/?$/i.test(pathname) :
    host === 'pokepast.es' ? /^\/[a-f0-9]{16}(?:\/(?:json|raw))?\/?$/.test(pathname) :
    /(?:^|\.)vrpastes\.com$/.test(host) ? /^\/[A-Za-z0-9_-]{6,32}(?:\/(?:open|raw))?\/?$/.test(pathname) :
    host === 'vrpaste-backend.vercel.app' ? /^\/api\/paste\/[A-Za-z0-9_-]{6,32}$/.test(pathname) :
    host === 'pkmn.github.io' ? /^\/smogon\/data\/teams\/(?:index|gen[1-9][a-z0-9]+)\.json$/.test(pathname) || pathname === '/smogon/data/teams/' :
    host === 'data.pkmn.cc' ? /^\/teams\/gen[1-9][a-z0-9]+\.json$/.test(pathname) :
    /^\/(?:sv|swsh)-rental-teams\/?$/.test(pathname);
  if (!allowed) throw new Error('队伍来源路径不受支持。');
  return url.href;
}
async function readRemote(fetcher, value, json = false, limit = 3 * 1024 * 1024) {
  let url = sourceURL(value);
  const signal = AbortSignal.timeout(20000);
  for (let redirects = 0; redirects <= 4; redirects++) {
    const response = await fetcher(url, { signal, redirect: 'manual', headers: { Accept: json ? 'application/json' : 'text/html' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel().catch(() => {});
      if (!location || redirects === 4) throw new Error('来源重定向异常。');
      url = sourceURL(new URL(location, url).href); continue;
    }
    if (!response.ok) throw new Error('来源暂时不可用（HTTP ' + response.status + '）。');
    if (!response.body) throw new Error('来源内容为空。');
    const reader = response.body.getReader(), chunks = []; let bytes = 0;
    try {
      while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.length;
        if (bytes > limit) throw new Error('来源内容过大，原有缓存已保留。'); chunks.push(Buffer.from(next.value)); }
    } finally { await reader.cancel().catch(() => {}); }
    const text = Buffer.concat(chunks).toString('utf8');
    if (!json) return text;
    try { return JSON.parse(text); } catch { throw new Error('来源返回的 JSON 无法读取。'); }
  }
}
function shareURL(value) {
  let url; try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (url.hostname === 'pokepast.es' && /^\/[a-f0-9]{16}(?:\/(?:raw|json))?\/?$/.test(url.pathname)) return 'https://pokepast.es/' + url.pathname.split('/')[1];
  if (['www.vrpastes.com', 'vrpastes.com'].includes(url.hostname) && /^\/[A-Za-z0-9_-]{6,32}(?:\/open)?\/?$/.test(url.pathname)) return 'https://www.vrpastes.com' + url.pathname.replace(/\/$/, '');
  return null;
}
async function readPaste(fetcher, value) {
  const url = shareURL(value); if (!url) throw new Error('请选择有效的 PokéPaste 或 VR Pastes 分享链接。');
  if (url.includes('pokepast.es')) {
    const payload = await readRemote(fetcher, url + '/json', true, 512 * 1024);
    if (typeof payload.paste !== 'string' || payload.paste.length > 120000) throw new Error('分享没有可读取的队伍文本。');
    return { text: payload.paste, title: payload.title || '', author: payload.author || '', notes: payload.notes || '', url, open: false };
  }
  const id = new URL(url).pathname.split('/')[1], open = url.endsWith('/open');
  const payload = await readRemote(fetcher, 'https://vrpaste-backend.vercel.app/api/paste/' + id + '?lang=english' + (open ? '&open=true' : ''), true, 512 * 1024);
  if (payload.hasPassword || payload.is_encrypted || payload.requiresPassword) throw new Error('这份分享受密码保护，未读取培养配置。');
  if (!Array.isArray(payload.teams) || !payload.teams.length || payload.teams.length > 6) throw new Error('VR Pastes 没有有效的队伍配置。');
  const keys = ['species', 'item', 'ability', 'nature', 'evs', 'ivs', 'moves', 'level', 'gender', 'teraType', 'hpType', 'shiny', 'happiness', 'gigantamax', 'dynamaxLevel'];
  const data = payload.teams.map(raw => {
    const set = Object.fromEntries(keys.filter(key => raw[key] !== undefined).map(key => [key, raw[key]]));
    if (raw.name && raw.name !== raw.species) set.name = raw.name;
    return set;
  });
  const publicSheet = open || payload.is_public === true || payload.isOpenTeamList === true;
  if (publicSheet) for (const member of data) { delete member.evs; delete member.ivs; delete member.nature; }
  return { data, title: payload.title || '', author: payload.author || '', notes: payload.notes || '', format: payload.format || '',
    url, open: publicSheet };
}
module.exports = { readRemote, readPaste, shareURL, sourceURL };
