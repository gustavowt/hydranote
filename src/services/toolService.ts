/**
 * Tool Service
 * Handles tool routing and execution
 * Phase 3: read tool implementation with router pattern
 */

import type {
  ToolName,
  ToolCall,
  ToolResult,
  ToolAttachment,
  ReadToolParams,
  SearchToolParams,
  SummarizeToolParams,
  WriteToolParams,
  ProgressiveReadConfig,
  ProjectFile,
  Chunk,
  DocumentFormat,
  NoteContextMetadata,
  UpdateFileToolParams,
  UpdateFilePreview,
  DiffLine,
  UpdateFileResult,
  LLMStreamCallback,
  WebResearchToolParams,
  WorkingContext,
  SelectionContext,
} from "../types";
import { DEFAULT_PROGRESSIVE_READ_CONFIG } from "../types";
import {
  get_project_files,
  get_file_chunks,
  getFile,
  searchProject,
  createProject,
  deleteProject,
  deleteFile,
  moveFile,
  renameFile,
  getAllProjects,
  getProject,
  findFileByPath,
  findFileGlobal,
  searchAllProjects,
  createFile as projectCreateFile,
  indexFileForSearch,
} from "./projectService";
import { chatCompletion, chatCompletionStreaming } from "./llmService";
import { generateDocument } from "./documentGeneratorService";
import {
  formatNote,
  generateNoteTitle,
  titleToSlug,
  decideNoteDirectoryWithDirs,
  getProjectDirectories,
  generateUniqueFileName,
} from "./noteService";
import { webResearch, formatWebResearchResults, isWebSearchConfigured } from "./webSearchService";

// ============================================
// Execution Log Types
// ============================================

export interface ExecutionStep {
  id: string;
  type: "routing" | "tool" | "response";
  status: "pending" | "running" | "completed" | "error";
  label: string;
  detail?: string;
  startTime?: Date;
  endTime?: Date;
}

export type ExecutionLogCallback = (steps: ExecutionStep[]) => void;

// ============================================
// ARCHITECTURE NOTE:
// The chat flow uses a Planner → Executor → Checker pattern:
// 1. createExecutionPlan() - Creates a plan with tool sequence
// 2. executePlan() - Executes tools with context passing between steps
// 3. checkCompletion() - Validates all tasks are complete
// 4. runPlannerFlow() - Orchestrates the full flow with re-planning support
// ============================================

// ============================================
// Read Tool Implementation
// ============================================

/**
 * Find a file by name or ID within a project
 */
async function findFile(
  projectId: string,
  params: ReadToolParams,
): Promise<ProjectFile | null> {
  // If fileId is provided, get directly
  if (params.fileId) {
    return getFile(params.fileId);
  }

  // Search by file name
  if (params.fileName) {
    const files = await get_project_files(projectId);
    const searchName = params.fileName.toLowerCase();

    // Exact match first
    let file = files.find((f) => f.name.toLowerCase() === searchName);

    // Partial match if no exact match
    if (!file) {
      file = files.find((f) => f.name.toLowerCase().includes(searchName));
    }

    return file || null;
  }

  return null;
}

/**
 * Stitch chunks back together into full text
 */
function stitchChunks(chunks: Chunk[]): string {
  if (chunks.length === 0) return "";
  if (chunks.length === 1) return chunks[0].text;

  // Sort by index and stitch, avoiding overlap duplication
  const sorted = [...chunks].sort((a, b) => a.index - b.index);

  let result = sorted[0].text;

  for (let i = 1; i < sorted.length; i++) {
    const prevChunk = sorted[i - 1];
    const currChunk = sorted[i];

    // Check for overlap
    const overlapStart = currChunk.startOffset;
    const prevEnd = prevChunk.endOffset;

    if (overlapStart < prevEnd) {
      // There's overlap, skip the overlapping part
      const overlapLength = prevEnd - overlapStart;
      if (overlapLength < currChunk.text.length) {
        result += currChunk.text.slice(overlapLength);
      }
    } else {
      // No overlap, add spacing if needed
      result += "\n" + currChunk.text;
    }
  }

  return result;
}

/**
 * Execute the read tool
 * Retrieves file content, handles large files with progressive reading
 */
export async function executeReadTool(
  projectId: string,
  params: ReadToolParams,
  config: ProgressiveReadConfig = DEFAULT_PROGRESSIVE_READ_CONFIG,
): Promise<ToolResult> {
  try {
    // Find the file
    const file = await findFile(projectId, params);

    if (!file) {
      return {
        success: false,
        tool: "read",
        error: `File not found: ${params.fileName || params.fileId || "No file specified"}`,
      };
    }

    // Check if file has stored content
    if (file.content) {
      const truncated = file.content.length > config.maxCharacters;
      const content = truncated
        ? file.content.slice(0, config.maxCharacters) +
          "\n\n[Content truncated due to size...]"
        : file.content;

      return {
        success: true,
        tool: "read",
        data: content,
        metadata: {
          fileName: file.name,
          fileId: file.id,
          fileSize: file.size,
          truncated,
        },
      };
    }

    // Fall back to chunks
    const chunks = await get_file_chunks(file.id);

    if (chunks.length === 0) {
      return {
        success: false,
        tool: "read",
        error: `File "${file.name}" has no content indexed yet.`,
      };
    }

    // Progressive reading: limit chunks if file is very large
    const maxChunks =
      params.maxChunks || Math.ceil(config.maxCharacters / 1000);
    const chunksToUse =
      chunks.length > maxChunks ? chunks.slice(0, maxChunks) : chunks;

    const content = stitchChunks(chunksToUse);
    const truncated = chunks.length > chunksToUse.length;

    return {
      success: true,
      tool: "read",
      data: truncated
        ? content +
          `\n\n[Showing ${chunksToUse.length} of ${chunks.length} chunks. Ask to continue reading for more.]`
        : content,
      metadata: {
        fileName: file.name,
        fileId: file.id,
        fileSize: file.size,
        chunkCount: chunks.length,
        truncated,
      },
    };
  } catch (error) {
    return {
      success: false,
      tool: "read",
      error: error instanceof Error ? error.message : "Failed to read file",
    };
  }
}

// ============================================
// Search Tool Implementation
// ============================================

/**
 * Default search configuration
 */
const DEFAULT_SEARCH_CONFIG = {
  maxResults: 5,
};

/**
 * Execute the search tool
 * Performs semantic search across all project documents
 */
export async function executeSearchTool(
  projectId: string,
  params: SearchToolParams,
): Promise<ToolResult> {
  try {
    const query = params.query;

    if (!query || query.trim().length === 0) {
      return {
        success: false,
        tool: "search",
        error: "Search query is required",
      };
    }

    const maxResults = params.maxResults || DEFAULT_SEARCH_CONFIG.maxResults;

    // Perform semantic search
    const results = await searchProject(projectId, query, maxResults);

    if (results.length === 0) {
      return {
        success: true,
        tool: "search",
        data: "No relevant results found for your query.",
        metadata: {
          truncated: false,
        },
      };
    }

    // Format results with source references
    const formattedResults = results
      .map((result, index) => {
        const scorePercent = (result.score * 100).toFixed(1);
        return `[Result ${index + 1}] (Source: ${result.fileName}, Score: ${scorePercent}%)\n${result.text}`;
      })
      .join("\n\n---\n\n");

    return {
      success: true,
      tool: "search",
      data: formattedResults,
      metadata: {
        truncated: false,
      },
    };
  } catch (error) {
    return {
      success: false,
      tool: "search",
      error:
        error instanceof Error ? error.message : "Failed to execute search",
    };
  }
}

// ============================================
// Summarize Tool Implementation
// ============================================

/**
 * Default summarization configuration
 */
const DEFAULT_SUMMARIZE_CONFIG = {
  maxDirectTokens: 8000, // ~32k characters - summarize directly if under this
  chunkSummaryMaxTokens: 500, // Target length for individual chunk summaries
  maxChunksForHierarchical: 30, // Max chunks to process (sampled evenly if exceeded)
  maxFileSizeBytes: 10 * 1024 * 1024, // 10MB max file size for summarization
};

/**
 * Estimate token count (rough: ~4 chars per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Check if file type is text-based (not image)
 */
function isTextBasedFile(file: ProjectFile): boolean {
  const imageTypes = ["png", "jpg", "jpeg", "webp"];
  return !imageTypes.includes(file.type);
}

/**
 * Sample chunks evenly from a large array
 * Takes chunks from beginning, middle, and end to get representative coverage
 */
function sampleChunksEvenly(chunks: Chunk[], maxCount: number): Chunk[] {
  if (chunks.length <= maxCount) return chunks;

  const step = chunks.length / maxCount;
  const sampled: Chunk[] = [];

  for (let i = 0; i < maxCount; i++) {
    const index = Math.floor(i * step);
    sampled.push(chunks[index]);
  }

  return sampled;
}

/**
 * Summarize text directly using LLM
 */
