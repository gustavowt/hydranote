/**
 * File System Service
 * Handles file system operations for syncing projects to disk.
 * Uses File System Access API for web, with structure ready for Electron's Node.js fs module.
 */

import type { FileSystemEntry, FileSystemSettings } from '../types';
import { DEFAULT_FILESYSTEM_SETTINGS } from '../types';

// Storage key for settings
const FILESYSTEM_SETTINGS_KEY = 'hydranote_filesystem_settings';
const DIRECTORY_HANDLE_KEY = 'hydranote_directory_handle';

// In-memory cache of the directory handle (File System Access API)
let rootDirectoryHandle: FileSystemDirectoryHandle | null = null;

// Check if running in Electron
export function isElectron(): boolean {
  return typeof window !== 'undefined' && window.electronAPI?.isElectron === true;
}

// Get the Electron API (only available in Electron)
function getElectronAPI() {
  if (!isElectron()) {
    return null;
  }
  return window.electronAPI!;
}

// Check if File System Access API is supported (or running in Electron)
export function isFileSystemAccessSupported(): boolean {
  // Electron has its own file system support via IPC
  if (isElectron()) {
    return true;
  }
  return 'showDirectoryPicker' in window;
}

// ============================================
// Settings Management
// ============================================

/**
 * Load file system settings from localStorage
 */
export function loadFileSystemSettings(): FileSystemSettings {
  try {
    const stored = localStorage.getItem(FILESYSTEM_SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_FILESYSTEM_SETTINGS, ...parsed };
    }
  } catch {
    // Ignore parse errors
  }
  return { ...DEFAULT_FILESYSTEM_SETTINGS };
}

/**
 * Save file system settings to localStorage
 */
export function saveFileSystemSettings(settings: FileSystemSettings): void {
  localStorage.setItem(FILESYSTEM_SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Update specific file system settings
 */
export function updateFileSystemSettings(updates: Partial<FileSystemSettings>): FileSystemSettings {
  const current = loadFileSystemSettings();
  const updated = { ...current, ...updates };
  saveFileSystemSettings(updated);
  return updated;
}

// ============================================
// Directory Handle Management (File System Access API)
// ============================================

/**
 * Store directory handle in IndexedDB for persistence
 */
async function storeDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const db = await openIndexedDB();
    const tx = db.transaction('handles', 'readwrite');
    const store = tx.objectStore('handles');
    await new Promise<void>((resolve, reject) => {
      const request = store.put({ key: DIRECTORY_HANDLE_KEY, handle });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    db.close();
  } catch (error) {
    console.error('Failed to store directory handle:', error);
  }
}

/**
 * Retrieve directory handle from IndexedDB
 */
async function retrieveDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openIndexedDB();
    const tx = db.transaction('handles', 'readonly');
    const store = tx.objectStore('handles');
    const result = await new Promise<{ handle: FileSystemDirectoryHandle } | undefined>((resolve, reject) => {
      const request = store.get(DIRECTORY_HANDLE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result?.handle || null;
  } catch {
    return null;
  }
}

/**
 * Open IndexedDB for storing directory handles
 */
function openIndexedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('HydraNoteFSHandles', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('handles')) {
        db.createObjectStore('handles', { keyPath: 'key' });
      }
    };
  });
}

/**
 * Clear stored directory handle
 */
