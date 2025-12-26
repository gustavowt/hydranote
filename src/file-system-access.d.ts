/**
 * Type declarations for the File System Access API
 * https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API
 */

interface FileSystemPermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemDirectoryHandle {
  /**
   * Returns a Promise that resolves to the current permission state of the handle.
   */
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  
  /**
   * Requests permission to read or readwrite the handle.
   */
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  
  /**
   * Returns an async iterator over the entries in the directory.
   */
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  
  /**
   * Returns an async iterator over the keys (names) of entries in the directory.
   */
  keys(): AsyncIterableIterator<string>;
  
  /**
   * Returns an async iterator over the values (handles) of entries in the directory.
   */
  values(): AsyncIterableIterator<FileSystemHandle>;
}

interface ShowDirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' | FileSystemHandle;
}

interface Window {
  /**
   * Shows a directory picker which allows the user to select a directory.
   */
  showDirectoryPicker(options?: ShowDirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}




