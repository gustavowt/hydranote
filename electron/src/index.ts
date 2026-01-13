import type { CapacitorElectronConfig } from '@capacitor-community/electron';
import { getCapacitorElectronConfig, setupElectronDeepLinking } from '@capacitor-community/electron';
import type { MenuItemConstructorOptions } from 'electron';
import { app, MenuItem, ipcMain, dialog, shell } from 'electron';
import electronIsDev from 'electron-is-dev';
import unhandled from 'electron-unhandled';
import { autoUpdater } from 'electron-updater';
import * as fs from 'fs';
import * as path from 'path';

import { ElectronCapacitorApp, setupContentSecurityPolicy, setupReloadWatcher } from './setup';
import {
  loadMCPSettings,
  saveMCPSettings,
  generateBearerToken,
  initializeMCPServer,
  getMCPServer,
  MCPSettings,
  DEFAULT_MCP_SETTINGS,
} from './mcpServer';
import { getModelManager, HFModelRef } from './modelManager';
import { getInferenceRuntime, isRuntimeAvailable } from './inferenceRuntime';

// Graceful handling of unhandled errors.
unhandled();

// Define our menu templates (these are optional)
const trayMenuTemplate: (MenuItemConstructorOptions | MenuItem)[] = [new MenuItem({ label: 'Quit App', role: 'quit' })];
const appMenuBarMenuTemplate: (MenuItemConstructorOptions | MenuItem)[] = [
  { role: process.platform === 'darwin' ? 'appMenu' : 'fileMenu' },
  { role: 'editMenu' },
  { role: 'viewMenu' },
];

// Get Config options from capacitor.config
const capacitorFileConfig: CapacitorElectronConfig = getCapacitorElectronConfig();

// Initialize our app. You can pass menu templates into the app here.
// const myCapacitorApp = new ElectronCapacitorApp(capacitorFileConfig);
const myCapacitorApp = new ElectronCapacitorApp(capacitorFileConfig, trayMenuTemplate, appMenuBarMenuTemplate);

// If deeplinking is enabled then we will set it up here.
if (capacitorFileConfig.electron?.deepLinkingEnabled) {
  setupElectronDeepLinking(myCapacitorApp, {
    customProtocol: capacitorFileConfig.electron.deepLinkingCustomProtocol ?? 'mycapacitorapp',
  });
}

// If we are in Dev mode, use the file watcher components.
if (electronIsDev) {
  setupReloadWatcher(myCapacitorApp);
}

// Run Application
(async () => {
  // Wait for electron app to be ready.
  await app.whenReady();
  // Security - Set Content-Security-Policy based on whether or not we are in dev mode.
  setupContentSecurityPolicy(myCapacitorApp.getCustomURLScheme());
  // Initialize our app, build windows, and load content.
  await myCapacitorApp.init();
  // Check for updates if we are in a packaged app.
  autoUpdater.checkForUpdatesAndNotify();
  
  // Start MCP server if enabled
  const mcpSettings = loadMCPSettings();
  if (mcpSettings.enabled && mcpSettings.bearerToken) {
    try {
      const mcpServer = initializeMCPServer(mcpSettings);
      mcpServer.setMainWindow(myCapacitorApp.getMainWindow());
      await mcpServer.start();
      console.log('[MCP] Server started successfully');
    } catch (error) {
      console.error('[MCP] Failed to start server:', error);
    }
  }
})();

// Handle when all of our windows are close (platforms have their own expectations).
app.on('window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// When the dock icon is clicked.
app.on('activate', async function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (myCapacitorApp.getMainWindow().isDestroyed()) {
    await myCapacitorApp.init();
  }
});

// Place all ipc or other electron api calls and custom functionality under this line

// ============================================
// File System IPC Handlers
// ============================================

// Select directory dialog
ipcMain.handle('fs:selectDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select HydraNote Sync Folder',
  });
  
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, error: 'Selection cancelled' };
  }
  
  return { success: true, path: result.filePaths[0] };
});