async function summarizeText(text: string, context?: string): Promise<string> {
  const systemPrompt = `You are a document summarization assistant. Create clear, concise summaries that capture the key points.
${context ? `\nContext: ${context}` : ""}

Guidelines:
- Extract and present the main ideas
- Preserve important details, facts, and figures
- Use clear, professional language
- Structure the summary logically`;

  const response = await chatCompletion({
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Please summarize the following text:\n\n${text}`,
      },
    ],
    temperature: 0.3,
    maxTokens: 1500,
  });

  return response.content;
}

/**
 * Summarize a single chunk (for hierarchical summarization)
 */
async function summarizeChunk(
  chunk: Chunk,
  index: number,
  total: number,
): Promise<string> {
  const response = await chatCompletion({
    messages: [
      {
        role: "system",
        content:
          "Summarize this document section concisely. Focus on key information only.",
      },
      {
        role: "user",
        content: `Section ${index + 1} of ${total}:\n\n${chunk.text}`,
      },
    ],
    temperature: 0.3,
    maxTokens: DEFAULT_SUMMARIZE_CONFIG.chunkSummaryMaxTokens,
  });

  return response.content;
}

/**
 * Merge multiple chunk summaries into a final summary
 */
async function mergeSummaries(
  summaries: string[],
  fileName: string,
): Promise<string> {
  const combined = summaries
    .map((s, i) => `[Section ${i + 1}]\n${s}`)
    .join("\n\n");

  const response = await chatCompletion({
    messages: [
      {
        role: "system",
        content: `You are synthesizing section summaries into a cohesive document summary for "${fileName}". 
Create a unified summary that:
- Integrates all key points
- Eliminates redundancy
- Maintains logical flow
- Highlights the most important information`,
      },
      {
        role: "user",
        content: `Create a comprehensive summary from these section summaries:\n\n${combined}`,
      },
    ],
    temperature: 0.3,
    maxTokens: 2000,
  });

  return response.content;
}

/**
 * Execute the summarize tool
 * Supports direct and hierarchical summarization based on document size
 */
export async function executeSummarizeTool(
  projectId: string,
  params: SummarizeToolParams,
): Promise<ToolResult> {
  try {
    // Find the file
    const file = await findFile(projectId, {
      fileId: params.fileId,
      fileName: params.fileName,
    });

    if (!file) {
      return {
        success: false,
        tool: "summarize",
        error: `File not found: ${params.fileName || params.fileId || "No file specified"}`,
      };
    }

    // Check if file is text-based
    if (!isTextBasedFile(file)) {
      return {
        success: false,
        tool: "summarize",
        error: `Cannot summarize image file "${file.name}". Summarization only works with text-based documents.`,
      };
    }

    // Check file size limit
    if (file.size > DEFAULT_SUMMARIZE_CONFIG.maxFileSizeBytes) {
      const maxMB = DEFAULT_SUMMARIZE_CONFIG.maxFileSizeBytes / (1024 * 1024);
      const fileMB = (file.size / (1024 * 1024)).toFixed(1);
      return {
        success: false,
        tool: "summarize",
        error: `File "${file.name}" (${fileMB}MB) exceeds the ${maxMB}MB limit for summarization. Consider splitting the document.`,
      };
    }

    // Get file content or chunks
    let textContent = file.content || "";
    const chunks = await get_file_chunks(file.id);

    if (!textContent && chunks.length === 0) {
      return {
        success: false,
        tool: "summarize",
        error: `File "${file.name}" has no content indexed yet.`,
      };
    }

    // If no direct content, stitch chunks
    if (!textContent && chunks.length > 0) {
      textContent = stitchChunks(chunks);
    }

    const tokenCount = estimateTokens(textContent);
    const maxDirect =
      params.maxDirectTokens || DEFAULT_SUMMARIZE_CONFIG.maxDirectTokens;

    let summary: string;
    let method: "direct" | "hierarchical";

    if (tokenCount <= maxDirect) {
      // Direct summarization for smaller documents
      method = "direct";
      summary = await summarizeText(textContent, `Document: ${file.name}`);
    } else {
      // Hierarchical summarization for larger documents
      method = "hierarchical";

      // Filter to text chunks only (in case of mixed content)
      let textChunks = chunks.filter((c) => c.text.trim().length > 50);

      if (textChunks.length === 0) {
        return {
          success: false,
          tool: "summarize",
          error: `File "${file.name}" has no substantial text content to summarize.`,
        };
      }

      // Sample chunks if too many (to avoid excessive API calls)
      const maxChunks = DEFAULT_SUMMARIZE_CONFIG.maxChunksForHierarchical;
      const wassampled = textChunks.length > maxChunks;
      if (wassampled) {
        textChunks = sampleChunksEvenly(textChunks, maxChunks);
      }

      // Summarize chunks in parallel batches of 5
      const chunkSummaries: string[] = new Array(textChunks.length);
      const batchSize = 5;

      for (let i = 0; i < textChunks.length; i += batchSize) {
        const batch = textChunks.slice(i, i + batchSize);
        const batchPromises = batch.map((chunk, batchIdx) =>
          summarizeChunk(chunk, i + batchIdx, textChunks.length),
        );
        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach((summary, batchIdx) => {
          chunkSummaries[i + batchIdx] = summary;
        });
      }

      // Merge all summaries
      summary = await mergeSummaries(chunkSummaries, file.name);

      if (wassampled) {
        summary += `\n\n_Note: This summary was generated from a sample of ${maxChunks} sections due to document size._`;
      }
    }

    return {
      success: true,
      tool: "summarize",
      data: summary,
      attachment: {
        id: crypto.randomUUID(),
        type: 'summary',
        title: `Summary of ${file.name}`,
        content: summary,
        metadata: { fileName: file.name, fileId: file.id },
      },
      metadata: {
        fileName: file.name,
        fileId: file.id,
        fileSize: file.size,
        chunkCount: chunks.length,
        truncated: false,
      },
    };
  } catch (error) {
    return {
      success: false,
      tool: "summarize",
      error:
        error instanceof Error ? error.message : "Failed to summarize file",
    };
  }
}

// ============================================
// Write Tool Implementation
// ============================================

/**
 * Default write configuration
 */
const DEFAULT_WRITE_CONFIG = {
  maxContentTokens: 4000,
  defaultFormat: "md" as DocumentFormat,
  supportedFormats: ["pdf", "docx", "md"] as DocumentFormat[],
};

/**
 * Generate document content using LLM based on project context
 */
async function generateDocumentContent(
  projectId: string,
  title: string,
  userRequest: string,
): Promise<string> {
  // Get relevant context from project
  const searchResults = await searchProject(projectId, userRequest, 10);

  let contextText = "";
  if (searchResults.length > 0) {
    contextText = searchResults
      .map((r, i) => `[Source ${i + 1}: ${r.fileName}]\n${r.text}`)
      .join("\n\n---\n\n");
  }

  const systemPrompt = `You are a professional document writer. Create well-structured content for a document.

Guidelines:
- Write in clear, professional language
- Use markdown formatting (headings, bullet points, etc.)
- Structure the content logically with sections
- Be comprehensive but concise
- Include relevant information from the provided context
- Do NOT include the title in your response (it will be added separately)`;

  const userPrompt = contextText
    ? `Based on the following context from the project documents:\n\n${contextText}\n\n---\n\nCreate content for a document titled "${title}". User request: ${userRequest}`
    : `Create content for a document titled "${title}". User request: ${userRequest}`;

  const response = await chatCompletion({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
    maxTokens: DEFAULT_WRITE_CONFIG.maxContentTokens,
  });

  return response.content;
}

/**
 * Convert title to a safe filename
 */
function titleToFileName(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "") // Remove special characters
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Replace multiple hyphens with single
    .replace(/^-|-$/g, "") // Remove leading/trailing hyphens
    .substring(0, 50); // Limit length
}

/**
 * Helper to build full file path
 */
function buildFilePath(fileName: string, directory: string): string {
  return directory ? `${directory}/${fileName}` : fileName;
}

/**
 * Execute the write tool
 * Creates a new file in the project.
 * For all formats: AI generates title if not provided, AI decides directory if not provided.
 * For Markdown: Also formats content via LLM.
 */
export async function executeWriteTool(
  projectId: string,
  params: WriteToolParams,
  userMessage?: string,
): Promise<ToolResult> {
  try {
    const format = params.format || DEFAULT_WRITE_CONFIG.defaultFormat;

    // Validate format
    if (!DEFAULT_WRITE_CONFIG.supportedFormats.includes(format)) {
      return {
        success: false,
        tool: "write",
        error: `Invalid format: ${format}. Supported formats: ${DEFAULT_WRITE_CONFIG.supportedFormats.join(", ")}`,
      };
    }

    // Generate content if not provided
    let content = params.content;
    if (!content) {
      content = await generateDocumentContent(
        projectId,
        params.title || "New Document",
        userMessage || `Generate a document about ${params.title || "the topic"}`,
      );
    }

    // Common: Check if title/directory are provided
    const titleProvided = params.title && params.title.trim().length > 0;
    const directoryProvided = params.path && params.path.trim().length > 0;

    // For Markdown files: Use the full AI pipeline (formatting, title generation, directory decision)
    if (format === "md") {
      // Run format, title generation (if needed), and directory fetch in PARALLEL
      const [formattedContent, generatedTitle, existingDirectories] = await Promise.all([
        // Always format content for MD files
        formatNote(content),
        // Generate title if not provided
        titleProvided ? Promise.resolve(params.title!) : generateNoteTitle(content),
        // Pre-fetch directories for decision (only if directory not provided)
        directoryProvided ? Promise.resolve([]) : getProjectDirectories(projectId),
      ]);

      const finalTitle = generatedTitle;
      const slug = titleToSlug(finalTitle);

      // Decide directory if not explicitly provided
      let targetDirectory: string;
      if (directoryProvided) {
        targetDirectory = params.path!;
      } else {
        const { targetDirectory: decidedDir } = await decideNoteDirectoryWithDirs(
          projectId,
          finalTitle,
          existingDirectories,
        );
        targetDirectory = decidedDir;
      }

      // Generate unique filename
      const fileName = await generateUniqueFileName(projectId, slug, targetDirectory);
      const fullPath = targetDirectory ? `${targetDirectory}/${fileName}` : fileName;

      // Add title as H1 if content doesn't start with a heading
      const finalContent = formattedContent.trim().startsWith("#")
        ? formattedContent
        : `# ${finalTitle}\n\n${formattedContent}`;

      // Use centralized createFile (handles DB + file system sync)
      const file = await projectCreateFile(
        projectId,
        fullPath,
        finalContent,
        "md",
      );

      // Index for search using centralized function
      await indexFileForSearch(projectId, file.id, finalContent, "md");

      return {
        success: true,
        tool: "write",
        persistedChanges: true,
        data: `File "${file.name}" has been created.\n\n**Title:** ${finalTitle}\n**Format:** Markdown\n**Size:** ${formatFileSize(file.size)}\n**Location:** ${targetDirectory || "project root"}`,
        metadata: {
          fileName: file.name,
          fileId: file.id,
          projectId,
          fileSize: file.size,
          truncated: false,
        },
      };
    }

    // For PDF/DOCX: AI generates title and decides directory (no content formatting)
    // Run title generation and directory fetch in PARALLEL
    const [generatedTitle, existingDirectories] = await Promise.all([
      // Generate title if not provided
      titleProvided ? Promise.resolve(params.title!) : generateNoteTitle(content),
      // Pre-fetch directories for decision (only if directory not provided)
      directoryProvided ? Promise.resolve([]) : getProjectDirectories(projectId),
    ]);

    const finalTitle = generatedTitle;

    // Decide directory if not explicitly provided
    let targetDirectory: string;
    if (directoryProvided) {
      targetDirectory = params.path!;
    } else {
      const { targetDirectory: decidedDir } = await decideNoteDirectoryWithDirs(
        projectId,
        finalTitle,
        existingDirectories,
      );
      targetDirectory = decidedDir;
    }

    // Generate document with AI-decided title and directory
    const result = await generateDocument(projectId, finalTitle, content, format, targetDirectory);

    return {
      success: true,
      tool: "write",
      persistedChanges: true,
      data: `Document "${result.fileName}" has been created.\n\n**Title:** ${finalTitle}\n**Format:** ${format.toUpperCase()}\n**Size:** ${formatFileSize(result.size)}\n**Location:** ${targetDirectory || "project root"}`,
      metadata: {
        fileName: result.fileName,
        fileId: result.fileId,
        projectId,
        fileSize: result.size,
        downloadUrl: result.downloadUrl,
        truncated: false,
      },
    };
  } catch (error) {
    return {
      success: false,
      tool: "write",
      error: error instanceof Error ? error.message : "Failed to create file",
    };
  }
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================
// CreateProject Tool Implementation
// ============================================

/**
 * Execute the createProject tool
 * Creates a new project or returns existing one (upsert behavior)
 * 
 * This is idempotent - if a project with the same name exists,
 * it returns success with the existing project info instead of failing.
 * This ensures pipelines can continue even if the project already exists.
 */
export async function executeCreateProjectTool(params: {
  name: string;
  description?: string;
}): Promise<ToolResult> {
  try {
    const name = params.name?.trim();

    if (!name) {
      return {
        success: false,
        tool: "createProject",
        error: "Project name is required",
      };
    }

    // Check if project with same name already exists
    const existingProjects = await getAllProjects();
    const existingProject = existingProjects.find(
      (p) => p.name.toLowerCase() === name.toLowerCase(),
    );

    if (existingProject) {
      // Return success with existing project (upsert behavior)
      // This allows pipelines to continue using the existing project
      return {
        success: true,
        tool: "createProject",
        data: `Using existing project "${existingProject.name}".`,
        metadata: {
          projectId: existingProject.id,
          projectName: existingProject.name,
          wasExisting: true,
        },
      };
    }

    const project = await createProject(name, params.description);

    // Check for sync error
    const syncError = (project as { syncError?: string }).syncError;

    return {
      success: true,
      tool: "createProject",
      persistedChanges: true,
      data: `Project "${project.name}" has been created successfully.${syncError ? `\n\n⚠️ Note: Folder sync failed: ${syncError}` : ""}${params.description ? `\n\n**Description:** ${params.description}` : ""}`,
      metadata: {
        projectId: project.id,
        projectName: project.name,
        wasExisting: false,
      },
    };
  } catch (error) {
    return {
      success: false,
      tool: "createProject",
      error:
        error instanceof Error ? error.message : "Failed to create project",
    };
  }
}

// ============================================
// MoveFile Tool Implementation
// ============================================

/**
 * Resolve project by name or ID
 */
async function resolveProject(
  nameOrId: string,
): Promise<{ id: string; name: string } | null> {
  // Try as ID first
  const projectById = await getProject(nameOrId);
  if (projectById) {
    return { id: projectById.id, name: projectById.name };
  }

  // Try by name (case-insensitive)
  const allProjects = await getAllProjects();
  const projectByName = allProjects.find(
    (p) => p.name.toLowerCase() === nameOrId.toLowerCase(),
  );

  if (projectByName) {
    return { id: projectByName.id, name: projectByName.name };
  }

  return null;
}

/**
 * Execute the moveFile tool
 * Supports three operations:
 * 1. Rename: Change file name within same project (newName provided)
 * 2. Move within project: Move to different directory in same project
 * 3. Move between projects: Move file from one project to another
 */
export async function executeMoveFileTool(params: {
  file: string;
  fromProject?: string;
  toProject?: string;
  directory?: string;
  newName?: string;
}): Promise<ToolResult> {
  try {
    const { file, fromProject, toProject, directory, newName } = params;

    if (!file) {
      return {
        success: false,
        tool: "moveFile",
        error: "File name is required.",
      };
    }

    // Determine source project
    let sourceProject: { id: string; name: string } | null = null;
    let sourceFile: ProjectFile | null = null;

    if (fromProject) {
      sourceProject = await resolveProject(fromProject);
      if (!sourceProject) {
        return {
          success: false,
          tool: "moveFile",
          error: `Source project "${fromProject}" not found.`,
        };
      }
      sourceFile = await findFileByPath(sourceProject.id, file);
    } else {
      // Try to find the file globally
      const globalResult = await findFileGlobal(file);
      if (globalResult) {
        sourceProject = { id: globalResult.projectId, name: globalResult.projectName };
        sourceFile = globalResult.file;
      }
    }

    if (!sourceProject || !sourceFile) {
      return {
        success: false,
        tool: "moveFile",
        error: `File "${file}" not found.${!fromProject ? " Please specify which project the file is in." : ""}`,
      };
    }

    // Determine if this is a rename, same-project move, or cross-project move
    const isSameProject = !toProject || toProject === fromProject || 
      (await resolveProject(toProject))?.id === sourceProject.id;

    // Case 1: Rename (same project, newName provided)
    if (isSameProject && newName) {
      const renamedFile = await renameFile(sourceFile.id, newName);
      if (!renamedFile) {
        return {
          success: false,
          tool: "moveFile",
          error: `Failed to rename file "${file}".`,
        };
      }
      return {
        success: true,
        tool: "moveFile",
        persistedChanges: true,
        data: `File "${file}" has been renamed to "${renamedFile.name}" in project "${sourceProject.name}".`,
        metadata: {
          fileId: renamedFile.id,
          fileName: renamedFile.name,
        },
      };
    }

    // Case 2: Move within same project to different directory
    if (isSameProject && directory) {
      const movedFile = await moveFile(sourceFile.id, sourceProject.id, directory);
      return {
        success: true,
        tool: "moveFile",
        persistedChanges: true,
        data: `File "${file}" has been moved to "${directory}/" in project "${sourceProject.name}".`,
        metadata: {
          fileId: movedFile.id,
          fileName: movedFile.name,
        },
      };
    }

    // Case 3: Cross-project move
    if (!toProject) {
      return {
        success: false,
        tool: "moveFile",
        error: "Please specify either a new name (for rename), a directory (for move within project), or a destination project (for cross-project move).",
      };
    }

    const destProject = await resolveProject(toProject);
    if (!destProject) {
      return {
        success: false,
        tool: "moveFile",
        error: `Destination project "${toProject}" not found.`,
      };
    }

    const movedFile = await moveFile(sourceFile.id, destProject.id, directory);

    return {
      success: true,
      tool: "moveFile",
      persistedChanges: true,
      data: `File "${file}" has been moved from "${sourceProject.name}" to "${destProject.name}".${directory ? `\n\n**New location:** ${directory}/${movedFile.name.split("/").pop()}` : ""}`,
      metadata: {
        fileId: movedFile.id,
        fileName: movedFile.name,
      },
    };
  } catch (error) {
    return {
      success: false,
      tool: "moveFile",
      error: error instanceof Error ? error.message : "Failed to move/rename file",
    };
  }
}

// ============================================
// DeleteFile Tool Implementation
// ============================================

/**
 * Execute the deleteFile tool
 * Deletes a file from a project
 */
export async function executeDeleteFileTool(
  projectId: string | undefined,
  params: { file: string; project?: string },
): Promise<ToolResult> {
  try {
    const { file, project } = params;

    if (!file) {
      return {
        success: false,
        tool: "deleteFile",
        error: "File name is required.",
      };
    }

    let targetProjectId: string | undefined = projectId;
    let targetProjectName: string | undefined;
    let fileToDelete: { id: string; name: string } | null = null;

    // If project is specified in params, use that
    if (project) {
      const resolvedProject = await resolveProject(project);
      if (!resolvedProject) {
        return {
          success: false,
          tool: "deleteFile",
          error: `Project "${project}" not found.`,
        };
      }
      targetProjectId = resolvedProject.id;
      targetProjectName = resolvedProject.name;
    }

    // If we have a specific project, search in it
    if (targetProjectId) {
      const foundFile = await findFileByPath(targetProjectId, file);
      if (foundFile) {
        fileToDelete = { id: foundFile.id, name: foundFile.name };
        if (!targetProjectName) {
          const proj = await getProject(targetProjectId);
          targetProjectName = proj?.name;
        }
      }
    } else {
      // Global mode - search across all projects
      const result = await findFileGlobal(file);
      if (result) {
        fileToDelete = { id: result.file.id, name: result.file.name };
        targetProjectName = result.projectName;
      }
    }

    if (!fileToDelete) {
      return {
        success: false,
        tool: "deleteFile",
        error: `File "${file}" not found.${!targetProjectId ? " Please specify which project the file is in." : ""}`,
      };
    }

    // Delete the file
    await deleteFile(fileToDelete.id);

    return {
      success: true,
      tool: "deleteFile",
      persistedChanges: true,
      data: `File "${fileToDelete.name}" has been deleted from project "${targetProjectName}".`,
      metadata: {
        fileId: fileToDelete.id,
        fileName: fileToDelete.name,
      },
    };
  } catch (error) {
    return {
      success: false,
      tool: "deleteFile",
      error: error instanceof Error ? error.message : "Failed to delete file",
    };
  }
}

// ============================================
// DeleteProject Tool Implementation
// ============================================

/**
 * Execute the deleteProject tool
 * Deletes an entire project and all its files
 */
export async function executeDeleteProjectTool(params: {
  project: string;
  confirm?: string;
}): Promise<ToolResult> {
  try {
    const { project, confirm } = params;

    if (!project) {
      return {
        success: false,
        tool: "deleteProject",
        error: "Project name or ID is required.",
      };
    }

    // Resolve the project first to show it exists
    const resolvedProject = await resolveProject(project);
    if (!resolvedProject) {
      return {
        success: false,
        tool: "deleteProject",
        error: `Project "${project}" not found.`,
      };
    }

    // Require explicit confirmation
    if (confirm?.toLowerCase() !== "yes") {
      return {
        success: false,
        tool: "deleteProject",
        error: `⚠️ **Confirmation required** to delete project "${resolvedProject.name}".\n\nThis will permanently delete the project and all its files. To confirm, please say "Yes, delete the project ${resolvedProject.name}" or ask me again with explicit confirmation.`,
      };
    }

    // Delete the project
    await deleteProject(resolvedProject.id);

    return {
      success: true,
      tool: "deleteProject",
      persistedChanges: true,
      data: `Project "${resolvedProject.name}" and all its files have been permanently deleted.`,
      metadata: {
        fileId: resolvedProject.id,
        fileName: resolvedProject.name,
      },
    };
  } catch (error) {
    return {
      success: false,
      tool: "deleteProject",
      error:
        error instanceof Error ? error.message : "Failed to delete project",
    };
  }
}

// ============================================
// WebResearch Tool Implementation
// ============================================

/**
 * Execute the webResearch tool
 * Searches the web, fetches content, generates embeddings, and returns relevant chunks
 */
export async function executeWebResearchTool(
  params: WebResearchToolParams,
): Promise<ToolResult> {
  try {
    // Check if web search is configured
    if (!isWebSearchConfigured()) {
      return {
        success: false,
        tool: "webResearch",
        error:
          "Web search is not configured. Please configure a search provider (SearXNG, Brave, or DuckDuckGo) in Settings.",
      };
    }

    const query = params.query;

    if (!query || query.trim().length === 0) {
      return {
        success: false,
        tool: "webResearch",
        error: "Search query is required for web research.",
      };
    }

    // Perform web research
    const result = await webResearch(query, {
      maxResults: params.maxResults,
      maxChunks: params.maxChunks,
      onProgress: params.onProgress,
    });

    if (result.error) {
      return {
        success: false,
        tool: "webResearch",
        error: result.error,
      };
    }

    if (result.relevantContent.length === 0) {
      return {
        success: true,
        tool: "webResearch",
        data: `No relevant information found for "${query}" from web search.`,
        metadata: {
          truncated: false,
        },
      };
    }

    // Format results
    const formattedResults = formatWebResearchResults(result);

    return {
      success: true,
      tool: "webResearch",
      data: formattedResults,
      metadata: {
        truncated: false,
      },
    };
  } catch (error) {
    return {
      success: false,
      tool: "webResearch",
      error:
        error instanceof Error ? error.message : "Web research failed",
    };
  }
}

// ============================================
// UpdateFile Tool Implementation
// ============================================

// Store for pending file update previews
const pendingPreviews = new Map<string, UpdateFilePreview>();

/**
 * Chain-of-Thought prompt for updateFile tool
 * Analyzes file structure, identifies changes, and generates unified diff
 */
const UPDATEFILE_COT_PROMPT = `You are a precise document editor. Your task is to analyze a file and generate a unified diff based on an edit instruction.

Follow these steps IN ORDER:

## STEP 1 - FILE ANALYSIS
Analyze the document and identify:
- Document type (markdown, code, notes, config, etc.)
- Main structure (sections, headings, functions, etc.)
- Total line count

## STEP 2 - CHANGE IDENTIFICATION
Based on the edit instruction, determine:
- What specific content needs to change?
- Which exact lines are affected? (be precise with line numbers)
- What content must NOT change? (everything else)
- Is this an insertion, replacement, or deletion?

## STEP 3 - GENERATE UNIFIED DIFF
Output a unified diff that applies ONLY the necessary changes.

CRITICAL RULES:
1. ONLY modify what the instruction asks for - preserve everything else EXACTLY
2. Include 3 lines of context before and after changes for accurate patch application
3. Line numbers in the hunk header (@@ -X,Y +X,Z @@) must be accurate
4. Use proper unified diff format with --- and +++ headers
5. Lines starting with space are context (unchanged)
6. Lines starting with - are removed
7. Lines starting with + are added

RESPOND WITH THIS EXACT JSON FORMAT:
{
  "reasoning": "Brief explanation of what you analyzed and what changes you identified",
  "affectedLines": "Line numbers that will change (e.g., '15-20' or '42')",
  "diff": "--- a/filename\\n+++ b/filename\\n@@ -X,Y +A,B @@\\n context\\n-removed\\n+added\\n context"
}

IMPORTANT:
- The diff field must be a valid unified diff string (with \\n for newlines in JSON)
- Do NOT include markdown code blocks around the JSON
- Do NOT modify lines that weren't mentioned in the instruction
- If the instruction is ambiguous, make a minimal, conservative change`;

/**
 * Result from parsing and applying a unified diff
 */
interface DiffApplicationResult {
  success: boolean;
  newContent: string;
  error?: string;
  hunksApplied: number;
}

/**
 * Parsed unified diff hunk
 */
interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: Array<{
    type: 'context' | 'removed' | 'added';
    content: string;
  }>;
}