async function clearDirectoryHandle(): Promise<void> {
  try {
    const db = await openIndexedDB();
    const tx = db.transaction('handles', 'readwrite');
    const store = tx.objectStore('handles');
    await new Promise<void>((resolve, reject) => {
      const request = store.delete(DIRECTORY_HANDLE_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    db.close();
    rootDirectoryHandle = null;
  } catch (error) {
    console.error('Failed to clear directory handle:', error);
  }
}

// ============================================
// Directory Selection
// ============================================

/**
 * Prompt user to select root directory
 * Uses Electron's native dialog in Electron, File System Access API in browser
 */
export async function selectRootDirectory(): Promise<{ success: boolean; path: string; error?: string }> {
  // Use Electron's native dialog if available
  const electronAPI = getElectronAPI();
  if (electronAPI) {
    const result = await electronAPI.fs.selectDirectory();
    if (result.success && result.path) {
      // Update settings with the selected path
      const settings = loadFileSystemSettings();
      settings.rootPath = result.path;
      settings.enabled = true;
      saveFileSystemSettings(settings);
      return { success: true, path: result.path };
    }
    return { success: false, path: '', error: result.error || 'Selection cancelled' };
  }

  // Fallback to File System Access API for browser
  if (!isFileSystemAccessSupported()) {
    return { 
      success: false, 
      path: '', 
      error: 'File System Access API is not supported in this browser. Please use Chrome, Edge, or Opera.' 
    };
  }

  try {
    const handle = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'documents',
    });

    rootDirectoryHandle = handle;
    await storeDirectoryHandle(handle);

    // Update settings with the selected path
    const settings = loadFileSystemSettings();
    settings.rootPath = handle.name;
    settings.enabled = true;
    saveFileSystemSettings(settings);

    return { success: true, path: handle.name };
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return { success: false, path: '', error: 'Directory selection was cancelled' };
    }
    return { 
      success: false, 
      path: '', 
      error: error instanceof Error ? error.message : 'Failed to select directory' 
    };
  }
}

/**
 * Get the current root directory handle, restoring from IndexedDB if needed
 */
export async function getRootDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (rootDirectoryHandle) {
    // Verify we still have permission
    try {
      const permission = await rootDirectoryHandle.queryPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        return rootDirectoryHandle;
      }
      // Try to request permission again
      const newPermission = await rootDirectoryHandle.requestPermission({ mode: 'readwrite' });
      if (newPermission === 'granted') {
        return rootDirectoryHandle;
      }
    } catch {
      // Handle is no longer valid
      rootDirectoryHandle = null;
    }
  }

  // Try to restore from IndexedDB
  const storedHandle = await retrieveDirectoryHandle();
  
  if (storedHandle) {
    try {
      const permission = await storedHandle.queryPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        rootDirectoryHandle = storedHandle;
        return storedHandle;
      }
      // Permission not granted yet - try requesting it
      const newPermission = await storedHandle.requestPermission({ mode: 'readwrite' });
      if (newPermission === 'granted') {
        rootDirectoryHandle = storedHandle;
        return storedHandle;
      }
    } catch {
      // Handle is no longer valid
    }
  }

  return null;
}

/**
 * Request permission for the stored directory handle
 */
export async function requestDirectoryPermission(): Promise<boolean> {
  const handle = await retrieveDirectoryHandle();
  if (!handle) {
    return false;
  }

  try {
    const permission = await handle.requestPermission({ mode: 'readwrite' });
    if (permission === 'granted') {
      rootDirectoryHandle = handle;
      return true;
    }
  } catch {
    // Permission denied or handle invalid
  }

  return false;
}

/**
 * Ensure file system permission is granted (call this early during user gesture)
 * This should be called at the start of any user-initiated action that may need file system access.
 * Returns true if permission is granted or not needed, false if permission denied.
 */
export async function ensureFileSystemPermission(): Promise<boolean> {
  const settings = loadFileSystemSettings();
  if (!settings.enabled) {
    // Sync not enabled, no permission needed
    return true;
  }

  // In Electron, permissions are always granted
  if (isElectron()) {
    return settings.rootPath ? true : false;
  }

  // Try to get the root handle - this will request permission if needed
  const handle = await getRootDirectoryHandle();
  return handle !== null;
}

/**
 * Disconnect from the root directory
 */
export async function disconnectRootDirectory(): Promise<void> {
  await clearDirectoryHandle();
  const settings = loadFileSystemSettings();
  settings.enabled = false;
  settings.rootPath = '';
  saveFileSystemSettings(settings);
}

// ============================================
// File Operations
// ============================================

/**
 * Get or create a subdirectory within the root
 */
