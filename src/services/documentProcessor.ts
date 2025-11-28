/**
 * Document Processor Service
 * Handles text extraction from various file types and document chunking
 */

import * as pdfjsLib from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import mammoth from 'mammoth';
import Tesseract from 'tesseract.js';
import type { SupportedFileType, Chunk, ChunkingConfig } from '../types';

// Configure PDF.js worker using local file
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker;

/**
 * Type guard for TextItem (has str property)
 */
function isTextItem(item: unknown): item is TextItem {
  return typeof item === 'object' && item !== null && 'str' in item;
}

/**
 * Detect file type from file extension
 */
export function detectFileType(fileName: string): SupportedFileType | null {
  const extension = fileName.split('.').pop()?.toLowerCase();
  const supportedTypes: SupportedFileType[] = ['pdf', 'txt', 'docx', 'md', 'png', 'jpg', 'jpeg', 'webp'];
  
  if (extension && supportedTypes.includes(extension as SupportedFileType)) {
    return extension as SupportedFileType;
  }
  return null;
}

/**
 * Extract text from a PDF file
 */
async function extractTextFromPDF(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  const textParts: string[] = [];
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .filter(isTextItem)
      .map((item) => item.str)
      .join(' ');
    textParts.push(pageText);
  }
  
  return textParts.join('\n\n');
}

/**
 * Extract text from a plain text or markdown file
 */
async function extractTextFromPlainFile(file: File): Promise<string> {
  return await file.text();
}

/**
 * Extract text from a DOCX file
 */
async function extractTextFromDOCX(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

/**
 * Extract text from an image using OCR
 */
async function extractTextFromImage(file: File): Promise<string> {
  const result = await Tesseract.recognize(file, 'eng', {
    logger: () => {}, // Silent logging
  });
  return result.data.text;
}

/**
 * Extract text from a file based on its type
 */
export async function extractText(file: File): Promise<string> {
  const fileType = detectFileType(file.name);
  
  if (!fileType) {
    throw new Error(`Unsupported file type: ${file.name}`);
  }
  
  switch (fileType) {
    case 'pdf':
      return extractTextFromPDF(file);
    case 'txt':
    case 'md':
      return extractTextFromPlainFile(file);
    case 'docx':
      return extractTextFromDOCX(file);
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
      return extractTextFromImage(file);
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Chunk text into segments with overlap
 */
export function chunkText(
  text: string,
  fileId: string,
  projectId: string,
  config: ChunkingConfig = { maxChunkSize: 1000, overlap: 200 }
): Chunk[] {
  const { maxChunkSize, overlap } = config;
  const chunks: Chunk[] = [];
  
  // Clean and normalize text
  const cleanedText = text.replace(/\s+/g, ' ').trim();
  
  if (cleanedText.length === 0) {
    return chunks;
  }
  
  // If text is smaller than max chunk size, return single chunk
  if (cleanedText.length <= maxChunkSize) {
    chunks.push({
      id: generateId(),
      fileId,
      projectId,
      index: 0,
      text: cleanedText,
      startOffset: 0,
      endOffset: cleanedText.length,
      createdAt: new Date(),
    });
    return chunks;
  }
  
  // Split into chunks with overlap
  let startOffset = 0;
  let chunkIndex = 0;
  
  while (startOffset < cleanedText.length) {
    let endOffset = Math.min(startOffset + maxChunkSize, cleanedText.length);
    
    // Try to break at sentence boundary
    if (endOffset < cleanedText.length) {
      const searchRange = cleanedText.slice(startOffset + maxChunkSize - 100, endOffset);
      const lastSentenceEnd = Math.max(
        searchRange.lastIndexOf('. '),
        searchRange.lastIndexOf('? '),
        searchRange.lastIndexOf('! '),
        searchRange.lastIndexOf('\n')
      );
      
      if (lastSentenceEnd > 0) {
        endOffset = startOffset + maxChunkSize - 100 + lastSentenceEnd + 1;
      }
    }
    
    const chunkText = cleanedText.slice(startOffset, endOffset).trim();
    
    if (chunkText.length > 0) {
      chunks.push({
        id: generateId(),
        fileId,
        projectId,
        index: chunkIndex,
        text: chunkText,
        startOffset,
        endOffset,
        createdAt: new Date(),
      });
      chunkIndex++;
    }
    
    // Move to next chunk with overlap
    startOffset = endOffset - overlap;
    
    // Prevent infinite loop
    if (startOffset >= cleanedText.length - overlap) {
      break;
    }
  }
  
  return chunks;
}

/**
 * Process a document: extract text and create chunks
 */
export async function processDocument(
  file: File,
  fileId: string,
  projectId: string,
  config?: ChunkingConfig
): Promise<{ text: string; chunks: Chunk[] }> {
  const text = await extractText(file);
  const chunks = chunkText(text, fileId, projectId, config);
  
  return { text, chunks };
}

/**
 * Check if a file type is supported
 */
export function isFileTypeSupported(fileName: string): boolean {
  return detectFileType(fileName) !== null;
}

/**
 * Get list of supported file extensions
 */
export function getSupportedExtensions(): string[] {
  return ['pdf', 'txt', 'docx', 'md', 'png', 'jpg', 'jpeg', 'webp'];
}

