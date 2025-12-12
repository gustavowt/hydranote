require('./rt/electron-rt');
//////////////////////////////
// User Defined Preload scripts below

import { contextBridge, ipcRenderer } from 'electron';

// Expose Electron APIs to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // File System Operations
  fs: {
    selectDirectory: () => ipcRenderer.invoke('fs:selectDirectory'),
    readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
    deleteFile: (filePath: string) => ipcRenderer.invoke('fs:deleteFile', filePath),
    createDirectory: (dirPath: string) => ipcRenderer.invoke('fs:createDirectory', dirPath),
    deleteDirectory: (dirPath: string) => ipcRenderer.invoke('fs:deleteDirectory', dirPath),
    listDirectory: (dirPath: string) => ipcRenderer.invoke('fs:listDirectory', dirPath),
    exists: (path: string) => ipcRenderer.invoke('fs:exists', path),
    getStats: (path: string) => ipcRenderer.invoke('fs:getStats', path),
  },
  // App info
  platform: process.platform,
  isElectron: true,
});

console.log('HydraNote Electron Preload Initialized');
