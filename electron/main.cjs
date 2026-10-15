const { app, BrowserWindow, ipcMain, globalShortcut, dialog, nativeImage, screen, clipboard, shell } = require('electron');
const path = require('node:path');
const { mkdirSync, readFileSync, writeFileSync, statSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { createDataService } = require('./data-service.cjs');
const { createUserStore, UI_SCALES } = require('./user-store.cjs');
const { createStrategyService } = require('./strategy-service.cjs');
const { createTeamService } = require('./team-service.cjs');
const { createBattleService } = require('./battle-service.cjs');
const { createTeamAssistantService } = require('./team-assistant-service.cjs');
const { createBackupService } = require('./backup-service.cjs');
const { sourceURL } = require('./team-network.cjs');

const ROOT = path.join(__dirname, '..');
const DEVELOPMENT_URL = process.env.POKEDEX_DEV_URL;
const userDirectory = process.env.POKEDEX_USER_DATA ? path.resolve(process.env.POKEDEX_USER_DATA) : path.join(app.getPath('appData'), 'PokedexDesktop');
mkdirSync(userDirectory, { recursive: true });
app.setPath('userData', userDirectory);
app.setName('宝可梦图鉴');
app.setAppUserModelId('cn.pokedex.desktop');
const singleInstance = process.env.POKEDEX_TEST === '1' || app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

let mainWindow, miniWindow, data, store, strategies, teams, battle, assistant, backups, quitting = false;
const pendingBackups = new Map();
function testBackupPath(value) {
  if (process.env.POKEDEX_TEST !== '1' || typeof value !== 'string') throw new Error('备份路径只能由文件选择器提供。');
  const resolved = path.resolve(value), base = path.join(ROOT, '.qa') + path.sep;
  if (!resolved.toLowerCase().startsWith(base.toLowerCase()) || path.extname(resolved).toLowerCase() !== '.json') throw new Error('测试备份只能写入项目 .qa 的 JSON 文件。');
  return resolved;
}
const iconPath = path.join(ROOT, 'data', 'app-icon.png');
function emitUser(state) {
  state = { ...state, shortcutAvailable: globalShortcut.isRegistered(state.settings.shortcut) };
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('dex:user-changed', state);
  return state;
}
function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
}
function toggleMini() {
  if (!miniWindow || miniWindow.isDestroyed()) miniWindow = createWindow(true);
  else if (miniWindow.isVisible() && miniWindow.isFocused()) miniWindow.hide();
  else { miniWindow.show(); miniWindow.focus(); }
}
function registerShortcut(shortcut) {
  const old = store.get().settings.shortcut;
  if (shortcut === old && globalShortcut.isRegistered(old)) return;
  if (!/^[A-Za-z0-9+]{2,80}$/.test(shortcut)) throw new Error('快捷键格式示例：Ctrl+Alt+P 或 F8。');
  let registered;
  try { registered = globalShortcut.register(shortcut, toggleMini); }
  catch { throw new Error('快捷键格式无效，请使用 Ctrl+Alt+P 或 F8 等组合。'); }
  if (!registered) throw new Error('该快捷键已被其他程序占用，请换一个组合。');
  if (old !== shortcut) globalShortcut.unregister(old);
}
function applyDisplayScale(window, mini, scale, resize = false) {
  const factor = scale / 100;
  window.webContents.setZoomFactor(factor);
  if (mini && resize) {
    const area = screen.getDisplayMatching(window.getBounds()).workArea;
    const width = Math.min(Math.round(440 * factor), area.width - 32);
    const height = Math.min(Math.round(820 * factor), area.height - 40);
    window.setMinimumSize(Math.min(Math.round(380 * factor), width), Math.min(Math.round(540 * factor), height));
    window.setBounds({ width, height, x: area.x + area.width - width - 20, y: area.y + 20 });
  }
}
function createWindow(mini) {
  const display = screen.getPrimaryDisplay().workArea;
  const factor = store.get().settings.uiScale / 100;
  const miniWidth = Math.min(Math.round(440 * factor), display.width - 32);
  const miniHeight = Math.min(Math.round(820 * factor), display.height - 40);
  const window = new BrowserWindow({
    width: mini ? miniWidth : 1400, height: mini ? miniHeight : Math.min(960, display.height - 40),
    minWidth: mini ? Math.min(Math.round(380 * factor), miniWidth) : 1050,
    minHeight: mini ? Math.min(Math.round(540 * factor), miniHeight) : 680,
    x: mini ? display.x + display.width - miniWidth - 20 : undefined,
    y: mini ? display.y + 20 : undefined,
    title: mini ? '图鉴 · 快速查询' : '宝可梦图鉴',
    frame: false, show: false, backgroundColor: '#f6f5f1',
    alwaysOnTop: mini || store.get().settings.keepOnTop,
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, zoomFactor: factor },
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('did-finish-load', () => applyDisplayScale(window, mini, store.get().settings.uiScale));
  window.setAlwaysOnTop(mini || store.get().settings.keepOnTop, 'screen-saver');
  window.on('ready-to-show', () => { if (process.env.POKEDEX_HEADLESS !== '1') window.show(); });
  if (DEVELOPMENT_URL) window.loadURL(`${DEVELOPMENT_URL}${mini ? '/?mini=1' : '/'}`);
  else window.loadFile(path.join(ROOT, 'dist/index.html'), { query: mini ? { mini: '1' } : {} });
  if (mini) {
    window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
    window.on('closed', () => { miniWindow = null; });
  } else {
    window.on('closed', () => { mainWindow = null; app.quit(); });
  }
  return window;
}
function trusted(event) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || event.senderFrame !== event.sender.mainFrame) throw new Error('无效的查询来源。');
  return window;
}