/**
 * Parse a unified diff string into hunks
 */
function parseUnifiedDiff(diffString: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = diffString.split('\n');
  
  let currentHunk: DiffHunk | null = null;
  
  for (const line of lines) {
    // Skip file headers
    if (line.startsWith('---') || line.startsWith('+++')) {
      continue;
    }
    
    // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      currentHunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newCount: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
        lines: [],
      };
      continue;
    }
    
    // Parse diff lines
    if (currentHunk) {
      if (line.startsWith('-')) {
        currentHunk.lines.push({ type: 'removed', content: line.slice(1) });
      } else if (line.startsWith('+')) {
        currentHunk.lines.push({ type: 'added', content: line.slice(1) });
      } else if (line.startsWith(' ') || line === '') {
        // Context line (space prefix) or empty line
        currentHunk.lines.push({ type: 'context', content: line.startsWith(' ') ? line.slice(1) : line });
      }
    }
  }
  
  // Don't forget the last hunk
  if (currentHunk) {
    hunks.push(currentHunk);
  }
  
  return hunks;
}

/**
 * Apply a unified diff to original content
 * Returns the new content after applying all hunks
 */
function applyUnifiedDiff(originalContent: string, diffString: string): DiffApplicationResult {
  try {
    const hunks = parseUnifiedDiff(diffString);
    
    if (hunks.length === 0) {
      return {
        success: false,
        newContent: originalContent,
        error: 'No valid hunks found in diff',
        hunksApplied: 0,
      };
    }
    
    const originalLines = originalContent.split('\n');
    const resultLines: string[] = [];
    let originalIndex = 0; // 0-based index into originalLines
    
    for (const hunk of hunks) {
      const hunkStartIndex = hunk.oldStart - 1; // Convert to 0-based
      
      // Copy lines before this hunk
      while (originalIndex < hunkStartIndex && originalIndex < originalLines.length) {
        resultLines.push(originalLines[originalIndex]);
        originalIndex++;
      }
      
      // Process hunk lines
      for (const line of hunk.lines) {
        if (line.type === 'context') {
          // Context line - copy from original and advance
          if (originalIndex < originalLines.length) {
            resultLines.push(originalLines[originalIndex]);
            originalIndex++;
          }
        } else if (line.type === 'removed') {
          // Skip this line in original (don't add to result)
          originalIndex++;
        } else if (line.type === 'added') {
          // Add new line to result
          resultLines.push(line.content);
        }
      }
    }
    
    // Copy remaining lines after last hunk
    while (originalIndex < originalLines.length) {
      resultLines.push(originalLines[originalIndex]);
      originalIndex++;
    }
    
    return {
      success: true,
      newContent: resultLines.join('\n'),
      hunksApplied: hunks.length,
    };
  } catch (error) {
    return {
      success: false,
      newContent: originalContent,
      error: error instanceof Error ? error.message : 'Failed to apply diff',
      hunksApplied: 0,
    };
  }
}

/**
 * Generate diff lines between original and new content
 */
function generateDiffLines(original: string, updated: string): DiffLine[] {
  const originalLines = original.split("\n");
  const updatedLines = updated.split("\n");
  const diffLines: DiffLine[] = [];

  // Simple line-by-line diff
  const maxLines = Math.max(originalLines.length, updatedLines.length);
  let oldLineNum = 1;
  let newLineNum = 1;

  // Find common prefix
  let commonPrefixEnd = 0;
  while (
    commonPrefixEnd < originalLines.length &&
    commonPrefixEnd < updatedLines.length &&
    originalLines[commonPrefixEnd] === updatedLines[commonPrefixEnd]
  ) {
    diffLines.push({
      type: "unchanged",
      content: originalLines[commonPrefixEnd],
      oldLineNumber: oldLineNum++,
      newLineNumber: newLineNum++,
    });
    commonPrefixEnd++;
  }

  // Find common suffix
  let commonSuffixStart = 0;
  while (
    commonSuffixStart < originalLines.length - commonPrefixEnd &&
    commonSuffixStart < updatedLines.length - commonPrefixEnd &&
    originalLines[originalLines.length - 1 - commonSuffixStart] ===
      updatedLines[updatedLines.length - 1 - commonSuffixStart]
  ) {
    commonSuffixStart++;
  }

  // Add removed lines
  for (
    let i = commonPrefixEnd;
    i < originalLines.length - commonSuffixStart;
    i++
  ) {
    diffLines.push({
      type: "removed",
      content: originalLines[i],
      oldLineNumber: oldLineNum++,
    });
  }

  // Add added lines
  for (
    let i = commonPrefixEnd;
    i < updatedLines.length - commonSuffixStart;
    i++
  ) {
    diffLines.push({
      type: "added",
      content: updatedLines[i],
      newLineNumber: newLineNum++,
    });
  }

  // Add common suffix
  for (
    let i = originalLines.length - commonSuffixStart;
    i < originalLines.length;
    i++
  ) {
    diffLines.push({
      type: "unchanged",
      content: originalLines[i],
      oldLineNumber: oldLineNum++,
      newLineNumber: newLineNum++,
    });
  }

  return diffLines;
}

