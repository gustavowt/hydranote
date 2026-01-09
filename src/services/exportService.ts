/**
 * Export Service
 * Handles file export operations (PDF, DOCX, Markdown)
 * 
 * This service provides a clean API for exporting content to different formats
 * and triggering downloads. It wraps the document generation functions with
 * download functionality.
 */

import { saveAs } from 'file-saver';
import type { DocumentFormat } from '../types';
import { generatePDF, generateDOCX, generateMarkdown } from './documentGeneratorService';

// ============================================
// Types
// ============================================

/**
 * Result of an export operation
 */
export interface ExportResult {
  /** Whether the export was successful */
  success: boolean;
  /** The exported file name */
  fileName: string;
  /** Error message if export failed */
  error?: string;
}

/**
 * Options for export operations
 */
export interface ExportOptions {
  /** Custom file name (without extension) */
  customFileName?: string;
  /** Whether to trigger download automatically (default: true) */
  autoDownload?: boolean;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Extract file name without extension from a path or file name
 */
export function getFileNameWithoutExtension(filePath: string): string {
  const lastSlash = filePath.lastIndexOf('/');
  const fileName = lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;
  const lastDot = fileName.lastIndexOf('.');
  return lastDot >= 0 ? fileName.substring(0, lastDot) : fileName;
}

/**
 * Get the file extension for a format
 */
export function getExtensionForFormat(format: DocumentFormat): string {
  switch (format) {
    case 'pdf':
      return '.pdf';
    case 'docx':
      return '.docx';
    case 'md':
      return '.md';
    default:
      return '';
  }
}

/**
 * Get MIME type for a format
 */
export function getMimeTypeForFormat(format: DocumentFormat): string {
  switch (format) {
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'md':
      return 'text/markdown';
    default:
      return 'application/octet-stream';
  }
}

// ============================================
// Core Export Functions
// ============================================

/**
 * Generate a document blob in the specified format
 * 
 * @param title - Document title
 * @param content - Markdown content to convert
 * @param format - Target format (pdf, docx, md)
 * @returns Promise with the generated Blob
 */
export async function generateExportBlob(
  title: string,
  content: string,
  format: DocumentFormat
): Promise<Blob> {
  switch (format) {
    case 'pdf':
      return generatePDF(title, content);
    case 'docx':
      return generateDOCX(title, content);
    case 'md':
      return generateMarkdown(title, content);
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
}

/**
 * Export content to a file and trigger download
 * 
 * @param title - Document title (used as file name if not overridden)
 * @param content - Markdown content to export
 * @param format - Target format (pdf, docx, md)
 * @param options - Export options
 * @returns Promise with export result
 * 
 * @example
 * ```typescript
 * const result = await exportToFile('My Document', '# Hello World', 'pdf');
 * if (result.success) {
 *   console.log(`Downloaded: ${result.fileName}`);
 * }
 * ```
 */
export async function exportToFile(
  title: string,
  content: string,
  format: DocumentFormat,
  options: ExportOptions = {}
): Promise<ExportResult> {
  const { customFileName, autoDownload = true } = options;
  
  // Validate content
  if (!content.trim()) {
    return {
      success: false,
      fileName: '',
      error: 'No content to export',
    };
  }
  
  try {
    // Determine file name
    const baseName = customFileName || title || 'Untitled';
    const extension = getExtensionForFormat(format);
    const fileName = `${baseName}${extension}`;
    
    // Generate the document blob
    const blob = await generateExportBlob(title, content, format);
    
    // Trigger download if requested
    if (autoDownload) {
      saveAs(blob, fileName);
    }
    
    return {
      success: true,
      fileName,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown export error';
    console.error('Export failed:', error);
    
    return {
      success: false,
      fileName: '',
      error: errorMessage,
    };
  }
}

/**
 * Export content as PDF
 */
export async function exportToPDF(
  title: string,
  content: string,
  options?: ExportOptions
): Promise<ExportResult> {
  return exportToFile(title, content, 'pdf', options);
}

/**
 * Export content as DOCX
 */
export async function exportToDOCX(
  title: string,
  content: string,
  options?: ExportOptions
): Promise<ExportResult> {
  return exportToFile(title, content, 'docx', options);
}

/**
 * Export content as Markdown
 */
export async function exportToMarkdown(
  title: string,
  content: string,
  options?: ExportOptions
): Promise<ExportResult> {
  return exportToFile(title, content, 'md', options);
}