// Read file (text)
ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return { success: true, content };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to read file' 
    };
  }
});

// Read binary file (returns base64)
ipcMain.handle('fs:readBinaryFile', async (_event, filePath: string) => {
  try {
    const buffer = await fs.promises.readFile(filePath);
    const base64 = buffer.toString('base64');
    return { success: true, data: base64 };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to read binary file' 
    };
  }
});

// Write file
ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
  try {
    // Ensure parent directory exists
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(filePath, content, 'utf-8');
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to write file' 
    };
  }
});

// Delete file
ipcMain.handle('fs:deleteFile', async (_event, filePath: string) => {
  try {
    await fs.promises.unlink(filePath);
    return { success: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { success: true }; // File doesn't exist, that's fine
    }
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to delete file' 
    };
  }
});

// Create directory
ipcMain.handle('fs:createDirectory', async (_event, dirPath: string) => {
  try {
    await fs.promises.mkdir(dirPath, { recursive: true });
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to create directory' 
    };
  }
});

// Delete directory
ipcMain.handle('fs:deleteDirectory', async (_event, dirPath: string) => {
  try {
    await fs.promises.rm(dirPath, { recursive: true, force: true });
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to delete directory' 
    };
  }
});

// List directory contents
ipcMain.handle('fs:listDirectory', async (_event, dirPath: string) => {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const result = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dirPath, entry.name);
        const stats = await fs.promises.stat(fullPath);
        return {
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          size: stats.size,
          modifiedTime: stats.mtime.toISOString(),
        };
      })
    );
    return { success: true, entries: result };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { success: true, entries: [] }; // Directory doesn't exist
    }
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to list directory' 
    };
  }
});

// Check if path exists
ipcMain.handle('fs:exists', async (_event, targetPath: string) => {
  try {
    await fs.promises.access(targetPath);
    return { success: true, exists: true };
  } catch {
    return { success: true, exists: false };
  }
});

// Get file/directory stats
ipcMain.handle('fs:getStats', async (_event, targetPath: string) => {
  try {
    const stats = await fs.promises.stat(targetPath);
    return {
      success: true,
      stats: {
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        size: stats.size,
        modifiedTime: stats.mtime.toISOString(),
        createdTime: stats.birthtime.toISOString(),
      },
    };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to get stats' 
    };
  }
});

// ============================================
// Shell IPC Handlers
// ============================================

// Open file in system default application
ipcMain.handle('shell:openPath', async (_event, filePath: string) => {
  try {
    const result = await shell.openPath(filePath);
    if (result) {
      // shell.openPath returns an empty string on success, error message otherwise
      return { success: false, error: result };
    }
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to open file' 
    };
  }
});

// ============================================
// Web Fetch IPC Handlers
// ============================================

// Configuration
const WEB_FETCH_TIMEOUT_MS = 30000; // 30 seconds
const WEB_FETCH_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

interface WebFetchOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
}

interface WebFetchResult {
  success: boolean;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  finalUrl?: string;
  error?: string;
}

/**
 * Validate URL - only allow http and https protocols
 */
function validateUrl(urlString: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { valid: false, error: `Invalid protocol: ${url.protocol}. Only http: and https: are allowed.` };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: `Invalid URL: ${urlString}` };
  }
}

/**
 * Perform HTTP fetch with timeout and size limits
 * This runs in the main process, bypassing CORS restrictions
 */
