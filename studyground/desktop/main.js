// SMEAG MockTest — Electron main process. Loads the bundled static site
// from disk (file://) so the app runs fully offline. No network required.
const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    backgroundColor: '#f7f4ee',
    title: 'SMEAG MockTest',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // allow <audio> to load local mp3 assets bundled in site/
      webSecurity: true,
    },
  });

  win.loadFile(path.join(__dirname, 'site', 'index.html'));

  // external links → system browser; internal navigation stays in-app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
}

app.whenReady().then(() => {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
