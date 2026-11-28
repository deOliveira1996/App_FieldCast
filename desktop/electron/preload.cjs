const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('fieldcastDesktop', Object.freeze({
  isDesktopApp: true,
  platform: process.platform,
  versions: Object.freeze({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  }),
}));
