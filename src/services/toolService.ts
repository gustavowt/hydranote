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
// Router LLM
// ============================================

const ROUTER_PROMPT = `You are a planning assistant. Analyze the user's request and create an execution plan with the tools needed.

Available tools:
- read: Read a specific file's full content. Use when user wants to see, open, view, or examine a file.
- search: Semantic search across all documents. Use when user asks questions about content, wants to find specific information, or asks "what does it say about...". Keywords: search, find, buscar, encontrar, procure, o que diz sobre, what does it say about.
- summarize: Create a summary of a document. Use when user wants a summary, overview, or TL;DR.
- write: **CREATE A NEW FILE** in PDF, DOCX, or Markdown format. Use when user wants to CREATE, WRITE, GENERATE, or PRODUCE a new file/document. This tool CREATES and SAVES files to the project. Keywords: create file, write file, generate file, make file, create document, generate PDF, write report, save as file, escreva, crie, gerar, criar arquivo, criar documento, gerar pdf, gerar docx, make a new file.
- addNote: Create and save a quick note in the project. Use when user wants to save a quick note, take notes, or add information. Keywords: add note, take note, save note, criar nota, salvar nota, anotar, lembrete, remember this.
- updateFile: Update or modify a specific section of an EXISTING file (Markdown or DOCX only). Use when user wants to edit, update, modify, or change an EXISTING file. Keywords: update, edit, modify, change, replace, insert, atualizar, editar, modificar.
- createProject: Create a new project. Use when user wants to create, start, or set up a new project. Keywords: create project, new project, criar projeto, novo projeto.
- moveFile: Move a file from one project to another. Use when user wants to move, transfer, or relocate a file between projects. Keywords: move file, transfer file, mover arquivo.
- deleteFile: Delete a file from a project. Use when user wants to delete, remove, or discard a file. Keywords: delete file, remove file, apagar arquivo, deletar arquivo, excluir arquivo.
- deleteProject: Delete an entire project and all its files. Use when user wants to delete, remove, or discard a project. Keywords: delete project, remove project, apagar projeto, deletar projeto, excluir projeto.
- webResearch: Search the web for current/external information not in the project documents. Use when user needs information from the internet, current news, external references, latest updates, or information not available in indexed documents. Keywords: search the web, web search, google, look up online, find on internet, current news, latest info, external info, what's new about, recent updates, pesquisar na web, buscar online, pesquisa externa, notícias sobre.

IMPORTANT: You can chain multiple tools for complex requests. Plan the sequence logically.

Respond ONLY with a JSON object in one of these formats:
1. Tools needed: {"tools": [{"name": "toolName", "params": {"paramName": "value"}}]}
2. No tools needed: {"tools": []}
3. Clarification needed: {"tools": [], "clarification": "your question to the user"}

FALLBACK RULES - Use clarification when:
- The user's intent is ambiguous or unclear
- User references a file that doesn't exist in the project
- User's request could be interpreted multiple ways
- Not enough information to execute the request

Examples:

Single tool:
- "Read the contract.pdf" → {"tools": [{"name": "read", "params": {"file": "contract.pdf"}}]}
- "Summarize the agreement" → {"tools": [{"name": "summarize", "params": {"file": "agreement"}}]}
- "Search for payment terms" → {"tools": [{"name": "search", "params": {"query": "payment terms"}}]}
- "Buscar informações sobre contrato" → {"tools": [{"name": "search", "params": {"query": "contrato"}}]}
- "O que diz sobre garantias?" → {"tools": [{"name": "search", "params": {"query": "garantias"}}]}
- "What does it say about deadlines?" → {"tools": [{"name": "search", "params": {"query": "deadlines"}}]}

File creation (write tool - CREATES files in the project):
- "Create a new file called notes.md" → {"tools": [{"name": "write", "params": {"format": "md", "title": "notes"}}]}
- "Create a table of contents at the root" → {"tools": [{"name": "write", "params": {"format": "md", "title": "Table of Contents", "path": ""}}]}
- "Create a file in the docs folder" → {"tools": [{"name": "write", "params": {"format": "md", "title": "Document", "path": "docs"}}]}
- "Write a report in docs/reports" → {"tools": [{"name": "write", "params": {"format": "md", "title": "Report", "path": "docs/reports"}}]}
- "Create a markdown file with the summary" → {"tools": [{"name": "write", "params": {"format": "md", "title": "Summary"}}]}
- "Generate a DOCX document" → {"tools": [{"name": "write", "params": {"format": "docx", "title": "Document"}}]}
- "Crie um arquivo na raiz do projeto" → {"tools": [{"name": "write", "params": {"format": "md", "title": "Documento", "path": ""}}]}
- "Gerar um arquivo na pasta documentos" → {"tools": [{"name": "write", "params": {"format": "md", "title": "Arquivo", "path": "documentos"}}]}
- "Make a new file with this content" → {"tools": [{"name": "write", "params": {"format": "md", "title": "New File"}}]}
- "Save this as a file" → {"tools": [{"name": "write", "params": {"format": "md", "title": "Saved Content"}}]}

Notes:
- "Add a note about the meeting" → {"tools": [{"name": "addNote", "params": {"content": "Meeting notes about the project..."}}]}
- "Save this note: The deadline is next Friday" → {"tools": [{"name": "addNote", "params": {"content": "The deadline is next Friday"}}]}
- "Criar nota: reunião com cliente amanhã" → {"tools": [{"name": "addNote", "params": {"content": "reunião com cliente amanhã"}}]}
- "Take a note about the requirements" → {"tools": [{"name": "addNote", "params": {"content": "Requirements discussion..."}}]}
- "Anotar: precisamos revisar o contrato" → {"tools": [{"name": "addNote", "params": {"content": "precisamos revisar o contrato"}}]}

UpdateFile tool (editing existing files - Markdown/DOCX only):
- "Update the introduction section in document.md" → {"tools": [{"name": "updateFile", "params": {"file": "document.md", "section": "introduction", "operation": "replace", "newContent": "..."}}]}
- "Add a conclusion to the report.md" → {"tools": [{"name": "updateFile", "params": {"file": "report.md", "section": "end", "operation": "insert_after", "newContent": "..."}}]}
- "Replace the 'Requirements' section with new text" → {"tools": [{"name": "updateFile", "params": {"file": "...", "section": "Requirements", "operation": "replace"}}]}
- "Insert a new paragraph before the Summary in notes.md" → {"tools": [{"name": "updateFile", "params": {"file": "notes.md", "section": "Summary", "operation": "insert_before"}}]}
- "Atualizar a seção de metodologia no documento" → {"tools": [{"name": "updateFile", "params": {"file": "documento.md", "section": "metodologia", "operation": "replace"}}]}
- "Modificar o parágrafo sobre prazos" → {"tools": [{"name": "updateFile", "params": {"file": "...", "section": "prazos", "operation": "replace"}}]}
- "Change the deadline information in project.docx" → {"tools": [{"name": "updateFile", "params": {"file": "project.docx", "section": "deadline", "operation": "replace"}}]}

Multiple tools (complex queries):
- "Read both the contract and the proposal" → {"tools": [{"name": "read", "params": {"file": "contract"}}, {"name": "read", "params": {"file": "proposal"}}]}
- "Compare the two reports" → {"tools": [{"name": "read", "params": {"file": "report1"}}, {"name": "read", "params": {"file": "report2"}}]}
- "Summarize all my documents" → {"tools": [{"name": "summarize", "params": {"file": "doc1"}}, {"name": "summarize", "params": {"file": "doc2"}}]}
- "Read the contract and tell me about payment terms" → {"tools": [{"name": "read", "params": {"file": "contract"}}]}

Chained read + write operations:
- "Read the last 2 files and create a summary PDF" → {"tools": [{"name": "read", "params": {"file": "file1"}}, {"name": "read", "params": {"file": "file2"}}, {"name": "write", "params": {"format": "pdf", "title": "Summary"}}]}
- "Summarize document and save as DOCX" → {"tools": [{"name": "summarize", "params": {"file": "document"}}, {"name": "write", "params": {"format": "docx", "title": "Document Summary"}}]}

Project management (global mode):
- "Create a new project called Research" → {"tools": [{"name": "createProject", "params": {"name": "Research"}}]}
- "Create project 'Work Notes' with description 'Daily work notes'" → {"tools": [{"name": "createProject", "params": {"name": "Work Notes", "description": "Daily work notes"}}]}
- "Criar um novo projeto chamado Estudos" → {"tools": [{"name": "createProject", "params": {"name": "Estudos"}}]}

File operations:
- "Move notes.md from Personal to Work" → {"tools": [{"name": "moveFile", "params": {"file": "notes.md", "fromProject": "Personal", "toProject": "Work"}}]}
- "Delete old-notes.md" → {"tools": [{"name": "deleteFile", "params": {"file": "old-notes.md"}}]}
- "Remove the file report.pdf from Project X" → {"tools": [{"name": "deleteFile", "params": {"file": "report.pdf", "project": "Project X"}}]}
- "Apagar arquivo teste.md" → {"tools": [{"name": "deleteFile", "params": {"file": "teste.md"}}]}

Project deletion (ALWAYS include confirm: "yes" when user explicitly asks to delete):
- "Delete the project Old Stuff" → {"tools": [{"name": "deleteProject", "params": {"project": "Old Stuff", "confirm": "yes"}}]}
- "Remove project called Temp" → {"tools": [{"name": "deleteProject", "params": {"project": "Temp", "confirm": "yes"}}]}
- "Yes, delete project X" → {"tools": [{"name": "deleteProject", "params": {"project": "X", "confirm": "yes"}}]}
- "Deletar projeto Teste" → {"tools": [{"name": "deleteProject", "params": {"project": "Teste", "confirm": "yes"}}]}
- "Sim, apagar o projeto" → {"tools": [{"name": "deleteProject", "params": {"project": "...", "confirm": "yes"}}]}

Web research (searching the internet for current/external information):
- "Search the web for Vue 3 best practices" → {"tools": [{"name": "webResearch", "params": {"query": "Vue 3 best practices"}}]}
- "What's the latest news about AI?" → {"tools": [{"name": "webResearch", "params": {"query": "latest AI news"}}]}
- "Look up information about TypeScript 5 features" → {"tools": [{"name": "webResearch", "params": {"query": "TypeScript 5 new features"}}]}
- "Find on internet how to configure Vite" → {"tools": [{"name": "webResearch", "params": {"query": "Vite configuration guide"}}]}
- "Pesquisar na web sobre Ionic Capacitor" → {"tools": [{"name": "webResearch", "params": {"query": "Ionic Capacitor"}}]}
- "Buscar online notícias sobre tecnologia" → {"tools": [{"name": "webResearch", "params": {"query": "technology news"}}]}

Chaining web research with notes:
- "Search the web for React hooks and save as a note" → {"tools": [{"name": "webResearch", "params": {"query": "React hooks"}}, {"name": "addNote", "params": {"content": "..."}}]}

No tools (use existing context or conversation flow):
- "Explain the previous answer" → {"tools": []}
- "Thanks" → {"tools": []}
- "Hello" → {"tools": []}
- "Done" → {"tools": []}
- "Ok" → {"tools": []}
- "Yes" → {"tools": []}
- "I uploaded the files" → {"tools": []}
- "What documents/files do I have?" → {"tools": []} (files are listed in system prompt)
- "List my files" → {"tools": []} (files are listed in system prompt)
- "Quais arquivos eu tenho?" → {"tools": []} (files are listed in system prompt)

IMPORTANT: Short acknowledgments ("done", "ok", "yes", "pronto", "feito") after assistant asked for upload or action should NOT trigger clarification - proceed without tools.

Clarification needed (FALLBACK - only when truly ambiguous):
- "Read it" (no file specified AND no context) → {"tools": [], "clarification": "Which file would you like me to read?"}
- "Find something" (completely vague) → {"tools": [], "clarification": "What would you like me to search for in the documents?"}
- "Do something with the files" → {"tools": [], "clarification": "I can read, search, summarize, or generate documents. What would you like me to do?"}
- "Faça algo" (unclear) → {"tools": [], "clarification": "O que você gostaria que eu fizesse? Posso ler, buscar, resumir ou criar documentos."}`;

