/**
 * Document Generator Service
 * Handles PDF and DOCX document generation
 * Phase 6: Write tool implementation
 */

import { jsPDF } from 'jspdf';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
} from 'docx';
import { saveAs } from 'file-saver';
import type { DocumentFormat, GeneratedDocument } from '../types';
import { MARKDOWN_FILE_CONFIG } from '../types';
import { getConnection } from './database';

// ============================================
// Configuration
// ============================================

const PDF_CONFIG = {
  marginTop: 20,
  marginLeft: 20,
  marginRight: 20,
  pageWidth: 210,
  pageHeight: 297,
  lineHeight: 7,
  fontSize: 12,
  titleFontSize: 18,
  headingFontSize: 14,
};

// ============================================
// Markdown Parser Utilities
// ============================================

interface ParsedLine {
  type: 'heading1' | 'heading2' | 'heading3' | 'paragraph' | 'bullet' | 'numbered';
  text: string;
  bold?: boolean;
  italic?: boolean;
}

/**
 * Parse markdown content into structured lines
 */
function parseMarkdownContent(content: string): ParsedLine[] {
  const lines = content.split('\n');
  const parsed: ParsedLine[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('### ')) {
      parsed.push({ type: 'heading3', text: trimmed.slice(4) });
    } else if (trimmed.startsWith('## ')) {
      parsed.push({ type: 'heading2', text: trimmed.slice(3) });
    } else if (trimmed.startsWith('# ')) {
      parsed.push({ type: 'heading1', text: trimmed.slice(2) });
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      parsed.push({ type: 'bullet', text: trimmed.slice(2) });
    } else if (/^\d+\.\s/.test(trimmed)) {
      parsed.push({ type: 'numbered', text: trimmed.replace(/^\d+\.\s/, '') });
    } else {
      parsed.push({ type: 'paragraph', text: trimmed });
    }
  }

  return parsed;
}

/**
 * Strip markdown formatting from text
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1') // Bold
    .replace(/\*(.+?)\*/g, '$1')     // Italic
    .replace(/_(.+?)_/g, '$1')       // Italic underscore
    .replace(/`(.+?)`/g, '$1')       // Code
    .replace(/\[(.+?)\]\(.+?\)/g, '$1'); // Links
}

// ============================================
// PDF Generation
// ============================================

/**
 * Generate a PDF document from content
 */
export async function generatePDF(
  title: string,
  content: string
): Promise<Blob> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const { marginLeft, marginRight, marginTop, pageWidth, pageHeight, lineHeight } = PDF_CONFIG;
  const maxWidth = pageWidth - marginLeft - marginRight;
  let yPosition = marginTop;

  // Add title
  doc.setFontSize(PDF_CONFIG.titleFontSize);
  doc.setFont('helvetica', 'bold');
  doc.text(title, marginLeft, yPosition);
  yPosition += lineHeight * 2;

  // Add date
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(128, 128, 128);
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, marginLeft, yPosition);
  yPosition += lineHeight * 2;

  // Reset text color
  doc.setTextColor(0, 0, 0);

  // Parse and add content
  const parsedLines = parseMarkdownContent(content);

  for (const line of parsedLines) {
    const text = stripMarkdown(line.text);

    // Check for page break
    if (yPosition > pageHeight - 30) {
      doc.addPage();
      yPosition = marginTop;
    }

    switch (line.type) {
      case 'heading1':
        doc.setFontSize(PDF_CONFIG.headingFontSize + 2);
        doc.setFont('helvetica', 'bold');
        yPosition += lineHeight * 0.5;
        doc.text(text, marginLeft, yPosition);
        yPosition += lineHeight * 1.5;
        break;

      case 'heading2':
        doc.setFontSize(PDF_CONFIG.headingFontSize);
        doc.setFont('helvetica', 'bold');
        yPosition += lineHeight * 0.3;
        doc.text(text, marginLeft, yPosition);
        yPosition += lineHeight * 1.3;
        break;

      case 'heading3':
        doc.setFontSize(PDF_CONFIG.fontSize + 1);
        doc.setFont('helvetica', 'bold');
        doc.text(text, marginLeft, yPosition);
        yPosition += lineHeight * 1.2;
        break;

      case 'bullet':
        doc.setFontSize(PDF_CONFIG.fontSize);
        doc.setFont('helvetica', 'normal');
        doc.text('•', marginLeft, yPosition);
        const bulletLines = doc.splitTextToSize(text, maxWidth - 8);
        doc.text(bulletLines, marginLeft + 6, yPosition);
        yPosition += lineHeight * bulletLines.length;
        break;

      case 'numbered':
        doc.setFontSize(PDF_CONFIG.fontSize);
        doc.setFont('helvetica', 'normal');
        const numLines = doc.splitTextToSize(text, maxWidth - 10);
        doc.text(numLines, marginLeft + 8, yPosition);
        yPosition += lineHeight * numLines.length;
        break;

      default:
        doc.setFontSize(PDF_CONFIG.fontSize);
        doc.setFont('helvetica', 'normal');
        const wrappedLines = doc.splitTextToSize(text, maxWidth);
        
        for (const wrappedLine of wrappedLines) {
          if (yPosition > pageHeight - 30) {
            doc.addPage();
            yPosition = marginTop;
          }
          doc.text(wrappedLine, marginLeft, yPosition);
          yPosition += lineHeight;
        }
        yPosition += lineHeight * 0.3;
    }
  }

  return doc.output('blob');
}

