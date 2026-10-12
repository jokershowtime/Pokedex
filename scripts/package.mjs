import { packager } from '@electron/packager';
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(path.join(root, 'data/pokedex.sqlite'))) throw new Error('请先执行 npm run data:import。');
const electronVersion = JSON.parse(readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
const appVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const zipName = `electron-v${electronVersion}-win32-x64.zip`;
const zipDirectory = path.join(root, '.electron-cache');
mkdirSync(zipDirectory, { recursive: true });
const temporaryDirectory = path.join(root, '.qa/package-temp');
mkdirSync(temporaryDirectory, { recursive: true });
const zipPath = path.join(zipDirectory, zipName);
if (!existsSync(zipPath)) {
  const caches = [zipDirectory, process.env.electron_config_cache, path.join(homedir(), 'AppData/Local/electron/Cache')].filter(Boolean);
  let cached;
  for (const cache of caches) {
    if (!existsSync(cache)) continue;
    const entries = readdirSync(cache, { recursive: true });
    const candidate = entries.find(file => path.basename(file) === zipName);
    if (candidate) { cached = path.join(cache, candidate); break; }
  }
  if (!cached) throw new Error(`找不到 ${zipName}。请先执行 npx install-electron --no，保留下载缓存。`);
  // Some Windows sandbox file systems do not implement cross-volume CopyFile.
  try { copyFileSync(cached, zipPath); }
  catch { writeFileSync(zipPath, readFileSync(cached)); }
}
const output = await packager({
  dir: root, out: path.join(root, 'release'), name: 'Pokedex', appVersion,
  tmpdir: temporaryDirectory,
  platform: 'win32', arch: 'x64', electronVersion,
  electronZipDir: zipDirectory,
  asar: false, prune: true, overwrite: true,
  icon: path.join(root, 'data/app-icon.ico'),
  executableName: 'Pokedex', appCopyright: 'Personal offline Pokédex tool',
  win32metadata: { ProductName: '宝可梦图鉴', FileDescription: '离线中文宝可梦图鉴' },
  ignore: [/^\/(src|scripts|tests|public|\.qa|\.npm-cache|\.electron-cache|release)(\/|$)/, /^\/[^/]+\.(bat|cmd)$/i, /^\/(tsconfig\.json|vite\.config\.mjs|index\.html|package-lock\.json|\.gitignore)$/],
});
for (const directory of output) {
  writeFileSync(path.join(directory, '使用说明.txt'), [
    `宝可梦图鉴 · Windows 桌面版 ${appVersion}`, '',
    '双击 Pokedex.exe 启动。首次启动和日常查询均不需要联网。',
    '请保留整个解压目录，程序旁的 resources 是图鉴资料与图片。', '',
    'Ctrl + K：聚焦搜索；搜索框中 ↑ / ↓ 选择结果。',
    'Ctrl + Alt + P：呼出／收起置顶迷你图鉴，可在设置中修改。',
    'GBA 游戏可在右上角或设置中选择红宝石／蓝宝石、绿宝石、火红／叶绿。',
    '设置 → 字体与界面大小：支持 100%–200% 缩放，默认 125%，立即生效并自动保存。',
    '收藏、历史和笔记保存在当前 Windows 用户的应用数据目录中。',
    '引用其他版本的中文说明和学习表会在界面中标明。', '',
    '数据：PokéAPI；图片：PokeAPI/sprites。相关来源说明随资料包提供。',
  ].join('\r\n'), 'utf8');
  console.log(`桌面版已打包：${directory}`);
}