async function getOrCreateDirectory(
  parentHandle: FileSystemDirectoryHandle,
  path: string
): Promise<FileSystemDirectoryHandle> {
  const parts = path.split('/').filter(p => p.length > 0);
  let currentHandle = parentHandle;

  for (const part of parts) {
    currentHandle = await currentHandle.getDirectoryHandle(part, { create: true });
  }

  return currentHandle;
}

/**
 * Get a project directory handle, creating it if it doesn't exist
 */
async function getProjectDirectory(projectName: string): Promise<FileSystemDirectoryHandle | null> {
  const rootHandle = await getRootDirectoryHandle();
  if (!rootHandle) {
    return null;
  }

  try {
    // Sanitize project name for file system
    const safeName = sanitizePathComponent(projectName);
    return await rootHandle.getDirectoryHandle(safeName, { create: true });
  } catch (error) {
    console.error(`Failed to get project directory: ${projectName}`, error);
    return null;
  }
}

/**
 * Sanitize a string to be safe for use as a file or directory name
 */
function sanitizePathComponent(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 255);
}

/**
 * Write a file to the file system
 */
export async function writeFile(
  projectName: string,
  filePath: string,
  content: string
): Promise<{ success: boolean; error?: string }> {
  const settings = loadFileSystemSettings();
  if (!settings.enabled) {
    return { success: false, error: 'File system sync is not enabled' };
  }

  // Use Electron API if available
  const electronAPI = getElectronAPI();
  if (electronAPI) {
    const safeName = sanitizePathComponent(projectName);
    const fullPath = `${settings.rootPath}/${safeName}/${filePath}`.replace(/\/+/g, '/');
    return electronAPI.fs.writeFile(fullPath, content);
  }

  // Fallback to File System Access API
  const projectDir = await getProjectDirectory(projectName);
  if (!projectDir) {
    return { success: false, error: 'Could not access project directory' };
  }

  try {
    // Handle nested paths
    const parts = filePath.split('/').filter(p => p.length > 0);
    const fileName = parts.pop()!;
    
    // Get or create parent directories
    let parentHandle = projectDir;
    if (parts.length > 0) {
      parentHandle = await getOrCreateDirectory(projectDir, parts.join('/'));
    }

    // Create or overwrite the file
    const fileHandle = await parentHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();

    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to write file' 
    };
  }
}

/**
 * Read a file from the file system
 */
export async function readFile(
  projectName: string,
  filePath: string
): Promise<{ success: boolean; content?: string; error?: string }> {
  const settings = loadFileSystemSettings();
  if (!settings.enabled) {
    return { success: false, error: 'File system sync is not enabled' };
  }

  // Use Electron API if available
  const electronAPI = getElectronAPI();
  if (electronAPI) {
    const safeName = sanitizePathComponent(projectName);
    const fullPath = `${settings.rootPath}/${safeName}/${filePath}`.replace(/\/+/g, '/');
    return electronAPI.fs.readFile(fullPath);
  }

  // Fallback to File System Access API
  const projectDir = await getProjectDirectory(projectName);
  if (!projectDir) {
    return { success: false, error: 'Could not access project directory' };
  }

  try {
    // Handle nested paths
    const parts = filePath.split('/').filter(p => p.length > 0);
    const fileName = parts.pop()!;
    
    // Navigate to parent directory
    let parentHandle = projectDir;
    for (const part of parts) {
      parentHandle = await parentHandle.getDirectoryHandle(part);
    }

    // Read the file
    const fileHandle = await parentHandle.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    const content = await file.text();

    return { success: true, content };
  } catch (error) {
    if ((error as Error).name === 'NotFoundError') {
      return { success: false, error: 'File not found' };
    }
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to read file' 
    };
  }
}

/**
 * Delete a file from the file system
 */
