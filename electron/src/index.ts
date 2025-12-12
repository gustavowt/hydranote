import type { CapacitorElectronConfig } from '@capacitor-community/electron';
import { getCapacitorElectronConfig, setupElectronDeepLinking } from '@capacitor-community/electron';
import type { MenuItemConstructorOptions } from 'electron';
import { app, MenuItem, ipcMain, dialog } from 'electron';
import electronIsDev from 'electron-is-dev';
import unhandled from 'electron-unhandled';
import { autoUpdater } from 'electron-updater';
import * as fs from 'fs';
import * as path from 'path';

import { ElectronCapacitorApp, setupContentSecurityPolicy, setupReloadWatcher } from './setup';

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

// Read file
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
