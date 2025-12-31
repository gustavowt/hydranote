/**
 * Sync Service
 * Handles bidirectional synchronization between DuckDB and the file system.
 * Detects changes, resolves conflicts, and keeps both sources in sync.
 */

import type {
  SyncResult,
  SyncChange,
  FileSystemEntry,
  ProjectFile,
} from "../types";
import {
  loadFileSystemSettings,
  updateFileSystemSettings,
  writeFile,
  readFile,
  readBinaryFile,
  deleteFile as fsDeleteFile,
  listProjectFiles,
  isSyncAvailable,
  createProjectDirectory,
  deleteProjectDirectory,
  listRootDirectories,
  getRootPath,
} from "./fileSystemService";
import {
  getAllProjects,
  get_project_files,
  getProject,
  createProject,
  createFile,
  updateFile,
  deleteFile as projectDeleteFile,
} from "./projectService";
import {
  flushDatabase,
} from "./database";
import {
  extractText,
  getFileBinaryData,
  convertDOCXToHTML,
} from "./documentProcessor";

// Supported file extensions for sync
const SUPPORTED_TEXT_EXTENSIONS = ['.md', '.txt'];
const SUPPORTED_BINARY_EXTENSIONS = ['.pdf', '.docx'];
const ALL_SUPPORTED_EXTENSIONS = [...SUPPORTED_TEXT_EXTENSIONS, ...SUPPORTED_BINARY_EXTENSIONS];

/**
 * Check if a file is supported for sync
 */
function isSupportedFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return ALL_SUPPORTED_EXTENSIONS.some(ext => lowerName.endsWith(ext));
}

/**
 * Check if a file is a binary file (PDF, DOCX)
 */
function isBinaryFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return SUPPORTED_BINARY_EXTENSIONS.some(ext => lowerName.endsWith(ext));
}

/**
 * Get file type from extension
 */
function getFileType(fileName: string): string {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.md')) return 'md';
  if (lowerName.endsWith('.txt')) return 'txt';
  if (lowerName.endsWith('.pdf')) return 'pdf';
  if (lowerName.endsWith('.docx')) return 'docx';
  return 'md'; // Default
}

// Sync state
let isSyncing = false;
let watcherInterval: ReturnType<typeof setInterval> | null = null;

// Event callbacks
type SyncEventCallback = (
  event: "start" | "complete" | "error",
  data?: SyncResult | string,
) => void;
const syncEventListeners: SyncEventCallback[] = [];

/**
 * Register a callback for sync events
 */
export function onSyncEvent(callback: SyncEventCallback): () => void {
  syncEventListeners.push(callback);
  return () => {
    const index = syncEventListeners.indexOf(callback);
    if (index > -1) {
      syncEventListeners.splice(index, 1);
    }
  };
}

/**
 * Emit a sync event to all listeners
 */
function emitSyncEvent(
  event: "start" | "complete" | "error",
  data?: SyncResult | string,
): void {
  for (const listener of syncEventListeners) {
    try {
      listener(event, data);
    } catch (error) {
      console.error("Sync event listener error:", error);
    }
  }
}

// ============================================
// Core Sync Operations
// ============================================

/**
 * Perform a full bidirectional sync for all projects
 */