export async function deleteFile(
  projectName: string,
  filePath: string
): Promise<{ success: boolean; error?: string }> {
  const settings = loadFileSystemSettings();
  if (!settings.enabled) {
    return { success: false, error: 'File system sync is not enabled' };
  }

  // Use Electron API if available
  const electronAPI = getElectronAPI();
  if (electronAPI) {
    const safeName = sanitizePathComponent(projectName);
    const fullPath = `${settings.rootPath}/${safeName}/${filePath}`.replace(/\/+/g, '/');
    return electronAPI.fs.deleteFile(fullPath);
  }

  // Fallback to File System Access API
  const projectDir = await getProjectDirectory(projectName);
  if (!projectDir) {
    return { success: false, error: 'Could not access project directory' };
  }

  try {
    // Handle nested paths
    const parts = filePath.split('/').filter(p => p.length > 0);
    const fileName = parts.pop()!;
    
    // Navigate to parent directory
    let parentHandle = projectDir;
    for (const part of parts) {
      parentHandle = await parentHandle.getDirectoryHandle(part);
    }

    // Delete the file
    await parentHandle.removeEntry(fileName);

    return { success: true };
  } catch (error) {
    if ((error as Error).name === 'NotFoundError') {
      return { success: true }; // File already doesn't exist
    }
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to delete file' 
    };
  }
}

/**
 * Create a directory in the project
 */
export async function createDirectory(
  projectName: string,
  dirPath: string
): Promise<{ success: boolean; error?: string }> {
  const settings = loadFileSystemSettings();
  if (!settings.enabled) {
    return { success: false, error: 'File system sync is not enabled' };
  }

  // Use Electron API if available
  const electronAPI = getElectronAPI();
  if (electronAPI) {
    const safeName = sanitizePathComponent(projectName);
    const fullPath = `${settings.rootPath}/${safeName}/${dirPath}`.replace(/\/+/g, '/');
    return electronAPI.fs.createDirectory(fullPath);
  }

  // Fallback to File System Access API
  const projectDir = await getProjectDirectory(projectName);
  if (!projectDir) {
    return { success: false, error: 'Could not access project directory' };
  }

  try {
    await getOrCreateDirectory(projectDir, dirPath);
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to create directory' 
    };
  }
}

/**
 * Delete a directory from the file system
 */
export async function deleteDirectory(
  projectName: string,
  dirPath: string
): Promise<{ success: boolean; error?: string }> {
  const settings = loadFileSystemSettings();
  if (!settings.enabled) {
    return { success: false, error: 'File system sync is not enabled' };
  }

  // Use Electron API if available
  const electronAPI = getElectronAPI();
  if (electronAPI) {
    const safeName = sanitizePathComponent(projectName);
    const fullPath = `${settings.rootPath}/${safeName}/${dirPath}`.replace(/\/+/g, '/');
    return electronAPI.fs.deleteDirectory(fullPath);
  }

  // Fallback to File System Access API
  const projectDir = await getProjectDirectory(projectName);
  if (!projectDir) {
    return { success: false, error: 'Could not access project directory' };
  }

  try {
    // Handle nested paths
    const parts = dirPath.split('/').filter(p => p.length > 0);
    const dirName = parts.pop()!;
    
    // Navigate to parent directory
    let parentHandle = projectDir;
    for (const part of parts) {
      parentHandle = await parentHandle.getDirectoryHandle(part);
    }

    // Delete the directory recursively
    await parentHandle.removeEntry(dirName, { recursive: true });

    return { success: true };
  } catch (error) {
    if ((error as Error).name === 'NotFoundError') {
      return { success: true }; // Directory already doesn't exist
    }
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to delete directory' 
    };
  }
}

/**
 * Create a project directory in the root sync folder
 * Note: Caller (syncProjectCreate) should check if sync is enabled before calling this.
 */
export async function createProjectDirectory(
  projectName: string
): Promise<{ success: boolean; error?: string }> {
  const settings = loadFileSystemSettings();
  
  // Use Electron API if available
  const electronAPI = getElectronAPI();
  if (electronAPI) {
    const safeName = sanitizePathComponent(projectName);
    const fullPath = `${settings.rootPath}/${safeName}`;
    return electronAPI.fs.createDirectory(fullPath);
  }

  // Fallback to File System Access API
  const rootHandle = await getRootDirectoryHandle();
  
  if (!rootHandle) {
    return { success: false, error: 'Could not access root directory. Please re-select the sync folder in Settings.' };
  }

  try {
    const safeName = sanitizePathComponent(projectName);
    await rootHandle.getDirectoryHandle(safeName, { create: true });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create project directory',
    };
  }
}