/**
 * Execute the updateFile tool using chain-of-thought reasoning
 * The tool analyzes the file and generates a unified diff based on the instruction
 */
export async function executeUpdateFileTool(
  projectId: string,
  params: UpdateFileToolParams,
): Promise<ToolResult & { preview?: UpdateFilePreview }> {
  try {
    // Find the file
    const file = await findFile(projectId, {
      fileId: params.fileId,
      fileName: params.fileName,
    });

    if (!file) {
      return {
        success: false,
        tool: "updateFile",
        error: `File not found: ${params.fileName || params.fileId || "No file specified"}`,
      };
    }

    // Validate file type (only MD and DOCX supported)
    if (file.type !== "md" && file.type !== "docx") {
      return {
        success: false,
        tool: "updateFile",
        error: `UpdateFile only supports Markdown (.md) and DOCX files. "${file.name}" is a ${file.type} file.`,
      };
    }

    // Get file content
    let content = file.content || "";
    if (!content) {
      const chunks = await get_file_chunks(file.id);
      if (chunks.length === 0) {
        return {
          success: false,
          tool: "updateFile",
          error: `File "${file.name}" has no content indexed yet.`,
        };
      }
      content = stitchChunks(chunks);
    }

    // Validate instruction
    if (!params.instruction) {
      return {
        success: false,
        tool: "updateFile",
        error: "No edit instruction provided. Please describe what changes you want to make.",
      };
    }

    // Build the user message with file content and instruction
    const lines = content.split('\n');
    const numberedContent = lines
      .map((line, i) => `${String(i + 1).padStart(4, ' ')} | ${line}`)
      .join('\n');

    let userMessageContent = `File: ${file.name}
Total lines: ${lines.length}

--- FILE CONTENT (with line numbers) ---
${numberedContent}
--- END FILE CONTENT ---

Edit instruction: ${params.instruction}`;

    // Add selection context if provided
    if (params.selectionContext) {
      userMessageContent += `

SELECTION CONTEXT (focus your changes here):
- Selected lines: ${params.selectionContext.startLine}-${params.selectionContext.endLine}
- Selected text:
\`\`\`
${params.selectionContext.selectedText}
\`\`\``;
    }

    // Call LLM with chain-of-thought prompt
    const response = await chatCompletion({
      messages: [
        { role: "system", content: UPDATEFILE_COT_PROMPT },
        { role: "user", content: userMessageContent },
      ],
      temperature: 0.3,
      maxTokens: 8000,
    });

    // Parse the JSON response
    let parsed: { reasoning: string; affectedLines: string; diff: string };
    try {
      // Clean up response - remove markdown code blocks if present
      let responseText = response.content.trim();
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        responseText = jsonMatch[1].trim();
      }
      parsed = JSON.parse(responseText);
    } catch (parseError) {
      return {
        success: false,
        tool: "updateFile",
        error: `Failed to parse LLM response as JSON. Response: ${response.content.slice(0, 200)}...`,
      };
    }

    // Validate parsed response
    if (!parsed.diff) {
      return {
        success: false,
        tool: "updateFile",
        error: `LLM did not provide a diff. Reasoning: ${parsed.reasoning || 'No reasoning provided'}`,
      };
    }

    // Apply the unified diff
    const diffResult = applyUnifiedDiff(content, parsed.diff);

    if (!diffResult.success) {
      return {
        success: false,
        tool: "updateFile",
        error: `Failed to apply diff: ${diffResult.error}. You may need to rephrase your instruction.`,
      };
    }

    const newFullContent = diffResult.newContent;

    // Generate visual diff lines for preview
    const diffLines = generateDiffLines(content, newFullContent);

    // Create preview
    const previewId = crypto.randomUUID();
    const preview: UpdateFilePreview = {
      previewId,
      fileId: file.id,
      fileName: file.name,
      fileType: file.type as "md" | "docx",
      reasoning: parsed.reasoning,
      originalFullContent: content,
      newFullContent,
      diffLines,
      unifiedDiff: parsed.diff,
      createdAt: new Date(),
    };

    // Store preview for later confirmation
    pendingPreviews.set(previewId, preview);

    // Format diff for display
    const diffDisplay = diffLines
      .filter((line) => line.type !== "unchanged")
      .slice(0, 20) // Limit display
      .map((line) => {
        const prefix = line.type === "added" ? "+" : "-";
        return `${prefix} ${line.content}`;
      })
      .join("\n");

    const truncatedNote =
      diffLines.filter((l) => l.type !== "unchanged").length > 20
        ? "\n\n_[Diff truncated - showing first 20 changes]_"
        : "";

    return {
      success: true,
      tool: "updateFile",
      data: `**Preview of changes to "${file.name}"**

**Analysis:** ${parsed.reasoning}
**Affected lines:** ${parsed.affectedLines}

\`\`\`diff
${diffDisplay}
\`\`\`${truncatedNote}

To apply these changes, confirm the update. To cancel, dismiss this preview.`,
      metadata: {
        fileName: file.name,
        fileId: file.id,
        truncated: false,
      },
      preview,
    };
  } catch (error) {
    return {
      success: false,
      tool: "updateFile",
      error:
        error instanceof Error
          ? error.message
          : "Failed to prepare file update",
    };
  }
}

/**
 * Get a pending preview by ID
 */
export function getPendingPreview(
  previewId: string,
): UpdateFilePreview | undefined {
  return pendingPreviews.get(previewId);
}

/**
 * Remove a pending preview (after apply or cancel)
 */
export function removePendingPreview(previewId: string): void {
  pendingPreviews.delete(previewId);
}

/**
 * Apply a file update from a confirmed preview
 * Commits changes to the database and re-indexes the file
 * Uses shared reindexFile() function from projectService
 */
export async function applyFileUpdate(
  previewId: string,
): Promise<UpdateFileResult> {
  const preview = pendingPreviews.get(previewId);

  if (!preview) {
    return {
      success: false,
      fileId: "",
      fileName: "",
      error: "Preview not found or expired. Please try the update again.",
      reIndexed: false,
    };
  }

  try {
    const { getConnection, flushDatabase } = await import("./database");
    const { reindexFile, getProject } = await import("./projectService");
    const { syncFileToFileSystem } = await import("./syncService");

    const conn = getConnection();

    // Get the file to retrieve projectId
    const file = await getFile(preview.fileId);
    if (!file) {
      return {
        success: false,
        fileId: preview.fileId,
        fileName: preview.fileName,
        error: "File no longer exists.",
        reIndexed: false,
      };
    }

    // Update file content in database
    const escapedContent = preview.newFullContent.replace(/'/g, "''");
    await conn.query(`
      UPDATE files 
      SET content = '${escapedContent}', 
          size = ${preview.newFullContent.length},
          updated_at = CURRENT_TIMESTAMP 
      WHERE id = '${preview.fileId}'
    `);

    await flushDatabase();

    // Re-index the file using shared function
    let reIndexed = false;
    if (preview.fileType === "md" || preview.fileType === "docx") {
      try {
        await reindexFile(
          preview.fileId,
          preview.newFullContent,
          preview.fileType === "md" ? "md" : "txt"
        );
        reIndexed = true;
      } catch (reindexError) {
        console.warn("Failed to re-index file:", reindexError);
        // Don't fail the whole operation if re-indexing fails
      }
    }

    // Sync to file system
    try {
      const project = await getProject(file.projectId);
      if (project && preview.fileType === "md") {
        await syncFileToFileSystem(
          project.name,
          preview.fileName,
          preview.newFullContent,
        );
      }
    } catch (syncError) {
      console.error("Failed to sync file to file system:", syncError);
      // Don't fail the whole operation if sync fails
    }

    // Clean up the preview
    pendingPreviews.delete(previewId);

    return {
      success: true,
      fileId: preview.fileId,
      fileName: preview.fileName,
      reIndexed,
    };
  } catch (error) {
    return {
      success: false,
      fileId: preview.fileId,
      fileName: preview.fileName,
      error:
        error instanceof Error ? error.message : "Failed to apply file update",
      reIndexed: false,
    };
  }
}

// ============================================
// Tool Executor
// ============================================

/**
 * Resolve project ID from params or use default
 * In global mode, some tools need to specify the project
 */
async function resolveProjectForTool(
  defaultProjectId: string | undefined,
  projectParam?: string,
): Promise<string | null> {
  // If project is specified in params, try to resolve it
  if (projectParam) {
    const resolved = await resolveProject(projectParam);
    return resolved?.id || null;
  }

  // Otherwise use the default
  return defaultProjectId || null;
}

/**
 * Execute a tool call
 * @param projectId - Project ID, or undefined for global mode
 */
export async function executeTool(
  projectId: string | undefined,
  call: ToolCall,
  userMessage?: string,
  onProgress?: (status: string) => void,
): Promise<ToolResult> {
  let result: ToolResult;
  const startTime = Date.now();
  
  try {
    result = await executeToolInternal(projectId, call, userMessage, onProgress);
  } catch (error) {
    console.error(`[TOOL:${call.tool}] EXCEPTION:`, error);
    result = {
      success: false,
      tool: call.tool,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
  
  return result;
}

async function executeToolInternal(
  projectId: string | undefined,
  call: ToolCall,
  userMessage?: string,
  onProgress?: (status: string) => void,
): Promise<ToolResult> {
  switch (call.tool) {
    case "read": {
      // In global mode, need to resolve project from params or find file globally
      let targetProjectId = await resolveProjectForTool(
        projectId,
        call.params.project,
      );

      if (!targetProjectId) {
        // Try to find the file globally
        const fileName =
          call.params.fileName || call.params.file || call.params.name;
        if (fileName) {
          const globalResult = await findFileGlobal(fileName);
          if (globalResult) {
            targetProjectId = globalResult.projectId;
          }
        }
      }

      if (!targetProjectId) {
        return {
          success: false,
          tool: "read",
          error:
            "Could not determine which project the file belongs to. Please specify the project.",
        };
      }

      return executeReadTool(targetProjectId, {
        fileId: call.params.fileId || call.params.file_id,
        fileName: call.params.fileName || call.params.file || call.params.name,
        maxChunks: call.params.maxChunks
          ? parseInt(call.params.maxChunks)
          : undefined,
      });
    }

    case "search": {
      const targetProjectId = await resolveProjectForTool(
        projectId,
        call.params.project,
      );

      // Search can work globally if no project specified
      if (!targetProjectId) {
        // Global search
        const results = await searchAllProjects(
          call.params.query || call.params.q || call.params.search,
          call.params.maxResults ? parseInt(call.params.maxResults) : 5,
        );

        if (results.length === 0) {
          return {
            success: true,
            tool: "search",
            data: "No relevant results found for your query across all projects.",
            metadata: { truncated: false },
          };
        }

        const formattedResults = results
          .map((result, index) => {
            const scorePercent = (result.score * 100).toFixed(1);
            return `[Result ${index + 1}] (Project: ${result.projectName}, Source: ${result.fileName}, Score: ${scorePercent}%)\n${result.text}`;
          })
          .join("\n\n---\n\n");

        return {
          success: true,
          tool: "search",
          data: formattedResults,
          metadata: { truncated: false },
        };
      }

      return executeSearchTool(targetProjectId, {
        query: call.params.query || call.params.q || call.params.search,
        maxResults: call.params.maxResults
          ? parseInt(call.params.maxResults)
          : undefined,
      });
    }

    case "summarize": {
      let targetProjectId = await resolveProjectForTool(
        projectId,
        call.params.project,
      );

      if (!targetProjectId) {
        // Try to find the file globally
        const fileName =
          call.params.fileName || call.params.file || call.params.name;
        if (fileName) {
          const globalResult = await findFileGlobal(fileName);
          if (globalResult) {
            targetProjectId = globalResult.projectId;
          }
        }
      }

      if (!targetProjectId) {
        return {
          success: false,
          tool: "summarize",
          error:
            "Could not determine which project the file belongs to. Please specify the project.",
        };
      }

      return executeSummarizeTool(targetProjectId, {
        fileId: call.params.fileId || call.params.file_id,
        fileName: call.params.fileName || call.params.file || call.params.name,
      });
    }

    case "write": {
      const targetProjectId = await resolveProjectForTool(
        projectId,
        call.params.project,
      );

      if (!targetProjectId) {
        return {
          success: false,
          tool: "write",
          error:
            "Project is required. Please specify which project to create the file in.",
        };
      }

      return executeWriteTool(
        targetProjectId,
        {
          format: (call.params.format as DocumentFormat) || "md",
          title: call.params.title || "", // Optional - AI generates if empty for MD files
          content: call.params.content || call.params.text || call.params.note || "",
          path: call.params.path || call.params.directory || "",
        },
        userMessage,
      );
    }

    case "updateFile": {
      let targetProjectId = await resolveProjectForTool(
        projectId,
        call.params.project,
      );

      if (!targetProjectId) {
        // Try to find the file globally
        const fileName =
          call.params.fileName || call.params.file || call.params.name;
        if (fileName) {
          const globalResult = await findFileGlobal(fileName);
          if (globalResult) {
            targetProjectId = globalResult.projectId;
          }
        }
      }

      if (!targetProjectId) {
        return {
          success: false,
          tool: "updateFile",
          error:
            "Could not determine which project the file belongs to. Please specify the project.",
        };
      }

      // Build selection context if provided (might be object or JSON string from planner)
      let selectionContext: SelectionContext | undefined;
      if (call.params.selectionContext) {
        const rawCtx = call.params.selectionContext;
        // Parse if it's a JSON string
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let ctx: any = rawCtx;
        if (typeof rawCtx === 'string') {
          try {
            ctx = JSON.parse(rawCtx);
          } catch {
            // If parsing fails, skip selection context
            ctx = undefined;
          }
        }
        if (ctx && typeof ctx === 'object') {
          selectionContext = {
            filePath: ctx.filePath || "",
            startLine: ctx.startLine || 1,
            endLine: ctx.endLine || 1,
            selectedText: ctx.selectedText || "",
          };
        }
      }

      // The instruction can come from multiple sources
      const instruction = call.params.instruction || userMessage || "";

      return executeUpdateFileTool(
        targetProjectId,
        {
          fileId: call.params.fileId || call.params.file_id,
          fileName:
            call.params.fileName || call.params.file || call.params.name,
          instruction,
          selectionContext,
        },
      );
    }

    // Global tools (work without projectId)
    case "createProject":
      return executeCreateProjectTool({
        name: call.params.name,
        description: call.params.description,
      });

    case "moveFile":
      return executeMoveFileTool({
        file: call.params.file || call.params.fileName,
        fromProject: call.params.fromProject || call.params.from || call.params.project,
        toProject: call.params.toProject || call.params.to,
        directory: call.params.directory || call.params.path,
        newName: call.params.newName || call.params.name || call.params.rename,
      });

    case "deleteFile":
      return executeDeleteFileTool(projectId, {
        file: call.params.file || call.params.fileName,
        project: call.params.project,
      });

    case "deleteProject":
      return executeDeleteProjectTool({
        project: call.params.project || call.params.name,
        confirm: call.params.confirm,
      });

    case "webResearch":
      return executeWebResearchTool({
        query: call.params.query || call.params.q || call.params.search || "",
        maxResults: call.params.maxResults
          ? parseInt(call.params.maxResults)
          : undefined,
        maxChunks: call.params.maxChunks
          ? parseInt(call.params.maxChunks)
          : undefined,
        onProgress,
      });

    default:
      return {
        success: false,
        tool: call.tool,
        error: `Unknown tool: ${call.tool}`,
      };
  }
}

/**
 * Execute all tool calls in a response
 * @param projectId - Project ID, or undefined for global mode
 */
export async function executeToolCalls(
  projectId: string | undefined,
  calls: ToolCall[],
  userMessage?: string,
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];

  for (const call of calls) {
    const result = await executeTool(projectId, call, userMessage);
    results.push(result);
  }

  return results;
}

/**
 * Format tool results for inclusion in LLM context
 */
export function formatToolResults(results: ToolResult[]): string {
  return results
    .map((result) => {
      if (result.success) {
        const header = result.metadata?.fileName
          ? `[File: ${result.metadata.fileName}]`
          : `[Tool: ${result.tool}]`;
        return `${header}\n${result.data}`;
      } else {
        return `[Tool Error: ${result.tool}] ${result.error}`;
      }
    })
    .join("\n\n---\n\n");
}

// ============================================
// Inline Tool Call Parser
// ============================================

/**
 * Result from parsing tool calls in LLM response
 */
export interface ParsedToolCalls {
  /** Text content with tool call blocks removed */
  textContent: string;
  /** Extracted tool calls */
  toolCalls: ToolCall[];
  /** Whether any tool calls were found */
  hasToolCalls: boolean;
}

/**
 * Parse tool calls from LLM response content
 * Looks for ```tool_call blocks and extracts the JSON
 */
export function parseToolCallsFromResponse(content: string): ParsedToolCalls {
  const toolCalls: ToolCall[] = [];

  // Pattern to match ```tool_call ... ``` blocks
  const toolCallPattern = /```tool_call\s*\n?([\s\S]*?)```/g;

  let match;
  while ((match = toolCallPattern.exec(content)) !== null) {
    const jsonStr = match[1].trim();
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.tool && typeof parsed.tool === "string") {
        toolCalls.push({
          tool: parsed.tool as ToolName,
          params: parsed.params || {},
        });
      }
    } catch {
      // Invalid JSON in tool call block, skip it
    }
  }

  // Remove tool call blocks from content to get clean text
  const textContent = content
    .replace(toolCallPattern, "")
    .replace(/\n{3,}/g, "\n\n") // Clean up excessive newlines
    .trim();

  return {
    textContent,
    toolCalls,
    hasToolCalls: toolCalls.length > 0,
  };
}