// ============================================
// DOCX Generation
// ============================================

/**
 * Create text runs with formatting from markdown text
 */
function createTextRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);

  for (const part of parts) {
    if (!part) continue;

    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true }));
    } else if (part.startsWith('*') && part.endsWith('*')) {
      runs.push(new TextRun({ text: part.slice(1, -1), italics: true }));
    } else if (part.startsWith('`') && part.endsWith('`')) {
      runs.push(new TextRun({ text: part.slice(1, -1), font: 'Courier New' }));
    } else {
      runs.push(new TextRun({ text: part }));
    }
  }

  return runs.length > 0 ? runs : [new TextRun({ text })];
}

/**
 * Generate a DOCX document from content
 */
export async function generateDOCX(
  title: string,
  content: string
): Promise<Blob> {
  const children: Paragraph[] = [];
  let bulletCounter = 0;

  // Add title
  children.push(
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );

  // Add date
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Generated: ${new Date().toLocaleDateString()}`,
          color: '888888',
          size: 20,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
    })
  );

  // Parse and add content
  const parsedLines = parseMarkdownContent(content);

  for (const line of parsedLines) {
    switch (line.type) {
      case 'heading1':
        children.push(
          new Paragraph({
            text: stripMarkdown(line.text),
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 200 },
          })
        );
        break;

      case 'heading2':
        children.push(
          new Paragraph({
            text: stripMarkdown(line.text),
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 150 },
          })
        );
        break;

      case 'heading3':
        children.push(
          new Paragraph({
            text: stripMarkdown(line.text),
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 200, after: 100 },
          })
        );
        break;

      case 'bullet':
        children.push(
          new Paragraph({
            children: createTextRuns(line.text),
            bullet: { level: 0 },
            spacing: { after: 100 },
          })
        );
        break;

      case 'numbered':
        bulletCounter++;
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${bulletCounter}. ` }),
              ...createTextRuns(line.text),
            ],
            spacing: { after: 100 },
          })
        );
        break;

      default:
        children.push(
          new Paragraph({
            children: createTextRuns(line.text),
            spacing: { after: 200 },
          })
        );
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return Packer.toBlob(doc);
}

// ============================================
// Markdown Generation (Phase 8)
// ============================================

/**
 * Generate a Markdown document from content
 * Preserves formatting as-is since content is already markdown
 */
export async function generateMarkdown(
  title: string,
  content: string
): Promise<Blob> {
  // Build the markdown document with title
  const markdownContent = `# ${title}

*Generated: ${new Date().toLocaleDateString()}*

---

${content}`;

  // Create blob with proper encoding
  return new Blob([markdownContent], { 
    type: `${MARKDOWN_FILE_CONFIG.mimeType};charset=${MARKDOWN_FILE_CONFIG.encoding}` 
  });
}

// ============================================
// Document Storage
// ============================================

// Store for generated documents (for download buttons)
const generatedDocuments = new Map<string, { blob: Blob; fileName: string }>();

/**
 * Get a generated document by ID
 */
export function getGeneratedDocument(fileId: string): { blob: Blob; fileName: string } | undefined {
  return generatedDocuments.get(fileId);
}

/**
 * Download a generated document by ID
 */
export function downloadGeneratedDocument(fileId: string): boolean {
  const doc = generatedDocuments.get(fileId);
  if (doc) {
    saveAs(doc.blob, doc.fileName);
    return true;
  }
  return false;
}

/**
 * Store generated document as a project file
 */
export async function storeGeneratedDocument(
  projectId: string,
  title: string,
  format: DocumentFormat,
  blob: Blob,
  autoDownload = true
): Promise<GeneratedDocument> {
  const fileId = crypto.randomUUID();
  const fileName = `${sanitizeFileName(title)}.${format}`;
  const downloadUrl = `docusage://download/${fileId}`;

  // Store blob for later download
  generatedDocuments.set(fileId, { blob, fileName });

  // Store in database
  const conn = getConnection();
  const now = new Date().toISOString();

  await conn.query(`
    INSERT INTO files (id, project_id, name, type, size, status, created_at, updated_at)
    VALUES ('${fileId}', '${projectId}', '${fileName}', '${format}', ${blob.size}, 'indexed', '${now}', '${now}')
  `);

  // Auto-download the file
  if (autoDownload) {
    saveAs(blob, fileName);
  }

  return {
    fileId,
    fileName,
    format,
    size: blob.size,
    downloadUrl,
    createdAt: new Date(),
  };
}

/**
 * Sanitize file name for safe storage
 */
function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s-_]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 100);
}

// ============================================
// Main API
// ============================================

/**
 * Generate and store a document
 */
export async function generateDocument(
  projectId: string,
  title: string,
  content: string,
  format: DocumentFormat
): Promise<GeneratedDocument> {
  let blob: Blob;

  switch (format) {
    case 'pdf':
      blob = await generatePDF(title, content);
      break;
    case 'docx':
      blob = await generateDOCX(title, content);
      break;
    case 'md':
      blob = await generateMarkdown(title, content);
      break;
    default:
      throw new Error(`Unsupported format: ${format}`);
  }

  return storeGeneratedDocument(projectId, title, format, blob);
}

/**
 * Download a generated document
 */
export function downloadDocument(fileName: string, downloadUrl: string): void {
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Trigger direct blob download using file-saver
 */
export async function downloadBlob(blob: Blob, fileName: string): Promise<void> {
  saveAs(blob, fileName);
}