export async function syncAll(): Promise<SyncResult> {
  if (isSyncing) {
    return {
      success: false,
      filesWritten: 0,
      filesRead: 0,
      filesDeleted: 0,
      conflictsDetected: 0,
      conflicts: [],
      error: "Sync already in progress",
      syncTime: new Date(),
    };
  }

  const available = await isSyncAvailable();
  if (!available) {
    return {
      success: false,
      filesWritten: 0,
      filesRead: 0,
      filesDeleted: 0,
      conflictsDetected: 0,
      conflicts: [],
      error:
        "File system sync is not available. Please select a root directory.",
      syncTime: new Date(),
    };
  }

  isSyncing = true;
  emitSyncEvent("start");

  const result: SyncResult = {
    success: true,
    filesWritten: 0,
    filesRead: 0,
    filesDeleted: 0,
    conflictsDetected: 0,
    conflicts: [],
    syncTime: new Date(),
  };

  try {
    const projects = await getAllProjects();
    const projectNames = new Set(projects.map((p) => p.name.toLowerCase()));

    // Step 1: Sync existing projects (DB → FS and FS → DB for existing projects)
    for (const project of projects) {
      const projectResult = await syncProject(project.id);

      result.filesWritten += projectResult.filesWritten;
      result.filesRead += projectResult.filesRead;
      result.filesDeleted += projectResult.filesDeleted;
      result.conflictsDetected += projectResult.conflictsDetected;
      result.conflicts.push(...projectResult.conflicts);

      if (!projectResult.success && !result.error) {
        result.success = false;
        result.error = projectResult.error;
      }
    }

    // Step 2: Check for new directories in file system that should become projects
    const dirResult = await listRootDirectories();
    if (dirResult.success && dirResult.directories) {
      for (const dirName of dirResult.directories) {
        // Skip hidden directories (starting with .)
        if (dirName.startsWith(".")) {
          continue;
        }

        // Check if a project with this name already exists (case-insensitive)
        if (!projectNames.has(dirName.toLowerCase())) {
          // New directory found - create a project and import files
          console.log(`Importing new project from file system: ${dirName}`);
          const importResult = await importProjectFromFileSystem(dirName);
          result.filesRead += importResult.filesRead;

          if (!importResult.success && !result.error) {
            result.error = importResult.error;
          }
        }
      }
    }

    // Update last sync time
    updateFileSystemSettings({ lastSyncTime: new Date().toISOString() });

    emitSyncEvent("complete", result);
    return result;
  } catch (error) {
    result.success = false;
    result.error = error instanceof Error ? error.message : "Sync failed";
    emitSyncEvent("error", result.error);
    return result;
  } finally {
    isSyncing = false;
  }
}

/**
 * Sync a single project bidirectionally
 */
export async function syncProject(projectId: string): Promise<SyncResult> {
  const result: SyncResult = {
    success: true,
    filesWritten: 0,
    filesRead: 0,
    filesDeleted: 0,
    conflictsDetected: 0,
    conflicts: [],
    syncTime: new Date(),
  };

  try {
    // Get project details using projectService (ensures database is initialized)
    const project = await getProject(projectId);

    if (!project) {
      result.success = false;
      result.error = `Project not found: ${projectId}`;
      return result;
    }

    // Get files from database
    const dbFiles = await get_project_files(projectId);

    // Get files from file system
    const fsResult = await listProjectFiles(project.name);
    const fsFiles = fsResult.success ? fsResult.files || [] : [];

    // Detect changes
    const changes = detectChanges(dbFiles, fsFiles, projectId);

    // Apply changes
    for (const change of changes) {
      try {
        if (change.direction === "db_to_fs") {
          // Sync from database to file system
          if (change.type === "created" || change.type === "modified") {
            const file = dbFiles.find((f) => f.name === change.filePath);
            if (file?.content) {
              const writeResult = await writeFile(
                project.name,
                change.filePath,
                file.content,
              );
              if (writeResult.success) {
                result.filesWritten++;
              }
            }
          } else if (change.type === "deleted") {
            const deleteResult = await fsDeleteFile(
              project.name,
              change.filePath,
            );
            if (deleteResult.success) {
              result.filesDeleted++;
            }
          }
        } else {
          // Sync from file system to database
          if (change.type === "created" || change.type === "modified") {
            const fileType = getFileType(change.filePath);
            
            if (isBinaryFile(change.filePath)) {
              // Handle binary files (PDF, DOCX)
              const binaryResult = await readBinaryFile(project.name, change.filePath);
              if (binaryResult.success && binaryResult.data) {
                const binaryData = new Uint8Array(binaryResult.data);
                
                // Create a File object for processing
                const fileName = change.filePath.split('/').pop() || change.filePath;
                const blob = new Blob([binaryData]);
                const file = new File([blob], fileName, { 
                  type: fileType === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
                });
                
                // Extract text content
                const textContent = await extractText(file);
                
                // Get HTML content for DOCX
                let htmlContent: string | undefined;
                if (fileType === 'docx') {
                  const docxResult = await convertDOCXToHTML(file);
                  htmlContent = docxResult.html;
                }
                
                if (change.type === "created") {
                  await createFile(
                    projectId,
                    change.filePath,
                    textContent,
                    fileType as 'md' | 'txt' | 'pdf' | 'docx',
                    binaryData,
                    htmlContent,
                  );
                } else if (change.fileId) {
                  // For binary file updates, we need to update with new binary data
                  // For now, just update the text content
                  await updateFile(change.fileId, textContent);
                }
                result.filesRead++;
              }
            } else {
              // Handle text files (MD, TXT)
              const readResult = await readFile(project.name, change.filePath);
              if (readResult.success && readResult.content !== undefined) {
                if (change.type === "created") {
                  await createFile(
                    projectId,
                    change.filePath,
                    readResult.content,
                    fileType as 'md' | 'txt' | 'pdf' | 'docx',
                  );
                } else if (change.fileId) {
                  await updateFile(change.fileId, readResult.content);
                }
                result.filesRead++;
              }
            }
          } else if (change.type === "deleted" && change.fileId) {
            await projectDeleteFile(change.fileId);
            result.filesDeleted++;
          }
        }
      } catch (error) {
        console.error(`Failed to apply change: ${change.filePath}`, error);
      }
    }

    await flushDatabase();
  } catch (error) {
    result.success = false;
    result.error =
      error instanceof Error ? error.message : "Project sync failed";
  }

  return result;
}

