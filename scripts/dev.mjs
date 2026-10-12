import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';

if (!existsSync('data/pokedex.sqlite')) {
  console.error('请先执行 npm run data:import，准备本地图鉴。');
  process.exit(1);
}
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' });
let desktop;
function stop(code = 0) { desktop?.kill(); vite.kill(); process.exit(code); }
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
vite.on('error', () => stop(1));
vite.on('exit', code => stop(code ?? 0));
for (let attempt = 0; attempt < 100; attempt++) {
  try { if ((await fetch('http://127.0.0.1:5173')).ok) break; } catch {}
  if (attempt === 99) stop(1);
  await setTimeout(150);
}
const electron = (await import('electron')).default;
const environment = { ...process.env, POKEDEX_DEV_URL: 'http://127.0.0.1:5173' };
delete environment.ELECTRON_RUN_AS_NODE;
desktop = spawn(electron, ['.'], { stdio: 'inherit', env: environment });
desktop.on('error', () => stop(1));
desktop.on('exit', code => stop(code ?? 0));