if (singleInstance) app.whenReady().then(() => {
  try {
    data = createDataService(path.join(ROOT, 'data/pokedex.sqlite'));
    store = createUserStore(app.getPath('userData'));
    strategies = createStrategyService(data, path.join(app.getPath('userData'), 'strategy-cache'));
    teams = createTeamService(strategies, path.join(app.getPath('userData'), 'team-cache'), globalThis.fetch, {
      ...(process.env.POKEDEX_TEST === '1' && process.env.POKEDEX_TEAM_SOURCES === 'samples' ? { providers: [] } : {}),
      onUpdate: progress => { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('dex:teams-updated', progress); },
    });
    battle = createBattleService(data, strategies, teams);
    assistant = createTeamAssistantService({ databasePath: path.join(ROOT, 'data/pokedex.sqlite'), directory: app.getPath('userData'),
      onUpdate: progress => { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('dex:assistant-updated', progress); } });
    backups = createBackupService(data, strategies, teams);
    const bootstrap = data.query('bootstrap');
    const settings = store.get().settings;
    if (!bootstrap.versions.some(v => v.id === settings.versionId)) store.settings({ versionId: 27 });
    if (!['light', 'dark'].includes(settings.theme)) store.settings({ theme: 'light' });
    if (!['artwork', 'sprite'].includes(settings.imageStyle)) store.settings({ imageStyle: 'artwork' });

    ipcMain.handle('dex:query', (event, action, args) => { trusted(event); return data.query(action, args); });
    ipcMain.handle('dex:strategy', async (event, action, args = {}) => {
      trusted(event);
      const versionId = store.get().settings.versionId;
      if (action === 'references') return strategies.references();
      if (action === 'list') return strategies.list({ ...args, versionId });
      if (action === 'personal') return store.get().plans.filter(plan => !args.pokemonId || plan.pokemonId === Number(args.pokemonId)).map(plan => strategies.decorate(plan, versionId));
      if (action === 'validate') return strategies.model.validate(args.set, versionId);
      if (action === 'save') { const plan = strategies.validatePersonal(args.set, versionId); return emitUser(store.savePlan(plan)); }
      if (action === 'delete') return emitUser(store.deletePlan(args.id));
      if (action === 'progress') return emitUser(store.progress(args.id, args.key, args.value));
      if (action === 'import') {
        const sets = strategies.import(args.text, args.generation);
        const plans = sets.map(set => strategies.validatePersonal(set, versionId));
        const user = emitUser(store.savePlans(plans)); return { count: sets.length, user };
      }
      if (action === 'export') {
        const text = strategies.export(args.set, args.language);
        if (args.copy !== false) clipboard.writeText(text);
        return text;
      }
      if (action === 'source') {
        let url;
        try { url = new URL(args.url); } catch { throw new Error('来源地址无效。'); }
        if (url.protocol !== 'https:' || url.hostname !== 'www.smogon.com' || !url.pathname.startsWith('/dex/')) throw new Error('只允许打开方案对应的 Smogon 来源页。');
        await shell.openExternal(url.href); return true;
      }
      throw new Error('不支持的配招操作。');
    });
    ipcMain.handle('dex:team', async (event, action, args = {}) => {
      trusted(event);
      const versionId = store.currentSettings().versionId;
      if (action === 'formats') return teams.formats(args.refresh === true);
      if (action === 'metadata') return teams.metadata();
      if (action === 'assistant-metadata') return assistant.metadata(teams.metadata().formats);
      if (action === 'assistant-preset-save') {
        const user = emitUser(store.saveAssistantPreset(args.preset)); return user.assistantPresets[0];
      }
      if (action === 'assistant-preset-delete') { emitUser(store.deleteAssistantPreset(args.id)); return true; }
      if (action === 'assistant-start') return assistant.start(event.sender.id, args, { versionId });
      if (action === 'assistant-status') return assistant.status(event.sender.id, args.runId, args.summary === true);
      if (action === 'assistant-inspect') return assistant.inspect(event.sender.id, args.runId, args.index);
      if (action === 'assistant-opponent-import') {
        const { snapshot } = require('./assistant-scenario.cjs');
        const sets = strategies.import(args.text, args.generation);
        if (sets.length > 6) throw new Error('一次最多导入 6 条对手路线。');
        return sets.map(set => ({ pokemonId: set.pokemonId, build: snapshot(set) }));
      }
      if (action === 'assistant-cancel') return assistant.cancel(event.sender.id, args.runId);
      if (action === 'assistant-save') {
        const result = assistant.result(event.sender.id, args.runId, args.index);
        if (result.savedId && store.get().teams.some(team => team.id === result.savedId)) return { user: store.get(), teamId: result.savedId };
        const team = teams.model.validate(result.team, versionId), user = emitUser(store.saveTeam(team, { roster: true, copy: true }));
        const teamId = user.teams[0].id; assistant.saved(event.sender.id, args.runId, args.index, teamId);
        return { user, teamId };
      }
      if (action === 'list') return teams.list({ ...args, versionId });
      if (action === 'browse') return teams.browse({ ...args, versionId });
      if (action === 'sync') return teams.sync(args);
      if (action === 'personal') { const user = store.get(); return user.teams.map(team => teams.model.decorate(team, versionId, user.plans)); }
      if (action === 'preview') return teams.model.decorate(await teams.import(args), versionId);
      if (action === 'save') return emitUser(store.saveTeam(teams.model.validate(args.team, versionId)));
      if (action === 'compose-preview') {
        const team = teams.compose(args, store.get(), versionId);
        return { ...teams.model.decorate(team, versionId), id: 'workbench-preview', personal: false };
      }
      if (action === 'compose-save') return emitUser(store.saveTeam(teams.compose(args, store.get(), versionId), { roster: true, copy: Boolean(args.copyFrom) }));
      if (action === 'restore') {
        const saved = store.get().teams.find(team => team.id === args.id);
        if (!saved) throw new Error('找不到这支收藏队伍。');
        teams.model.validate(saved, versionId);
        return emitUser(store.restoreTeamPlans(args.id, args.memberId));
      }
      if (action === 'delete') return emitUser(store.deleteTeam(args.id, args.deletePlans === true));
      if (action === 'export') {
        const text = teams.export(args.team, args.language, versionId);
        if (args.copy !== false) clipboard.writeText(text);
        return text;
      }
      if (action === 'source') {
        const url = sourceURL(args.url);
        await shell.openExternal(url); return true;
      }
      throw new Error('不支持的队伍操作。');
    });
    ipcMain.handle('dex:battle', (event, action, args = {}) => {
      trusted(event);
      if (action === 'references') return battle.references(args.generation);
      if (action === 'draft') return battle.draft(args);
      if (action === 'stats') return battle.stats(args);
      if (action === 'damage') return battle.damage(args);
      if (action === 'analyze') {
        const saved = args.team?.personal && store.get().teams.find(team => team.id === args.team.id);
        return battle.analyze({ ...args, team: saved || args.team });
      }
      throw new Error('不支持的对战计算操作。');
    });
    ipcMain.handle('dex:backup', async (event, action, args = {}) => {
      const window = trusted(event);
      if (action === 'export') {
        const result = args.path ? { filePath: testBackupPath(args.path), canceled: false } :
          await dialog.showSaveDialog(window, { title: '保存图鉴个人资料备份', defaultPath: 'Pokedex-backup-' + new Date().toISOString().slice(0, 10) + '.json', filters: [{ name: '图鉴备份', extensions: ['json'] }] });
        if (result.canceled || !result.filePath) return { canceled: true };
        writeFileSync(result.filePath, backups.encode(store.get()), 'utf8');
        return { canceled: false, path: result.filePath };
      }
      if (action === 'preview') {
        const result = args.path ? { filePaths: [testBackupPath(args.path)], canceled: false } :
          await dialog.showOpenDialog(window, { title: '选择图鉴个人资料备份', filters: [{ name: '图鉴备份', extensions: ['json'] }], properties: ['openFile'] });
        if (result.canceled || !result.filePaths[0]) return { canceled: true };
        if (statSync(result.filePaths[0]).size > 20 * 1024 * 1024) throw new Error('备份文件超过 20 MB。');
        const decoded = backups.decode(readFileSync(result.filePaths[0], 'utf8')), token = randomUUID();
        if (pendingBackups.size >= 4) pendingBackups.clear();
        pendingBackups.set(token, { ...decoded, senderId: event.sender.id, expires: Date.now() + 10 * 60 * 1000 });
        return { canceled: false, token, summary: decoded.summary };
      }
      if (action === 'restore') {
        const pending = pendingBackups.get(args.token);
        if (!pending || pending.senderId !== event.sender.id || pending.expires < Date.now()) throw new Error('备份预览已过期，请重新选择文件。');
        const result = store.restorePersonal(pending.state); pendingBackups.delete(args.token);
        emitUser(result.user); return { recovery: result.recovery };
      }
      throw new Error('不支持的备份操作。');
    });
    ipcMain.handle('dex:user', (event, action, args = {}) => {
      trusted(event);
      if (action === 'get') return { ...store.get(), shortcutAvailable: globalShortcut.isRegistered(store.get().settings.shortcut) };
      if (action === 'mini-pin') {
        if (!['pokemon', 'moves', 'abilities', 'items'].includes(args.kind) || !Number.isInteger(args.id)) throw new Error('请选择有效的资料。');
        const reference = data.references()[args.kind].find(value => value.id === args.id);
        if (!reference) throw new Error('未找到要固定的资料。');
        return emitUser(store.pinMini({ kind: args.kind, id: args.id, name: reference.name }));
      }
      if (action === 'mini-unpin') return emitUser(store.unpinMini(args.key));
      if (action === 'settings') {
        const allowed = ['versionId', 'theme', 'imageStyle', 'shortcut', 'keepOnTop', 'uiScale'];
        if (Object.keys(args).some(key => !allowed.includes(key))) throw new Error('无效的设置项目。');
        if ('versionId' in args && !bootstrap.versions.some(v => v.id === args.versionId)) throw new Error('无效的资料版本。');
        if ('theme' in args && !['light', 'dark'].includes(args.theme)) throw new Error('无效的主题。');
        if ('imageStyle' in args && !['artwork', 'sprite'].includes(args.imageStyle)) throw new Error('无效的图片风格。');
        if ('keepOnTop' in args && typeof args.keepOnTop !== 'boolean') throw new Error('无效的置顶设置。');
        if ('uiScale' in args && !UI_SCALES.includes(args.uiScale)) throw new Error('请选择 100%、125%、150%、175% 或 200% 的界面缩放。');
        if ('shortcut' in args) registerShortcut(args.shortcut);
        if ('keepOnTop' in args) mainWindow?.setAlwaysOnTop(args.keepOnTop, 'screen-saver');
        const updated = store.settings(args);
        if ('uiScale' in args) {
          for (const target of BrowserWindow.getAllWindows()) applyDisplayScale(target, target === miniWindow, args.uiScale, target === miniWindow);
        }
        return emitUser(updated);
      }
      const id = Number(args.id);
      if (!data.hasPokemon(id)) throw new Error('无效的宝可梦编号。');
      if (action === 'favorite') return emitUser(store.favorite(id));
      if (action === 'visit') return emitUser(store.visit(id));
      if (action === 'note') return emitUser(store.note(id, args.text));
      throw new Error('不支持的个人资料操作。');
    });
    ipcMain.handle('dex:window', (event, action) => {
      const window = trusted(event);
      if (action === 'minimize') window.minimize();
      else if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
      else if (action === 'close') window.close();
      else if (action === 'mini') toggleMini();
      else if (action === 'main') { showMain(); miniWindow?.hide(); }
      else if (action === 'quit') app.quit();
      else throw new Error('不支持的窗口操作。');
      return true;
    });
    try { registerShortcut(store.get().settings.shortcut); }
    catch (error) { console.warn(error.message); }
    mainWindow = createWindow(false);
  } catch (error) {
    dialog.showErrorBox('图鉴暂时无法启动', `${error.message}\n\n开发环境请先执行 npm run data:import；成品请保留完整解压目录。`);
    app.quit();
  }
});
app.on('second-instance', () => { if (store) showMain(); });
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { assistant?.dispose(); globalShortcut.unregisterAll(); data?.close(); });
app.on('window-all-closed', () => app.quit());
