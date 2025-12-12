/// <reference types="vite/client" />

// Electron API types exposed via preload script
export interface ElectronFSResult {
  success: boolean;
  error?: string;
}

export interface ElectronSelectDirectoryResult extends ElectronFSResult {
  path?: string;
}

export interface ElectronReadFileResult extends ElectronFSResult {
  content?: string;
}

export interface ElectronListDirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedTime: string;
}

export interface ElectronListDirectoryResult extends ElectronFSResult {
  entries?: ElectronListDirectoryEntry[];
}

export interface ElectronExistsResult extends ElectronFSResult {
  exists?: boolean;
}

export interface ElectronStatsResult extends ElectronFSResult {
  stats?: {
    isDirectory: boolean;
    isFile: boolean;
    size: number;
    modifiedTime: string;
    createdTime: string;
  };
}

export interface ElectronAPI {
  fs: {
    selectDirectory: () => Promise<ElectronSelectDirectoryResult>;
    readFile: (filePath: string) => Promise<ElectronReadFileResult>;
    writeFile: (filePath: string, content: string) => Promise<ElectronFSResult>;
    deleteFile: (filePath: string) => Promise<ElectronFSResult>;
    createDirectory: (dirPath: string) => Promise<ElectronFSResult>;
    deleteDirectory: (dirPath: string) => Promise<ElectronFSResult>;
    listDirectory: (dirPath: string) => Promise<ElectronListDirectoryResult>;
    exists: (path: string) => Promise<ElectronExistsResult>;
    getStats: (path: string) => Promise<ElectronStatsResult>;
  };
  platform: string;
  isElectron: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
