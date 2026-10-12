const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createUserStore } = require('../electron/user-store.cjs');

function directory() {
  const root = path.join(__dirname, '../.qa/storage-tests');
  fs.mkdirSync(root, { recursive: true });
  return fs.mkdtempSync(path.join(root, 'case-'));
}
test('收藏、笔记和规则在重新打开后保持；取消收藏不删除笔记', () => {
  const folder = directory();
  const first = createUserStore(folder);
  first.favorite(25); first.note(25, '十万伏特 + 电光一闪');
  first.settings({ versionId: 6, theme: 'dark' });
  const second = createUserStore(folder);
  assert.deepEqual(second.get().favorites, [25]);
  assert.equal(second.get().notes[25], '十万伏特 + 电光一闪');
  assert.equal(second.get().settings.versionId, 6);
  second.favorite(25);
  assert.equal(second.get().favorites.length, 0);
  assert.equal(second.get().notes[25], '十万伏特 + 电光一闪');
});
test('最近查询去重、按最新排序并保留最多 50 项', () => {
  const store = createUserStore(directory());
  for (let id = 1; id <= 60; id++) store.visit(id);
  store.visit(25);
  assert.equal(store.get().history.length, 50);
  assert.equal(store.get().history[0].id, 25);
  assert.equal(store.get().history.filter(entry => entry.id === 25).length, 1);
});
test('损坏的个人数据保留恢复副本；返回的状态不会被调用方意外修改', () => {
  const folder = directory();
  fs.writeFileSync(path.join(folder, 'preferences.json'), '{bad json');
  const store = createUserStore(folder);
  assert.ok(fs.readdirSync(folder).some(name => name.includes('.recovery-')));
  const snapshot = store.get(); snapshot.favorites.push(1);
  assert.equal(store.get().favorites.length, 0);
  assert.throws(() => store.note(1, 'a'.repeat(5001)));
});
test('旧版设置自动采用较大显示，保留收藏笔记；显示档位重启后保持', () => {
  const folder = directory();
  fs.writeFileSync(path.join(folder, 'preferences.json'), JSON.stringify({ favorites: [25], history: [], notes: { 25: '保留原来的笔记' }, settings: { versionId: 6, theme: 'dark' } }));
  const store = createUserStore(folder);
  assert.equal(store.get().settings.uiScale, 125);
  assert.deepEqual(store.get().favorites, [25]);
  assert.equal(store.get().notes[25], '保留原来的笔记');
  store.settings({ uiScale: 175 });
  assert.equal(createUserStore(folder).get().settings.uiScale, 175);
});
test('无法使用的历史显示设置恢复为默认 125%', () => {
  const folder = directory();
  fs.writeFileSync(path.join(folder, 'preferences.json'), JSON.stringify({ settings: { uiScale: 900 } }));
  assert.equal(createUserStore(folder).get().settings.uiScale, 125);
});