// ============================================
// Continuation Router (Sequential Message Handler)
// ============================================

/**
 * Prompt for analyzing if tools should be executed after an assistant response
 * Called after the main LLM responds to check if the response implies pending tool execution
 */
const CONTINUATION_ROUTER_PROMPT = `You are a tool execution analyzer. Your job is to analyze the assistant's latest response and determine if any tools should NOW be executed.

Context: The assistant has access to tools but sometimes it describes what it WILL do instead of actually executing the tool. Your job is to detect when the assistant has committed to an action and extract the tool call that should be executed.

Available tools:
- read: Read a file's content. Params: {file: "filename"}
- search: Search documents. Params: {query: "search query"}
- summarize: Summarize a document. Params: {file: "filename"}
- write: Create a new file. Params: {format: "md"|"pdf"|"docx", title: "title", content: "content", path: "optional/path"}
- addNote: Create a quick note. Params: {content: "note content", title: "optional title"}
- updateFile: Update an existing file. Params: {file: "filename", section: "section name OR special keyword", operation: "replace"|"insert_before"|"insert_after", newContent: "content"}
  Special section keywords: "end"/"bottom" = append at end of file, "start"/"beginning" = prepend at start of file
- webResearch: Search the web for information. Params: {query: "search query", maxResults: optional number}

Analyze the assistant's response and respond with JSON:
{
  "shouldExecuteTool": boolean,
  "tools": [{"name": "toolName", "params": {"key": "value"}}],
  "reasoning": "brief explanation"
}

Rules:
1. If assistant says "I will now...", "Let me...", "I'll add...", "I'll create...", "Proceeding to...", "Now, I will...", "Let's proceed", "Let's create", "Let's do that" → Extract the tool and params
2. If assistant already showed tool results or said "Done", "Created", "Added", "has been updated", "successfully created", "has been saved" → No tools needed
3. If assistant is asking a question like "Should I proceed?", "Would you like me to...", "Do you want me to..." → No tools needed (asking for confirmation)
4. For updateFile: Extract the file name, section identifier, operation, and the NEW CONTENT the assistant wrote/composed
5. For write: Extract format, title, and the FULL CONTENT the assistant composed

IMPORTANT: 
- Extract the ACTUAL content from the assistant's message
- If they wrote out new content to add to a file, include ALL of it in newContent
- Look for markdown content blocks that the assistant composed

Example 1 - Assistant committing to update a file:
Assistant: "Now, I will add a new section at the end of the file to explain its contents.\n\n## About This File\n\nThis file contains instructions for..."
→ {"shouldExecuteTool": true, "tools": [{"name": "updateFile", "params": {"file": "document.md", "section": "end", "operation": "insert_after", "newContent": "## About This File\n\nThis file contains instructions for..."}}], "reasoning": "Assistant committed to adding section with specific content"}

Example 2 - Assistant already completed:
Assistant: "I've added the new section to the file. The file has been updated successfully."
→ {"shouldExecuteTool": false, "tools": [], "reasoning": "Action already completed"}

Example 3 - Assistant asking for confirmation:
Assistant: "Here's what I'll add:\n\n## Summary\n...\n\nShould I proceed?"
→ {"shouldExecuteTool": false, "tools": [], "reasoning": "Assistant is asking for confirmation, not committing to action"}

Example 4 - Assistant committing to action with "Let's proceed":
Assistant: "I'll create a new Markdown file named 'meeting-notes' with the content you provided. Let's proceed with that."
→ {"shouldExecuteTool": true, "tools": [{"name": "write", "params": {"format": "md", "title": "meeting-notes", "content": "the content provided"}}], "reasoning": "Assistant is committing to create a file with 'Let's proceed'"}

Example 5 - Assistant just explaining:
Assistant: "The file contains documentation about server monitoring and database management."
→ {"shouldExecuteTool": false, "tools": [], "reasoning": "Informational response only"}`;

