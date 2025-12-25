/**
 * Version Service
 * Handles file version history with diff-based storage
 * 
 * Uses a hybrid approach:
 * - First version: Store full content
 * - Subsequent versions: Store diffs (patches) from the previous version
 * - Reconstruction: Apply patches sequentially to get any version
 */

import DiffMatchPatch from 'diff-match-patch';
import type { FileVersion, FileVersionMeta, VersionSource } from '../types';
import { VERSION_HISTORY_CONFIG } from '../types';
import {
  createFileVersion as dbCreateFileVersion,
  getFileVersions as dbGetFileVersions,
  getFileVersion as dbGetFileVersion,
  getLatestVersionNumber as dbGetLatestVersionNumber,
  deleteOldVersions as dbDeleteOldVersions,
  deleteFileVersions as dbDeleteFileVersions,
  updateVersionToFullContent as dbUpdateVersionToFullContent,
  type DBFileVersion,
} from './database';

// Initialize diff-match-patch
const dmp = new DiffMatchPatch();

/**
 * Create a new version for a file
 * 
 * @param fileId - The file ID to create a version for
 * @param newContent - The new content of the file
 * @param source - What triggered this version (create, update, format, restore)
 * @returns The created version metadata
 */
export async function createVersion(
  fileId: string,
  newContent: string,
  source: VersionSource
): Promise<FileVersionMeta> {
  // Get current version number
  const currentVersionNumber = await dbGetLatestVersionNumber(fileId);
  const newVersionNumber = currentVersionNumber + 1;
  
  let isFullContent: boolean;
  let contentOrPatch: string;
  
  if (newVersionNumber === 1) {
    // First version: store full content
    isFullContent = true;
    contentOrPatch = newContent;
  } else {
    // Subsequent versions: store diff from previous version
    // First, reconstruct the previous version content
    const previousContent = await reconstructVersion(fileId, currentVersionNumber);
    
    if (previousContent === null) {
      // If we can't reconstruct previous version, store full content
      isFullContent = true;
      contentOrPatch = newContent;
    } else {
      // Create a patch from previous to new content
      const patches = dmp.patch_make(previousContent, newContent);
      contentOrPatch = dmp.patch_toText(patches);
      isFullContent = false;
      
      // If the patch is larger than the full content, store full content instead
      if (contentOrPatch.length > newContent.length) {
        isFullContent = true;
        contentOrPatch = newContent;
      }
    }
  }
  
  const version: DBFileVersion = {
    id: crypto.randomUUID(),
    fileId,
    versionNumber: newVersionNumber,
    isFullContent,
    contentOrPatch,
    source,
    createdAt: new Date(),
  };
  
  await dbCreateFileVersion(version);
  
  // Prune old versions if we exceed the limit
  await pruneVersions(fileId, VERSION_HISTORY_CONFIG.maxVersions);
  
  return {
    id: version.id,
    fileId: version.fileId,
    versionNumber: version.versionNumber,
    source: version.source,
    createdAt: version.createdAt,
  };
}

/**
 * Get version history metadata for a file (without content)
 * 
 * @param fileId - The file ID to get history for
 * @returns Array of version metadata, ordered by version number descending (newest first)
 */
export async function getVersionHistory(fileId: string): Promise<FileVersionMeta[]> {
  const versions = await dbGetFileVersions(fileId);
  
  return versions.map(v => ({
    id: v.id,
    fileId: v.fileId,
    versionNumber: v.versionNumber,
    source: v.source,
    createdAt: v.createdAt,
  }));
}

/**
 * Reconstruct the content at a specific version
 * 
 * @param fileId - The file ID
 * @param versionNumber - The version number to reconstruct
 * @returns The reconstructed content, or null if version not found
 */
export async function reconstructVersion(
  fileId: string,
  versionNumber: number
): Promise<string | null> {
  // Get all versions up to and including the target version
  const allVersions = await dbGetFileVersions(fileId);
  
  // Filter and sort versions from 1 to target version (ascending)
  const versionsToApply = allVersions
    .filter(v => v.versionNumber <= versionNumber)
    .sort((a, b) => a.versionNumber - b.versionNumber);
  
  if (versionsToApply.length === 0) {
    return null;
  }
  
  // Start with the first version (must be full content)
  let content = '';
  
  for (const version of versionsToApply) {
    if (version.isFullContent) {
      // Full content version - use it directly
      content = version.contentOrPatch;
    } else {
      // Patch version - apply the patch
      const patches = dmp.patch_fromText(version.contentOrPatch);
      const [patchedContent, results] = dmp.patch_apply(patches, content);
      
      // Check if all patches applied successfully
      const allApplied = results.every(r => r);
      if (!allApplied) {
        console.warn(`Some patches failed to apply for version ${version.versionNumber}`);
      }
      
      content = patchedContent;
    }
  }
  
  return content;
}