/**
 * Delete an entire project directory
 */
export async function deleteProjectDirectory(
  projectName: string
): Promise<{ success: boolean; error?: string }> {
  const settings = loadFileSystemSettings();
  if (!settings.enabled) {
    return { success: false, error: 'File system sync is not enabled' };
  }

  // Use Electron API if available
  const electronAPI = getElectronAPI();
  if (electronAPI) {
    const safeName = sanitizePathComponent(projectName);
    const fullPath = `${settings.rootPath}/${safeName}`;
    return electronAPI.fs.deleteDirectory(fullPath);
  }

  // Fallback to File System Access API
  const rootHandle = await getRootDirectoryHandle();
  if (!rootHandle) {
    return { success: false, error: 'Could not access root directory' };
  }

  try {
    const safeName = sanitizePathComponent(projectName);
    await rootHandle.removeEntry(safeName, { recursive: true });
    return { success: true };
  } catch (error) {
    if ((error as Error).name === 'NotFoundError') {
      return { success: true }; // Directory already doesn't exist
    }
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to delete project directory' 
    };
  }
}

/**
 * List all files in a project directory
 */
export async function listProjectFiles(
  projectName: string
): Promise<{ success: boolean; files?: FileSystemEntry[]; error?: string }> {
  const settings = loadFileSystemSettings();
  if (!settings.enabled) {
    return { success: false, error: 'File system sync is not enabled' };
  }

  // Use Electron API if available
  const electronAPI = getElectronAPI();
  if (electronAPI) {
    const safeName = sanitizePathComponent(projectName);
    const projectPath = `${settings.rootPath}/${safeName}`;
    return listDirectoryRecursiveElectron(electronAPI, projectPath, '');
  }

  // Fallback to File System Access API
  const projectDir = await getProjectDirectory(projectName);
  if (!projectDir) {
    return { success: false, error: 'Could not access project directory' };
  }

  try {
    const files = await listDirectoryRecursive(projectDir, '');
    return { success: true, files };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to list files' 
    };
  }
}

/**
 * Recursively list directory using Electron API
 */
async function listDirectoryRecursiveElectron(
  electronAPI: NonNullable<typeof window.electronAPI>,
  dirPath: string,
  basePath: string
): Promise<{ success: boolean; files?: FileSystemEntry[]; error?: string }> {
  const result = await electronAPI.fs.listDirectory(dirPath);
  if (!result.success) {
    return { success: false, error: result.error };
  }

  const entries: FileSystemEntry[] = [];
  
  for (const entry of result.entries || []) {
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    
    entries.push({
      relativePath,
      name: entry.name,
      isDirectory: entry.isDirectory,
      size: entry.isDirectory ? undefined : entry.size,
      modifiedTime: new Date(entry.modifiedTime),
    });

    // Recursively list subdirectories
    if (entry.isDirectory) {
      const subResult = await listDirectoryRecursiveElectron(electronAPI, entry.path, relativePath);
      if (subResult.success && subResult.files) {
        entries.push(...subResult.files);
      }
    }
  }

  return { success: true, files: entries };
}

/**
 * Recursively list all entries in a directory
 */