/**
 * Result from continuation analysis
 */
export interface ContinuationResult {
  shouldExecuteTool: boolean;
  tools: ToolCall[];
  reasoning: string;
}

/**
 * Analyze assistant response to determine if tools should be executed
 * Called after LLM generates a response to check for uncommitted tool actions
 */
export async function analyzeAssistantResponse(
  assistantResponse: string,
  conversationHistory: Array<{ role: string; content: string }>,
  projectFiles: string[],
): Promise<ContinuationResult> {
  const filesContext =
    projectFiles.length > 0
      ? `\n\nAvailable files in project: ${projectFiles.join(", ")}`
      : "\n\nNo files in project yet.";

  // Get last few messages for context
  const recentContext = conversationHistory
    .slice(-10)
    .map(
      (m) =>
        `${m.role === "user" ? "User" : "Assistant"}: ${m.content.substring(0, 500)}`,
    )
    .join("\n\n");

  console.log("[DEBUG-FLOW] analyzeAssistantResponse: sending to LLM...");
  const response = await chatCompletion({
    messages: [
      { role: "system", content: CONTINUATION_ROUTER_PROMPT + filesContext },
      {
        role: "user",
        content: `Recent conversation:\n${recentContext}\n\n---\n\nLatest assistant response to analyze:\n${assistantResponse}`,
      },
    ],
    temperature: 0,
    maxTokens: 1000, // Higher limit to capture content
  });
  console.log("[DEBUG-FLOW] analyzeAssistantResponse: LLM raw response:", response.content);

  try {
    let jsonStr = response.content.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    console.log("[DEBUG-FLOW] analyzeAssistantResponse: parsed JSON string:", jsonStr);

    const parsed = JSON.parse(jsonStr);
    console.log("[DEBUG-FLOW] analyzeAssistantResponse: parsed object:", parsed);

    const tools: ToolCall[] = (parsed.tools || []).map(
      (t: { name: string; params?: Record<string, string> }) => ({
        tool: t.name as ToolName,
        params: t.params || {},
      }),
    );

    return {
      shouldExecuteTool: parsed.shouldExecuteTool || false,
      tools,
      reasoning: parsed.reasoning || "",
    };
  } catch (e) {
    console.log("[DEBUG-FLOW] analyzeAssistantResponse: PARSE ERROR:", e);
    return {
      shouldExecuteTool: false,
      tools: [],
      reasoning: "Failed to parse continuation analysis",
    };
  }
}

/**
 * Result from routing a message
 */
export interface RoutingResult {
  tools: ToolCall[];
  clarification?: string;
}

/**
 * Route user message through router LLM to determine tool usage
 */
