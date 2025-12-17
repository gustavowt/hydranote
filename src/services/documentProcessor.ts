/**
 * Document Processor Service
 * Handles text extraction from various file types and document chunking
 */

import * as pdfjsLib from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import mammoth from 'mammoth';
import Tesseract from 'tesseract.js';
import type { SupportedFileType, Chunk, ChunkingConfig, DocumentSection } from '../types';

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
    
    const chunkTextContent = cleanedText.slice(startOffset, endOffset).trim();
    
    if (chunkTextContent.length > 0) {
      chunks.push({
        id: generateId(),
        fileId,
        projectId,
        index: chunkIndex,
        text: chunkTextContent,
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
 * Chunk Markdown text using headings as primary boundaries (Phase 8)
 * Falls back to regular chunking if sections are too large
 */
export function chunkMarkdownText(
  text: string,
  fileId: string,
  projectId: string,
  config: ChunkingConfig = { maxChunkSize: 1000, overlap: 200 }
): Chunk[] {
  const { maxChunkSize } = config;
  const chunks: Chunk[] = [];
  
  if (text.trim().length === 0) {
    return chunks;
  }
  
  // Split by markdown headings (# ## ### etc.)
  const headingPattern = /^(#{1,6})\s+(.+)$/gm;
  const sections: { heading: string; content: string; startOffset: number }[] = [];
  
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  
  // Find all headings and their positions
  const matches: { index: number; heading: string }[] = [];
  while ((match = headingPattern.exec(text)) !== null) {
    matches.push({ index: match.index, heading: match[0] });
  }
  
  // Create sections based on headings
  for (let i = 0; i < matches.length; i++) {
    const currentMatch = matches[i];
    const nextMatch = matches[i + 1];
    
    // Content before first heading (if any)
    if (i === 0 && currentMatch.index > 0) {
      const preContent = text.slice(0, currentMatch.index).trim();
      if (preContent.length > 0) {
        sections.push({
          heading: '',
          content: preContent,
          startOffset: 0,
        });
      }
    }
    
    // Current section content
    const sectionStart = currentMatch.index;
    const sectionEnd = nextMatch ? nextMatch.index : text.length;
    const sectionContent = text.slice(sectionStart, sectionEnd).trim();
    
    sections.push({
      heading: currentMatch.heading,
      content: sectionContent,
      startOffset: sectionStart,
    });
  }
  
  // If no headings found, use regular chunking
  if (sections.length === 0) {
    return chunkText(text, fileId, projectId, config);
  }
  
  // Process each section
  let chunkIndex = 0;
  
  for (const section of sections) {
    // If section is small enough, add as single chunk
    if (section.content.length <= maxChunkSize) {
      chunks.push({
        id: generateId(),
        fileId,
        projectId,
        index: chunkIndex,
        text: section.content,
        startOffset: section.startOffset,
        endOffset: section.startOffset + section.content.length,
        createdAt: new Date(),
      });
      chunkIndex++;
    } else {
      // Section too large, sub-chunk it
      const subChunks = chunkText(section.content, fileId, projectId, config);
      for (const subChunk of subChunks) {
        chunks.push({
          ...subChunk,
          id: generateId(),
          index: chunkIndex,
          startOffset: section.startOffset + subChunk.startOffset,
          endOffset: section.startOffset + subChunk.endOffset,
        });
        chunkIndex++;
      }
    }
  }
  
  return chunks;
}

/**
 * Process a document: extract text and create chunks
 * Uses markdown-aware chunking for .md files (Phase 8)
 */
export async function processDocument(
  file: File,
  fileId: string,
  projectId: string,
  config?: ChunkingConfig
): Promise<{ text: string; chunks: Chunk[] }> {
  const text = await extractText(file);
  const fileType = detectFileType(file.name);
  
  // Use markdown-aware chunking for .md files
  const chunks = fileType === 'md'
    ? chunkMarkdownText(text, fileId, projectId, config)
    : chunkText(text, fileId, projectId, config);
  
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

/**
 * Normalize a title for matching (lowercase, trim, remove extra whitespace)
 */
function normalizeTitle(title: string): string {
  return title.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  
  // Create distance matrix
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  // Initialize first column and row
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  
  // Fill the matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // Deletion
        dp[i][j - 1] + 1,      // Insertion
        dp[i - 1][j - 1] + cost // Substitution
      );
    }
  }
  
  return dp[m][n];
}

/**
 * Calculate similarity score between two strings (0-1, higher is better)
 */
export function stringSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1;
  if (str1.length === 0 || str2.length === 0) return 0;
  
  const distance = levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
  const maxLength = Math.max(str1.length, str2.length);
  
  return 1 - (distance / maxLength);
}

/**
 * Get line number from character offset
 */
function getLineNumber(content: string, offset: number): number {
  const substring = content.slice(0, offset);
  return (substring.match(/\n/g) || []).length + 1;
}

/**
 * Parse markdown document into structured sections
 * Extracts headings, paragraphs, code blocks, lists, and blockquotes
 */
export function parseDocumentStructure(content: string): DocumentSection[] {
  const sections: DocumentSection[] = [];
  
  if (!content || content.trim().length === 0) {
    return sections;
  }
  
  // Pattern to match headings
  const headingPattern = /^(#{1,6})\s+(.+)$/gm;
  
  // Find all headings first
  const headings: Array<{
    match: string;
    level: number;
    title: string;
    index: number;
  }> = [];
  
  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(content)) !== null) {
    headings.push({
      match: match[0],
      level: match[1].length,
      title: match[2].trim(),
      index: match.index,
    });
  }
  
  // If no headings, treat entire document as one section
  if (headings.length === 0) {
    const trimmed = content.trim();
    if (trimmed.length > 0) {
      sections.push({
        type: 'paragraph',
        content: trimmed,
        startOffset: 0,
        endOffset: content.length,
        startLine: 1,
        endLine: getLineNumber(content, content.length),
      });
    }
    return sections;
  }
  
  // Content before first heading
  if (headings[0].index > 0) {
    const preContent = content.slice(0, headings[0].index).trim();
    if (preContent.length > 0) {
      sections.push({
        type: 'paragraph',
        content: preContent,
        startOffset: 0,
        endOffset: headings[0].index,
        startLine: 1,
        endLine: getLineNumber(content, headings[0].index),
      });
    }
  }
  
  // Process each heading and its content
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const nextHeading = headings[i + 1];
    
    const sectionStart = heading.index;
    const sectionEnd = nextHeading ? nextHeading.index : content.length;
    const sectionContent = content.slice(sectionStart, sectionEnd).trimEnd();
    
    const section: DocumentSection = {
      type: 'heading',
      level: heading.level,
      title: heading.title,
      normalizedTitle: normalizeTitle(heading.title),
      content: sectionContent,
      startOffset: sectionStart,
      endOffset: sectionEnd,
      startLine: getLineNumber(content, sectionStart),
      endLine: getLineNumber(content, sectionEnd),
    };
    
    sections.push(section);
  }
  
  return sections;
}