async function listDirectoryRecursive(
  dirHandle: FileSystemDirectoryHandle,
  basePath: string
): Promise<FileSystemEntry[]> {
  const entries: FileSystemEntry[] = [];

  for await (const [name, handle] of dirHandle.entries()) {
    const relativePath = basePath ? `${basePath}/${name}` : name;

    if (handle.kind === 'directory') {
      entries.push({
        relativePath,
        name,
        isDirectory: true,
        modifiedTime: new Date(), // Directories don't have mtime in File System Access API
      });

      // Recursively list subdirectory
      const subEntries = await listDirectoryRecursive(handle as FileSystemDirectoryHandle, relativePath);
      entries.push(...subEntries);
    } else {
      // Get file metadata
      const file = await (handle as FileSystemFileHandle).getFile();
      entries.push({
        relativePath,
        name,
        isDirectory: false,
        size: file.size,
        modifiedTime: new Date(file.lastModified),
      });
    }
  }

  return entries;
}

/**
 * Get file metadata without reading content
 */
export async function getFileMetadata(
  projectName: string,
  filePath: string
): Promise<{ success: boolean; entry?: FileSystemEntry; error?: string }> {
  const settings = loadFileSystemSettings();
  if (!settings.enabled) {
    return { success: false, error: 'File system sync is not enabled' };
  }

  const projectDir = await getProjectDirectory(projectName);
  if (!projectDir) {
    return { success: false, error: 'Could not access project directory' };
  }

  try {
    // Handle nested paths
    const parts = filePath.split('/').filter(p => p.length > 0);
    const fileName = parts.pop()!;
    
    // Navigate to parent directory
    let parentHandle = projectDir;
    for (const part of parts) {
      parentHandle = await parentHandle.getDirectoryHandle(part);
    }

    // Get file handle and metadata
    const fileHandle = await parentHandle.getFileHandle(fileName);
    const file = await fileHandle.getFile();

    return {
      success: true,
      entry: {
        relativePath: filePath,
        name: fileName,
        isDirectory: false,
        size: file.size,
        modifiedTime: new Date(file.lastModified),
      },
    };
  } catch (error) {
    if ((error as Error).name === 'NotFoundError') {
      return { success: false, error: 'File not found' };
    }
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to get file metadata' 
    };
  }
}

/**
 * Check if file system sync is available and configured
 */
export async function isSyncAvailable(): Promise<boolean> {
  const settings = loadFileSystemSettings();
  if (!settings.enabled) {
    return false;
  }

  // In Electron, just check if rootPath is set
  const electronAPI = getElectronAPI();
  if (electronAPI) {
    if (!settings.rootPath) {
      return false;
    }
    // Verify the directory exists
    const result = await electronAPI.fs.exists(settings.rootPath);
    return result.success && result.exists === true;
  }

  // Browser: check File System Access API handle
  const handle = await getRootDirectoryHandle();
  return handle !== null;
}

/**
 * Get the display path of the root directory
 */
export function getRootPath(): string {
  const settings = loadFileSystemSettings();
  return settings.rootPath || '';
}

/**
 * List all subdirectories in the root directory (these are project folders)
 */
export async function listRootDirectories(): Promise<{ success: boolean; directories?: string[]; error?: string }> {
  const settings = loadFileSystemSettings();
  if (!settings.enabled) {
    return { success: false, error: 'File system sync is not enabled' };
  }

  // Use Electron API if available
  const electronAPI = getElectronAPI();
  if (electronAPI) {
    if (!settings.rootPath) {
      return { success: false, error: 'No root directory configured' };
    }
    
    try {
      const result = await electronAPI.fs.listDirectory(settings.rootPath);
      if (!result.success) {
        return { success: false, error: result.error || 'Failed to list root directory' };
      }
      
      // Filter for directories only
      const directories = (result.entries || [])
        .filter((entry: { isDirectory: boolean }) => entry.isDirectory)
        .map((entry: { name: string }) => entry.name);
      
      return { success: true, directories };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list directories',
      };
    }
  }

  // Fallback to File System Access API for browser
  const rootHandle = await getRootDirectoryHandle();
  if (!rootHandle) {
    return { success: false, error: 'Could not access root directory' };
  }

  try {
    const directories: string[] = [];

    for await (const [name, handle] of rootHandle.entries()) {
      if (handle.kind === 'directory') {
        directories.push(name);
      }
    }

    return { success: true, directories };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list directories',
    };
  }
}