/**
 * Import a project from the file system (new directory discovered)
 * Creates a new project in the database and imports all markdown files
 * 
 * Note: If a project with the same name already exists (case-insensitive),
 * uses the existing project instead of creating a duplicate.
 * 
 * Uses projectService functions to ensure proper initialization and consistency.
 */
async function importProjectFromFileSystem(
  directoryName: string,
): Promise<{ success: boolean; filesRead: number; error?: string }> {
  const result = {
    success: true,
    filesRead: 0,
    error: undefined as string | undefined,
  };

  try {
    // Use projectService.createProject which handles:
    // - Database initialization (via ensureInitialized)
    // - Duplicate detection (case-insensitive)
    // - Returns existing project if name matches
    const project = await createProject(directoryName, 'Imported from file system');

    // List all files in the directory
    const filesResult = await listProjectFiles(directoryName);
    if (!filesResult.success || !filesResult.files) {
      return result;
    }

    // Import all supported files (md, txt, pdf, docx)
    const supportedFiles = filesResult.files.filter(
      (f) => !f.isDirectory && isSupportedFile(f.name),
    );

    // Get existing files to avoid duplicates
    const existingFiles = await get_project_files(project.id);
    const existingPaths = new Set(existingFiles.map(f => f.name.toLowerCase()));

    for (const fsFile of supportedFiles) {
      try {
        // Skip if file already exists in project
        if (existingPaths.has(fsFile.relativePath.toLowerCase())) {
          continue;
        }

        const fileType = getFileType(fsFile.name);

        if (isBinaryFile(fsFile.name)) {
          // Handle binary files (PDF, DOCX)
          const binaryResult = await readBinaryFile(directoryName, fsFile.relativePath);
          if (binaryResult.success && binaryResult.data) {
            // Convert ArrayBuffer to Uint8Array for storage
            const binaryData = new Uint8Array(binaryResult.data);
            
            // Create a File object for processing
            const blob = new Blob([binaryData]);
            const file = new File([blob], fsFile.name, { 
              type: fileType === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
            });
            
            // Extract text content
            const textContent = await extractText(file);
            
            if (fileType === 'pdf') {
              // For PDF files: store system file path for readonly viewing
              const rootPath = getRootPath();
              const systemFilePath = `${rootPath}/${directoryName}/${fsFile.relativePath}`.replace(/\/+/g, '/');
              
              await createFile(
                project.id,
                fsFile.relativePath,
                textContent,
                'pdf',
                undefined, // no binary data for PDFs
                undefined, // no html content for PDFs
                systemFilePath,
              );
            } else {
              // For DOCX files: store binary data and HTML content
              let htmlContent: string | undefined;
              const docxResult = await convertDOCXToHTML(file);
              htmlContent = docxResult.html;
              
              await createFile(
                project.id,
                fsFile.relativePath,
                textContent,
                'docx',
                binaryData,
                htmlContent,
              );
            }
            result.filesRead++;
          }
        } else {
          // Handle text files (MD, TXT)
          const readResult = await readFile(directoryName, fsFile.relativePath);
          if (readResult.success && readResult.content !== undefined) {
            await createFile(
              project.id,
              fsFile.relativePath,
              readResult.content,
              fileType as 'md' | 'txt' | 'pdf' | 'docx',
            );
            result.filesRead++;
          }
        }
      } catch (error) {
        console.error(`Failed to import file: ${fsFile.relativePath}`, error);
      }
    }
  } catch (error) {
    result.success = false;
    result.error =
      error instanceof Error ? error.message : "Failed to import project";
  }

  return result;
}

/**
 * Detect changes between database files and file system files
 */