// ============================================
// Planner → Executor → Checker Flow
// ============================================

import type {
  ExecutionPlan,
  PlanStep,
  CompletedStep,
  FailedStep,
  ExecutionResult,
  CompletionCheck,
  PlanStepCallback,
  ExecutePlanOptions,
  PlannerFlowState,
} from "../types";

// ============================================
// Auto-Execute Configuration
// ============================================

/**
 * Determine if a plan should auto-execute without user confirmation
 * Based on the complexity assessment from the planner LLM
 * 
 * @param plan - The execution plan to check
 * @returns true if the plan should auto-execute (low complexity)
 */
export function shouldAutoExecutePlan(plan: ExecutionPlan): boolean {
  // Never auto-execute if clarification is needed
  if (plan.needsClarification) {
    return false;
  }

  // Use the LLM's complexity assessment
  return plan.complexity === 'low';
}

// ============================================
// Planner Prompt
// ============================================

const PLANNER_PROMPT = `You are an AI execution planner. Analyze the user's request and create a detailed execution plan.

Before creating the plan, reason through these steps IN ORDER:

STEP 1 - PROJECT CONTEXT CHECK:
- Is a project currently selected (check "Current project ID" below)?
- Did the user specify a project with @project:ProjectName?
- If YES to either → Use that project for all steps, proceed to STEP 3
- If NO to both (Global mode) → Go to STEP 2

STEP 2 - GLOBAL MODE DECISION:
- Is the user explicitly asking to "create a project" or "new project"?
  - YES → First step must be createProject, all following steps use projectId from it, proceed to STEP 3
  - NO → Set needsClarification: true and ask which project to use or if they want to create one. STOP here.

STEP 3 - PLAN THE EXECUTION:
- Break down the request into specific tool calls IN ORDER
- Identify dependencies between steps
- Ensure ALL steps that need a project include projectId in contextNeeded (from current project or createProject)

STEP 4 - VERIFY PROJECT PROPAGATION:
- Confirm every step after project selection/creation has access to the project context
- Mark projectId in providesContext for createProject
- Mark projectId in contextNeeded for all subsequent steps

STEP 5 - ASSESS COMPLEXITY:
Determine if this plan is LOW or HIGH complexity. Default to LOW unless HIGH criteria are clearly met.

LOW complexity (auto-execute without confirmation) - USE THIS WHEN:
- Read-only operations: read, search, summarize (ALWAYS low)
- 1-2 steps with clear instructions
- User specified the file/project names explicitly
- File updates with @selection: reference
- Simple, unambiguous requests

HIGH complexity (requires user confirmation) - ONLY USE WHEN:
- 3+ steps
- Creating NEW files/projects where names must be generated by AI
- Destructive operations (delete)
- Ambiguous requests where you're uncertain what the user wants

Examples:
- "search for meeting notes" → LOW (read-only, 1 step)
- "read my todo list" → LOW (read-only, 1 step)
- "summarize document.md" → LOW (read-only, 1 step)
- "search X and summarize results" → LOW (read-only, 2 steps)
- "update @selection: fix typos" → LOW (clear instruction with selection)
- "create a note about cats" → HIGH (AI must generate filename)
- "reorganize my project structure" → HIGH (ambiguous, multiple files)
- "delete old-file.md" → HIGH (destructive)

Available tools:
- read: Read a file's full content. Params: {file: "filename", project?: "project name"}
- search: Semantic search across documents. Params: {query: "search query", project?: "project name"}
- summarize: Create a summary of a document. Params: {file: "filename", project?: "project name"}
- write: Create a file. AI generates title if not provided and decides directory for all formats. For MD: also formats content. Params: {format: "md"|"pdf"|"docx", content: "content", title?: "title", path?: "directory", project?: "project name"}
- updateFile: Update an existing file. The tool itself analyzes the file and generates precise changes. Params: {file: "filename", instruction: "natural language description of what to change", selectionContext?: {filePath, startLine, endLine, selectedText}}
- createProject: Create a new project. Params: {name: "project name", description?: "description"}
- moveFile: Rename or move a file. Params: {file: "filename", newName?: "new-name.md" (for rename), directory?: "target/dir" (for move within project), fromProject?: "source", toProject?: "destination" (for cross-project move)}
- deleteFile: Delete a file. Params: {file: "filename", project?: "project name"}
- deleteProject: Delete a project. Params: {project: "project name", confirm: "yes"}
- webResearch: Search the web for information. Params: {query: "search query", maxResults?: number}

User message references:
- @file:path/to/file.md - References a specific file in the project
- @project:ProjectName - References a specific project
- @selection:filepath:startLine-endLine followed by code block - User-selected text from the editor with precise location
  Example: @selection:notes/meeting.md:15-22 followed by the selected text in a code block

IMPORTANT RULES:
1. If a step needs data from a previous step, mark it in dependsOn and contextNeeded
2. For content generation (write), the Executor will generate content based on accumulated context
3. **Current File Context**: When user says "this file", "this document", "here", "the file", "current file" etc.:
   - Check the "Currently open file in editor" section in the context
   - Use that file's name/path for the operation
   - If no file is open, ask for clarification about which file they mean
4. **Selection Edit Behavior**: When the user includes @selection: with a file path and asks to edit/change/modify:
   - You MUST use the "updateFile" tool to edit that specific section
   - Pass the user's request as the "instruction" parameter
   - Include selectionContext with the file path, line numbers, and selected text
   - Do NOT create a new file when a selection reference is provided
   - Example: @selection:notes/doc.md:10-15 + "rephrase this" → updateFile with instruction="rephrase this" and selectionContext from the selection

Context propagation (CRITICAL):
- projectId: When createProject runs first, ALL subsequent steps MUST include "projectId" in contextNeeded
- webResearchResults: write step needs this from webResearch step
- searchResults: write step needs this from search step

Respond ONLY with a JSON object:
{
  "summary": "Brief description of what will be done",
  "needsClarification": false,
  "clarificationQuestion": null,
  "estimatedDuration": "~X seconds",
  "complexity": "low" | "high",
  "complexityReason": "Brief explanation of why this complexity level",
  "steps": [
    {
      "id": "step-1",
      "tool": "toolName",
      "params": {"key": "value"},
      "description": "Human readable description",
      "dependsOn": [],
      "contextNeeded": [],
      "providesContext": ["contextKey1", "contextKey2"]
    }
  ]
}

If clarification is needed:
{
  "summary": "",
  "needsClarification": true,
  "clarificationQuestion": "What specific question to ask the user?",
  "complexity": "high",
  "complexityReason": "Clarification needed",
  "steps": []
}`;

// ============================================
// Checker Prompt
// ============================================

const CHECKER_PROMPT = `You are a completion checker. Your job is to verify if the user's original request has been fully satisfied.

Compare the original request against the execution results and determine:
1. What tasks were requested?
2. What tasks were completed successfully?
3. What tasks are still missing or failed?
4. Should the system re-plan to complete missing tasks?

Respond ONLY with a JSON object:
{
  "isComplete": boolean,
  "completedTasks": ["task 1 description", "task 2 description"],
  "missingTasks": ["missing task description"],
  "shouldReplan": boolean,
  "replanContext": "Context for replanning if needed",
  "reasoning": "Brief explanation of your assessment"
}

Rules:
- isComplete = true only if ALL user requests are satisfied
- shouldReplan = true if there are missing tasks that can potentially be completed
- shouldReplan = false if the missing tasks are due to user error or impossible requests
- Be strict: if user asked for 3 files and only 2 were created, isComplete = false`;

// ============================================
// Planner Implementation
// ============================================

/**
 * Create an execution plan from a user message
 */
/**
 * Build runtime context for the planner (date, time, platform, etc.)
 */
function buildRuntimeContext(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  const timeStr = now.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: true 
  });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  
  // Detect platform
  const userAgent = navigator.userAgent;
  let platform = 'Unknown';
  if (userAgent.includes('Win')) platform = 'Windows';
  else if (userAgent.includes('Mac')) platform = 'macOS';
  else if (userAgent.includes('Linux')) platform = 'Linux';
  else if (userAgent.includes('Android')) platform = 'Android';
  else if (userAgent.includes('iOS') || userAgent.includes('iPhone') || userAgent.includes('iPad')) platform = 'iOS';
  
  // Get user's locale/language
  const locale = navigator.language || 'en-US';

  return `\n\nContext:
- Date: ${dateStr}
- Time: ${timeStr} (${timezone})
- Platform: ${platform}
- Locale: ${locale}`;
}

/**
 * Context about the currently open file in the editor
 */
interface CurrentFileContext {
  fileName: string;
  filePath: string;
  fileType: string;
  projectId?: string;
  projectName?: string;
}

