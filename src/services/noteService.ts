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
  ProjectSummary,
  ProjectRouterDecision,
  GlobalAddNoteParams,
  GlobalAddNoteResult,
} from '../types';

// ============================================
// Execution Step Types (matching toolService pattern)
// ============================================

export interface NoteExecutionStep {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  label: string;
  detail?: string;
}

export type NoteExecutionCallback = (steps: NoteExecutionStep[]) => void;
import { MARKDOWN_FILE_CONFIG } from '../types';
import { chatCompletion } from './llmService';
import { getNoteFormatInstructions, getDefaultNoteDirectory } from './llmService';
import { get_project_files, getProject, getAllProjects, createProject } from './projectService';
import { updateProjectStatus } from './database';
import { getConnection, flushDatabase } from './database';
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
  
  // Flush to persist immediately
  await flushDatabase();
  
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
  
  // Flush to persist immediately
  await flushDatabase();
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
    
    // Update project status to indexed
    await updateProjectStatus(projectId, 'indexed');
    await flushDatabase();
    
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
    
    // Update project status to indexed
    await updateProjectStatus(projectId, 'indexed');
    await flushDatabase();
    
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

// ============================================
// Phase 10: Global Project Router
// ============================================

/**
 * Prompt template for deciding which project a note belongs to
 */
function buildDecideTargetProjectPrompt(projects: ProjectSummary[]): string {
  const projectList = projects.length > 0
    ? projects.map(p => `  - ID: "${p.id}" | Name: "${p.name}"${p.description ? ` | Description: ${p.description}` : ''}`).join('\n')
    : '  (No existing projects)';

  return `You are a project classification assistant. Given a note's content, decide which project it belongs to.

Existing projects:
${projectList}

Guidelines:
- STRONGLY prefer assigning to an existing project when the note reasonably fits its topic or theme
- Only suggest creating a new project if:
  1. No existing projects exist, OR
  2. The note is clearly about a completely different domain that doesn't fit any existing project
- Consider project names and descriptions to find the best match
- If uncertain between multiple projects, choose the one with the closest thematic match

Respond with a JSON object ONLY:
{
  "action": "use_existing" | "create_project",
  "targetProjectId": "project-id-here" (only if action is "use_existing"),
  "proposedProjectName": "New Project Name" (only if action is "create_project"),
  "proposedProjectDescription": "Brief description" (only if action is "create_project"),
  "confidence": "high" | "medium" | "low",
  "reasoning": "Brief explanation of why this project was chosen"
}`;
}

/**
 * Decide which project a note should be added to
 */
export async function decideTargetProject(
  noteContent: string,
  tags?: string[]
): Promise<ProjectRouterDecision> {
  // Get all existing projects
  const projects = await getAllProjects();
  const projectSummaries: ProjectSummary[] = projects.map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
  }));

  // If no projects exist, always suggest creating one
  if (projectSummaries.length === 0) {
    // Generate a project name from the note content
    const titleResponse = await chatCompletion({
      messages: [
        { role: 'system', content: 'Generate a short, descriptive project name (2-4 words) for organizing notes about this topic. Respond with ONLY the project name, no quotes or explanation.' },
        { role: 'user', content: noteContent.slice(0, 1000) },
      ],
      temperature: 0.5,
      maxTokens: 50,
    });

    return {
      action: 'create_project',
      proposedProjectName: titleResponse.content.trim() || 'My Notes',
      proposedProjectDescription: 'Auto-created project for notes',
      confidence: 'high',
      reasoning: 'No existing projects available',
    };
  }

  const systemPrompt = buildDecideTargetProjectPrompt(projectSummaries);
  
  let userContent = `Note content:\n${noteContent.slice(0, 2000)}`;
  if (tags && tags.length > 0) {
    userContent += `\n\nTags: ${tags.join(', ')}`;
  }

  const response = await chatCompletion({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.2,
    maxTokens: 300,
  });

  try {
    // Extract JSON from response
    let jsonStr = response.content.trim();
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    
    const parsed = JSON.parse(jsonStr);
    
    // Validate the decision
    if (parsed.action === 'use_existing') {
      // Verify the project exists
      const projectExists = projectSummaries.some(p => p.id === parsed.targetProjectId);
      if (!projectExists) {
        // Fallback to first project if the suggested one doesn't exist
        return {
          action: 'use_existing',
          targetProjectId: projectSummaries[0].id,
          confidence: 'medium',
          reasoning: 'Fallback to first available project',
        };
      }
    }
    
    return {
      action: parsed.action || 'use_existing',
      targetProjectId: parsed.targetProjectId,
      proposedProjectName: parsed.proposedProjectName,
      proposedProjectDescription: parsed.proposedProjectDescription,
      confidence: parsed.confidence || 'medium',
      reasoning: parsed.reasoning,
    };
  } catch {
    // Fallback: assign to first project or suggest creating one
    if (projectSummaries.length > 0) {
      return {
        action: 'use_existing',
        targetProjectId: projectSummaries[0].id,
        confidence: 'low',
        reasoning: 'Fallback due to parsing error',
      };
    }
    
    return {
      action: 'create_project',
      proposedProjectName: 'General Notes',
      proposedProjectDescription: 'Default project for notes',
      confidence: 'low',
      reasoning: 'Fallback due to parsing error',
    };
  }
}

