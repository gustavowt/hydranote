/**
 * Tool Service
 * Handles tool routing and execution
 * Phase 3: read tool implementation with router pattern
 */

import type {
  ToolName,
  ToolCall,
  ToolResult,
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
  UpdateOperation,
  DiffLine,
  UpdateFileResult,
  LLMStreamCallback,
  WebResearchToolParams,
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
import { addNote, addNoteWithTitle } from "./noteService";
import { webResearch, formatWebResearchResults, isWebSearchConfigured } from "./webSearchService";
import { generateEmbedding, cosineSimilarity } from "./embeddingService";
import {
  parseDocumentStructure,
  buildSectionTree,
  findSectionByTitle,
  findSectionByPath,
  fuzzyMatchSections,
  findMatchingSections,
  parseLineNumberSpec,
  getOffsetFromLineNumbers,
  stringSimilarity,
} from "./documentProcessor";

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
 * Creates a new file in the project. For Markdown files, saves directly to project.
 * For PDF/DOCX, generates and stores in project with optional download.
 */
export async function executeWriteTool(
  projectId: string,
  params: WriteToolParams,
  userMessage?: string,
): Promise<ToolResult> {
  try {
    const format = params.format || DEFAULT_WRITE_CONFIG.defaultFormat;
    const title = params.title || "New Document";
    const directory = params.path || ""; // Root of project by default

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
        title,
        userMessage || `Generate a document about ${title}`,
      );
    }

    // For Markdown files: Save directly to project using centralized function
    if (format === "md") {
      const fileName = titleToFileName(title) + ".md";
      const fullPath = buildFilePath(fileName, directory);

      // Add title as H1 if content doesn't start with a heading
      const finalContent = content.trim().startsWith("#")
        ? content
        : `# ${title}\n\n${content}`;

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
        data: `File "${fullPath}" has been created in the project.\n\n**Format:** Markdown\n**Size:** ${formatFileSize(file.size)}\n**Location:** ${directory || "project root"}`,
        metadata: {
          fileName: fullPath,
          fileId: file.id,
          projectId,
          fileSize: file.size,
          truncated: false,
        },
      };
    }

    // For PDF/DOCX: Generate document and store in project
    const result = await generateDocument(projectId, title, content, format);

    return {
      success: true,
      tool: "write",
      data: `Document "${result.fileName}" has been created.\n\n**Format:** ${format.toUpperCase()}\n**Size:** ${formatFileSize(result.size)}`,
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
// AddNote Tool Implementation (Phase 9)
// ============================================

/**
 * Execute the addNote tool
 * Creates a formatted note and saves it to the project
 */
export async function executeAddNoteTool(
  projectId: string,
  params: { content: string; title?: string; topic?: string; tags?: string },
): Promise<ToolResult> {
  try {
    const content = params.content;

    if (!content || content.trim().length === 0) {
      return {
        success: false,
        tool: "addNote",
        error: "Note content is required",
      };
    }

    // Build context metadata
    const contextMetadata: NoteContextMetadata = {};
    if (params.topic) contextMetadata.topic = params.topic;
    if (params.tags)
      contextMetadata.tags = params.tags.split(",").map((t) => t.trim());

    // Execute the addNote pipeline
    let result;
    if (params.title) {
      result = await addNoteWithTitle(
        projectId,
        content,
        params.title,
        contextMetadata,
      );
    } else {
      result = await addNote({
        projectId,
        rawNoteText: content,
        contextMetadata,
      });
    }

    if (!result.success) {
      return {
        success: false,
        tool: "addNote",
        error: result.error || "Failed to create note",
      };
    }

    return {
      success: true,
      tool: "addNote",
      data: `Note "${result.title}" has been created and saved.\n\n**Location:** ${result.filePath}\n**Directory:** ${result.directory}`,
      metadata: {
        fileName: result.filePath,
        fileId: result.fileId,
        projectId,
        truncated: false,
      },
    };
  } catch (error) {
    return {
      success: false,
      tool: "addNote",
      error: error instanceof Error ? error.message : "Failed to create note",
    };
  }
}

// ============================================
// CreateProject Tool Implementation
// ============================================

/**
 * Execute the createProject tool
 * Creates a new project
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
      return {
        success: false,
        tool: "createProject",
        error: `A project named "${name}" already exists.`,
      };
    }

    const project = await createProject(name, params.description);

    // Check for sync error
    const syncError = (project as { syncError?: string }).syncError;

    return {
      success: true,
      tool: "createProject",
      data: `Project "${project.name}" has been created successfully.${syncError ? `\n\n⚠️ Note: Folder sync failed: ${syncError}` : ""}${params.description ? `\n\n**Description:** ${params.description}` : ""}`,
      metadata: {
        fileId: project.id,
        fileName: project.name,
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
 * Moves a file from one project to another
 */
export async function executeMoveFileTool(params: {
  file: string;
  fromProject: string;
  toProject: string;
  directory?: string;
}): Promise<ToolResult> {
  try {
    const { file, fromProject, toProject, directory } = params;

    if (!file || !fromProject || !toProject) {
      return {
        success: false,
        tool: "moveFile",
        error:
          "File name, source project, and destination project are all required.",
      };
    }

    // Resolve source project
    const sourceProject = await resolveProject(fromProject);
    if (!sourceProject) {
      return {
        success: false,
        tool: "moveFile",
        error: `Source project "${fromProject}" not found.`,
      };
    }

    // Resolve destination project
    const destProject = await resolveProject(toProject);
    if (!destProject) {
      return {
        success: false,
        tool: "moveFile",
        error: `Destination project "${toProject}" not found.`,
      };
    }

    // Find the file in source project
    const sourceFile = await findFileByPath(sourceProject.id, file);
    if (!sourceFile) {
      return {
        success: false,
        tool: "moveFile",
        error: `File "${file}" not found in project "${sourceProject.name}".`,
      };
    }

    // Move the file
    const movedFile = await moveFile(sourceFile.id, destProject.id, directory);

    return {
      success: true,
      tool: "moveFile",
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
      error: error instanceof Error ? error.message : "Failed to move file",
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
 * Section identification prompt for LLM (improved - uses line numbers)
 */
const SECTION_IDENTIFICATION_PROMPT = `You are a document section identifier. Given a document with line numbers, identify the section to modify.

IMPORTANT: The document is provided with line numbers in format "LINE_NUMBER|content".

Your task:
1. Analyze the document structure (headings, paragraphs, sections)
2. Find the section that best matches the user's description
3. Return LINE NUMBERS (more reliable than text content)

Response format (JSON only):
{
  "found": true/false,
  "startLine": <number>,
  "endLine": <number>,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}

RULES:
- startLine and endLine are 1-based line numbers from the document
- For headings, include the heading line and all content until next same-level heading or end
- For paragraphs, include all contiguous non-empty lines
- confidence should be 0.9+ for clear matches, 0.6-0.8 for partial matches, <0.6 for uncertain

If section is not found:
{
  "found": false,
  "confidence": 0,
  "reasoning": "explanation of why not found"
}`;

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
 * Section identification result
 */
interface SectionIdentificationResult {
  found: boolean;
  sectionContent: string;
  sectionStart: number;
  sectionEnd: number;
  confidence: number;
  reasoning?: string;
  method?: string;
}

/**
 * Convert line numbers to character offsets
 */
function lineNumbersToOffsets(
  content: string,
  startLine: number,
  endLine: number,
): { start: number; end: number } | null {
  const lines = content.split("\n");

  if (startLine < 1 || startLine > lines.length) return null;
  if (endLine < startLine || endLine > lines.length) return null;

  let start = 0;
  for (let i = 0; i < startLine - 1; i++) {
    start += lines[i].length + 1;
  }

  let end = start;
  for (let i = startLine - 1; i <= endLine - 1; i++) {
    end += lines[i].length;
    if (i < endLine - 1) end += 1;
  }

  return { start, end };
}

/**
 * Format document with line numbers for LLM
 */
function formatDocumentWithLineNumbers(content: string): string {
  const lines = content.split("\n");
  return lines.map((line, i) => `${String(i + 1).padStart(4)}|${line}`).join("\n");
}

/**
 * Identify section in document using multi-level cascade matching
 *
 * Cascade order:
 * 1. Special keywords (end, start, bottom, top)
 * 2. Line number specification (line:42, lines:10-25)
 * 3. Exact text match
 * 4. Structural parsing (markdown headers)
 * 5. Fuzzy matching (typo tolerance)
 * 6. Semantic embeddings (existing chunks)
 * 7. LLM fallback (line-number based)
 */
async function identifySection(
  content: string,
  sectionIdentifier: string,
  identificationMethod?: string,
  fileId?: string,
): Promise<SectionIdentificationResult> {
  const notFound: SectionIdentificationResult = {
    found: false,
    sectionContent: "",
    sectionStart: -1,
    sectionEnd: -1,
    confidence: 0,
  };

  const identifier = sectionIdentifier.trim();
  const identifierLower = identifier.toLowerCase();

  // ============================================
  // Level 1: Special Keywords
  // ============================================
  const endKeywords = ["end", "bottom", "eof", "fim", "final", "末尾", "append"];
  if (endKeywords.includes(identifierLower)) {
    const trimmedContent = content.trimEnd();
    return {
      found: true,
      sectionContent: "",
      sectionStart: trimmedContent.length,
      sectionEnd: trimmedContent.length,
      confidence: 1.0,
      reasoning: `Special keyword "${identifier}" - targeting end of document`,
      method: "special_keyword",
    };
  }

  const startKeywords = ["start", "beginning", "top", "início", "inicio", "開始", "prepend"];
  if (startKeywords.includes(identifierLower)) {
    return {
      found: true,
      sectionContent: "",
      sectionStart: 0,
      sectionEnd: 0,
      confidence: 1.0,
      reasoning: `Special keyword "${identifier}" - targeting start of document`,
      method: "special_keyword",
    };
  }

  // ============================================
  // Level 2: Line Number Specification
  // ============================================
  if (!identificationMethod || identificationMethod === "line_number") {
    const lineSpec = parseLineNumberSpec(identifier);
    if (lineSpec) {
      const offsets = getOffsetFromLineNumbers(content, lineSpec.startLine, lineSpec.endLine);
      if (offsets) {
        return {
          found: true,
          sectionContent: content.slice(offsets.startOffset, offsets.endOffset),
          sectionStart: offsets.startOffset,
          sectionEnd: offsets.endOffset,
          confidence: 1.0,
          reasoning: `Line number specification: ${identifier}`,
          method: "line_number",
        };
      }
    }
  }

  // ============================================
  // Level 3: Exact Text Match
  // ============================================
  if (!identificationMethod || identificationMethod === "exact_match") {
    const exactIndex = content.indexOf(identifier);
    if (exactIndex !== -1) {
      return {
        found: true,
        sectionContent: identifier,
        sectionStart: exactIndex,
        sectionEnd: exactIndex + identifier.length,
        confidence: 1.0,
        reasoning: "Exact text match found",
        method: "exact_match",
      };
    }
  }

  // ============================================
  // Level 4: Structural Parsing (Markdown)
  // ============================================
  if (!identificationMethod || identificationMethod === "header") {
    const sections = parseDocumentStructure(content);
    const tree = buildSectionTree(sections);

    // Try path-based lookup first (e.g., "Features/API" or "Features > API")
    if (identifier.includes("/") || identifier.includes(">")) {
      const pathMatch = findSectionByPath(tree, identifier);
      if (pathMatch) {
        return {
          found: true,
          sectionContent: pathMatch.content,
          sectionStart: pathMatch.startOffset,
          sectionEnd: pathMatch.endOffset,
          confidence: 1.0,
          reasoning: `Found section at path "${identifier}"`,
          method: "structure_path",
        };
      }
    }

    // Try title-based lookup
    const titleMatch = findSectionByTitle(tree, identifier);
    if (titleMatch) {
      return {
        found: true,
        sectionContent: titleMatch.content,
        sectionStart: titleMatch.startOffset,
        sectionEnd: titleMatch.endOffset,
        confidence: 1.0,
        reasoning: `Found heading matching "${identifier}"`,
        method: "structure_title",
      };
    }

    // Check all matching sections
    const matchingResults = findMatchingSections(sections, identifier);
    if (matchingResults.length > 0 && matchingResults[0].score >= 0.7) {
      const best = matchingResults[0];
      return {
        found: true,
        sectionContent: best.section.content,
        sectionStart: best.section.startOffset,
        sectionEnd: best.section.endOffset,
        confidence: best.score,
        reasoning: `Structural match: "${best.section.title || "content"}" (score: ${best.score.toFixed(2)})`,
        method: "structure_match",
      };
    }
  }

  // ============================================
  // Level 5: Fuzzy Matching
  // ============================================
  if (!identificationMethod || identificationMethod === "semantic") {
    const sections = parseDocumentStructure(content);
    const fuzzyResult = fuzzyMatchSections(sections, identifier, 0.6);

    if (fuzzyResult && fuzzyResult.score >= 0.6) {
      return {
        found: true,
        sectionContent: fuzzyResult.section.content,
        sectionStart: fuzzyResult.section.startOffset,
        sectionEnd: fuzzyResult.section.endOffset,
        confidence: fuzzyResult.score,
        reasoning: `Fuzzy match: "${fuzzyResult.section.title || "content"}" (similarity: ${(fuzzyResult.score * 100).toFixed(0)}%)`,
        method: "fuzzy_match",
      };
    }
  }

  // ============================================
  // Level 6: Semantic Embeddings (if fileId provided)
  // ============================================
  if (fileId && (!identificationMethod || identificationMethod === "semantic")) {
    try {
      const chunks = await get_file_chunks(fileId);
      if (chunks.length > 0) {
        // Generate embedding for the query
        const queryEmbedding = await generateEmbedding(identifier);

        // Find most similar chunk
        let bestChunk: { chunk: typeof chunks[0]; score: number } | null = null;

        for (const chunk of chunks) {
          // We need to get the embedding for this chunk
          // For now, generate embedding on the fly (could be optimized with stored embeddings)
          const chunkEmbedding = await generateEmbedding(chunk.text);
          const score = cosineSimilarity(queryEmbedding, chunkEmbedding);

          if (!bestChunk || score > bestChunk.score) {
            bestChunk = { chunk, score };
          }
        }

        if (bestChunk && bestChunk.score >= 0.5) {
          return {
            found: true,
            sectionContent: bestChunk.chunk.text,
            sectionStart: bestChunk.chunk.startOffset,
            sectionEnd: bestChunk.chunk.endOffset,
            confidence: bestChunk.score,
            reasoning: `Semantic match via embeddings (similarity: ${(bestChunk.score * 100).toFixed(0)}%)`,
            method: "embeddings",
          };
        }
      }
    } catch (e) {
      console.warn("Semantic embedding search failed:", e);
      // Continue to LLM fallback
    }
  }

  // ============================================
  // Level 7: LLM Fallback (improved with line numbers)
  // ============================================
  try {
    const formattedDoc = formatDocumentWithLineNumbers(content);

    const response = await chatCompletion({
      messages: [
        { role: "system", content: SECTION_IDENTIFICATION_PROMPT },
        {
          role: "user",
          content: `Document:\n\n${formattedDoc}\n\n---\n\nSection to find: "${identifier}"`,
        },
      ],
      temperature: 0,
      maxTokens: 500,
    });

    let jsonStr = response.content.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const result = JSON.parse(jsonStr);

    if (!result.found) {
      return {
        ...notFound,
        reasoning: result.reasoning || "LLM could not find section",
        method: "llm_fallback",
      };
    }

    // Convert line numbers to offsets
    const offsets = lineNumbersToOffsets(content, result.startLine, result.endLine);
    if (!offsets) {
      return {
        ...notFound,
        reasoning: `LLM returned invalid line numbers: ${result.startLine}-${result.endLine}`,
        method: "llm_fallback",
      };
    }

    return {
      found: true,
      sectionContent: content.slice(offsets.start, offsets.end),
      sectionStart: offsets.start,
      sectionEnd: offsets.end,
      confidence: result.confidence || 0.7,
      reasoning: result.reasoning || "Found via LLM analysis",
      method: "llm_fallback",
    };
  } catch (e) {
    return {
      ...notFound,
      reasoning: `LLM fallback failed: ${e instanceof Error ? e.message : "Unknown error"}`,
      method: "llm_fallback",
    };
  }
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Apply update operation to content
 */
function applyUpdateOperation(
  originalContent: string,
  sectionStart: number,
  sectionEnd: number,
  newContent: string,
  operation: UpdateOperation,
): string {
  switch (operation) {
    case "insert_before":
      return (
        originalContent.slice(0, sectionStart) +
        newContent +
        "\n\n" +
        originalContent.slice(sectionStart)
      );

    case "insert_after":
      return (
        originalContent.slice(0, sectionEnd) +
        "\n\n" +
        newContent +
        originalContent.slice(sectionEnd)
      );

    case "replace":
    default:
      // Default to 'replace' operation for any unrecognized operation
      return (
        originalContent.slice(0, sectionStart) +
        newContent +
        originalContent.slice(sectionEnd)
      );
  }
}

/**
 * Execute the updateFile tool
 * Creates a preview of changes without applying them
 */
export async function executeUpdateFileTool(
  projectId: string,
  params: UpdateFileToolParams,
  userMessage?: string,
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

    // Identify the section to update (pass fileId for semantic matching)
    const sectionResult = await identifySection(
      content,
      params.sectionIdentifier,
      params.identificationMethod,
      file.id,
    );

    if (!sectionResult.found) {
      return {
        success: false,
        tool: "updateFile",
        error: `Could not find section "${params.sectionIdentifier}" in file "${file.name}". ${sectionResult.reasoning || ""}`,
      };
    }

    // Generate new content if not provided (use LLM to generate based on user message)
    let newContent = params.newContent;
    if (!newContent && userMessage) {
      // Get surrounding context from the document
      const contextStart = Math.max(0, sectionResult.sectionStart - 500);
      const contextEnd = Math.min(
        content.length,
        sectionResult.sectionEnd + 500,
      );
      const surroundingContext = content.slice(contextStart, contextEnd);

      const operationDescription =
        params.operation === "replace"
          ? "replace the following section with improved/updated content"
          : params.operation === "insert_before"
            ? "create new content to insert BEFORE the following section"
            : "create new content to insert AFTER the following section";

      const generateResponse = await chatCompletion({
        messages: [
          {
            role: "system",
            content: `You are a professional content writer. Your task is to ${operationDescription} in a document.

DOCUMENT: "${file.name}"

SURROUNDING CONTEXT (for reference):
---
${surroundingContext}
---

SECTION TO ${params.operation.toUpperCase()}:
---
${sectionResult.sectionContent}
---

IMPORTANT INSTRUCTIONS:
1. Generate ACTUAL, SUBSTANTIVE content - not placeholders or descriptions
2. Match the style and tone of the existing document
3. If asked for "more detail" or "expanded" content, write real detailed paragraphs with specific information
4. Keep the same markdown formatting style (headers, lists, etc.)
5. Output ONLY the new content - no explanations, no "Here is..." prefix
6. The content should be ready to insert directly into the document`,
          },
          { role: "user", content: `User request: ${userMessage}` },
        ],
        temperature: 0.7,
        maxTokens: 3000,
      });
      newContent = generateResponse.content;
    }

    if (!newContent) {
      return {
        success: false,
        tool: "updateFile",
        error: "No new content provided for the update operation.",
      };
    }

    // Apply the update operation to generate preview
    const newFullContent = applyUpdateOperation(
      content,
      sectionResult.sectionStart,
      sectionResult.sectionEnd,
      newContent,
      params.operation,
    );

    // Generate diff
    const diffLines = generateDiffLines(content, newFullContent);

    // Create preview
    const previewId = crypto.randomUUID();
    const preview: UpdateFilePreview = {
      previewId,
      fileId: file.id,
      fileName: file.name,
      fileType: file.type as "md" | "docx",
      operation: params.operation,
      identifiedSection: sectionResult.sectionContent,
      originalContent: sectionResult.sectionContent,
      newContent,
      originalFullContent: content,
      newFullContent,
      diffLines,
      sectionFound: true,
      confidence: sectionResult.confidence,
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

**Operation:** ${params.operation}
**Section:** ${params.sectionIdentifier}
**Confidence:** ${(sectionResult.confidence * 100).toFixed(0)}%

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
      operation: "replace",
      error: "Preview not found or expired. Please try the update again.",
      reIndexed: false,
    };
  }

  try {
    const { getConnection, flushDatabase } = await import("./database");
    const { chunkText, chunkMarkdownText } = await import(
      "./documentProcessor"
    );
    const { generateEmbeddingsForChunks } = await import("./embeddingService");

    const conn = getConnection();

    // Get the file to retrieve projectId
    const file = await getFile(preview.fileId);
    if (!file) {
      return {
        success: false,
        fileId: preview.fileId,
        fileName: preview.fileName,
        operation: preview.operation,
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

    // Delete old chunks and embeddings
    await conn.query(`
      DELETE FROM embeddings WHERE file_id = '${preview.fileId}'
    `);
    await conn.query(`
      DELETE FROM chunks WHERE file_id = '${preview.fileId}'
    `);

    // Re-chunk the document
    const chunks =
      preview.fileType === "md"
        ? chunkMarkdownText(
            preview.newFullContent,
            preview.fileId,
            file.projectId,
          )
        : chunkText(preview.newFullContent, preview.fileId, file.projectId);

    // Store new chunks
    for (const chunk of chunks) {
      const escapedText = chunk.text.replace(/'/g, "''");
      await conn.query(`
        INSERT INTO chunks (id, file_id, project_id, chunk_index, text, start_offset, end_offset, created_at)
        VALUES ('${chunk.id}', '${chunk.fileId}', '${chunk.projectId}', ${chunk.index}, '${escapedText}', ${chunk.startOffset}, ${chunk.endOffset}, '${chunk.createdAt.toISOString()}')
      `);
    }

    // Generate and store new embeddings
    const embeddings = await generateEmbeddingsForChunks(chunks);
    for (const embedding of embeddings) {
      const vectorStr = `[${embedding.vector.join(", ")}]`;
      await conn.query(`
        INSERT INTO embeddings (id, chunk_id, file_id, project_id, vector, created_at)
        VALUES ('${embedding.id}', '${embedding.chunkId}', '${embedding.fileId}', '${embedding.projectId}', ${vectorStr}::DOUBLE[], '${embedding.createdAt.toISOString()}')
      `);
    }

    // Flush to persist changes
    await flushDatabase();

    // Sync to file system
    try {
      const { syncFileToFileSystem } = await import("./syncService");
      const { getProject } = await import("./projectService");
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
      operation: preview.operation,
      reIndexed: true,
    };
  } catch (error) {
    return {
      success: false,
      fileId: preview.fileId,
      fileName: preview.fileName,
      operation: preview.operation,
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
  console.log(`[TOOL:${call.tool}] ========== START ==========`);
  console.log(`[TOOL:${call.tool}] projectId:`, projectId);
  console.log(`[TOOL:${call.tool}] params:`, JSON.stringify(call.params, null, 2));
  
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
  
  const duration = Date.now() - startTime;
  console.log(`[TOOL:${call.tool}] Result - success:`, result.success);
  if (!result.success) {
    console.log(`[TOOL:${call.tool}] Error:`, result.error);
  }
  console.log(`[TOOL:${call.tool}] Duration: ${duration}ms`);
  console.log(`[TOOL:${call.tool}] ========== END ==========`);
  
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
          title: call.params.title || "New Document",
          content: call.params.content || "",
          path: call.params.path || call.params.directory || "",
        },
        userMessage,
      );
    }

    case "addNote": {
      const targetProjectId = await resolveProjectForTool(
        projectId,
        call.params.project,
      );

      if (!targetProjectId) {
        return {
          success: false,
          tool: "addNote",
          error:
            "Project is required. Please specify which project to add the note to.",
        };
      }

      return executeAddNoteTool(targetProjectId, {
        content:
          call.params.content ||
          call.params.text ||
          call.params.note ||
          userMessage ||
          "",
        title: call.params.title,
        topic: call.params.topic,
        tags: call.params.tags,
      });
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

      // Validate operation - must be one of the valid values, default to 'replace'
      const validOperations: UpdateOperation[] = [
        "replace",
        "insert_before",
        "insert_after",
      ];
      const rawOperation = call.params.operation?.toLowerCase?.() || "";
      const operation: UpdateOperation = validOperations.includes(
        rawOperation as UpdateOperation,
      )
        ? (rawOperation as UpdateOperation)
        : "replace";

      return executeUpdateFileTool(
        targetProjectId,
        {
          fileId: call.params.fileId || call.params.file_id,
          fileName:
            call.params.fileName || call.params.file || call.params.name,
          operation,
          sectionIdentifier:
            call.params.section || call.params.sectionIdentifier || "",
          newContent: call.params.newContent || call.params.content || "",
        },
        userMessage,
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
        fromProject: call.params.fromProject || call.params.from,
        toProject: call.params.toProject || call.params.to,
        directory: call.params.directory || call.params.path,
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
  console.log("[PARSE] Parsing response for tool_call blocks...");
  console.log("[PARSE] Content length:", content.length);
  
  const toolCalls: ToolCall[] = [];

  // Pattern to match ```tool_call ... ``` blocks
  const toolCallPattern = /```tool_call\s*\n?([\s\S]*?)```/g;

  // Check if content contains the pattern at all
  const hasPattern = content.includes("```tool_call");
  console.log("[PARSE] Contains ```tool_call pattern:", hasPattern);

  let match;
  let matchCount = 0;
  while ((match = toolCallPattern.exec(content)) !== null) {
    matchCount++;
    const jsonStr = match[1].trim();
    console.log(`[PARSE] Match ${matchCount} - Raw JSON:`, jsonStr.substring(0, 200));
    try {
      const parsed = JSON.parse(jsonStr);
      console.log(`[PARSE] Match ${matchCount} - Parsed tool:`, parsed.tool);
      if (parsed.tool && typeof parsed.tool === "string") {
        toolCalls.push({
          tool: parsed.tool as ToolName,
          params: parsed.params || {},
        });
        console.log(`[PARSE] Match ${matchCount} - Added to toolCalls`);
      } else {
        console.log(`[PARSE] Match ${matchCount} - Missing or invalid tool property`);
      }
    } catch (e) {
      // Invalid JSON in tool call block, skip it
      console.warn(`[PARSE] Match ${matchCount} - Failed to parse JSON:`, e);
      console.warn(`[PARSE] Match ${matchCount} - JSON string was:`, jsonStr);
    }
  }

  // Remove tool call blocks from content to get clean text
  const textContent = content
    .replace(toolCallPattern, "")
    .replace(/\n{3,}/g, "\n\n") // Clean up excessive newlines
    .trim();

  console.log("[PARSE] Total matches found:", matchCount);
  console.log("[PARSE] Valid tool calls:", toolCalls.length);
  console.log("[PARSE] hasToolCalls:", toolCalls.length > 0);

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
// Planner Prompt
// ============================================

const PLANNER_PROMPT = `You are an AI execution planner. Analyze the user's request and create a detailed execution plan.

Your job is to:
1. Understand what the user wants to accomplish
2. Break it down into specific tool calls that need to be executed IN ORDER
3. Identify dependencies between steps (what needs to happen before what)
4. Identify what context each step needs from previous steps

Available tools:
- read: Read a file's full content. Params: {file: "filename", project?: "project name"}
- search: Semantic search across documents. Params: {query: "search query", project?: "project name"}
- summarize: Create a summary of a document. Params: {file: "filename", project?: "project name"}
- write: Create a NEW file (MD/PDF/DOCX). Params: {format: "md"|"pdf"|"docx", title: "filename", content: "content", path?: "directory", project?: "project name"}
- addNote: Create and save a quick note. Params: {content: "note content", title?: "title", project?: "project name"}
- updateFile: Update an existing file. Params: {file: "filename", section: "section to find", operation: "replace"|"insert_before"|"insert_after", newContent: "new content"}
- createProject: Create a new project. Params: {name: "project name", description?: "description"}
- moveFile: Move a file between projects. Params: {file: "filename", fromProject: "source", toProject: "destination"}
- deleteFile: Delete a file. Params: {file: "filename", project?: "project name"}
- deleteProject: Delete a project. Params: {project: "project name", confirm: "yes"}
- webResearch: Search the web for information. Params: {query: "search query", maxResults?: number}

IMPORTANT RULES:
1. Order matters! If creating a project then adding files, createProject MUST come first
2. If a step needs data from a previous step, mark it in dependsOn and contextNeeded
3. For content generation (write/addNote), the Executor will generate content based on accumulated context
4. If the user's request is ambiguous or missing critical info, set needsClarification: true

Context propagation examples:
- webResearch → write: The write step needs webResearchResults from the webResearch step
- createProject → write: The write step needs projectId from createProject
- search → addNote: The addNote step needs searchResults from search

Respond ONLY with a JSON object:
{
  "summary": "Brief description of what will be done",
  "needsClarification": false,
  "clarificationQuestion": null,
  "estimatedDuration": "~X seconds",
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
export async function createExecutionPlan(
  userMessage: string,
  projectId: string | undefined,
  projectFiles: string[],
  conversationContext?: string,
  replanContext?: string,
): Promise<ExecutionPlan> {
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

  const response = await chatCompletion({
    messages: [
      {
        role: "system",
        content: PLANNER_PROMPT + filesContext + projectInfo + contextInfo + replanInfo,
      },
      { role: "user", content: userMessage },
    ],
    temperature: 0,
    maxTokens: 2000,
  });

  try {
    let jsonStr = response.content.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

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
    };

    return plan;
  } catch (error) {
    console.error("[PLANNER] Failed to parse plan:", error, response.content);
    
    // Return a plan with clarification needed
    return {
      id: crypto.randomUUID(),
      summary: "",
      steps: [],
      needsClarification: true,
      clarificationQuestion: "I couldn't understand your request. Could you please rephrase what you'd like me to do?",
      originalQuery: userMessage,
      createdAt: new Date(),
    };
  }
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
    addNote: "📌",
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
      context.projectName = params.name;
      break;

    case "write":
    case "addNote":
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

  // If step needs content from web research
  if (
    step.contextNeeded?.includes("webResearchResults") &&
    accumulatedContext.webResearchResults &&
    !enrichedParams.content
  ) {
    // For write/addNote, we'll generate content based on web research
    enrichedParams._webContext = String(accumulatedContext.webResearchResults);
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
 * Generate content for write/addNote tools when content needs to be created
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

/**
 * Execute a plan step by step with context passing
 */
export async function executePlan(
  plan: ExecutionPlan,
  projectId: string | undefined,
  options: ExecutePlanOptions = {},
): Promise<ExecutionResult> {
  const { onStepUpdate, onStreamChunk, stopOnFailure = false } = options;

  const startTime = Date.now();
  const completedSteps: CompletedStep[] = [];
  const failedSteps: FailedStep[] = [];
  const accumulatedContext: Record<string, unknown> = {
    projectId,
  };

  console.log("[EXECUTOR] Starting plan execution:", plan.id);
  console.log("[EXECUTOR] Steps count:", plan.steps.length);

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const stepStartTime = Date.now();

    // Update step status to running
    step.status = "running";
    onStepUpdate?.(step, i, plan.steps.length);

    console.log(`[EXECUTOR] Step ${i + 1}/${plan.steps.length}: ${step.tool} - ${step.description}`);

    // Check dependencies
    const unmetDependencies = (step.dependsOn || []).filter(
      (depId) => !completedSteps.some((cs) => cs.stepId === depId),
    );

    if (unmetDependencies.length > 0) {
      console.log("[EXECUTOR] Unmet dependencies:", unmetDependencies);
      
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

      // For write/addNote, generate content if needed
      if (
        (step.tool === "write" || step.tool === "addNote") &&
        !enrichedParams.content &&
        (enrichedParams._webContext || enrichedParams._searchContext)
      ) {
        console.log("[EXECUTOR] Generating content from context...");
        enrichedParams.content = await generateContentFromContext(
          step,
          accumulatedContext,
          plan.originalQuery,
        );
        // Clean up internal params
        delete enrichedParams._webContext;
        delete enrichedParams._searchContext;
      }

      // Resolve project ID for the step
      let stepProjectId = projectId;
      if (enrichedParams.project) {
        // Could be a project ID or name, try to resolve
        const resolvedId = await resolveProjectForTool(projectId, enrichedParams.project);
        if (resolvedId) {
          stepProjectId = resolvedId;
        }
      } else if (accumulatedContext.projectId && typeof accumulatedContext.projectId === "string") {
        stepProjectId = accumulatedContext.projectId;
      }

      // Execute the tool
      const toolCall: ToolCall = {
        tool: step.tool,
        params: enrichedParams,
      };

      // Create progress callback that updates step detail
      const progressCallback = (status: string) => {
        step.detail = status;
        onStepUpdate?.(step, i, plan.steps.length);
      };

      const result = await executeTool(stepProjectId, toolCall, plan.originalQuery, progressCallback);

      if (result.success) {
        step.status = "completed";
        
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

        console.log("[EXECUTOR] Step completed successfully. Extracted context:", Object.keys(extractedContext));
      } else {
        step.status = "failed";
        step.error = result.error;

        failedSteps.push({
          stepId: step.id,
          tool: step.tool,
          error: result.error || "Unknown error",
          recoverable: true,
        });

        console.log("[EXECUTOR] Step failed:", result.error);

        if (stopOnFailure) {
          console.log("[EXECUTOR] Stopping due to failure");
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

      if (stopOnFailure) {
        break;
      }
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

  console.log("[EXECUTOR] Execution complete:", {
    completed: completedSteps.length,
    failed: failedSteps.length,
    duration: executionResult.totalDurationMs,
  });

  return executionResult;
}

/**
 * Generate a final response summarizing the execution
 */
function generateFinalResponse(
  plan: ExecutionPlan,
  completedSteps: CompletedStep[],
  failedSteps: FailedStep[],
  context: Record<string, unknown>,
): string {
  const parts: string[] = [];

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
    }
  }

  if (failedSteps.length > 0) {
    parts.push("");
    parts.push("**Failed:**");
    for (const step of failedSteps) {
      const originalStep = plan.steps.find((s) => s.id === step.stepId);
      parts.push(`- ❌ ${originalStep?.description || step.tool}: ${step.error}`);
    }
  }

  if (completedSteps.length === plan.steps.length) {
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

/**
 * Result from the full planner flow
 */
export interface PlannerFlowResult {
  /** Final state of the flow */
  state: PlannerFlowState;
  /** Final response to show user */
  response: string;
  /** All tool results from execution */
  toolResults: ToolResult[];
  /** Whether the flow completed successfully */
  success: boolean;
}

/**
 * Run the complete Planner → Executor → Checker flow
 * Called after user confirms the plan
 */
export async function runPlannerFlow(
  plan: ExecutionPlan,
  projectId: string | undefined,
  options: ExecutePlanOptions = {},
): Promise<PlannerFlowResult> {
  const maxReplanAttempts = options.maxReplanAttempts ?? 2;
  let replanAttempts = 0;
  let currentPlan = plan;
  let allToolResults: ToolResult[] = [];

  const state: PlannerFlowState = {
    phase: "executing",
    plan: currentPlan,
    replanAttempts: 0,
  };

  while (replanAttempts <= maxReplanAttempts) {
    // Execute the plan
    state.phase = "executing";
    const executionResult = await executePlan(currentPlan, projectId, options);
    state.executionResult = executionResult;

    // Collect all tool results
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
      // All done!
      state.phase = "complete";
  return {
        state,
        response: executionResult.finalResponse,
    toolResults: allToolResults,
        success: true,
      };
    }

    if (!completionCheck.shouldReplan || replanAttempts >= maxReplanAttempts) {
      // Can't or shouldn't replan
      state.phase = "complete";
      
      let response = executionResult.finalResponse;
      if (completionCheck.missingTasks.length > 0) {
        response += `\n\n⚠️ Some tasks could not be completed:\n${completionCheck.missingTasks.map((t) => `- ${t}`).join("\n")}`;
      }

      return {
        state,
        response,
        toolResults: allToolResults,
        success: false,
      };
    }

    // Replan
    state.phase = "replanning";
    replanAttempts++;
    state.replanAttempts = replanAttempts;

    console.log(`[FLOW] Replanning attempt ${replanAttempts}/${maxReplanAttempts}`);

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
      return {
        state,
        response: currentPlan.clarificationQuestion || "I need more information to continue.",
        toolResults: allToolResults,
        success: false,
      };
    }
  }

  // Should never reach here, but just in case
  state.phase = "complete";
  return {
    state,
    response: state.executionResult?.finalResponse || "Execution completed.",
    toolResults: allToolResults,
    success: state.executionResult?.allSuccessful ?? false,
  };
}