export async function createExecutionPlan(
  userMessage: string,
  projectId: string | undefined,
  projectFiles: string[],
  conversationContext?: string,
  replanContext?: string,
  workingContext?: WorkingContext,
  currentFileContext?: CurrentFileContext,
  onReasoningChunk?: (chunk: string) => void,
): Promise<ExecutionPlan> {
  const runtimeContext = buildRuntimeContext();

  const filesContext =
    projectFiles.length > 0
      ? `\n\nAvailable files in project: ${projectFiles.join(", ")}`
      : "\n\nNo files uploaded yet.";

  const contextInfo = conversationContext
    ? `\n\nRecent conversation context:\n${conversationContext}`
    : "";

  const replanInfo = replanContext
    ? `\n\n[REPLANNING] Previous execution was incomplete. Context:\n${replanContext}`
    : "";

  const projectInfo = projectId
    ? `\n\nCurrent project ID: ${projectId}`
    : "\n\nGlobal mode: No specific project selected. User may want to create a project first.";

  // Working context from recent creations in this session (global mode only)
  const workingContextInfo = !projectId && workingContext?.projectId
    ? `\n\nWorking context (from earlier in conversation):
- Active project: "${workingContext.projectName}" (id: ${workingContext.projectId})
- Use this project for operations unless user specifies otherwise
${workingContext.recentFiles.length > 0 
  ? `- Recently created files: ${workingContext.recentFiles.map(f => f.fileName).join(', ')}`
  : ''}`
    : "";

  // Current file context - what the user is looking at in the editor
  const currentFileInfo = currentFileContext
    ? `\n\nCurrently open file in editor:
- File name: "${currentFileContext.fileName}"
- File path: ${currentFileContext.filePath}
- File type: ${currentFileContext.fileType}
${currentFileContext.projectName ? `- Project: "${currentFileContext.projectName}"` : ''}
(When user says "this file", "here", "this document", etc. - they mean this file)`
    : "\n\nNo file currently open in editor.";

  const systemContent = PLANNER_PROMPT + runtimeContext + filesContext + projectInfo + workingContextInfo + currentFileInfo + contextInfo + replanInfo;
  
  // Build conversation messages - will be extended if retries are needed
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemContent },
    { role: "user", content: userMessage },
  ];

  const MAX_RETRY_ATTEMPTS = 2;
  let lastResponse = "";
  let lastError = "";

  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    let response;
    if (onReasoningChunk) {
      // Use streaming to capture reasoning tokens for UI display
      response = await chatCompletionStreaming(
        { messages, temperature: 0, maxTokens: 2000 },
        (_chunk: string, _done: boolean, type?: 'content' | 'reasoning') => {
          if (type === 'reasoning' && _chunk) {
            onReasoningChunk(_chunk);
          }
          // Content chunks are accumulated by chatCompletionStreaming internally
        }
      );
    } else {
      response = await chatCompletion({
        messages,
        temperature: 0,
        maxTokens: 2000,
      });
    }

    lastResponse = response.content.trim();

    try {
      let jsonStr = lastResponse;
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      const parsed = JSON.parse(jsonStr);

      // Debug: log what the LLM returned for complexity
      console.log('[Planner] LLM returned complexity:', parsed.complexity, '| reason:', parsed.complexityReason);
      if (attempt > 0) {
        console.log(`[Planner] Successfully parsed JSON on retry attempt ${attempt}`);
      }

      const plan: ExecutionPlan = {
        id: crypto.randomUUID(),
        summary: parsed.summary || "",
        steps: (parsed.steps || []).map((step: Partial<PlanStep>, index: number) => ({
          id: step.id || `step-${index + 1}`,
          tool: step.tool as ToolName,
          params: step.params || {},
          description: step.description || `Execute ${step.tool}`,
          dependsOn: step.dependsOn || [],
          contextNeeded: step.contextNeeded || [],
          providesContext: step.providesContext || [],
          status: "pending" as const,
        })),
        needsClarification: parsed.needsClarification || false,
        clarificationQuestion: parsed.clarificationQuestion,
        estimatedDuration: parsed.estimatedDuration,
        originalQuery: userMessage,
        createdAt: new Date(),
        complexity: parsed.complexity || 'high', // Default to high if not specified for safety
        complexityReason: parsed.complexityReason,
      };

      console.log('[Planner] Final plan complexity:', plan.complexity, '| steps:', plan.steps.length);

      return plan;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.warn(`[Planner] JSON parse failed (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS + 1}):`, lastError);

      // If we haven't exhausted retries, ask the LLM to fix its response
      if (attempt < MAX_RETRY_ATTEMPTS) {
        // Add the malformed response and correction request to the conversation
        messages.push({ role: "assistant", content: lastResponse });
        messages.push({
          role: "user",
          content: `Your response could not be parsed as valid JSON. Error: "${lastError}"

Please respond ONLY with a valid JSON object in the exact format specified. Do not include any text before or after the JSON. Make sure all strings are properly quoted, all brackets are balanced, and there are no trailing commas.

Remember the required format:
{
  "summary": "...",
  "needsClarification": false,
  "clarificationQuestion": null,
  "estimatedDuration": "...",
  "complexity": "low" | "high",
  "complexityReason": "...",
  "steps": [...]
}`,
        });
        console.log(`[Planner] Requesting JSON correction (attempt ${attempt + 2})`);
      }
    }
  }

  // All retries exhausted - return a plan with clarification needed
  console.error('[Planner] All JSON parse attempts failed. Last response:', lastResponse);
  return {
    id: crypto.randomUUID(),
    summary: "",
    steps: [],
    needsClarification: true,
    clarificationQuestion: "I had trouble understanding that request. This may be due to the local model not supporting structured output well. Please try rephrasing, or consider using a model better suited for tool use (e.g., Mistral Instruct, Llama 3 Instruct, or Functionary).",
    originalQuery: userMessage,
    createdAt: new Date(),
    complexity: 'high' as const,
    complexityReason: "Parse error - defaulting to high complexity",
  };
}

// ============================================
// Executor Implementation
// ============================================

/**
 * Tool icon mapping for UI
 */
export function getToolIcon(tool: ToolName): string {
  const icons: Record<ToolName, string> = {
    read: "📖",
    search: "🔍",
    summarize: "📋",
    write: "📝",
    updateFile: "✏️",
    createProject: "📁",
    moveFile: "📦",
    deleteFile: "🗑️",
    deleteProject: "🗑️",
    webResearch: "🌐",
  };
  return icons[tool] || "⚙️";
}

/**
 * Extract context from a tool result for subsequent steps
 */
function extractContextFromResult(
  tool: ToolName,
  result: ToolResult,
  params: Record<string, string>,
): Record<string, unknown> {
  const context: Record<string, unknown> = {};

  if (!result.success) {
    return context;
  }

  switch (tool) {
    case "webResearch":
      context.webResearchResults = result.data;
      context.webResearchSources = result.metadata;
      break;

    case "createProject":
      context.projectId = result.metadata?.projectId;
      context.projectName = result.metadata?.projectName || params.name;
      break;

    case "write":
      context.lastCreatedFileId = result.metadata?.fileId;
      context.lastCreatedFileName = result.metadata?.fileName;
      context.lastCreatedProjectId = result.metadata?.projectId;
      break;

    case "read":
      context.fileContent = result.data;
      context.readFileName = result.metadata?.fileName;
      break;

    case "search":
      context.searchResults = result.data;
      break;

    case "summarize":
      context.summary = result.data;
      context.summarizedFileName = result.metadata?.fileName;
      break;

    default:
      // Store generic result data
      if (result.data) {
        context[`${tool}Result`] = result.data;
      }
      if (result.metadata) {
        Object.assign(context, result.metadata);
      }
  }

  return context;
}

/**
 * Enrich step params with context from previous steps
 */
function enrichParamsWithContext(
  step: PlanStep,
  accumulatedContext: Record<string, unknown>,
): Record<string, string> {
  const enrichedParams = { ...step.params };

  // If step needs projectId and we have it from context
  if (
    !enrichedParams.project &&
    !enrichedParams.projectId &&
    accumulatedContext.projectId
  ) {
    enrichedParams.project = String(accumulatedContext.projectId);
  }

  // If step needs content from web research - always set _webContext when contextNeeded declares it
  // This overrides any placeholder content the Planner may have set
  if (
    step.contextNeeded?.includes("webResearchResults") &&
    accumulatedContext.webResearchResults
  ) {
    // For write, we'll generate content based on web research
    enrichedParams._webContext = String(accumulatedContext.webResearchResults);
    // Mark that we should override placeholder content
    enrichedParams._shouldGenerateFromContext = "true";
  }

  // If step needs search results
  if (
    step.contextNeeded?.includes("searchResults") &&
    accumulatedContext.searchResults
  ) {
    enrichedParams._searchContext = String(accumulatedContext.searchResults);
  }

  return enrichedParams;
}

/**
 * Generate content for write tool when content needs to be created
 * based on accumulated context
 */
async function generateContentFromContext(
  step: PlanStep,
  accumulatedContext: Record<string, unknown>,
  originalQuery: string,
): Promise<string> {
  // Build context for content generation
  const contextParts: string[] = [];

  if (accumulatedContext.webResearchResults) {
    contextParts.push(`Web Research Results:\n${accumulatedContext.webResearchResults}`);
  }

  if (accumulatedContext.searchResults) {
    contextParts.push(`Search Results:\n${accumulatedContext.searchResults}`);
  }

  if (accumulatedContext.fileContent) {
    contextParts.push(`File Content:\n${accumulatedContext.fileContent}`);
  }

  if (accumulatedContext.summary) {
    contextParts.push(`Summary:\n${accumulatedContext.summary}`);
  }

  if (contextParts.length === 0) {
    // No context to generate from, use the step description
    return step.params.content || step.description;
  }

  const response = await chatCompletion({
    messages: [
      {
        role: "system",
        content: `You are a content generator. Based on the provided context, create content for a ${step.tool === "write" ? "document" : "note"}.
        
The content should be well-structured, use appropriate markdown formatting, and be relevant to the user's original request.

Original user request: ${originalQuery}
Step description: ${step.description}
Title: ${step.params.title || "Untitled"}

Generate ONLY the content, no explanations or meta-commentary.`,
      },
      {
        role: "user",
        content: contextParts.join("\n\n---\n\n"),
      },
    ],
    temperature: 0.7,
    maxTokens: 4000,
  });

  return response.content;
}

// Track web research progress state for generating unique child IDs
const webResearchChildState: Map<string, { 
  childIndex: number; 
  childIds: Map<string, string>;
  lastFetchBatch: string | null;
  processedPages: Set<number>;
}> = new Map();

/**
 * Parse web research progress messages into child execution entries
 * Returns an array of updates (can be multiple when completing previous + starting new)
 * 
 * Progress messages follow patterns like:
 * - "Checking cache..."
 * - "Searching the web..."
 * - "Found 5 results, fetching pages..."
 * - "Fetching pages 1-3 of 5..."
 * - "Processing page 1/3: Title..."
 * - "Analyzing content (2/5)..."
 * - "Finding relevant content..."
 * - "Done"
 */
function parseWebResearchProgress(stepId: string, status: string): import("../types").ToolExecutionChild[] {
  // Initialize state for this step if needed
  if (!webResearchChildState.has(stepId)) {
    webResearchChildState.set(stepId, { 
      childIndex: 0, 
      childIds: new Map(),
      lastFetchBatch: null,
      processedPages: new Set(),
    });
  }
  const state = webResearchChildState.get(stepId)!;
  const updates: import("../types").ToolExecutionChild[] = [];
  
  // Skip simple status messages that don't warrant a child entry
  if (status === "Checking cache..." || status === "Found cached results" || status === "Error") {
    return updates;
  }
  
  // Searching the web
  if (status === "Searching the web...") {
    const childId = `${stepId}-search`;
    state.childIds.set("search", childId);
    updates.push({
      id: childId,
      label: "Searching...",
      status: "running",
      timestamp: new Date(),
    });
    return updates;
  }
  
  // Found results - update search child to completed
  const foundMatch = status.match(/^Found (\d+) results/);
  if (foundMatch) {
    const searchChildId = state.childIds.get("search");
    if (searchChildId) {
      updates.push({
        id: searchChildId,
        label: `Found ${foundMatch[1]} results`,
        status: "completed",
        timestamp: new Date(),
      });
    }
    return updates;
  }
  
  // Fetching pages - mark previous fetch batch as complete first
  const fetchMatch = status.match(/^Fetching pages? (\d+)(?:-(\d+))? of (\d+)/);
  if (fetchMatch) {
    // Mark previous fetch batch as complete if exists
    if (state.lastFetchBatch) {
      const prevFetchId = state.childIds.get(state.lastFetchBatch);
      if (prevFetchId) {
        const prevLabel = state.lastFetchBatch.replace("fetch-", "Pages ");
        updates.push({
          id: prevFetchId,
          label: prevLabel,
          status: "completed",
          timestamp: new Date(),
        });
      }
    }
    
    const start = parseInt(fetchMatch[1]);
    const end = fetchMatch[2] ? parseInt(fetchMatch[2]) : start;
    const childId = `${stepId}-fetch-${start}`;
    const batchKey = `fetch-${start}-${end}`;
    const label = fetchMatch[2] 
      ? `Fetching pages ${fetchMatch[1]}-${fetchMatch[2]}...`
      : `Fetching page ${start}...`;
    
    state.childIds.set(batchKey, childId);
    state.lastFetchBatch = batchKey;
    
    updates.push({
      id: childId,
      label,
      status: "running",
      timestamp: new Date(),
    });
    return updates;
  }
  
  // Processing pages - mark last fetch batch as complete
  const processingMatch = status.match(/^Processing (\d+) pages/);
  if (processingMatch) {
    // Mark last fetch batch as complete
    if (state.lastFetchBatch) {
      const prevFetchId = state.childIds.get(state.lastFetchBatch);
      if (prevFetchId) {
        const match = state.lastFetchBatch.match(/fetch-(\d+)-(\d+)/);
        const label = match ? `Pages ${match[1]}-${match[2]}` : "Pages fetched";
        updates.push({
          id: prevFetchId,
          label,
          status: "completed",
          timestamp: new Date(),
        });
      }
      state.lastFetchBatch = null;
    }
    return updates;
  }
  
  // Processing page - add page title as child
  const processMatch = status.match(/^Processing page (\d+)\/(\d+): (.+)\.\.\.$/);
  if (processMatch) {
    const pageNum = parseInt(processMatch[1]);
    const title = processMatch[3].substring(0, 25) + (processMatch[3].length > 25 ? "..." : "");
    const childId = `${stepId}-page-${pageNum}`;
    
    // Mark previous page as complete if exists
    if (state.processedPages.size > 0) {
      const prevPageNum = Math.max(...state.processedPages);
      const prevPageId = state.childIds.get(`page-${prevPageNum}`);
      if (prevPageId) {
        updates.push({
          id: prevPageId,
          label: state.childIds.get(`page-${prevPageNum}-title`) || `Page ${prevPageNum}`,
          status: "completed",
          timestamp: new Date(),
        });
      }
    }
    
    state.childIds.set(`page-${pageNum}`, childId);
    state.childIds.set(`page-${pageNum}-title`, title);
    state.processedPages.add(pageNum);
    
    updates.push({
      id: childId,
      label: title,
      status: "running",
      timestamp: new Date(),
    });
    return updates;
  }
  
  // Analyzing content - mark last page as complete
  const analyzeMatch = status.match(/^Analyzing content \((\d+)\/(\d+)\)/);
  if (analyzeMatch) {
    // Mark last page as complete
    if (state.processedPages.size > 0) {
      const lastPageNum = Math.max(...state.processedPages);
      const lastPageId = state.childIds.get(`page-${lastPageNum}`);
      if (lastPageId) {
        updates.push({
          id: lastPageId,
          label: state.childIds.get(`page-${lastPageNum}-title`) || `Page ${lastPageNum}`,
          status: "completed",
          timestamp: new Date(),
        });
      }
    }
    return updates;
  }
  
  // Finding relevant content
  if (status === "Finding relevant content...") {
    const childId = `${stepId}-finding`;
    state.childIds.set("finding", childId);
    updates.push({
      id: childId,
      label: "Finding relevant content...",
      status: "running",
      timestamp: new Date(),
    });
    return updates;
  }
  
  // Done - mark finding as complete
  if (status === "Done") {
    const findingId = state.childIds.get("finding");
    if (findingId) {
      updates.push({
        id: findingId,
        label: "Processing complete",
        status: "completed",
        timestamp: new Date(),
      });
    }
    // Clean up state
    webResearchChildState.delete(stepId);
    return updates;
  }
  
  return updates;
}

