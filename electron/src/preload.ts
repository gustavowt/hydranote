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
    readBinaryFile: (filePath: string) => ipcRenderer.invoke('fs:readBinaryFile', filePath),
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
    deleteFile: (filePath: string) => ipcRenderer.invoke('fs:deleteFile', filePath),
    createDirectory: (dirPath: string) => ipcRenderer.invoke('fs:createDirectory', dirPath),
    deleteDirectory: (dirPath: string) => ipcRenderer.invoke('fs:deleteDirectory', dirPath),
    listDirectory: (dirPath: string) => ipcRenderer.invoke('fs:listDirectory', dirPath),
    exists: (path: string) => ipcRenderer.invoke('fs:exists', path),
    getStats: (path: string) => ipcRenderer.invoke('fs:getStats', path),
  },
  // Shell Operations (open files/URLs in system applications)
  shell: {
    openPath: (filePath: string) => ipcRenderer.invoke('shell:openPath', filePath),
  },
  // Web Fetch Operations (bypasses CORS by running in main process)
  web: {
    fetch: (options: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      timeout?: number;
    }) => ipcRenderer.invoke('web:fetch', options),
  },
  // App info
  platform: process.platform,
  isElectron: true,
});

console.log('HydraNote Electron Preload Initialized');
