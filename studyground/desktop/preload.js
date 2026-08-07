// Minimal, safe preload — exposes app version only. The site is 100% static.
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('SMEAG_DESKTOP', { version: '1.0.0', offline: true });