ipcMain.handle('web:fetch', async (_event, options: WebFetchOptions): Promise<WebFetchResult> => {
  const { url, method = 'GET', headers = {}, body, timeout = WEB_FETCH_TIMEOUT_MS } = options;

  // Validate URL
  const validation = validateUrl(url);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Perform the fetch
    const response = await fetch(url, {
      method,
      headers: {
        'User-Agent': 'HydraNote/1.0',
        'Accept': 'text/html,application/json,application/xhtml+xml,*/*',
        ...headers,
      },
      body: body || undefined,
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timeoutId);

    // Check content length before reading body
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > WEB_FETCH_MAX_SIZE_BYTES) {
      return {
        success: false,
        error: `Response too large: ${contentLength} bytes (max: ${WEB_FETCH_MAX_SIZE_BYTES} bytes)`,
      };
    }

    // Read body as text with size limit
    const reader = response.body?.getReader();
    if (!reader) {
      return {
        success: true,
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: '',
        finalUrl: response.url,
      };
    }

    const chunks: Uint8Array[] = [];
    let totalSize = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalSize += value.length;
      if (totalSize > WEB_FETCH_MAX_SIZE_BYTES) {
        reader.cancel();
        return {
          success: false,
          error: `Response too large: exceeded ${WEB_FETCH_MAX_SIZE_BYTES} bytes limit`,
        };
      }

      chunks.push(value);
    }

    // Combine chunks and decode as text
    const allChunks = new Uint8Array(totalSize);
    let position = 0;
    for (const chunk of chunks) {
      allChunks.set(chunk, position);
      position += chunk.length;
    }

    const decoder = new TextDecoder('utf-8');
    const bodyText = decoder.decode(allChunks);

    // Convert headers to plain object
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      success: true,
      status: response.status,
      headers: responseHeaders,
      body: bodyText,
      finalUrl: response.url,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    if (errorMessage.includes('aborted')) {
      return { success: false, error: `Request timeout after ${timeout}ms` };
    }
    
    return { success: false, error: `Fetch failed: ${errorMessage}` };
  }
});

// ============================================
// MCP Server IPC Handlers
// ============================================

// Get MCP settings
ipcMain.handle('mcp:getSettings', async () => {
  try {
    const settings = loadMCPSettings();
    return { success: true, settings };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load MCP settings',
    };
  }
});

// Save MCP settings
ipcMain.handle('mcp:saveSettings', async (_event, settings: MCPSettings) => {
  try {
    saveMCPSettings(settings);
    
    // Update or restart server based on settings
    const server = getMCPServer();
    
    if (settings.enabled && settings.bearerToken) {
      if (server) {
        // Server exists - update settings and restart if needed
        const wasRunning = server.isRunning();
        if (wasRunning) {
          await server.stop();
        }
        server.updateSettings(settings);
        server.setMainWindow(myCapacitorApp.getMainWindow());
        await server.start();
      } else {
        // Create new server
        const newServer = initializeMCPServer(settings);
        newServer.setMainWindow(myCapacitorApp.getMainWindow());
        await newServer.start();
      }
    } else if (server && server.isRunning()) {
      // Disable server
      await server.stop();
    }
    
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save MCP settings',
    };
  }
});

// Generate new bearer token
ipcMain.handle('mcp:generateToken', async () => {
  try {
    const token = generateBearerToken();
    return { success: true, token };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate token',
    };
  }
});

// Get MCP server status
ipcMain.handle('mcp:getStatus', async () => {
  try {
    const server = getMCPServer();
    return {
      success: true,
      running: server?.isRunning() ?? false,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get MCP status',
    };
  }
});

// Start MCP server manually
ipcMain.handle('mcp:start', async () => {
  try {
    const settings = loadMCPSettings();
    if (!settings.enabled) {
      return { success: false, error: 'MCP server is disabled in settings' };
    }
    if (!settings.bearerToken) {
      return { success: false, error: 'No bearer token configured' };
    }
    
    let server = getMCPServer();
    if (!server) {
      server = initializeMCPServer(settings);
    }
    
    server.setMainWindow(myCapacitorApp.getMainWindow());
    await server.start();
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start MCP server',
    };
  }
});

