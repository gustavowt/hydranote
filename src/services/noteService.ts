/**
 * Note Service
 * Handles the AddNote tool pipeline for creating and storing markdown notes
 * Phase 9: AddNote tool implementation
 */

import type {
  AddNoteParams,
  AddNoteResult,
  NoteContextMetadata,
  DirectoryDecision,
  ProjectFile,
  Chunk,
} from '../types';
import { MARKDOWN_FILE_CONFIG } from '../types';
import { chatCompletion } from './llmService';
import { getNoteFormatInstructions, getDefaultNoteDirectory } from './llmService';
import { get_project_files, getProject } from './projectService';
import { getConnection } from './database';
import { generateEmbedding } from './embeddingService';

// ============================================
// Prompt Templates
// ============================================

/**
 * Prompt template for formatting raw note text into structured markdown
 */
function buildFormatNotePrompt(userInstructions: string): string {
  const basePrompt = `You are a note formatting assistant. Your task is to transform raw note text into well-structured Markdown.

Guidelines:
- Use clear headings (##, ###) to organize content
- Use bullet points or numbered lists where appropriate
- Preserve all important information from the original text
- Fix grammar and spelling errors
- Maintain a clean, readable structure
- Add emphasis (bold/italic) for key terms where helpful
- Keep the tone professional but accessible`;

  const customInstructions = userInstructions
    ? `\n\nUser's custom formatting instructions:\n${userInstructions}`
    : '';

  return `${basePrompt}${customInstructions}

IMPORTANT: Respond with ONLY the formatted Markdown content. Do not include any explanations, preamble, or meta-commentary about the formatting.`;
}

/**
 * Prompt template for generating a note title from content
 */
const GENERATE_TITLE_PROMPT = `You are a title generator. Given note content, generate a short, descriptive title.

Guidelines:
- Keep the title under 60 characters
- Make it descriptive but concise
- Use title case
- Do not use special characters that are invalid in filenames
- Focus on the main topic or theme of the note

IMPORTANT: Respond with ONLY the title text. No quotes, no explanations, just the title.`;

/**
 * Prompt template for deciding which directory to save the note in
 */
function buildDecideDirectoryPrompt(existingDirectories: string[]): string {
  const dirList = existingDirectories.length > 0
    ? existingDirectories.map(d => `  - ${d}`).join('\n')
    : '  (No existing directories)';

  return `You are a file organization assistant. Given a note's title and context, decide the best directory to save it in.

Existing directories in the project:
${dirList}

Guidelines:
- STRONGLY prefer using an existing directory whenever the note reasonably fits
- Only suggest creating a new directory if the note represents a clearly distinct category
- Use lowercase, hyphen-separated names for new directories (e.g., "meeting-notes", "research")
- Keep directory structures shallow (avoid deep nesting)

Respond with a JSON object ONLY:
{"targetDirectory": "path/to/directory", "shouldCreateDirectory": false}

Examples:
- Note about a team meeting → {"targetDirectory": "meeting-notes", "shouldCreateDirectory": false}
- Note about project X → {"targetDirectory": "projects/project-x", "shouldCreateDirectory": true}
- General note → {"targetDirectory": "notes", "shouldCreateDirectory": false}`;
}

// ============================================
// Pipeline Step 1: Format Note
// ============================================

/**
 * Format raw note text into structured markdown using LLM
 */
export async function formatNote(
  rawText: string,
  metadata?: NoteContextMetadata
): Promise<string> {
  const formatInstructions = getNoteFormatInstructions();
  const systemPrompt = buildFormatNotePrompt(formatInstructions);

  let userContent = rawText;
  
  // Add context metadata if provided
  if (metadata) {
    const contextParts: string[] = [];
    if (metadata.topic) contextParts.push(`Topic: ${metadata.topic}`);
    if (metadata.tags?.length) contextParts.push(`Tags: ${metadata.tags.join(', ')}`);
    if (metadata.source) contextParts.push(`Source: ${metadata.source}`);
    if (metadata.language) contextParts.push(`Language: ${metadata.language}`);
    
    if (contextParts.length > 0) {
      userContent = `[Context]\n${contextParts.join('\n')}\n\n[Note Content]\n${rawText}`;
    }
  }

  const response = await chatCompletion({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.3,
    maxTokens: 4000,
  });

  return response.content.trim();
}