export async function routeMessage(
  userMessage: string,
  projectFiles: string[],
  conversationContext?: string,
): Promise<RoutingResult> {
  const filesContext =
    projectFiles.length > 0
      ? `\n\nAvailable files in project: ${projectFiles.join(", ")}`
      : "\n\nNo files uploaded yet.";

  const contextInfo = conversationContext
    ? `\n\nRecent conversation context:\n${conversationContext}`
    : "";
  console.log("Routing message with context:", contextInfo);

  const response = await chatCompletion({
    messages: [
      { role: "system", content: ROUTER_PROMPT + filesContext + contextInfo },
      { role: "user", content: userMessage },
    ],
    temperature: 0,
    maxTokens: 300,
  });

  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = response.content.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    // Check for clarification request
    if (parsed.clarification && typeof parsed.clarification === "string") {
      return {
        tools: [],
        clarification: parsed.clarification,
      };
    }

    if (!parsed.tools || !Array.isArray(parsed.tools)) {
      return { tools: [] };
    }

    const tools = parsed.tools.map(
      (t: { name: string; params?: Record<string, string> }) => ({
        tool: t.name as ToolName,
        params: t.params || {},
      }),
    );

    return { tools };
  } catch {
    // If parsing fails, no tools needed
    return { tools: [] };
  }
}

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
 * Section identification prompt for LLM
 */