function detectChanges(
  dbFiles: ProjectFile[],
  fsFiles: FileSystemEntry[],
  projectId: string,
): SyncChange[] {
  const changes: SyncChange[] = [];

  // Filter to only supported files in file system
  const fsSupportedFiles = fsFiles.filter(
    (f) => !f.isDirectory && isSupportedFile(f.name),
  );

  // Create maps for easy lookup
  const dbFileMap = new Map<string, ProjectFile>();
  for (const file of dbFiles) {
    dbFileMap.set(file.name.toLowerCase(), file);
  }

  const fsFileMap = new Map<string, FileSystemEntry>();
  for (const file of fsSupportedFiles) {
    fsFileMap.set(file.relativePath.toLowerCase(), file);
  }

  // Check for files in DB but not in FS (need to write to FS)
  for (const dbFile of dbFiles) {
    const fsFile = fsFileMap.get(dbFile.name.toLowerCase());
    if (!fsFile) {
      changes.push({
        type: "created",
        direction: "db_to_fs",
        filePath: dbFile.name,
        projectId,
        fileId: dbFile.id,
      });
    } else {
      // Both exist - check for modifications
      const dbModTime = dbFile.updatedAt.getTime();
      const fsModTime = fsFile.modifiedTime.getTime();

      // If file system is newer, sync from FS to DB
      if (fsModTime > dbModTime) {
        changes.push({
          type: "modified",
          direction: "fs_to_db",
          filePath: dbFile.name,
          projectId,
          fileId: dbFile.id,
        });
      } else if (dbModTime > fsModTime) {
        // If database is newer, sync from DB to FS
        changes.push({
          type: "modified",
          direction: "db_to_fs",
          filePath: dbFile.name,
          projectId,
          fileId: dbFile.id,
        });
      }
    }
  }

  // Check for files in FS but not in DB (need to import to DB)
  for (const fsFile of fsSupportedFiles) {
    const dbFile = dbFileMap.get(fsFile.relativePath.toLowerCase());
    if (!dbFile) {
      changes.push({
        type: "created",
        direction: "fs_to_db",
        filePath: fsFile.relativePath,
        projectId,
      });
    }
  }

  return changes;
}

// ============================================
// Single File Sync Operations
// ============================================

/**
 * Sync a single file from database to file system
 */
export async function syncFileToFileSystem(
  projectName: string,
  filePath: string,
  content: string,
): Promise<{ success: boolean; error?: string }> {
  const settings = loadFileSystemSettings();
  if (!settings.enabled || !settings.syncOnSave) {
    return { success: true }; // Sync not enabled, but not an error
  }

  return await writeFile(projectName, filePath, content);
}

/**
 * Sync a single file from file system to database
 */
export async function syncFileFromFileSystem(
  projectId: string,
  projectName: string,
  filePath: string,
): Promise<{ success: boolean; error?: string }> {
  const settings = loadFileSystemSettings();
  if (!settings.enabled) {
    return { success: true };
  }

  try {
    const fileType = getFileType(filePath);
    
    // Find existing file in database
    const dbFiles = await get_project_files(projectId);
    const existingFile = dbFiles.find(
      (f) => f.name.toLowerCase() === filePath.toLowerCase(),
    );

    if (isBinaryFile(filePath)) {
      // Handle binary files (PDF, DOCX)
      const binaryResult = await readBinaryFile(projectName, filePath);
      if (!binaryResult.success || !binaryResult.data) {
        return { success: false, error: binaryResult.error };
      }
      
      const binaryData = new Uint8Array(binaryResult.data);
      
      // Create a File object for processing
      const fileName = filePath.split('/').pop() || filePath;
      const blob = new Blob([binaryData]);
      const file = new File([blob], fileName, { 
        type: fileType === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
      });
      
      // Extract text content
      const textContent = await extractText(file);

      if (fileType === 'pdf') {
        // For PDF files: store system file path for readonly viewing
        const rootPath = getRootPath();
        const systemFilePath = `${rootPath}/${projectName}/${filePath}`.replace(/\/+/g, '/');
        
        if (existingFile) {
          // Update existing file - just update text content for embeddings
          await updateFile(existingFile.id, textContent);
        } else {
          // Create new file with system file path
          await createFile(projectId, filePath, textContent, 'pdf', undefined, undefined, systemFilePath);
        }
      } else {
        // For DOCX files: store binary data and HTML content
        let htmlContent: string | undefined;
        const docxResult = await convertDOCXToHTML(file);
        htmlContent = docxResult.html;

        if (existingFile) {
          // Update existing file
          await updateFile(existingFile.id, textContent);
        } else {
          // Create new file with binary data
          await createFile(projectId, filePath, textContent, 'docx', binaryData, htmlContent);
        }
      }
    } else {
      // Handle text files (MD, TXT)
      const readResult = await readFile(projectName, filePath);
      if (!readResult.success) {
        return readResult;
      }

      if (existingFile) {
        // Update existing file using projectService
        await updateFile(existingFile.id, readResult.content!);
      } else {
        // Create new file using projectService
        await createFile(projectId, filePath, readResult.content!, fileType as 'md' | 'txt' | 'pdf' | 'docx');
      }
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to sync file from file system",
    };
  }
}