// Stop MCP server manually
ipcMain.handle('mcp:stop', async () => {
  try {
    const server = getMCPServer();
    if (server && server.isRunning()) {
      await server.stop();
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to stop MCP server',
    };
  }
});

// ============================================
// Local Models IPC Handlers
// ============================================

// Initialize model manager and set main window
const modelManager = getModelManager();
const inferenceRuntime = getInferenceRuntime();

// Set main window reference after app is ready
app.whenReady().then(() => {
  const mainWindow = myCapacitorApp.getMainWindow();
  modelManager.setMainWindow(mainWindow);
  inferenceRuntime.setMainWindow(mainWindow);
});

// Get model catalog
ipcMain.handle('models:getCatalog', async () => {
  try {
    const catalog = modelManager.getCatalog();
    return { success: true, models: catalog };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get catalog',
    };
  }
});

// Fetch model info from Hugging Face
ipcMain.handle('models:fetchModelInfo', async (_event, repoId: string) => {
  try {
    const model = await modelManager.fetchModelInfo(repoId);
    return { success: true, model };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch model info',
    };
  }
});

// Get installed models
ipcMain.handle('models:getInstalled', async () => {
  try {
    const models = modelManager.getInstalledModels();
    return { success: true, models };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get installed models',
    };
  }
});

// Get a specific model
ipcMain.handle('models:getModel', async (_event, modelId: string) => {
  try {
    const model = modelManager.getModel(modelId);
    if (!model) {
      return { success: false, error: 'Model not found' };
    }
    return { success: true, model };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get model',
    };
  }
});

// Install a model
ipcMain.handle('models:install', async (_event, modelRef: HFModelRef) => {
  try {
    const modelId = await modelManager.installModel(modelRef);
    return { success: true, modelId };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to install model',
    };
  }
});

// Cancel installation
ipcMain.handle('models:cancelInstall', async (_event, modelId: string) => {
  try {
    const cancelled = modelManager.cancelInstall(modelId);
    return { success: cancelled };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cancel installation',
    };
  }
});

// Remove a model
ipcMain.handle('models:remove', async (_event, modelId: string) => {
  try {
    const removed = await modelManager.removeModel(modelId);
    return { success: removed };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to remove model',
    };
  }
});

// Get runtime status
ipcMain.handle('models:getRuntimeStatus', async () => {
  try {
    const available = await isRuntimeAvailable();
    if (!available) {
      return {
        success: true,
        status: {
          running: false,
          ready: false,
          error: 'node-llama-cpp is not installed. Run: npm install node-llama-cpp',
        },
      };
    }
    const status = inferenceRuntime.getStatus();
    return { success: true, status };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get runtime status',
    };
  }
});

// Load a model into runtime
ipcMain.handle('models:loadModel', async (_event, modelId: string, options?: { gpuLayers?: number; contextLength?: number }) => {
  try {
    await inferenceRuntime.loadModel(modelId, options);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load model',
    };
  }
});

// Unload current model
ipcMain.handle('models:unloadModel', async () => {
  try {
    await inferenceRuntime.unloadModel();
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to unload model',
    };
  }
});

// Run inference
interface InferenceMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface InferenceOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  stream?: boolean;
}

ipcMain.handle('models:infer', async (_event, messages: InferenceMessage[], options?: InferenceOptions) => {
  try {
    const result = await inferenceRuntime.infer(messages, options);
    return { success: true, content: result.content };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Inference failed',
    };
  }
});

// Get local model settings
ipcMain.handle('models:getSettings', async () => {
  try {
    const settings = modelManager.getSettings();
    return { success: true, settings };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get settings',
    };
  }
});

// Save local model settings
ipcMain.handle('models:saveSettings', async (_event, settings: {
  modelsDirectory?: string;
  defaultGpuLayers: number;
  defaultContextLength: number;
  huggingFaceToken?: string;
  autoLoadLastModel: boolean;
}) => {
  try {
    modelManager.saveSettings(settings);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save settings',
    };
  }
});