const SECTION_IDENTIFICATION_PROMPT = `You are a document section identifier. Given a document and a section description, identify the exact section to modify.

Your task:
1. Analyze the document structure (headings, paragraphs, sections)
2. Find the section that best matches the user's description
3. Return the exact text boundaries of that section

SPECIAL CASES:
- If the user wants to insert at the END/BOTTOM of the document (e.g., "end", "bottom", "EOF", "final", "append", "after everything"):
  - Set found: true
  - Set sectionContent to the LAST paragraph or last few lines of the document
  - Set sectionStart/sectionEnd to match that last content
  - This allows insert_after to append content at the end of the file
  - Use confidence 1.0 for clear end-of-file requests

- If the user wants to insert at the BEGINNING/TOP (e.g., "start", "beginning", "top", "first"):
  - Set found: true
  - Set sectionContent to the FIRST paragraph or first few lines
  - This allows insert_before to prepend content at the start

Response format (JSON only):
{
  "found": true/false,
  "sectionStart": "exact text where section starts (first 50 chars)",
  "sectionEnd": "exact text where section ends (last 50 chars)", 
  "sectionContent": "the full content of the identified section",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation of why this section was chosen"
}

If the section is not found, return:
{
  "found": false,
  "confidence": 0,
  "reasoning": "explanation of why section was not found"
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
 * Identify section in document using LLM
 */
async function identifySection(
  content: string,
  sectionIdentifier: string,
  identificationMethod?: string,
): Promise<{
  found: boolean;
  sectionContent: string;
  sectionStart: number;
  sectionEnd: number;
  confidence: number;
  reasoning?: string;
}> {
  // Special handling for "end"/"bottom" keywords - append at end of document
  const endKeywords = ["end", "bottom", "eof", "fim", "final", "末尾"];
  if (endKeywords.includes(sectionIdentifier.toLowerCase().trim())) {
    // Return the last character position for insert_after operations
    const trimmedContent = content.trimEnd();
    return {
      found: true,
      sectionContent: "",
      sectionStart: trimmedContent.length,
      sectionEnd: trimmedContent.length,
      confidence: 1.0,
      reasoning: `Special keyword "${sectionIdentifier}" - targeting end of document`,
    };
  }

  // Special handling for "start"/"beginning" keywords - prepend at start of document
  const startKeywords = ["start", "beginning", "top", "início", "inicio", "開始"];
  if (startKeywords.includes(sectionIdentifier.toLowerCase().trim())) {
    return {
      found: true,
      sectionContent: "",
      sectionStart: 0,
      sectionEnd: 0,
      confidence: 1.0,
      reasoning: `Special keyword "${sectionIdentifier}" - targeting start of document`,
    };
  }

  // Try header-based identification first for markdown
  if (!identificationMethod || identificationMethod === "header") {
    const headerPattern = new RegExp(
      `^(#{1,6})\\s*${escapeRegex(sectionIdentifier)}\\s*$`,
      "im",
    );
    const headerMatch = content.match(headerPattern);

    if (headerMatch) {
      const headerLevel = headerMatch[1].length;
      const startIndex = headerMatch.index!;

      // Find the end of this section (next header of same or higher level, or end of file)
      const afterHeader = content.slice(startIndex + headerMatch[0].length);
      const nextHeaderPattern = new RegExp(`^#{1,${headerLevel}}\\s+`, "m");
      const nextHeaderMatch = afterHeader.match(nextHeaderPattern);

      const endIndex = nextHeaderMatch
        ? startIndex + headerMatch[0].length + nextHeaderMatch.index!
        : content.length;

      return {
        found: true,
        sectionContent: content.slice(startIndex, endIndex).trim(),
        sectionStart: startIndex,
        sectionEnd: endIndex,
        confidence: 1.0,
        reasoning: `Found header matching "${sectionIdentifier}"`,
      };
    }
  }

  // Try exact match
  if (!identificationMethod || identificationMethod === "exact_match") {
    const exactIndex = content.indexOf(sectionIdentifier);
    if (exactIndex !== -1) {
      return {
        found: true,
        sectionContent: sectionIdentifier,
        sectionStart: exactIndex,
        sectionEnd: exactIndex + sectionIdentifier.length,
        confidence: 1.0,
        reasoning: "Exact text match found",
      };
    }
  }

  // Fall back to semantic identification using LLM
  const response = await chatCompletion({
    messages: [
      { role: "system", content: SECTION_IDENTIFICATION_PROMPT },
      {
        role: "user",
        content: `Document:\n\n${content}\n\n---\n\nSection to find: "${sectionIdentifier}"`,
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

    const result = JSON.parse(jsonStr);

    if (!result.found) {
      return {
        found: false,
        sectionContent: "",
        sectionStart: -1,
        sectionEnd: -1,
        confidence: 0,
        reasoning: result.reasoning,
      };
    }

    // Find the section in the original content
    const sectionIndex = content.indexOf(result.sectionContent);
    if (sectionIndex === -1) {
      // Try to find by start marker
      const startIndex = content.indexOf(result.sectionStart);
      if (startIndex !== -1) {
        const endIndex = content.indexOf(result.sectionEnd, startIndex);
        if (endIndex !== -1) {
          return {
            found: true,
            sectionContent: content.slice(
              startIndex,
              endIndex + result.sectionEnd.length,
            ),
            sectionStart: startIndex,
            sectionEnd: endIndex + result.sectionEnd.length,
            confidence: result.confidence || 0.8,
            reasoning: result.reasoning,
          };
        }
      }

      return {
        found: false,
        sectionContent: "",
        sectionStart: -1,
        sectionEnd: -1,
        confidence: 0,
        reasoning: "Could not locate section boundaries in document",
      };
    }

    return {
      found: true,
      sectionContent: result.sectionContent,
      sectionStart: sectionIndex,
      sectionEnd: sectionIndex + result.sectionContent.length,
      confidence: result.confidence || 0.8,
      reasoning: result.reasoning,
    };
  } catch {
    return {
      found: false,
      sectionContent: "",
      sectionStart: -1,
      sectionEnd: -1,
      confidence: 0,
      reasoning: "Failed to parse section identification response",
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

    // Identify the section to update
    const sectionResult = await identifySection(
      content,
      params.sectionIdentifier,
      params.identificationMethod,
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
      console.warn("Failed to parse tool call JSON:", jsonStr);
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
// Orchestrated Execution
// ============================================

export interface OrchestratedResult {
  /** All responses from the assistant (may be multiple for multi-step requests) */
  responses: string[];
  /** Final concatenated response */
  response: string;
  toolsUsed: ToolCall[];
  toolResults: ToolResult[];
  /** Whether a clarification was requested */
  clarificationRequested?: boolean;
}

/**
 * Completion check prompt - asks the LLM if the user's request is fully satisfied
 */
const COMPLETION_CHECK_PROMPT = `Based on the conversation, is the user's original request FULLY completed?
Consider: Did all requested actions finish? Were all requested outputs delivered?

Respond with ONLY one word:
- "COMPLETE" if everything the user asked for has been done
- "INCOMPLETE" if there are still pending actions or outputs to deliver`;

/**
 * Check if the user's request is complete
 */
async function isRequestComplete(
  originalRequest: string,
  conversationSoFar: Array<{ role: string; content: string }>,
  toolResults: ToolResult[],
): Promise<boolean> {
  const context = conversationSoFar
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n");
  const toolSummary = toolResults
    .map((r) => `${r.tool}: ${r.success ? "success" : "failed"}`)
    .join(", ");

  const response = await chatCompletion({
    messages: [
      { role: "system", content: COMPLETION_CHECK_PROMPT },
      {
        role: "user",
        content: `Original request: "${originalRequest}"\n\nTools executed: ${toolSummary || "none"}\n\nConversation:\n${context}`,
      },
    ],
    temperature: 0,
    maxTokens: 10,
  });

  return response.content.trim().toUpperCase().includes("COMPLETE");
}

/**
 * Execute the full tool-assisted chat flow with logging
 * Supports both router-based tool detection AND inline tool calls from LLM response
 * Also includes checkpoint analysis for sequential message handling (confirmations)
 * @param projectId - Project ID, or undefined for global mode
 * @param onStreamChunk - Optional callback for streaming response chunks
 */
export async function orchestrateToolExecution(
  projectId: string | undefined,
  userMessage: string,
  systemPrompt: string,
  conversationHistory: Array<{ role: string; content: string }>,
  projectFiles: string[],
  onStepUpdate?: ExecutionLogCallback,
  onStreamChunk?: LLMStreamCallback,
): Promise<OrchestratedResult> {
  console.log("[DEBUG-FLOW] ========== orchestrateToolExecution START ==========");
  console.log("[DEBUG-FLOW] Input:", {
    projectId,
    userMessage: userMessage.substring(0, 100) + (userMessage.length > 100 ? "..." : ""),
    conversationHistoryLength: conversationHistory.length,
    projectFilesCount: projectFiles.length,
    projectFiles: projectFiles.slice(0, 5),
  });

  const steps: ExecutionStep[] = [];
  const allResponses: string[] = [];
  const allToolCalls: ToolCall[] = [];
  const allToolResults: ToolResult[] = [];
  const failedToolSignatures = new Set<string>(); // Track failed tool calls to prevent retry loops

  const updateStep = (step: ExecutionStep) => {
    const idx = steps.findIndex((s) => s.id === step.id);
    if (idx >= 0) {
      steps[idx] = step;
    } else {
      steps.push(step);
    }
    onStepUpdate?.(steps);
  };

  // Build initial messages array
  const messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [
    { role: "system", content: systemPrompt },
    ...conversationHistory.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: userMessage },
  ];

  const MAX_ITERATIONS = 5;
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    console.log(`[DEBUG-FLOW] ========== ITERATION ${iteration} ==========`);
    const iterationSuffix = iteration > 1 ? ` (step ${iteration})` : "";

    // Step 1: Router-based tool detection (first iteration only, as a hint)
    let routerToolCalls: ToolCall[] = [];

    if (iteration === 1) {
      const routingStep: ExecutionStep = {
        id: `routing-${iteration}`,
        type: "routing",
        status: "running",
        label: `Analyzing request${iterationSuffix}...`,
        startTime: new Date(),
      };
      updateStep(routingStep);

      try {
        // Build conversation context from recent messages (last 4 exchanges)
        const recentHistory = conversationHistory
          .slice(-4)
          .map(
            (m) =>
              `${m.role === "user" ? "User" : "Assistant"}: ${m.content.substring(0, 200)}${m.content.length > 200 ? "..." : ""}`,
          )
          .join("\n");

        console.log("[DEBUG-FLOW] Calling routeMessage...");
        const routingResult = await routeMessage(
          userMessage,
          projectFiles,
          recentHistory,
        );
        console.log("[DEBUG-FLOW] routeMessage result:", {
          toolsCount: routingResult.tools.length,
          tools: routingResult.tools.map(t => ({ tool: t.tool, params: t.params })),
          clarification: routingResult.clarification,
        });

        // Check if clarification is needed
        if (routingResult.clarification) {
          routingStep.status = "completed";
          routingStep.endTime = new Date();
          routingStep.detail = "Clarification needed";
          updateStep(routingStep);

          return {
            responses: [routingResult.clarification],
            response: routingResult.clarification,
            toolsUsed: [],
            toolResults: [],
            clarificationRequested: true,
          };
        }

        routerToolCalls = routingResult.tools;

        routingStep.status = "completed";
        routingStep.endTime = new Date();
        routingStep.detail =
          routerToolCalls.length > 0
            ? `Tools to execute: ${routerToolCalls.map((t) => t.tool).join(", ")}`
            : "Proceeding to LLM";
        updateStep(routingStep);
      } catch {
        routingStep.status = "completed";
        routingStep.detail = "Proceeding to LLM";
        routingStep.endTime = new Date();
        updateStep(routingStep);
      }
    }

    // Step 2: Execute router-detected tools (if any)
    console.log("[DEBUG-FLOW] Router tools to execute:", routerToolCalls.length);
    for (const call of routerToolCalls) {
      // Skip if already executed or already failed with same params
      const callKey = `${call.tool}-${JSON.stringify(call.params)}`;
      if (
        allToolCalls.some(
          (t) => `${t.tool}-${JSON.stringify(t.params)}` === callKey,
        ) ||
        failedToolSignatures.has(callKey)
      ) {
        continue;
      }

      const toolStep: ExecutionStep = {
        id: `tool-${call.tool}-${Date.now()}`,
        type: "tool",
        status: "running",
        label: `Running ${call.tool}`,
        detail:
          call.params.file ||
          call.params.fileName ||
          call.params.query ||
          call.params.title,
        startTime: new Date(),
      };
      updateStep(toolStep);

      console.log("[DEBUG-FLOW] Executing router tool:", call.tool, call.params);
      const result = await executeTool(projectId, call, userMessage);
      console.log("[DEBUG-FLOW] Router tool result:", { tool: call.tool, success: result.success, error: result.error });
      allToolResults.push(result);
      allToolCalls.push(call);

      // Track failed tools to prevent retry loops
      if (!result.success) {
        failedToolSignatures.add(callKey);
      }

      toolStep.status = result.success ? "completed" : "error";
      toolStep.endTime = new Date();
      toolStep.detail = result.success
        ? result.metadata?.fileName || "Done"
        : result.error;
      updateStep(toolStep);
    }

    // Step 3: Add tool results to messages if any router tools were executed
    if (routerToolCalls.length > 0) {
      const successResults = allToolResults.filter((r) => r.success);
      if (successResults.length > 0) {
        const toolContext = formatToolResults(successResults);
        messages.push({
          role: "user",
          content: `[System: Tool results]\n\n${toolContext}`,
        });
      }
    }

    // Step 4: Generate LLM response (without streaming initially to parse tool calls)
    const responseStep: ExecutionStep = {
      id: `response-${iteration}`,
      type: "response",
      status: "running",
      label: `Generating response${iterationSuffix}...`,
      startTime: new Date(),
    };
    updateStep(responseStep);

    // Generate response with streaming, accumulating content to parse for tool calls after
    console.log("[DEBUG-FLOW] Calling chatCompletion (streaming with accumulation)...");
    
    let llmResponse: { content: string };
    if (onStreamChunk) {
      // Stream to user while accumulating full response
      // Filter out tool_call blocks so user doesn't see raw JSON
      let streamBuffer = "";
      let inToolCallBlock = false;
      let toolCallBuffer = "";
      
      llmResponse = await chatCompletionStreaming({ messages }, (chunk, done) => {
        if (done) {
          // Flush any remaining buffer that's not a tool call
          if (streamBuffer && !streamBuffer.includes("```tool_call")) {
            onStreamChunk(streamBuffer, false);
          }
          // Don't signal done yet - we may have tools to execute
          return;
        }
        
        // Accumulate chunk
        streamBuffer += chunk;
        
        // Process buffer to filter out tool_call blocks
        while (streamBuffer.length > 0) {
          if (inToolCallBlock) {
            // Looking for closing ```
            const closeIdx = streamBuffer.indexOf("```");
            if (closeIdx !== -1) {
              // Found closing, discard the tool call block
              toolCallBuffer += streamBuffer.substring(0, closeIdx + 3);
              streamBuffer = streamBuffer.substring(closeIdx + 3);
              inToolCallBlock = false;
              toolCallBuffer = "";
              console.log("[DEBUG-FLOW] Filtered out tool_call block from stream");
            } else {
              // Still in tool call block, keep buffering
              toolCallBuffer += streamBuffer;
              streamBuffer = "";
            }
          } else {
            // Looking for ```tool_call
            const toolCallStart = streamBuffer.indexOf("```tool_call");
            const tripleBacktick = streamBuffer.indexOf("```");
            
            if (toolCallStart !== -1) {
              // Found tool_call block start
              // Stream everything before it
              if (toolCallStart > 0) {
                onStreamChunk(streamBuffer.substring(0, toolCallStart), false);
              }
              streamBuffer = streamBuffer.substring(toolCallStart + 12); // Skip "```tool_call"
              inToolCallBlock = true;
              toolCallBuffer = "```tool_call";
            } else if (tripleBacktick !== -1 && streamBuffer.length < tripleBacktick + 12) {
              // We see ``` but don't have enough chars to know if it's tool_call
              // Stream everything before the ```
              if (tripleBacktick > 0) {
                onStreamChunk(streamBuffer.substring(0, tripleBacktick), false);
                streamBuffer = streamBuffer.substring(tripleBacktick);
              }
              // Keep buffering to see what comes after ```
              break;
            } else {
              // No tool_call block in sight, safe to stream
              // But keep last 11 chars in case "```tool_call" is split across chunks
              const safeLength = Math.max(0, streamBuffer.length - 11);
              if (safeLength > 0) {
                onStreamChunk(streamBuffer.substring(0, safeLength), false);
                streamBuffer = streamBuffer.substring(safeLength);
              }
              break;
            }
          }
        }
      });
    } else {
      // No streaming callback, use regular completion
      llmResponse = await chatCompletion({ messages });
    }
    
    console.log("[DEBUG-FLOW] LLM response received:", {
      contentLength: llmResponse.content.length,
      contentPreview: llmResponse.content.substring(0, 200) + (llmResponse.content.length > 200 ? "..." : ""),
    });

    // Step 5: Parse response for inline tool calls (after streaming completes)
    const parsed = parseToolCallsFromResponse(llmResponse.content);
    console.log("[DEBUG-FLOW] parseToolCallsFromResponse result:", {
      hasToolCalls: parsed.hasToolCalls,
      toolCallsCount: parsed.toolCalls.length,
      toolCalls: parsed.toolCalls.map(t => ({ tool: t.tool, params: t.params })),
      textContentLength: parsed.textContent?.length || 0,
    });

    if (parsed.hasToolCalls) {
      responseStep.status = "completed";
      responseStep.endTime = new Date();
      responseStep.label = `Found ${parsed.toolCalls.length} tool call(s)`;
      updateStep(responseStep);

      // Note: Content already streamed above, no need to re-stream

      // Step 6: Execute inline tool calls from LLM response
      const inlineResults: ToolResult[] = [];

      for (const call of parsed.toolCalls) {
        // Skip if already executed or already failed with same params
        const callKey = `${call.tool}-${JSON.stringify(call.params)}`;
        if (
          allToolCalls.some(
            (t) => `${t.tool}-${JSON.stringify(t.params)}` === callKey,
          ) ||
          failedToolSignatures.has(callKey)
        ) {
          continue;
        }

        const toolStep: ExecutionStep = {
          id: `inline-tool-${call.tool}-${Date.now()}`,
          type: "tool",
          status: "running",
          label: `Executing ${call.tool}`,
          detail:
            call.params.file ||
            call.params.fileName ||
            call.params.query ||
            call.params.title ||
            call.params.content?.substring(0, 30),
          startTime: new Date(),
        };
        updateStep(toolStep);

        console.log("[DEBUG-FLOW] Executing inline tool:", call.tool, call.params);
        const result = await executeTool(projectId, call, userMessage);
        console.log("[DEBUG-FLOW] Inline tool result:", { tool: call.tool, success: result.success, error: result.error });
        inlineResults.push(result);
        allToolResults.push(result);
        allToolCalls.push(call);

        // Track failed tools to prevent retry loops
        if (!result.success) {
          failedToolSignatures.add(callKey);
        }

        toolStep.status = result.success ? "completed" : "error";
        toolStep.endTime = new Date();
        toolStep.detail = result.success
          ? result.metadata?.fileName || "Done"
          : result.error;
        updateStep(toolStep);
      }

      // Step 7: Add inline tool results and get final response
      if (inlineResults.length > 0) {
        // Add assistant's partial response
        messages.push({
          role: "assistant",
          content: parsed.textContent || "Executing tools...",
        });

        // Add tool results
        const toolContext = formatToolResults(inlineResults);
        messages.push({
          role: "user",
          content: `[System: Tool execution results]\n\n${toolContext}\n\nPlease summarize the results for the user.`,
        });

        // Generate final response with results
        const finalStep: ExecutionStep = {
          id: `final-response-${iteration}`,
          type: "response",
          status: "running",
          label: "Summarizing results...",
          startTime: new Date(),
        };
        updateStep(finalStep);

        let finalResponse;
        if (onStreamChunk) {
          // Add separator since initial response was already streamed
          onStreamChunk("\n\n", false);
          finalResponse = await chatCompletionStreaming(
            { messages },
            onStreamChunk,
          );
        } else {
          finalResponse = await chatCompletion({ messages });
        }

        finalStep.status = "completed";
        finalStep.endTime = new Date();
        finalStep.label = "Response ready";
        updateStep(finalStep);

        // Build combined response (initial response already streamed, this is the full content for storage)
        const combinedResponse = `${llmResponse.content}\n\n${finalResponse.content}`;

        allResponses.push(combinedResponse);
        messages.push({ role: "assistant", content: finalResponse.content });
      } else {
        // No tools actually executed (maybe all were duplicates)
        allResponses.push(parsed.textContent || llmResponse.content);
        messages.push({ role: "assistant", content: llmResponse.content });
      }
    } else {
      // No inline tool calls in response - mark response generation complete
      responseStep.status = "completed";
      responseStep.endTime = new Date();
      responseStep.label = "Response generated";
      updateStep(responseStep);

      // Note: Response already streamed above during generation

      // Add planning step for continuation analysis
      const planningStep: ExecutionStep = {
        id: `planning-${iteration}`,
        type: "routing",
        status: "running",
        label: "Planning next moves...",
        startTime: new Date(),
      };
      updateStep(planningStep);

      // Run continuation analysis to check if assistant said "I will now..." without executing
      console.log("[DEBUG-FLOW] ========== CONTINUATION ANALYSIS START ==========");
      console.log("[DEBUG-FLOW] Calling analyzeAssistantResponse with:", {
        responseLength: llmResponse.content.length,
        responsePreview: llmResponse.content.substring(0, 300) + (llmResponse.content.length > 300 ? "..." : ""),
        conversationHistoryLength: conversationHistory.length + 1,
        projectFilesCount: projectFiles.length,
      });
      const continuationResult = await analyzeAssistantResponse(
        llmResponse.content,
        [...conversationHistory, { role: "user", content: userMessage }],
        projectFiles,
      );
      console.log("[DEBUG-FLOW] analyzeAssistantResponse result:", {
        shouldExecuteTool: continuationResult.shouldExecuteTool,
        toolsCount: continuationResult.tools.length,
        tools: continuationResult.tools.map(t => ({ tool: t.tool, params: t.params })),
        reasoning: continuationResult.reasoning,
      });

      if (
        continuationResult.shouldExecuteTool &&
        continuationResult.tools.length > 0
      ) {
        console.log("[DEBUG-FLOW] Continuation detected - will execute tools");
        // Filter out tools that have already failed to prevent retry loops
        const toolsToExecute = continuationResult.tools.filter((call) => {
          const callKey = `${call.tool}-${JSON.stringify(call.params)}`;
          return !failedToolSignatures.has(callKey);
        });

        if (toolsToExecute.length === 0) {
          // All requested tools have already failed - don't retry
          planningStep.label = "Skipped (tools already failed)";
          planningStep.status = "completed";
          planningStep.endTime = new Date();
          updateStep(planningStep);

          // Signal streaming completion
          if (onStreamChunk) {
            onStreamChunk("", true);
          }

          allResponses.push(llmResponse.content);
          messages.push({ role: "assistant", content: llmResponse.content });
          break; // Exit the loop - don't keep retrying failed operations
        }

        // Assistant committed to action - execute the tools
        planningStep.label = `Executing: ${continuationResult.reasoning}`;
        planningStep.status = "completed";
        planningStep.endTime = new Date();
        updateStep(planningStep);

        const continuationResults: ToolResult[] = [];
        console.log("[DEBUG-FLOW] Continuation tools to execute:", toolsToExecute.length);

        for (const call of toolsToExecute) {
          const callKey = `${call.tool}-${JSON.stringify(call.params)}`;

          const toolStep: ExecutionStep = {
            id: `continuation-tool-${call.tool}-${Date.now()}`,
            type: "tool",
            status: "running",
            label: `Executing ${call.tool}`,
            detail:
              call.params.file ||
              call.params.fileName ||
              call.params.title ||
              "Processing...",
            startTime: new Date(),
          };
          updateStep(toolStep);

          console.log("[DEBUG-FLOW] Executing continuation tool:", call.tool, call.params);
          const result = await executeTool(projectId, call, userMessage);
          console.log("[DEBUG-FLOW] Continuation tool result:", { tool: call.tool, success: result.success, error: result.error });
          continuationResults.push(result);
          allToolResults.push(result);
          allToolCalls.push(call);

          // Track failed tools to prevent retry loops
          if (!result.success) {
            failedToolSignatures.add(callKey);
          }

          toolStep.status = result.success ? "completed" : "error";
          toolStep.endTime = new Date();
          toolStep.detail = result.success
            ? result.metadata?.fileName || "Done"
            : result.error;
          updateStep(toolStep);
        }

        // Add tool results and generate final response
        console.log("[DEBUG-FLOW] Continuation results summary:", {
          total: continuationResults.length,
          successful: continuationResults.filter(r => r.success).length,
          failed: continuationResults.filter(r => !r.success).length,
        });
        if (continuationResults.some((r) => r.success)) {
          console.log("[DEBUG-FLOW] Some continuation tools succeeded - generating confirmation response");
          messages.push({ role: "assistant", content: llmResponse.content });

          const toolContext = formatToolResults(continuationResults);
          messages.push({
            role: "user",
            content: `[System: Tool execution completed]\n\n${toolContext}\n\nBriefly confirm the action was completed.`,
          });

          const confirmStep: ExecutionStep = {
            id: `confirm-response-${iteration}`,
            type: "response",
            status: "running",
            label: "Confirming completion...",
            startTime: new Date(),
          };
          updateStep(confirmStep);

          let confirmResponse;
          if (onStreamChunk) {
            onStreamChunk("\n\n", false); // Add separator
            confirmResponse = await chatCompletionStreaming(
              { messages },
              onStreamChunk,
            );
          } else {
            confirmResponse = await chatCompletion({ messages });
          }

          confirmStep.status = "completed";
          confirmStep.endTime = new Date();
          confirmStep.label = "Complete";
          updateStep(confirmStep);

          const combinedResponse = `${llmResponse.content}\n\n${confirmResponse.content}`;
          allResponses.push(combinedResponse);
          messages.push({
            role: "assistant",
            content: confirmResponse.content,
          });
        } else {
          // ALL tools failed - add error context and break to prevent retry loops
          console.log("[DEBUG-FLOW] All continuation tools failed - generating error response");
          messages.push({ role: "assistant", content: llmResponse.content });

          const toolContext = formatToolResults(continuationResults);
          messages.push({
            role: "user",
            content: `[System: Tool execution FAILED]\n\n${toolContext}\n\nDo NOT retry these operations. Explain the error to the user and suggest alternatives.`,
          });

          const errorStep: ExecutionStep = {
            id: `error-response-${iteration}`,
            type: "response",
            status: "running",
            label: "Explaining error...",
            startTime: new Date(),
          };
          updateStep(errorStep);

          let errorResponse;
          if (onStreamChunk) {
            onStreamChunk("\n\n", false);
            errorResponse = await chatCompletionStreaming(
              { messages },
              onStreamChunk,
            );
          } else {
            errorResponse = await chatCompletion({ messages });
          }

          errorStep.status = "completed";
          errorStep.endTime = new Date();
          errorStep.label = "Complete";
          updateStep(errorStep);

          const combinedResponse = `${llmResponse.content}\n\n${errorResponse.content}`;
          allResponses.push(combinedResponse);
          messages.push({ role: "assistant", content: errorResponse.content });

          // Break the loop - don't keep retrying failed operations
          break;
        }
      } else {
        // No continuation needed - complete planning step
        console.log("[DEBUG-FLOW] No continuation needed - completing");
        planningStep.label = "Complete";
        planningStep.status = "completed";
        planningStep.endTime = new Date();
        updateStep(planningStep);

        // Signal streaming completion (content already streamed earlier)
        if (onStreamChunk) {
          onStreamChunk("", true);
        }

        allResponses.push(llmResponse.content);
        messages.push({ role: "assistant", content: llmResponse.content });
      }
    }

    // Step 8: Check if more iterations needed (only if we had tool calls)
    if (
      (parsed.hasToolCalls || allToolCalls.length > 0) &&
      iteration < MAX_ITERATIONS
    ) {
      // Check if the response still contains unfulfilled requests
      const lastResponse = allResponses[allResponses.length - 1];
      const stillHasToolCalls =
        parseToolCallsFromResponse(lastResponse).hasToolCalls;

      if (!stillHasToolCalls) {
        // No more tool calls, we're done
        console.log("[DEBUG-FLOW] Breaking loop: no more tool calls in last response");
        break;
      }
    } else {
      // No tool calls in this iteration, we're done
      console.log("[DEBUG-FLOW] Breaking loop: no tool calls in this iteration");
      break;
    }
  }

  // Combine all responses
  const finalResponse =
    allResponses.length === 1
      ? allResponses[0]
      : allResponses[allResponses.length - 1]; // Use the last (most complete) response

  console.log("[DEBUG-FLOW] ========== orchestrateToolExecution END ==========");
  console.log("[DEBUG-FLOW] Final result:", {
    responsesCount: allResponses.length,
    finalResponseLength: finalResponse.length,
    toolsUsedCount: allToolCalls.length,
    toolsUsed: allToolCalls.map(t => t.tool),
    toolResultsCount: allToolResults.length,
    successfulTools: allToolResults.filter(r => r.success).length,
    failedTools: allToolResults.filter(r => !r.success).length,
  });

  return {
    responses: allResponses,
    response: finalResponse,
    toolsUsed: allToolCalls,
    toolResults: allToolResults,
  };
}
