'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sms', {
  state: () => ipcRenderer.invoke('state'),
  saveSettings: value => ipcRenderer.invoke('save-settings', value),
  chooseRom: () => ipcRenderer.invoke('choose-rom'),
  chooseRepo: () => ipcRenderer.invoke('choose-repo'),
  chooseLocation: () => ipcRenderer.invoke('choose-location'),
  installPort: () => ipcRenderer.invoke('install-port'),
  updatePort: () => ipcRenderer.invoke('update-port'),
  installEclipse: () => ipcRenderer.invoke('install-eclipse'),
  build: () => ipcRenderer.invoke('build'),
  play: () => ipcRenderer.invoke('play'),
  cleanPreview: () => ipcRenderer.invoke('clean-preview'),
  clean: () => ipcRenderer.invoke('clean'),
  stop: () => ipcRenderer.invoke('stop'),
  openDocs: () => ipcRenderer.invoke('open-docs'),
  checkAppUpdate: () => ipcRenderer.invoke('check-app-update'),
  onLog: callback => ipcRenderer.on('log', (_event, line) => callback(line)),
  onActivity: callback => ipcRenderer.on('activity', (_event, value) => callback(value)),
  onAppUpdate: callback => ipcRenderer.on('app-update', (_event, value) => callback(value))
});