/**
 * Helper to update execution steps
 */
function updateStep(
  steps: NoteExecutionStep[],
  id: string,
  updates: Partial<NoteExecutionStep>,
  callback?: NoteExecutionCallback
): NoteExecutionStep[] {
  const newSteps = steps.map(s => s.id === id ? { ...s, ...updates } : s);
  callback?.(newSteps);
  return newSteps;
}

/**
 * Global add note pipeline - adds a note from the dashboard
 * 
 * Pipeline steps:
 * 1. Decide target project (or create new one)
 * 2. Format the note content
 * 3. Generate title and filename
 * 4. Save note to project
 * 5. Index for search
 */
export async function globalAddNote(
  params: GlobalAddNoteParams,
  onProgress?: NoteExecutionCallback
): Promise<GlobalAddNoteResult> {
  const { rawNoteText, tags } = params;

  // Initialize execution steps
  let steps: NoteExecutionStep[] = [
    { id: 'router', status: 'pending', label: 'Deciding target project' },
    { id: 'format', status: 'pending', label: 'Formatting note' },
    { id: 'title', status: 'pending', label: 'Generating title' },
    { id: 'directory', status: 'pending', label: 'Choosing directory' },
    { id: 'save', status: 'pending', label: 'Saving note' },
    { id: 'index', status: 'pending', label: 'Indexing for search' },
  ];
  onProgress?.(steps);

  try {
    // Step 1: Decide target project
    steps = updateStep(steps, 'router', { status: 'running' }, onProgress);
    const routerDecision = await decideTargetProject(rawNoteText, tags);
    
    let projectId: string;
    let projectName: string;
    let newProjectCreated = false;

    if (routerDecision.action === 'create_project') {
      // Create a new project
      steps = updateStep(steps, 'router', { 
        status: 'running', 
        detail: `Creating project: ${routerDecision.proposedProjectName}` 
      }, onProgress);
      
      const newProject = await createProject(
        routerDecision.proposedProjectName || 'New Project',
        routerDecision.proposedProjectDescription
      );
      projectId = newProject.id;
      projectName = newProject.name;
      newProjectCreated = true;
      
      steps = updateStep(steps, 'router', { 
        status: 'completed', 
        detail: `Created: ${projectName}` 
      }, onProgress);
    } else {
      // Use existing project
      projectId = routerDecision.targetProjectId!;
      const project = await getProject(projectId);
      if (!project) {
        steps = updateStep(steps, 'router', { status: 'error', detail: 'Project not found' }, onProgress);
        return {
          success: false,
          projectId: '',
          projectName: '',
          newProjectCreated: false,
          filePath: '',
          title: '',
          fileId: '',
          error: 'Target project not found',
        };
      }
      projectName = project.name;
      steps = updateStep(steps, 'router', { 
        status: 'completed', 
        detail: projectName 
      }, onProgress);
    }

    // Step 2: Format the note
    steps = updateStep(steps, 'format', { status: 'running' }, onProgress);
    const contextMetadata: NoteContextMetadata = tags ? { tags } : {};
    const formattedContent = await formatNote(rawNoteText, contextMetadata);
    steps = updateStep(steps, 'format', { status: 'completed' }, onProgress);

    // Step 3: Generate title
    steps = updateStep(steps, 'title', { status: 'running' }, onProgress);
    const title = await generateNoteTitle(formattedContent);
    const slug = titleToSlug(title);
    steps = updateStep(steps, 'title', { status: 'completed', detail: title }, onProgress);

    // Step 4: Decide directory
    steps = updateStep(steps, 'directory', { status: 'running' }, onProgress);
    const { targetDirectory } = await decideNoteDirectory(projectId, title, contextMetadata);
    steps = updateStep(steps, 'directory', { status: 'completed', detail: targetDirectory }, onProgress);

    // Step 5: Save the note
    steps = updateStep(steps, 'save', { status: 'running' }, onProgress);
    const fileName = await generateUniqueFileName(projectId, slug, targetDirectory);
    const file = await persistNote(projectId, fileName, targetDirectory, formattedContent);
    steps = updateStep(steps, 'save', { status: 'completed', detail: file.name }, onProgress);

    // Step 6: Index the note
    steps = updateStep(steps, 'index', { status: 'running' }, onProgress);
    await indexNote(file);
    
    // Update project status to indexed
    await updateProjectStatus(projectId, 'indexed');
    await flushDatabase();
    
    steps = updateStep(steps, 'index', { status: 'completed' }, onProgress);

    return {
      success: true,
      projectId,
      projectName,
      newProjectCreated,
      filePath: file.name,
      title,
      fileId: file.id,
    };
  } catch (error) {
    // Mark any running step as error
    steps = steps.map(s => 
      s.status === 'running' 
        ? { ...s, status: 'error' as const, detail: error instanceof Error ? error.message : 'Error' }
        : s
    );
    onProgress?.(steps);
    
    return {
      success: false,
      projectId: '',
      projectName: '',
      newProjectCreated: false,
      filePath: '',
      title: '',
      fileId: '',
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}


