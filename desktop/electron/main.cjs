const { app, BrowserWindow, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

function resolveIndexHtmlPath() {
  const packagedDist = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(packagedDist)) {
    return packagedDist;
  }
  const workspaceDist = path.join(__dirname, '..', '..', 'dist', 'index.html');
  return workspaceDist;
}

function resolveAppIconPath() {
  const candidates = [
    path.join(__dirname, 'dist', 'icons', '512x512.png'),
    path.join(__dirname, '..', '..', 'dist', 'icons', '512x512.png'),
    path.join(__dirname, '..', '..', 'public', 'icons', '512x512.png'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function createMainWindow() {
  const indexHtmlPath = resolveIndexHtmlPath();
  const iconPath = resolveAppIconPath();

  const win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'FieldCast — Previsão Local & Campo',
    backgroundColor: '#0f172a',
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Open external documentation / official weather source links in OS default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (!targetUrl.startsWith('file://')) {
      event.preventDefault();
      if (targetUrl.startsWith('https://') || targetUrl.startsWith('http://')) {
        void shell.openExternal(targetUrl);
      }
    }
  });

  if (!fs.existsSync(indexHtmlPath)) {
    const missingHtml = encodeURIComponent(
      '<!doctype html><html lang="pt-BR"><body style="font-family:sans-serif;background:#0f172a;color:#e2e8f0;padding:32px">' +
        '<h1>FieldCast Desktop</h1>' +
        '<p>Arquivo <code>dist/index.html</code> não encontrado. Execute <code>npm run desktop:prepare</code> na raiz do projeto antes de iniciar.</p>' +
        '</body></html>',
    );
    void win.loadURL(`data:text/html;charset=utf-8,${missingHtml}`);
    return win;
  }

  void win.loadFile(indexHtmlPath);
  return win;
}

app.whenReady().then(() => {
  // Permit desktop notifications and geolocation requests originating from the packaged local app
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = permission === 'notifications' || permission === 'geolocation';
    callback(allowed);
  });

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