/**
 * Execute a plan step by step with context passing
 */
export async function executePlan(
  plan: ExecutionPlan,
  projectId: string | undefined,
  options: ExecutePlanOptions = {},
): Promise<ExecutionResult> {
  const { onStepUpdate, onStreamChunk, stopOnFailure = false, onToolChildUpdate } = options;

  const startTime = Date.now();
  const completedSteps: CompletedStep[] = [];
  const failedSteps: FailedStep[] = [];
  const accumulatedContext: Record<string, unknown> = {
    projectId,
  };

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const stepStartTime = Date.now();

    // Update step status to running
    step.status = "running";
    onStepUpdate?.(step, i, plan.steps.length);

    // Check dependencies
    const unmetDependencies = (step.dependsOn || []).filter(
      (depId) => !completedSteps.some((cs) => cs.stepId === depId),
    );

    if (unmetDependencies.length > 0) {
      // Check if dependencies failed
      const failedDeps = unmetDependencies.filter((depId) =>
        failedSteps.some((fs) => fs.stepId === depId),
      );

      if (failedDeps.length > 0) {
        step.status = "skipped";
        step.error = `Skipped due to failed dependencies: ${failedDeps.join(", ")}`;
        onStepUpdate?.(step, i, plan.steps.length);
        
        failedSteps.push({
          stepId: step.id,
          tool: step.tool,
          error: step.error,
          recoverable: false,
        });
        continue;
      }
    }

    try {
      // Enrich params with context
      const enrichedParams = enrichParamsWithContext(step, accumulatedContext);

      // For write, generate content if needed
      // Generate content when:
      // 1. No content exists, OR
      // 2. Step explicitly needs context (contextNeeded was set, so _shouldGenerateFromContext is true)
      const hasContextToUse = enrichedParams._webContext || enrichedParams._searchContext;
      const shouldGenerateContent = enrichedParams._shouldGenerateFromContext === "true";
      
      if (
        step.tool === "write" &&
        hasContextToUse &&
        (!enrichedParams.content || shouldGenerateContent)
      ) {
        enrichedParams.content = await generateContentFromContext(
          step,
          accumulatedContext,
          plan.originalQuery,
        );
        // Clean up internal params
        delete enrichedParams._webContext;
        delete enrichedParams._searchContext;
        delete enrichedParams._shouldGenerateFromContext;
      }

      // Resolve project ID for the step
      // Priority: 1) enrichedParams.project (resolved), 2) accumulatedContext.projectId, 3) original projectId
      let stepProjectId = projectId;
      
      if (enrichedParams.project) {
        // Could be a project ID or name, try to resolve
        const resolvedId = await resolveProjectForTool(projectId, enrichedParams.project);
        if (resolvedId) {
          stepProjectId = resolvedId;
        }
      }
      
      // Fall back to accumulatedContext.projectId if stepProjectId is still undefined
      if (!stepProjectId && accumulatedContext.projectId && typeof accumulatedContext.projectId === "string") {
        stepProjectId = accumulatedContext.projectId;
      }

      // Execute the tool
      const toolCall: ToolCall = {
        tool: step.tool,
        params: enrichedParams,
      };

      // Create progress callback that updates step detail
      // For web research, also parse progress to create child entries
      const progressCallback = (status: string) => {
        step.detail = status;
        onStepUpdate?.(step, i, plan.steps.length);
        
        // Parse web research progress to create child entries
        if (step.tool === "webResearch" && onToolChildUpdate) {
          const childUpdates = parseWebResearchProgress(step.id, status);
          for (const child of childUpdates) {
            onToolChildUpdate(step.id, child);
          }
        }
      };

      const result = await executeTool(stepProjectId, toolCall, plan.originalQuery, progressCallback);

      if (result.success) {
        step.status = "completed";
        // Propagate persistedChanges flag to step for UI to check
        step.persistedChanges = result.persistedChanges;
        
        // Extract context for subsequent steps
        const extractedContext = extractContextFromResult(step.tool, result, enrichedParams);
        Object.assign(accumulatedContext, extractedContext);

        completedSteps.push({
          stepId: step.id,
          tool: step.tool,
          result,
          extractedContext,
          durationMs: Date.now() - stepStartTime,
        });

        // Emit step result for streaming display
        options.onStepResult?.(step.id, step.tool, result.data);
      } else {
        step.status = "failed";
        step.error = result.error;

        failedSteps.push({
          stepId: step.id,
          tool: step.tool,
          error: result.error || "Unknown error",
          recoverable: false,
        });

        // Check if this failure would block subsequent steps
        // Stop execution if:
        // 1. This step provides context that later steps need
        // 2. Later steps have explicit dependencies on this step
        // 3. stopOnFailure is explicitly requested
        const providesContext = step.providesContext || [];
        const hasLaterDependents = plan.steps.slice(i + 1).some(
          (laterStep) =>
            laterStep.dependsOn?.includes(step.id) ||
            laterStep.contextNeeded?.some((ctx) => providesContext.includes(ctx))
        );

        if (stopOnFailure || hasLaterDependents) {
          onStepUpdate?.(step, i, plan.steps.length);
          break;
        }
      }
    } catch (error) {
      step.status = "failed";
      step.error = error instanceof Error ? error.message : "Unknown error";

      failedSteps.push({
        stepId: step.id,
        tool: step.tool,
        error: step.error,
        recoverable: false,
      });

      console.error("[EXECUTOR] Step error:", error);

      // Always stop on exceptions - they are unrecoverable
      onStepUpdate?.(step, i, plan.steps.length);
      break;
    }

    onStepUpdate?.(step, i, plan.steps.length);
  }

  // Generate final response
  const finalResponse = generateFinalResponse(plan, completedSteps, failedSteps, accumulatedContext);

  const executionResult: ExecutionResult = {
    planId: plan.id,
    completedSteps,
    failedSteps,
    accumulatedContext,
    finalResponse,
    totalDurationMs: Date.now() - startTime,
    allSuccessful: failedSteps.length === 0,
  };

  return executionResult;
}

/**
 * Generate a final response summarizing the execution
 */
function generateFinalResponse(
  plan: ExecutionPlan,
  completedSteps: CompletedStep[],
  failedSteps: FailedStep[],
  _context: Record<string, unknown>,
): string {
  const parts: string[] = [];

  // Check if execution stopped early due to a blocking failure
  const totalSteps = plan.steps.length;
  const processedSteps = completedSteps.length + failedSteps.length;
  const stoppedEarly = processedSteps < totalSteps && failedSteps.length > 0;

  // If we have failures, show them prominently first
  if (failedSteps.length > 0) {
    const lastFailure = failedSteps[failedSteps.length - 1];
    const failedStep = plan.steps.find((s) => s.id === lastFailure.stepId);
    
    if (stoppedEarly) {
      parts.push("⚠️ **Execution stopped due to an error:**");
      parts.push("");
      parts.push(`**${failedStep?.description || lastFailure.tool}** failed:`);
      parts.push(`> ${lastFailure.error}`);
      parts.push("");
      
      // Show which steps were skipped
      const skippedSteps = plan.steps.filter(
        (s) => !completedSteps.some((cs) => cs.stepId === s.id) && 
               !failedSteps.some((fs) => fs.stepId === s.id)
      );
      if (skippedSteps.length > 0) {
        parts.push("**Skipped steps:**");
        for (const step of skippedSteps) {
          parts.push(`- ⏭️ ${step.description}`);
        }
        parts.push("");
      }
    } else {
      parts.push("**Failed:**");
      for (const step of failedSteps) {
        const originalStep = plan.steps.find((s) => s.id === step.stepId);
        parts.push(`- ❌ ${originalStep?.description || step.tool}: ${step.error}`);
      }
      parts.push("");
    }
  }

  // Show completed steps
  if (completedSteps.length > 0) {
    parts.push("**Completed:**");
    for (const step of completedSteps) {
      const originalStep = plan.steps.find((s) => s.id === step.stepId);
      const icon = getToolIcon(step.tool);
      parts.push(`- ${icon} ${originalStep?.description || step.tool}`);

      // Add relevant details
      if (step.result.metadata?.fileName) {
        parts.push(`  → Created: ${step.result.metadata.fileName}`);
      }
      if (step.result.metadata?.projectName && step.tool === "createProject") {
        const wasExisting = step.result.metadata?.wasExisting;
        parts.push(`  → ${wasExisting ? "Using" : "Created"}: ${step.result.metadata.projectName}`);
      }
    }
  }

  // Success message only if all steps completed
  if (completedSteps.length === totalSteps && failedSteps.length === 0) {
    parts.push("");
    parts.push("✅ All tasks completed successfully!");
  }

  return parts.join("\n");
}

// ============================================
// Checker Implementation
// ============================================

/**
 * Check if the execution completed all user requests
 */
export async function checkCompletion(
  originalQuery: string,
  executionResult: ExecutionResult,
  plan: ExecutionPlan,
): Promise<CompletionCheck> {
  // Build a summary of what was executed
  const executedSummary = plan.steps.map((step) => {
    const completed = executionResult.completedSteps.find((cs) => cs.stepId === step.id);
    const failed = executionResult.failedSteps.find((fs) => fs.stepId === step.id);

    if (completed) {
      return `✓ ${step.description}: SUCCESS`;
    } else if (failed) {
      return `✗ ${step.description}: FAILED - ${failed.error}`;
    } else {
      return `- ${step.description}: NOT EXECUTED`;
    }
  }).join("\n");

  const response = await chatCompletion({
    messages: [
      {
        role: "system",
        content: CHECKER_PROMPT,
      },
      {
      role: "user",
        content: `Original user request:
${originalQuery}

Planned steps:
${plan.summary}

Execution results:
${executedSummary}

Context accumulated:
${JSON.stringify(Object.keys(executionResult.accumulatedContext))}

Did we fully satisfy the user's request?`,
      },
    ],
    temperature: 0,
    maxTokens: 1000,
  });

  try {
    let jsonStr = response.content.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    return {
      isComplete: parsed.isComplete ?? false,
      completedTasks: parsed.completedTasks || [],
      missingTasks: parsed.missingTasks || [],
      shouldReplan: parsed.shouldReplan ?? false,
      replanContext: parsed.replanContext,
      reasoning: parsed.reasoning || "",
    };
  } catch (error) {
    console.error("[CHECKER] Failed to parse check result:", error);
    
    // Default to complete if we can't parse (avoid infinite loops)
    return {
      isComplete: executionResult.allSuccessful,
      completedTasks: executionResult.completedSteps.map((s) => s.tool),
      missingTasks: executionResult.failedSteps.map((s) => s.tool),
      shouldReplan: false,
      reasoning: "Could not parse completion check result",
    };
  }
}

// ============================================
// Main Planner Flow Orchestrator
// ============================================