/**
 * Prune old versions, keeping only the most recent N versions
 * 
 * When pruning, we need to ensure the oldest kept version has full content
 * to allow reconstruction of all kept versions.
 * 
 * @param fileId - The file ID to prune versions for
 * @param keepCount - Number of versions to keep
 * @returns Number of versions deleted
 */
export async function pruneVersions(
  fileId: string,
  keepCount: number = VERSION_HISTORY_CONFIG.maxVersions
): Promise<number> {
  const allVersions = await dbGetFileVersions(fileId);
  
  if (allVersions.length <= keepCount) {
    return 0;
  }
  
  // Versions are ordered by version_number DESC, so first N are the ones to keep
  const versionsToKeep = allVersions.slice(0, keepCount);
  
  // Check if the oldest version to keep is a full content version
  const oldestKept = versionsToKeep[versionsToKeep.length - 1];
  
  if (!oldestKept.isFullContent) {
    // We need to convert this to a full content version before pruning
    // Reconstruct the content at this version (while we still have all versions)
    const content = await reconstructVersion(fileId, oldestKept.versionNumber);
    
    if (content !== null) {
      // Update the version to store full content instead of patch
      await dbUpdateVersionToFullContent(oldestKept.id, content);
    }
  }
  
  // Delete old versions
  return dbDeleteOldVersions(fileId, keepCount);
}

/**
 * Delete all versions for a file
 * 
 * @param fileId - The file ID to delete versions for
 */
export async function deleteAllVersions(fileId: string): Promise<void> {
  await dbDeleteFileVersions(fileId);
}

/**
 * Get the content of a specific version
 * 
 * @param fileId - The file ID
 * @param versionNumber - The version number
 * @returns The version content, or null if not found
 */
export async function getVersionContent(
  fileId: string,
  versionNumber: number
): Promise<string | null> {
  return reconstructVersion(fileId, versionNumber);
}

/**
 * Check if a file has any version history
 * 
 * @param fileId - The file ID to check
 * @returns True if the file has at least one version
 */
export async function hasVersionHistory(fileId: string): Promise<boolean> {
  const latestVersion = await dbGetLatestVersionNumber(fileId);
  return latestVersion > 0;
}

/**
 * Get the latest version number for a file
 * 
 * @param fileId - The file ID
 * @returns The latest version number, or 0 if no versions exist
 */
export async function getLatestVersionNumber(fileId: string): Promise<number> {
  return dbGetLatestVersionNumber(fileId);
}

/**
 * Create initial version for a newly created file
 * This should be called when a file is first created
 * 
 * @param fileId - The file ID
 * @param content - The initial content
 * @returns The created version metadata
 */
export async function createInitialVersion(
  fileId: string,
  content: string
): Promise<FileVersionMeta> {
  return createVersion(fileId, content, 'create');
}

/**
 * Create a version before updating file content
 * Stores the current content as a version before the update
 * 
 * @param fileId - The file ID
 * @param currentContent - The current content before update
 * @returns The created version metadata
 */
export async function createUpdateVersion(
  fileId: string,
  currentContent: string
): Promise<FileVersionMeta> {
  return createVersion(fileId, currentContent, 'update');
}

/**
 * Create a version before formatting
 * Stores the original content before AI formatting is applied
 * 
 * @param fileId - The file ID
 * @param originalContent - The original content before formatting
 * @returns The created version metadata
 */
export async function createFormatVersion(
  fileId: string,
  originalContent: string
): Promise<FileVersionMeta> {
  return createVersion(fileId, originalContent, 'format');
}

/**
 * Create a version when restoring to a previous version
 * Stores the current content before restoration
 * 
 * @param fileId - The file ID
 * @param currentContent - The current content before restoration
 * @returns The created version metadata
 */
export async function createRestoreVersion(
  fileId: string,
  currentContent: string
): Promise<FileVersionMeta> {
  return createVersion(fileId, currentContent, 'restore');
}