/**
 * Delete a file from the file system when deleted in database
 */
export async function syncFileDelete(
  projectName: string,
  filePath: string,
): Promise<{ success: boolean; error?: string }> {
  const settings = loadFileSystemSettings();
  if (!settings.enabled || !settings.syncOnSave) {
    return { success: true };
  }

  return await fsDeleteFile(projectName, filePath);
}

// ============================================
// Project Sync Operations
// ============================================

/**
 * Create a project directory on the file system
 */
export async function syncProjectCreate(
  projectName: string,
): Promise<{ success: boolean; error?: string }> {
  const settings = loadFileSystemSettings();
  if (!settings.enabled) {
    return { success: true };
  }

  return await createProjectDirectory(projectName);
}

/**
 * Delete a project directory from the file system
 */
export async function syncProjectDelete(
  projectName: string,
): Promise<{ success: boolean; error?: string }> {
  const settings = loadFileSystemSettings();
  if (!settings.enabled) {
    return { success: true };
  }

  return await deleteProjectDirectory(projectName);
}

// ============================================
// File Watcher
// ============================================

/**
 * Start watching for file system changes
 */
export function startFileWatcher(): void {
  const settings = loadFileSystemSettings();
  if (!settings.enabled || !settings.watchForChanges) {
    return;
  }

  if (watcherInterval) {
    return; // Already watching
  }

  watcherInterval = setInterval(async () => {
    if (isSyncing) {
      return; // Skip if sync is already in progress
    }

    try {
      await checkForExternalChanges();
    } catch (error) {
      console.error("File watcher error:", error);
    }
  }, settings.watchInterval);
}

/**
 * Stop watching for file system changes
 */
export function stopFileWatcher(): void {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
  }
}

/**
 * Check for external file changes and sync if needed
 */
async function checkForExternalChanges(): Promise<void> {
  const available = await isSyncAvailable();
  if (!available) {
    return;
  }

  const projects = await getAllProjects();

  for (const project of projects) {
    try {
      const dbFiles = await get_project_files(project.id);
      const fsResult = await listProjectFiles(project.name);

      if (!fsResult.success || !fsResult.files) {
        continue;
      }

      const fsSupportedFiles = fsResult.files.filter(
        (f) => !f.isDirectory && isSupportedFile(f.name),
      );

      // Check for new or modified files in file system
      for (const fsFile of fsSupportedFiles) {
        const dbFile = dbFiles.find(
          (f) => f.name.toLowerCase() === fsFile.relativePath.toLowerCase(),
        );

        if (!dbFile) {
          // New file in file system - import it
          await syncFileFromFileSystem(
            project.id,
            project.name,
            fsFile.relativePath,
          );
        } else if (fsFile.modifiedTime.getTime() > dbFile.updatedAt.getTime()) {
          // File was modified externally - update database
          await syncFileFromFileSystem(
            project.id,
            project.name,
            fsFile.relativePath,
          );
        }
      }
    } catch (error) {
      console.error(
        `Failed to check changes for project ${project.name}:`,
        error,
      );
    }
  }
}

/**
 * Check if sync is currently in progress
 */
export function isSyncInProgress(): boolean {
  return isSyncing;
}

/**
 * Get sync status information
 */
export function getSyncStatus(): {
  enabled: boolean;
  watching: boolean;
  syncing: boolean;
  lastSyncTime?: Date;
} {
  const settings = loadFileSystemSettings();
  return {
    enabled: settings.enabled,
    watching: watcherInterval !== null,
    syncing: isSyncing,
    lastSyncTime: settings.lastSyncTime
      ? new Date(settings.lastSyncTime)
      : undefined,
  };
}