import type { ToolLogEntry, ToolLogStatus } from "../types";

/**
 * Result from the full planner flow
 */
export interface PlannerFlowResult {
  /** Final state of the flow */
  state: PlannerFlowState;
  /** Final response to show user (LLM interpretation) */
  response: string;
  /** All tool results from execution */
  toolResults: ToolResult[];
  /** Tool execution logs for UI display */
  toolLogs: ToolLogEntry[];
  /** Formatted tool outputs (for display in chat) */
  formattedToolOutputs: string[];
  /** Whether the flow completed successfully */
  success: boolean;
  /** Attachments produced by tools (e.g. summaries) */
  attachments?: ToolAttachment[];
}

/**
 * Create a tool log entry for a step
 */
function createToolLogEntry(
  step: PlanStep,
  status: ToolLogStatus,
  result?: ToolResult,
): ToolLogEntry {
  const entry: ToolLogEntry = {
    id: step.id,
    tool: step.tool,
    description: step.description,
    status,
    startTime: new Date(),
  };

  if (result) {
    entry.endTime = new Date();
    if (result.success && result.data) {
      // Create a brief preview (first 200 chars)
      entry.resultPreview = result.data.length > 200
        ? result.data.substring(0, 200) + "..."
        : result.data;
      entry.resultData = result.data;
    } else if (!result.success) {
      entry.error = result.error;
    }
  }

  return entry;
}

/**
 * Format tool outputs for display in chat
 */
function formatToolOutputsForDisplay(
  completedSteps: CompletedStep[],
  plan: ExecutionPlan,
): string[] {
  return completedSteps
    .filter((cs) => cs.result.success && cs.result.data)
    .map((cs) => {
      const step = plan.steps.find((s) => s.id === cs.stepId);
      const icon = getToolIcon(cs.tool);
      const title = step?.description || cs.tool;
      // For steps with attachments, exclude the full content from the LLM interpretation input
      // The attachment will be rendered separately in the UI
      if (cs.result.attachment) {
        return `### ${icon} ${title}\n\n[Attachment: ${cs.result.attachment.title}]`;
      }
      return `### ${icon} ${title}\n\n${cs.result.data}`;
    });
}

/**
 * Generate LLM interpretation of tool results
 */
async function generateInterpretation(
  originalQuery: string,
  toolOutputs: string[],
  onStreamChunk?: LLMStreamCallback,
): Promise<string> {
  if (toolOutputs.length === 0) {
    return "The operation completed, but no output was produced.";
  }

  const systemPrompt = `You are a helpful assistant. Provide a brief, direct response based on the tool execution results.

CRITICAL RULES:
- Be VERY concise - 1-3 sentences max for simple operations
- DO NOT repeat file contents, diffs, or raw tool output
- DO NOT ask for confirmation if tools already completed successfully
- Just confirm what was done and any key results
- Respond in the same language as the user's query
- For file operations: just say what files were affected, don't show content
- If tool results include attachments (shown as [Attachment: ...]), those are displayed separately to the user. Do NOT summarize or repeat their content. Just acknowledge they were generated.`;

  const userPrompt = `User's request: ${originalQuery}

Tool results summary:
${toolOutputs.join("\n\n---\n\n")}

Provide a brief confirmation of what was accomplished.`;

  if (onStreamChunk) {
    // Streaming response
    const response = await chatCompletionStreaming(
      {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        maxTokens: 500,
      },
      onStreamChunk,
    );
    return response.content;
  } else {
    // Non-streaming response
    const response = await chatCompletion({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      maxTokens: 500,
    });
    return response.content;
  }
}

/**
 * Collect all attachments from tool results.
 * When multiple summary attachments exist, consolidate them into a single
 * attachment so the user sees one cohesive result instead of many cards.
 */
function collectAttachments(toolResults: ToolResult[]): ToolAttachment[] {
  const raw = toolResults
    .filter((r) => r.success && r.attachment)
    .map((r) => r.attachment!);

  if (raw.length === 0) return [];

  // Separate summary attachments from other types
  const summaries = raw.filter((a) => a.type === 'summary');
  const others = raw.filter((a) => a.type !== 'summary');

  if (summaries.length <= 1) {
    // Single summary (or none) — nothing to consolidate
    return raw;
  }

  // Deduplicate by fileId (same file summarized multiple times → keep last)
  const uniqueByFile = new Map<string, ToolAttachment>();
  for (const s of summaries) {
    const key = s.metadata?.fileId || s.title;
    uniqueByFile.set(key, s);
  }
  const deduped = Array.from(uniqueByFile.values());

  if (deduped.length === 1) {
    // After dedup only one file remains
    return [...deduped, ...others];
  }

  // Consolidate multiple file summaries into a single attachment
  const fileNames = deduped
    .map((s) => s.metadata?.fileName || s.title.replace('Summary of ', ''))
    .join(', ');
  const consolidatedContent = deduped
    .map((s) => {
      const name = s.metadata?.fileName || s.title.replace('Summary of ', '');
      return `## ${name}\n\n${s.content}`;
    })
    .join('\n\n---\n\n');

  const consolidated: ToolAttachment = {
    id: crypto.randomUUID(),
    type: 'summary',
    title: `Summary of ${deduped.length} files`,
    content: consolidatedContent,
    metadata: {
      fileName: fileNames,
    },
  };

  return [consolidated, ...others];
}

/**
 * Run the complete Planner → Executor → Checker flow
 * Called after user confirms the plan (or auto-executed for simple plans)
 * 
 * @param options.onToolLog - Callback for real-time tool log updates
 * @param options.onToolResultStream - Callback for streaming tool result content as it becomes available
 * @param options.onStreamChunk - Callback for streaming LLM interpretation
 */
export async function runPlannerFlow(
  plan: ExecutionPlan,
  projectId: string | undefined,
  options: ExecutePlanOptions & {
    onToolLog?: (log: ToolLogEntry) => void;
    onToolResultStream?: (content: string, done: boolean) => void;
    skipInterpretation?: boolean;
  } = {},
): Promise<PlannerFlowResult> {
  const { onToolLog, onToolResultStream, skipInterpretation, onStreamChunk, ...execOptions } = options;
  const maxReplanAttempts = execOptions.maxReplanAttempts ?? 2;
  let replanAttempts = 0;
  let currentPlan = plan;
  let allToolResults: ToolResult[] = [];
  const allToolLogs: ToolLogEntry[] = [];

  const state: PlannerFlowState = {
    phase: "executing",
    plan: currentPlan,
    replanAttempts: 0,
  };

  // Wrap step update to also track tool logs
  const wrappedOnStepUpdate = (step: PlanStep, index: number, total: number) => {
    // Call original callback if provided
    execOptions.onStepUpdate?.(step, index, total);

    // Create or update tool log entry
    const existingLogIndex = allToolLogs.findIndex((l) => l.id === step.id);
    
    let logEntry: ToolLogEntry;
    if (existingLogIndex === -1) {
      // New log entry
      logEntry = {
        id: step.id,
        tool: step.tool,
        description: step.description,
        status: step.status === "running" ? "running" : 
                step.status === "completed" ? "completed" : 
                step.status === "failed" ? "failed" : "running",
        startTime: new Date(),
      };
      allToolLogs.push(logEntry);
    } else {
      // Update existing
      logEntry = allToolLogs[existingLogIndex];
      logEntry.status = step.status === "running" ? "running" : 
                        step.status === "completed" ? "completed" : 
                        step.status === "failed" ? "failed" : logEntry.status;
      if (step.status === "completed" || step.status === "failed") {
        logEntry.endTime = new Date();
        logEntry.durationMs = logEntry.endTime.getTime() - logEntry.startTime.getTime();
      }
      if (step.error) {
        logEntry.error = step.error;
      }
    }

    // Emit log update
    onToolLog?.(logEntry);
  };

  // Handle child updates for nested tool progress (e.g., web research page fetches)
  const handleToolChildUpdate = (stepId: string, child: import("../types").ToolExecutionChild) => {
    const logEntry = allToolLogs.find((l) => l.id === stepId);
    if (!logEntry) return;
    
    // Initialize children array if needed
    if (!logEntry.children) {
      logEntry.children = [];
    }
    
    // Find or create child entry
    const existingChildIndex = logEntry.children.findIndex((c) => c.id === child.id);
    if (existingChildIndex >= 0) {
      // Update existing child
      logEntry.children[existingChildIndex] = child;
    } else {
      // Add new child
      logEntry.children.push(child);
    }
    
    // Emit updated log
    onToolLog?.(logEntry);
  };

  while (replanAttempts <= maxReplanAttempts) {
    // Execute the plan with wrapped step update and result streaming
    state.phase = "executing";
    const executionResult = await executePlan(currentPlan, projectId, {
      ...execOptions,
      onToolChildUpdate: handleToolChildUpdate,
      onStepUpdate: wrappedOnStepUpdate,
      onStepResult: (stepId, tool, resultData) => {
        // Show tool result content immediately as it becomes available
        if (resultData && onToolResultStream) {
          const maxPreview = 500; // Limit to first 500 chars
          const dataToShow = resultData.length > maxPreview 
            ? resultData.substring(0, maxPreview) + "..." 
            : resultData;
          
          // Send the full content immediately
          onToolResultStream(dataToShow, false);
          // Signal done after a brief delay to let the UI update
          setTimeout(() => onToolResultStream("", true), 50);
        }
      },
    });
    state.executionResult = executionResult;

    // Update tool logs with results
    for (const cs of executionResult.completedSteps) {
      const logEntry = allToolLogs.find((l) => l.id === cs.stepId);
      if (logEntry && cs.result.success && cs.result.data) {
        logEntry.resultPreview = cs.result.data.length > 200
          ? cs.result.data.substring(0, 200) + "..."
          : cs.result.data;
        logEntry.resultData = cs.result.data;
        onToolLog?.(logEntry);
      }
    }

    // Collect all tool results and attachments
    allToolResults = [
      ...allToolResults,
      ...executionResult.completedSteps.map((cs) => cs.result),
    ];

    // Check completion
    state.phase = "checking";
    const completionCheck = await checkCompletion(
      currentPlan.originalQuery,
      executionResult,
      currentPlan,
    );
    state.completionCheck = completionCheck;

    if (completionCheck.isComplete) {
      // All done - generate LLM interpretation
      state.phase = "complete";
      
      const formattedOutputs = formatToolOutputsForDisplay(
        executionResult.completedSteps,
        currentPlan,
      );

      let interpretation: string;
      if (skipInterpretation) {
        // For simple single-tool queries, don't add extra interpretation
        interpretation = "";
      } else {
        interpretation = await generateInterpretation(
          currentPlan.originalQuery,
          formattedOutputs,
          onStreamChunk,
        );
      }

      const attachments = collectAttachments(allToolResults);
      return {
        state,
        response: interpretation,
        toolResults: allToolResults,
        toolLogs: allToolLogs,
        formattedToolOutputs: formattedOutputs,
        success: true,
        attachments: attachments.length > 0 ? attachments : undefined,
      };
    }

    if (!completionCheck.shouldReplan || replanAttempts >= maxReplanAttempts) {
      // Can't or shouldn't replan
      state.phase = "complete";
      
      const formattedOutputs = formatToolOutputsForDisplay(
        executionResult.completedSteps,
        currentPlan,
      );

      let response = await generateInterpretation(
        currentPlan.originalQuery,
        formattedOutputs,
        onStreamChunk,
      );

      if (completionCheck.missingTasks.length > 0) {
        response += `\n\n⚠️ Some tasks could not be completed:\n${completionCheck.missingTasks.map((t) => `- ${t}`).join("\n")}`;
      }

      const attachments = collectAttachments(allToolResults);
      return {
        state,
        response,
        toolResults: allToolResults,
        toolLogs: allToolLogs,
        formattedToolOutputs: formattedOutputs,
        success: false,
        attachments: attachments.length > 0 ? attachments : undefined,
      };
    }

    // Replan
    state.phase = "replanning";
    replanAttempts++;
    state.replanAttempts = replanAttempts;

    // Get project files again (they may have changed)
    const projectFiles = projectId
      ? (await get_project_files(projectId)).map((f) => f.name)
      : [];

    currentPlan = await createExecutionPlan(
      currentPlan.originalQuery,
      projectId,
      projectFiles,
      undefined,
      completionCheck.replanContext,
    );

    state.plan = currentPlan;

    // If replan also needs clarification, we have a problem
    if (currentPlan.needsClarification) {
      state.phase = "complete";
      state.error = currentPlan.clarificationQuestion;
      const attachments = collectAttachments(allToolResults);
      return {
        state,
        response: currentPlan.clarificationQuestion || "I need more information to continue.",
        toolResults: allToolResults,
        toolLogs: allToolLogs,
        formattedToolOutputs: [],
        success: false,
        attachments: attachments.length > 0 ? attachments : undefined,
      };
    }
  }

  // Should never reach here, but just in case
  state.phase = "complete";
  const formattedOutputs = state.executionResult
    ? formatToolOutputsForDisplay(state.executionResult.completedSteps, currentPlan)
    : [];
  const finalAttachments = collectAttachments(allToolResults);
    
  return {
    state,
    response: state.executionResult?.finalResponse || "Execution completed.",
    toolResults: allToolResults,
    toolLogs: allToolLogs,
    formattedToolOutputs: formattedOutputs,
    success: state.executionResult?.allSuccessful ?? false,
    attachments: finalAttachments.length > 0 ? finalAttachments : undefined,
  };
}
