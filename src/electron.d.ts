/**
 * Type declarations for Electron IPC API
 * Exposed via preload script through contextBridge
 */

// Web Fetch Options
interface ElectronWebFetchOptions {
  /** URL to fetch */
  url: string;
  /** HTTP method (default: 'GET') */
  method?: string;
  /** Request headers */
  headers?: Record<string, string>;
  /** Request body (for POST/PUT) */
  body?: string;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
}

// Web Fetch Result
interface ElectronWebFetchResult {
  /** Whether the fetch succeeded */
  success: boolean;
  /** HTTP status code */
  status?: number;
  /** Response headers */
  headers?: Record<string, string>;
  /** Response body as text */
  body?: string;
  /** Final URL after redirects */
  finalUrl?: string;
  /** Error message if failed */
  error?: string;
}

// File System Operation Results
interface ElectronFsResult {
  success: boolean;
  error?: string;
}

interface ElectronFsSelectDirectoryResult extends ElectronFsResult {
  path?: string;
}

interface ElectronFsReadFileResult extends ElectronFsResult {
  content?: string;
}

interface ElectronFsExistsResult extends ElectronFsResult {
  exists?: boolean;
}

interface ElectronFsListDirectoryResult extends ElectronFsResult {
  entries?: Array<{
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    modifiedTime: string;
  }>;
}

interface ElectronFsStatsResult extends ElectronFsResult {
  stats?: {
    isDirectory: boolean;
    isFile: boolean;
    size: number;
    modifiedTime: string;
    createdTime: string;
  };
}

// Electron API interface
interface ElectronAPI {
  // File System Operations
  fs: {
    selectDirectory: () => Promise<ElectronFsSelectDirectoryResult>;
    readFile: (filePath: string) => Promise<ElectronFsReadFileResult>;
    writeFile: (filePath: string, content: string) => Promise<ElectronFsResult>;
    deleteFile: (filePath: string) => Promise<ElectronFsResult>;
    createDirectory: (dirPath: string) => Promise<ElectronFsResult>;
    deleteDirectory: (dirPath: string) => Promise<ElectronFsResult>;
    listDirectory: (dirPath: string) => Promise<ElectronFsListDirectoryResult>;
    exists: (path: string) => Promise<ElectronFsExistsResult>;
    getStats: (path: string) => Promise<ElectronFsStatsResult>;
  };
  // Web Fetch Operations (bypasses CORS by running in main process)
  web: {
    fetch: (options: ElectronWebFetchOptions) => Promise<ElectronWebFetchResult>;
  };
  // App info
  platform: string;
  isElectron: boolean;
}

// Extend Window interface
declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};