// ============================================
// Pipeline Step 2: Generate File Name
// ============================================

/**
 * Generate a title for the note using LLM
 */
export async function generateNoteTitle(noteContent: string): Promise<string> {
  const response = await chatCompletion({
    messages: [
      { role: 'system', content: GENERATE_TITLE_PROMPT },
      { role: 'user', content: noteContent.slice(0, 2000) }, // Limit content for efficiency
    ],
    temperature: 0.5,
    maxTokens: 100,
  });

  return response.content.trim();
}

/**
 * Convert a title to a URL-safe slug for filename
 */
export function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-')          // Replace spaces with hyphens
    .replace(/-+/g, '-')           // Replace multiple hyphens with single
    .replace(/^-|-$/g, '')         // Remove leading/trailing hyphens
    .slice(0, 80);                 // Limit length
}

/**
 * Generate a unique filename, adding suffix if needed
 */
export async function generateUniqueFileName(
  projectId: string,
  baseSlug: string,
  directory: string
): Promise<string> {
  const files = await get_project_files(projectId);
  const existingNames = new Set(files.map(f => f.name.toLowerCase()));
  
  let fileName = `${baseSlug}.md`;
  let counter = 1;
  
  // Check if file exists in the target directory
  while (existingNames.has(fileName.toLowerCase()) || existingNames.has(`${directory}/${fileName}`.toLowerCase())) {
    fileName = `${baseSlug}-${counter}.md`;
    counter++;
    
    // Safety limit
    if (counter > 100) {
      fileName = `${baseSlug}-${Date.now()}.md`;
      break;
    }
  }
  
  return fileName;
}

// ============================================
// Pipeline Step 3: Decide Directory
// ============================================

/**
 * Extract existing directory paths from project files
 */
export async function getProjectDirectories(projectId: string): Promise<string[]> {
  const files = await get_project_files(projectId);
  const directories = new Set<string>();
  
  // Add default note directory
  directories.add(getDefaultNoteDirectory());
  
  // Extract directories from existing file paths
  for (const file of files) {
    const lastSlash = file.name.lastIndexOf('/');
    if (lastSlash > 0) {
      const dir = file.name.substring(0, lastSlash);
      directories.add(dir);
      
      // Also add parent directories
      const parts = dir.split('/');
      let path = '';
      for (const part of parts) {
        path = path ? `${path}/${part}` : part;
        directories.add(path);
      }
    }
  }
  
  return Array.from(directories).sort();
}

/**
 * Decide which directory to save the note in using LLM
 */
export async function decideNoteDirectory(
  projectId: string,
  noteTitle: string,
  metadata?: NoteContextMetadata
): Promise<DirectoryDecision> {
  const existingDirectories = await getProjectDirectories(projectId);
  const systemPrompt = buildDecideDirectoryPrompt(existingDirectories);
  
  let context = `Note title: "${noteTitle}"`;
  if (metadata?.topic) context += `\nTopic: ${metadata.topic}`;
  if (metadata?.tags?.length) context += `\nTags: ${metadata.tags.join(', ')}`;
  
  const response = await chatCompletion({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: context },
    ],
    temperature: 0.2,
    maxTokens: 200,
  });

  try {
    // Extract JSON from response
    let jsonStr = response.content.trim();
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    
    const parsed = JSON.parse(jsonStr);
    return {
      targetDirectory: parsed.targetDirectory || getDefaultNoteDirectory(),
      shouldCreateDirectory: parsed.shouldCreateDirectory === true,
    };
  } catch {
    // Fallback to default directory if parsing fails
    return {
      targetDirectory: getDefaultNoteDirectory(),
      shouldCreateDirectory: false,
    };
  }
}

// ============================================
// Pipeline Step 4: Persist Note
// ============================================

