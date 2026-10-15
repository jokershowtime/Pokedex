const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pokedex', {
  query: (action, args) => ipcRenderer.invoke('dex:query', action, args),
  strategy: (action, args) => ipcRenderer.invoke('dex:strategy', action, args),
  team: (action, args) => ipcRenderer.invoke('dex:team', action, args),
  battle: (action, args) => ipcRenderer.invoke('dex:battle', action, args),
  backup: (action, args) => ipcRenderer.invoke('dex:backup', action, args),
  user: (action, args) => ipcRenderer.invoke('dex:user', action, args),
  window: action => ipcRenderer.invoke('dex:window', action),
  onUserChange: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('dex:user-changed', listener);
    return () => ipcRenderer.removeListener('dex:user-changed', listener);
  },
  onTeamUpdate: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('dex:teams-updated', listener);
    return () => ipcRenderer.removeListener('dex:teams-updated', listener);
  },
  onAssistantUpdate: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('dex:assistant-updated', listener);
    return () => ipcRenderer.removeListener('dex:assistant-updated', listener);
  },
  onNavigate: callback => {
    const listener = (_event, id) => callback(id);
    ipcRenderer.on('dex:navigate', listener);
    return () => ipcRenderer.removeListener('dex:navigate', listener);
  },
});
