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
  GeneratedDocument,
} from '../types';
import { DEFAULT_PROGRESSIVE_READ_CONFIG } from '../types';
import { get_project_files, get_file_chunks, getFile, searchProject } from './projectService';
import { chatCompletion } from './llmService';
import { generateDocument } from './documentGeneratorService';

// ============================================
// Execution Log Types
// ============================================

export interface ExecutionStep {
  id: string;
  type: 'routing' | 'tool' | 'response';
  status: 'pending' | 'running' | 'completed' | 'error';
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
- write: Generate a new document (PDF, DOCX, or Markdown). Use when user wants to create, write, generate, or produce a document. Keywords: write, create, generate, produce, make, escreva, crie, gerar, criar documento, gerar pdf, gerar docx, gerar markdown, write a report, create a document, make a summary document, create note, save as markdown.

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
- "Write a report about the project" → {"tools": [{"name": "write", "params": {"format": "pdf", "title": "Project Report"}}]}
- "Crie um documento PDF com o resumo" → {"tools": [{"name": "write", "params": {"format": "pdf", "title": "Resumo"}}]}
- "Generate a DOCX summary" → {"tools": [{"name": "write", "params": {"format": "docx", "title": "Summary Document"}}]}
- "Gerar PDF do relatório" → {"tools": [{"name": "write", "params": {"format": "pdf", "title": "Relatório"}}]}
- "Create a markdown note" → {"tools": [{"name": "write", "params": {"format": "md", "title": "Note"}}]}
- "Save this as markdown" → {"tools": [{"name": "write", "params": {"format": "md", "title": "Document"}}]}
- "Crie uma nota em markdown" → {"tools": [{"name": "write", "params": {"format": "md", "title": "Nota"}}]}

Multiple tools (complex queries):
- "Read both the contract and the proposal" → {"tools": [{"name": "read", "params": {"file": "contract"}}, {"name": "read", "params": {"file": "proposal"}}]}
- "Compare the two reports" → {"tools": [{"name": "read", "params": {"file": "report1"}}, {"name": "read", "params": {"file": "report2"}}]}
- "Summarize all my documents" → {"tools": [{"name": "summarize", "params": {"file": "doc1"}}, {"name": "summarize", "params": {"file": "doc2"}}]}
- "Read the contract and tell me about payment terms" → {"tools": [{"name": "read", "params": {"file": "contract"}}]}

Chained read + write operations:
- "Read the last 2 files and create a summary PDF" → {"tools": [{"name": "read", "params": {"file": "file1"}}, {"name": "read", "params": {"file": "file2"}}, {"name": "write", "params": {"format": "pdf", "title": "Summary"}}]}
- "Summarize document and save as DOCX" → {"tools": [{"name": "summarize", "params": {"file": "document"}}, {"name": "write", "params": {"format": "docx", "title": "Document Summary"}}]}

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
  conversationContext?: string
): Promise<RoutingResult> {
  const filesContext = projectFiles.length > 0 
    ? `\n\nAvailable files in project: ${projectFiles.join(', ')}`
    : '\n\nNo files uploaded yet.';

  const contextInfo = conversationContext 
    ? `\n\nRecent conversation context:\n${conversationContext}`
    : '';

  const response = await chatCompletion({
    messages: [
      { role: 'system', content: ROUTER_PROMPT + filesContext + contextInfo },
      { role: 'user', content: userMessage },
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
    if (parsed.clarification && typeof parsed.clarification === 'string') {
      return {
        tools: [],
        clarification: parsed.clarification,
      };
    }
    
    if (!parsed.tools || !Array.isArray(parsed.tools)) {
      return { tools: [] };
    }

    const tools = parsed.tools.map((t: { name: string; params?: Record<string, string> }) => ({
      tool: t.name as ToolName,
      params: t.params || {},
    }));

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
  params: ReadToolParams
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
    let file = files.find(f => f.name.toLowerCase() === searchName);
    
    // Partial match if no exact match
    if (!file) {
      file = files.find(f => f.name.toLowerCase().includes(searchName));
    }
    
    return file || null;
  }

  return null;
}

/**
 * Stitch chunks back together into full text
 */
function stitchChunks(chunks: Chunk[]): string {
  if (chunks.length === 0) return '';
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
      result += '\n' + currChunk.text;
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
  config: ProgressiveReadConfig = DEFAULT_PROGRESSIVE_READ_CONFIG
): Promise<ToolResult> {
  try {
    // Find the file
    const file = await findFile(projectId, params);
    
    if (!file) {
      return {
        success: false,
        tool: 'read',
        error: `File not found: ${params.fileName || params.fileId || 'No file specified'}`,
      };
    }

    // Check if file has stored content
    if (file.content) {
      const truncated = file.content.length > config.maxCharacters;
      const content = truncated 
        ? file.content.slice(0, config.maxCharacters) + '\n\n[Content truncated due to size...]'
        : file.content;

      return {
        success: true,
        tool: 'read',
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
        tool: 'read',
        error: `File "${file.name}" has no content indexed yet.`,
      };
    }

    // Progressive reading: limit chunks if file is very large
    const maxChunks = params.maxChunks || Math.ceil(config.maxCharacters / 1000);
    const chunksToUse = chunks.length > maxChunks 
      ? chunks.slice(0, maxChunks) 
      : chunks;
    
    const content = stitchChunks(chunksToUse);
    const truncated = chunks.length > chunksToUse.length;

    return {
      success: true,
      tool: 'read',
      data: truncated 
        ? content + `\n\n[Showing ${chunksToUse.length} of ${chunks.length} chunks. Ask to continue reading for more.]`
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
      tool: 'read',
      error: error instanceof Error ? error.message : 'Failed to read file',
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
  params: SearchToolParams
): Promise<ToolResult> {
  try {
    const query = params.query;
    
    if (!query || query.trim().length === 0) {
      return {
        success: false,
        tool: 'search',
        error: 'Search query is required',
      };
    }

    const maxResults = params.maxResults || DEFAULT_SEARCH_CONFIG.maxResults;
    
    // Perform semantic search
    const results = await searchProject(projectId, query, maxResults);
    
    if (results.length === 0) {
      return {
        success: true,
        tool: 'search',
        data: 'No relevant results found for your query.',
        metadata: {
          truncated: false,
        },
      };
    }

    // Format results with source references
    const formattedResults = results.map((result, index) => {
      const scorePercent = (result.score * 100).toFixed(1);
      return `[Result ${index + 1}] (Source: ${result.fileName}, Score: ${scorePercent}%)\n${result.text}`;
    }).join('\n\n---\n\n');

    return {
      success: true,
      tool: 'search',
      data: formattedResults,
      metadata: {
        truncated: false,
      },
    };
  } catch (error) {
    return {
      success: false,
      tool: 'search',
      error: error instanceof Error ? error.message : 'Failed to execute search',
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
  const imageTypes = ['png', 'jpg', 'jpeg', 'webp'];
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
${context ? `\nContext: ${context}` : ''}

Guidelines:
- Extract and present the main ideas
- Preserve important details, facts, and figures
- Use clear, professional language
- Structure the summary logically`;

  const response = await chatCompletion({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Please summarize the following text:\n\n${text}` },
    ],
    temperature: 0.3,
    maxTokens: 1500,
  });

  return response.content;
}

/**
 * Summarize a single chunk (for hierarchical summarization)
 */
async function summarizeChunk(chunk: Chunk, index: number, total: number): Promise<string> {
  const response = await chatCompletion({
    messages: [
      { 
        role: 'system', 
        content: 'Summarize this document section concisely. Focus on key information only.' 
      },
      { 
        role: 'user', 
        content: `Section ${index + 1} of ${total}:\n\n${chunk.text}` 
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
async function mergeSummaries(summaries: string[], fileName: string): Promise<string> {
  const combined = summaries.map((s, i) => `[Section ${i + 1}]\n${s}`).join('\n\n');

  const response = await chatCompletion({
    messages: [
      { 
        role: 'system', 
        content: `You are synthesizing section summaries into a cohesive document summary for "${fileName}". 
Create a unified summary that:
- Integrates all key points
- Eliminates redundancy
- Maintains logical flow
- Highlights the most important information` 
      },
      { 
        role: 'user', 
        content: `Create a comprehensive summary from these section summaries:\n\n${combined}` 
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
  params: SummarizeToolParams
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
        tool: 'summarize',
        error: `File not found: ${params.fileName || params.fileId || 'No file specified'}`,
      };
    }

    // Check if file is text-based
    if (!isTextBasedFile(file)) {
      return {
        success: false,
        tool: 'summarize',
        error: `Cannot summarize image file "${file.name}". Summarization only works with text-based documents.`,
      };
    }

    // Check file size limit
    if (file.size > DEFAULT_SUMMARIZE_CONFIG.maxFileSizeBytes) {
      const maxMB = DEFAULT_SUMMARIZE_CONFIG.maxFileSizeBytes / (1024 * 1024);
      const fileMB = (file.size / (1024 * 1024)).toFixed(1);
      return {
        success: false,
        tool: 'summarize',
        error: `File "${file.name}" (${fileMB}MB) exceeds the ${maxMB}MB limit for summarization. Consider splitting the document.`,
      };
    }

    // Get file content or chunks
    let textContent = file.content || '';
    const chunks = await get_file_chunks(file.id);

    if (!textContent && chunks.length === 0) {
      return {
        success: false,
        tool: 'summarize',
        error: `File "${file.name}" has no content indexed yet.`,
      };
    }

    // If no direct content, stitch chunks
    if (!textContent && chunks.length > 0) {
      textContent = stitchChunks(chunks);
    }

    const tokenCount = estimateTokens(textContent);
    const maxDirect = params.maxDirectTokens || DEFAULT_SUMMARIZE_CONFIG.maxDirectTokens;

    let summary: string;
    let method: 'direct' | 'hierarchical';

    if (tokenCount <= maxDirect) {
      // Direct summarization for smaller documents
      method = 'direct';
      summary = await summarizeText(textContent, `Document: ${file.name}`);
    } else {
      // Hierarchical summarization for larger documents
      method = 'hierarchical';
      
      // Filter to text chunks only (in case of mixed content)
      let textChunks = chunks.filter(c => c.text.trim().length > 50);
      
      if (textChunks.length === 0) {
        return {
          success: false,
          tool: 'summarize',
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
          summarizeChunk(chunk, i + batchIdx, textChunks.length)
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
      tool: 'summarize',
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
      tool: 'summarize',
      error: error instanceof Error ? error.message : 'Failed to summarize file',
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
  defaultFormat: 'pdf' as DocumentFormat,
  supportedFormats: ['pdf', 'docx', 'md'] as DocumentFormat[],
};

/**
 * Generate document content using LLM based on project context
 */
async function generateDocumentContent(
  projectId: string,
  title: string,
  userRequest: string
): Promise<string> {
  // Get relevant context from project
  const searchResults = await searchProject(projectId, userRequest, 10);
  
  let contextText = '';
  if (searchResults.length > 0) {
    contextText = searchResults.map((r, i) => 
      `[Source ${i + 1}: ${r.fileName}]\n${r.text}`
    ).join('\n\n---\n\n');
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
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    maxTokens: DEFAULT_WRITE_CONFIG.maxContentTokens,
  });

  return response.content;
}

/**
 * Execute the write tool
 * Generates a new document (PDF or DOCX) based on user request
 */
export async function executeWriteTool(
  projectId: string,
  params: WriteToolParams,
  userMessage?: string
): Promise<ToolResult> {
  try {
    const format = params.format || DEFAULT_WRITE_CONFIG.defaultFormat;
    const title = params.title || 'Generated Document';

    // Validate format
    if (!DEFAULT_WRITE_CONFIG.supportedFormats.includes(format)) {
      return {
        success: false,
        tool: 'write',
        error: `Invalid format: ${format}. Supported formats: ${DEFAULT_WRITE_CONFIG.supportedFormats.join(', ')}`,
      };
    }

    // Generate content if not provided
    let content = params.content;
    if (!content) {
      content = await generateDocumentContent(
        projectId, 
        title, 
        userMessage || `Generate a document about ${title}`
      );
    }

    // Generate the document
    const result = await generateDocument(projectId, title, content, format);

    return {
      success: true,
      tool: 'write',
      data: `Document "${result.fileName}" has been generated and downloaded.\n\n**Format:** ${format.toUpperCase()}\n**Size:** ${formatFileSize(result.size)}`,
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
      tool: 'write',
      error: error instanceof Error ? error.message : 'Failed to generate document',
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
// Tool Executor
// ============================================

/**
 * Execute a tool call
 */
export async function executeTool(
  projectId: string,
  call: ToolCall,
  userMessage?: string
): Promise<ToolResult> {
  switch (call.tool) {
    case 'read':
      return executeReadTool(projectId, {
        fileId: call.params.fileId || call.params.file_id,
        fileName: call.params.fileName || call.params.file || call.params.name,
        maxChunks: call.params.maxChunks ? parseInt(call.params.maxChunks) : undefined,
      });

    case 'search':
      return executeSearchTool(projectId, {
        query: call.params.query || call.params.q || call.params.search,
        maxResults: call.params.maxResults ? parseInt(call.params.maxResults) : undefined,
      });

    case 'summarize':
      return executeSummarizeTool(projectId, {
        fileId: call.params.fileId || call.params.file_id,
        fileName: call.params.fileName || call.params.file || call.params.name,
      });

    case 'write':
      return executeWriteTool(projectId, {
        format: (call.params.format as DocumentFormat) || 'pdf',
        title: call.params.title || 'Generated Document',
        content: call.params.content || '',
      }, userMessage);

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
 */
export async function executeToolCalls(
  projectId: string,
  calls: ToolCall[],
  userMessage?: string
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
  return results.map(result => {
    if (result.success) {
      const header = result.metadata?.fileName 
        ? `[File: ${result.metadata.fileName}]`
        : `[Tool: ${result.tool}]`;
      return `${header}\n${result.data}`;
    } else {
      return `[Tool Error: ${result.tool}] ${result.error}`;
    }
  }).join('\n\n---\n\n');
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
  toolResults: ToolResult[]
): Promise<boolean> {
  const context = conversationSoFar.map(m => `${m.role}: ${m.content}`).join('\n\n');
  const toolSummary = toolResults.map(r => `${r.tool}: ${r.success ? 'success' : 'failed'}`).join(', ');

  const response = await chatCompletion({
    messages: [
      { role: 'system', content: COMPLETION_CHECK_PROMPT },
      { role: 'user', content: `Original request: "${originalRequest}"\n\nTools executed: ${toolSummary || 'none'}\n\nConversation:\n${context}` },
    ],
    temperature: 0,
    maxTokens: 10,
  });

  return response.content.trim().toUpperCase().includes('COMPLETE');
}

/**
 * Execute the full tool-assisted chat flow with logging
 * Uses iterative routing - keeps calling the router until the request is complete
 */
export async function orchestrateToolExecution(
  projectId: string,
  userMessage: string,
  systemPrompt: string,
  conversationHistory: Array<{ role: string; content: string }>,
  projectFiles: string[],
  onStepUpdate?: ExecutionLogCallback
): Promise<OrchestratedResult> {
  const steps: ExecutionStep[] = [];
  const allResponses: string[] = [];
  const allToolCalls: ToolCall[] = [];
  const allToolResults: ToolResult[] = [];
  
  const updateStep = (step: ExecutionStep) => {
    const idx = steps.findIndex(s => s.id === step.id);
    if (idx >= 0) {
      steps[idx] = step;
    } else {
      steps.push(step);
    }
    onStepUpdate?.(steps);
  };

  // Build initial messages array
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.map(m => ({ 
      role: m.role as 'user' | 'assistant', 
      content: m.content 
    })),
    { role: 'user', content: userMessage },
  ];

  const MAX_ITERATIONS = 5;
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    const iterationSuffix = iteration > 1 ? ` (step ${iteration})` : '';

    // Step 1: Router
    const routingStep: ExecutionStep = {
      id: `routing-${iteration}`,
      type: 'routing',
      status: 'running',
      label: `Analyzing request${iterationSuffix}...`,
      startTime: new Date(),
    };
    updateStep(routingStep);

    let toolCalls: ToolCall[] = [];
    let clarificationMessage: string | undefined;
    
    try {
      // For subsequent iterations, include context about what's been done
      const routerInput = iteration === 1 
        ? userMessage 
        : `Original request: "${userMessage}"\n\nAlready completed: ${allToolCalls.map(t => t.tool).join(', ')}\n\nWhat tools are needed next to complete the request?`;
      
      // Build conversation context from recent messages (last 4 exchanges)
      const recentHistory = conversationHistory.slice(-4).map(m => 
        `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.substring(0, 200)}${m.content.length > 200 ? '...' : ''}`
      ).join('\n');
      
      const routingResult = await routeMessage(routerInput, projectFiles, recentHistory);
      
      // Check if clarification is needed (only on first iteration)
      if (iteration === 1 && routingResult.clarification) {
        clarificationMessage = routingResult.clarification;
        routingStep.status = 'completed';
        routingStep.endTime = new Date();
        routingStep.detail = 'Clarification needed';
        updateStep(routingStep);
        
        // Return early with clarification response
        return {
          responses: [clarificationMessage],
          response: clarificationMessage,
          toolsUsed: [],
          toolResults: [],
          clarificationRequested: true,
        };
      }
      
      toolCalls = routingResult.tools;
      
      // Filter out already executed tools (by tool+params combination)
      const executedKeys = new Set(allToolCalls.map(t => `${t.tool}-${JSON.stringify(t.params)}`));
      toolCalls = toolCalls.filter(c => !executedKeys.has(`${c.tool}-${JSON.stringify(c.params)}`));

      routingStep.status = 'completed';
      routingStep.endTime = new Date();
      routingStep.detail = toolCalls.length > 0 
        ? `Tools: ${toolCalls.map(t => t.tool).join(', ')}`
        : 'No tools needed';
      updateStep(routingStep);
    } catch {
      routingStep.status = 'completed';
      routingStep.detail = 'Using context';
      routingStep.endTime = new Date();
      updateStep(routingStep);
    }

    // Step 2: Execute tools
    for (const call of toolCalls) {
      const toolStep: ExecutionStep = {
        id: `tool-${call.tool}-${Date.now()}`,
        type: 'tool',
        status: 'running',
        label: `Running ${call.tool}`,
        detail: call.params.file || call.params.fileName || call.params.query || call.params.title,
        startTime: new Date(),
      };
      updateStep(toolStep);

      const result = await executeTool(projectId, call, userMessage);
      allToolResults.push(result);
      allToolCalls.push(call);

      toolStep.status = result.success ? 'completed' : 'error';
      toolStep.endTime = new Date();
      toolStep.detail = result.success 
        ? (result.metadata?.fileName || 'Done')
        : result.error;
      updateStep(toolStep);
    }

    // Step 3: Add tool results to messages if any
    const successResults = allToolResults.filter(r => r.success);
    if (toolCalls.length > 0 && successResults.length > 0) {
      const toolContext = formatToolResults(successResults.slice(-toolCalls.length)); // Only latest results
      messages.push({ 
        role: 'user', 
        content: `[System: Tool results]\n\n${toolContext}` 
      });
    }

    // Step 4: Generate response
    const responseStep: ExecutionStep = {
      id: `response-${iteration}`,
      type: 'response',
      status: 'running',
      label: `Generating response${iterationSuffix}...`,
      startTime: new Date(),
    };
    updateStep(responseStep);

    const llmResponse = await chatCompletion({ messages });
    allResponses.push(llmResponse.content);
    
    // Add assistant response to conversation
    messages.push({ role: 'assistant', content: llmResponse.content });

    responseStep.status = 'completed';
    responseStep.endTime = new Date();
    responseStep.label = iteration === 1 ? 'Response ready' : `Step ${iteration} complete`;
    updateStep(responseStep);

    // Step 5: Check if request is complete
    if (iteration < MAX_ITERATIONS) {
      const checkStep: ExecutionStep = {
        id: `check-${iteration}`,
        type: 'routing',
        status: 'running',
        label: 'Checking completion...',
        startTime: new Date(),
      };
      updateStep(checkStep);

      const complete = await isRequestComplete(
        userMessage,
        messages.slice(1), // Exclude system prompt
        allToolResults
      );

      checkStep.status = 'completed';
      checkStep.endTime = new Date();
      checkStep.detail = complete ? 'Request complete' : 'More steps needed';
      updateStep(checkStep);

      if (complete) break;
    }
  }

  // Combine all responses
  const finalResponse = allResponses.length === 1 
    ? allResponses[0]
    : allResponses.join('\n\n---\n\n');

  return {
    responses: allResponses,
    response: finalResponse,
    toolsUsed: allToolCalls,
    toolResults: allToolResults,
  };
}

