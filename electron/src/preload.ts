require('./rt/electron-rt');
//////////////////////////////
// User Defined Preload scripts below

import { contextBridge, ipcRenderer } from 'electron';

// MCP Settings type
interface MCPSettings {
  enabled: boolean;
  port: number;
  bearerToken: string;
}

// MCP Tool Request type
interface MCPToolRequest {
  requestId: string;
  toolName: string;
  args: Record<string, unknown>;
}

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
  // MCP Server Operations
  mcp: {
    getSettings: () => ipcRenderer.invoke('mcp:getSettings'),
    saveSettings: (settings: MCPSettings) => {
      // Create a plain object copy to ensure serializability
      const plainSettings = {
        enabled: settings.enabled,
        port: settings.port,
        bearerToken: settings.bearerToken,
      };
      return ipcRenderer.invoke('mcp:saveSettings', plainSettings);
    },
    generateToken: () => ipcRenderer.invoke('mcp:generateToken'),
    getStatus: () => ipcRenderer.invoke('mcp:getStatus'),
    start: () => ipcRenderer.invoke('mcp:start'),
    stop: () => ipcRenderer.invoke('mcp:stop'),
    // Listen for tool execution requests from main process
    onToolRequest: (callback: (request: MCPToolRequest) => void) => {
      ipcRenderer.on('mcp:tool-request', (_event, request: MCPToolRequest) => {
        callback(request);
      });
    },
    // Send tool execution response back to main process
    sendToolResponse: (requestId: string, response: { success: boolean; data?: unknown; error?: string }) => {
      ipcRenderer.send('mcp:tool-response', { requestId, result: response });
    },
  },
  // App info
  platform: process.platform,
  isElectron: true,
});

console.log('HydraNote Electron Preload Initialized');