/**
 * Build a hierarchical tree from flat sections based on heading levels
 */
export function buildSectionTree(sections: DocumentSection[]): DocumentSection[] {
  const result: DocumentSection[] = [];
  const stack: DocumentSection[] = [];
  
  for (const section of sections) {
    if (section.type !== 'heading') {
      // Non-heading sections go to root
      result.push(section);
      continue;
    }
    
    const level = section.level || 1;
    
    // Pop from stack until we find a parent (lower level) or empty
    while (stack.length > 0 && (stack[stack.length - 1].level || 1) >= level) {
      stack.pop();
    }
    
    if (stack.length === 0) {
      // This is a root-level heading
      result.push(section);
    } else {
      // This is a child of the current stack top
      const parent = stack[stack.length - 1];
      if (!parent.children) {
        parent.children = [];
      }
      parent.children.push(section);
    }
    
    stack.push(section);
  }
  
  return result;
}

/**
 * Find a section by its title (normalized matching)
 */
export function findSectionByTitle(
  sections: DocumentSection[],
  title: string,
  recursive: boolean = true
): DocumentSection | null {
  const normalizedQuery = normalizeTitle(title);
  
  for (const section of sections) {
    // Check if this section matches
    if (section.normalizedTitle === normalizedQuery) {
      return section;
    }
    
    // Also check if title is contained in the section title (partial match)
    if (section.normalizedTitle && section.normalizedTitle.includes(normalizedQuery)) {
      return section;
    }
    
    // Check children recursively
    if (recursive && section.children && section.children.length > 0) {
      const found = findSectionByTitle(section.children, title, true);
      if (found) {
        return found;
      }
    }
  }
  
  return null;
}

/**
 * Find a section by path (e.g., "Features/API" or "Features > API")
 */
export function findSectionByPath(
  sections: DocumentSection[],
  path: string
): DocumentSection | null {
  // Normalize separators
  const parts = path.split(/[\/>\-]/).map(p => normalizeTitle(p.trim())).filter(p => p.length > 0);
  
  if (parts.length === 0) {
    return null;
  }
  
  let currentSections = sections;
  let foundSection: DocumentSection | null = null;
  
  for (const part of parts) {
    foundSection = null;
    
    for (const section of currentSections) {
      if (section.normalizedTitle === part || 
          (section.normalizedTitle && section.normalizedTitle.includes(part))) {
        foundSection = section;
        currentSections = section.children || [];
        break;
      }
    }
    
    if (!foundSection) {
      return null;
    }
  }
  
  return foundSection;
}

/**
 * Find all sections matching a query (returns all matches with scores)
 */
