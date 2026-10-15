const KINDS = ['pokemon', 'moves', 'abilities', 'items'];
const MAX_TABS = 12;
const tabKey = value => value.kind + ':' + value.id;
function miniTab(input) {
  if (!input || !KINDS.includes(input.kind) || !Number.isInteger(input.id) || input.id < 1 || input.id > 100000 ||
      typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) throw new Error('固定标签资料无效。');
  return { kind: input.kind, id: input.id, name: input.name.trim() };
}
function miniTabs(input, strict = true) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > MAX_TABS) { if (strict) throw new Error('最多固定 12 个迷你图鉴标签。'); return []; }
  const result = [], seen = new Set();
  for (const value of input) {
    try {
      const tab = miniTab(value), key = tabKey(tab);
      if (!seen.has(key)) { seen.add(key); result.push(tab); }
    } catch (error) { if (strict) throw error; }
  }
  return result;
}
module.exports = { MAX_TABS, tabKey, miniTab, miniTabs };