/**
 * Save note to database as a project file
 */
export async function persistNote(
  projectId: string,
  fileName: string,
  directory: string,
  content: string
): Promise<ProjectFile> {
  const conn = getConnection();
  const now = new Date();
  const fileId = crypto.randomUUID();
  
  // Build full path
  const fullPath = directory ? `${directory}/${fileName}` : fileName;
  
  // Escape content for SQL
  const escapedContent = content.replace(/'/g, "''");
  const escapedName = fullPath.replace(/'/g, "''");
  
  // Calculate size in bytes
  const size = new Blob([content]).size;
  
  // Insert file record
  await conn.query(`
    INSERT INTO files (id, project_id, name, type, size, status, content, created_at, updated_at)
    VALUES ('${fileId}', '${projectId}', '${escapedName}', 'md', ${size}, 'indexed', '${escapedContent}', '${now.toISOString()}', '${now.toISOString()}')
  `);
  
  return {
    id: fileId,
    projectId,
    name: fullPath,
    type: 'md',
    size,
    status: 'indexed',
    content,
    createdAt: now,
    updatedAt: now,
  };
}

// ============================================
// Pipeline Step 5: Index Note
// ============================================

/**
 * Create chunks from markdown content using heading-aware chunking
 */
function chunkMarkdownContent(
  content: string,
  fileId: string,
  projectId: string
): Chunk[] {
  const chunks: Chunk[] = [];
  const lines = content.split('\n');
  
  let currentChunk = '';
  let currentHeading = '';
  let startOffset = 0;
  let currentOffset = 0;
  let chunkIndex = 0;
  
  const maxChunkSize = 800; // Characters per chunk
  const overlap = 100;
  
  for (const line of lines) {
    const lineLength = line.length + 1; // +1 for newline
    
    // Check if this is a heading
    if (line.startsWith('#')) {
      // Save current chunk if substantial
      if (currentChunk.trim().length > 50) {
        chunks.push({
          id: crypto.randomUUID(),
          fileId,
          projectId,
          index: chunkIndex++,
          text: currentChunk.trim(),
          startOffset,
          endOffset: currentOffset,
          createdAt: new Date(),
        });
      }
      
      currentHeading = line;
      currentChunk = line + '\n';
      startOffset = currentOffset;
    } else {
      currentChunk += line + '\n';
      
      // Check if chunk is too large
      if (currentChunk.length > maxChunkSize) {
        chunks.push({
          id: crypto.randomUUID(),
          fileId,
          projectId,
          index: chunkIndex++,
          text: currentChunk.trim(),
          startOffset,
          endOffset: currentOffset + lineLength,
          createdAt: new Date(),
        });
        
        // Start new chunk with overlap
        const overlapText = currentHeading ? currentHeading + '\n' : '';
        currentChunk = overlapText;
        startOffset = currentOffset - overlap;
      }
    }
    
    currentOffset += lineLength;
  }
  
  // Add final chunk
  if (currentChunk.trim().length > 0) {
    chunks.push({
      id: crypto.randomUUID(),
      fileId,
      projectId,
      index: chunkIndex,
      text: currentChunk.trim(),
      startOffset,
      endOffset: currentOffset,
      createdAt: new Date(),
    });
  }
  
  return chunks;
}

/**
 * Index the note for search (create chunks and embeddings)
 */
export async function indexNote(file: ProjectFile): Promise<void> {
  const conn = getConnection();
  
  if (!file.content) return;
  
  // Create chunks
  const chunks = chunkMarkdownContent(file.content, file.id, file.projectId);
  
  // Store chunks and generate embeddings
  for (const chunk of chunks) {
    const escapedText = chunk.text.replace(/'/g, "''");
    
    // Insert chunk
    await conn.query(`
      INSERT INTO chunks (id, file_id, project_id, chunk_index, text, start_offset, end_offset, created_at)
      VALUES ('${chunk.id}', '${chunk.fileId}', '${chunk.projectId}', ${chunk.index}, '${escapedText}', ${chunk.startOffset}, ${chunk.endOffset}, '${chunk.createdAt.toISOString()}')
    `);
    
    // Generate and store embedding
    try {
      const vector = await generateEmbedding(chunk.text);
      const embeddingId = crypto.randomUUID();
      const vectorStr = `[${vector.join(', ')}]`;
      
      await conn.query(`
        INSERT INTO embeddings (id, chunk_id, file_id, project_id, vector, created_at)
        VALUES ('${embeddingId}', '${chunk.id}', '${chunk.fileId}', '${chunk.projectId}', ${vectorStr}::DOUBLE[], '${new Date().toISOString()}')
      `);
    } catch (error) {
      // Continue even if embedding fails for a chunk
      console.error('Failed to generate embedding for chunk:', error);
    }
  }
}

// ============================================
// Main AddNote Pipeline
// ============================================

/**
 * Execute the full AddNote pipeline
 * 
 * Pipeline steps:
 * 1. Format note - Transform raw text into structured markdown
 * 2. Generate filename - Create a title and slug
 * 3. Decide directory - Determine where to save the note
 * 4. Persist note - Save to database
 * 5. Index note - Create embeddings for search
 */
export async function addNote(params: AddNoteParams): Promise<AddNoteResult> {
  const { projectId, rawNoteText, contextMetadata } = params;
  
  try {
    // Validate project exists
    const project = await getProject(projectId);
    if (!project) {
      return {
        success: false,
        filePath: '',
        title: '',
        directory: '',
        fileId: '',
        createdAt: new Date(),
        error: `Project not found: ${projectId}`,
      };
    }
    
    // Step 1: Format the note
    const formattedContent = await formatNote(rawNoteText, contextMetadata);
    
    // Step 2: Generate title and filename
    const title = await generateNoteTitle(formattedContent);
    const slug = titleToSlug(title);
    
    // Step 3: Decide directory
    const { targetDirectory, shouldCreateDirectory } = await decideNoteDirectory(
      projectId,
      title,
      contextMetadata
    );
    
    // Step 4: Generate unique filename
    const fileName = await generateUniqueFileName(projectId, slug, targetDirectory);
    
    // Step 5: Persist the note
    const file = await persistNote(projectId, fileName, targetDirectory, formattedContent);
    
    // Step 6: Index the note for search
    await indexNote(file);
    
    return {
      success: true,
      filePath: file.name,
      title,
      directory: targetDirectory,
      fileId: file.id,
      createdAt: file.createdAt,
    };
  } catch (error) {
    return {
      success: false,
      filePath: '',
      title: '',
      directory: '',
      fileId: '',
      createdAt: new Date(),
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Add note with explicit title (skip title generation)
 */
export async function addNoteWithTitle(
  projectId: string,
  rawNoteText: string,
  title: string,
  contextMetadata?: NoteContextMetadata
): Promise<AddNoteResult> {
  try {
    // Validate project exists
    const project = await getProject(projectId);
    if (!project) {
      return {
        success: false,
        filePath: '',
        title: '',
        directory: '',
        fileId: '',
        createdAt: new Date(),
        error: `Project not found: ${projectId}`,
      };
    }
    
    // Step 1: Format the note
    const formattedContent = await formatNote(rawNoteText, contextMetadata);
    
    // Step 2: Use provided title
    const slug = titleToSlug(title);
    
    // Step 3: Decide directory
    const { targetDirectory } = await decideNoteDirectory(
      projectId,
      title,
      contextMetadata
    );
    
    // Step 4: Generate unique filename
    const fileName = await generateUniqueFileName(projectId, slug, targetDirectory);
    
    // Step 5: Persist the note
    const file = await persistNote(projectId, fileName, targetDirectory, formattedContent);
    
    // Step 6: Index the note for search
    await indexNote(file);
    
    return {
      success: true,
      filePath: file.name,
      title,
      directory: targetDirectory,
      fileId: file.id,
      createdAt: file.createdAt,
    };
  } catch (error) {
    return {
      success: false,
      filePath: '',
      title: '',
      directory: '',
      fileId: '',
      createdAt: new Date(),
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}