export function findMatchingSections(
  sections: DocumentSection[],
  query: string,
  recursive: boolean = true
): Array<{ section: DocumentSection; score: number }> {
  const normalizedQuery = normalizeTitle(query);
  const results: Array<{ section: DocumentSection; score: number }> = [];
  
  function searchSections(sects: DocumentSection[]) {
    for (const section of sects) {
      let score = 0;
      
      // Exact title match
      if (section.normalizedTitle === normalizedQuery) {
        score = 1.0;
      }
      // Title starts with query
      else if (section.normalizedTitle?.startsWith(normalizedQuery)) {
        score = 0.9;
      }
      // Title contains query
      else if (section.normalizedTitle?.includes(normalizedQuery)) {
        score = 0.7;
      }
      // Content contains query (lower score)
      else if (section.content.toLowerCase().includes(normalizedQuery)) {
        score = 0.4;
      }
      
      if (score > 0) {
        results.push({ section, score });
      }
      
      // Search children
      if (recursive && section.children && section.children.length > 0) {
        searchSections(section.children);
      }
    }
  }
  
  searchSections(sections);
  
  // Sort by score descending
  results.sort((a, b) => b.score - a.score);
  
  return results;
}

/**
 * Fuzzy match sections using Levenshtein distance
 * Returns best matching section if similarity exceeds threshold
 */
export function fuzzyMatchSections(
  sections: DocumentSection[],
  query: string,
  threshold: number = 0.6,
  recursive: boolean = true
): { section: DocumentSection; score: number } | null {
  const normalizedQuery = normalizeTitle(query);
  let bestMatch: { section: DocumentSection; score: number } | null = null;
  
  function searchSections(sects: DocumentSection[]) {
    for (const section of sects) {
      if (section.normalizedTitle) {
        const similarity = stringSimilarity(normalizedQuery, section.normalizedTitle);
        
        if (similarity >= threshold) {
          if (!bestMatch || similarity > bestMatch.score) {
            bestMatch = { section, score: similarity };
          }
        }
        
        // Also check if query words are all present (word-level matching)
        const queryWords = normalizedQuery.split(' ').filter(w => w.length > 2);
        const titleWords = section.normalizedTitle.split(' ');
        const matchedWords = queryWords.filter(qw => 
          titleWords.some(tw => tw.includes(qw) || stringSimilarity(qw, tw) > 0.8)
        );
        
        if (queryWords.length > 0) {
          const wordMatchScore = matchedWords.length / queryWords.length;
          if (wordMatchScore >= threshold && (!bestMatch || wordMatchScore > bestMatch.score)) {
            bestMatch = { section, score: wordMatchScore };
          }
        }
      }
      
      // Search children
      if (recursive && section.children && section.children.length > 0) {
        searchSections(section.children);
      }
    }
  }
  
  searchSections(sections);
  
  return bestMatch;
}

/**
 * Get all section titles for fuzzy matching
 */
export function getAllSectionTitles(
  sections: DocumentSection[],
  recursive: boolean = true
): Array<{ title: string; section: DocumentSection }> {
  const results: Array<{ title: string; section: DocumentSection }> = [];
  
  function collectTitles(sects: DocumentSection[]) {
    for (const section of sects) {
      if (section.title) {
        results.push({ title: section.title, section });
      }
      
      if (recursive && section.children && section.children.length > 0) {
        collectTitles(section.children);
      }
    }
  }
  
  collectTitles(sections);
  return results;
}

/**
 * Find offset range for a line number range
 */
export function getOffsetFromLineNumbers(
  content: string,
  startLine: number,
  endLine?: number
): { startOffset: number; endOffset: number } | null {
  const lines = content.split('\n');
  
  if (startLine < 1 || startLine > lines.length) {
    return null;
  }
  
  const actualEndLine = endLine ?? startLine;
  if (actualEndLine < startLine || actualEndLine > lines.length) {
    return null;
  }
  
  let startOffset = 0;
  for (let i = 0; i < startLine - 1; i++) {
    startOffset += lines[i].length + 1; // +1 for newline
  }
  
  let endOffset = startOffset;
  for (let i = startLine - 1; i <= actualEndLine - 1; i++) {
    endOffset += lines[i].length + (i < actualEndLine - 1 ? 1 : 0);
  }
  
  // Include trailing newline if exists
  if (actualEndLine < lines.length) {
    endOffset += 1;
  }
  
  return { startOffset, endOffset };
}

/**
 * Parse line number specification from sectionIdentifier
 * Supports: "line:42", "lines:10-25", "line 42", "lines 10-25"
 */
export function parseLineNumberSpec(
  sectionIdentifier: string
): { startLine: number; endLine?: number } | null {
  // Pattern: "line:42", "lines:10-25", "line 42", "lines 10-25", etc.
  const match = sectionIdentifier.match(/^lines?[:\s]+(\d+)(?:\s*[-–]\s*(\d+))?$/i);
  
  if (!match) {
    return null;
  }
  
  const startLine = parseInt(match[1], 10);
  const endLine = match[2] ? parseInt(match[2], 10) : undefined;
  
  return { startLine, endLine };
}

