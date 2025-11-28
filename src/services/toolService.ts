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
  ProgressiveReadConfig,
  ProjectFile,
  Chunk,
} from '../types';
import { DEFAULT_PROGRESSIVE_READ_CONFIG } from '../types';
import { get_project_files, get_file_chunks, getFile, searchProject } from './projectService';
import { chatCompletion } from './llmService';

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
- write: Generate a new document. Use when user wants to create, write, or generate a document.

IMPORTANT: You can chain multiple tools for complex requests. Plan the sequence logically.

Respond ONLY with a JSON object:
{"tools": [{"name": "toolName", "params": {"paramName": "value"}}]}

If no tools are needed (simple questions answerable from context), respond: {"tools": []}

Examples:

Single tool:
- "Read the contract.pdf" → {"tools": [{"name": "read", "params": {"file": "contract.pdf"}}]}
- "Summarize the agreement" → {"tools": [{"name": "summarize", "params": {"file": "agreement"}}]}
- "Search for payment terms" → {"tools": [{"name": "search", "params": {"query": "payment terms"}}]}
- "Buscar informações sobre contrato" → {"tools": [{"name": "search", "params": {"query": "contrato"}}]}
- "O que diz sobre garantias?" → {"tools": [{"name": "search", "params": {"query": "garantias"}}]}
- "What does it say about deadlines?" → {"tools": [{"name": "search", "params": {"query": "deadlines"}}]}

Multiple tools (complex queries):
- "Read both the contract and the proposal" → {"tools": [{"name": "read", "params": {"file": "contract"}}, {"name": "read", "params": {"file": "proposal"}}]}
- "Compare the two reports" → {"tools": [{"name": "read", "params": {"file": "report1"}}, {"name": "read", "params": {"file": "report2"}}]}
- "Summarize all my documents" → {"tools": [{"name": "summarize", "params": {"file": "doc1"}}, {"name": "summarize", "params": {"file": "doc2"}}]}
- "Read the contract and tell me about payment terms" → {"tools": [{"name": "read", "params": {"file": "contract"}}]}

No tools (use existing context):
- "Explain the previous answer" → {"tools": []}`;

/**
 * Route user message through router LLM to determine tool usage
 */
export async function routeMessage(
  userMessage: string,
  projectFiles: string[]
): Promise<ToolCall[]> {
  const filesContext = projectFiles.length > 0 
    ? `\n\nAvailable files in project: ${projectFiles.join(', ')}`
    : '';

  const response = await chatCompletion({
    messages: [
      { role: 'system', content: ROUTER_PROMPT + filesContext },
      { role: 'user', content: userMessage },
    ],
    temperature: 0,
    maxTokens: 200,
  });

  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = response.content.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    
    const parsed = JSON.parse(jsonStr);
    
    if (!parsed.tools || !Array.isArray(parsed.tools)) {
      return [];
    }

    return parsed.tools.map((t: { name: string; params?: Record<string, string> }) => ({
      tool: t.name as ToolName,
      params: t.params || {},
    }));
  } catch {
    // If parsing fails, no tools needed
    return [];
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
// Tool Executor
// ============================================

/**
 * Execute a tool call
 */
export async function executeTool(
  projectId: string,
  call: ToolCall
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
      // Placeholder for Phase 5
      return {
        success: false,
        tool: 'summarize',
        error: 'Summarize tool not yet implemented',
      };

    case 'write':
      // Placeholder for Phase 6
      return {
        success: false,
        tool: 'write',
        error: 'Write tool not yet implemented',
      };

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
  calls: ToolCall[]
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  
  for (const call of calls) {
    const result = await executeTool(projectId, call);
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
  response: string;
  toolsUsed: ToolCall[];
  toolResults: ToolResult[];
}

/**
 * Execute the full tool-assisted chat flow with logging
 * 1. Router determines which tools to use
 * 2. Tools are executed
 * 3. Main LLM generates response with tool context
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
  
  const updateStep = (step: ExecutionStep) => {
    const idx = steps.findIndex(s => s.id === step.id);
    if (idx >= 0) {
      steps[idx] = step;
    } else {
      steps.push(step);
    }
    onStepUpdate?.(steps);
  };

  // Step 1: Router
  const routingStep: ExecutionStep = {
    id: 'routing',
    type: 'routing',
    status: 'running',
    label: 'Analyzing request...',
    startTime: new Date(),
  };
  updateStep(routingStep);

  let toolCalls: ToolCall[] = [];
  try {
    toolCalls = await routeMessage(userMessage, projectFiles);
    routingStep.status = 'completed';
    routingStep.endTime = new Date();
    routingStep.detail = toolCalls.length > 0 
      ? `Tools needed: ${toolCalls.map(t => t.tool).join(', ')}`
      : 'No tools needed';
    updateStep(routingStep);
  } catch {
    routingStep.status = 'completed';
    routingStep.detail = 'Using context search';
    routingStep.endTime = new Date();
    updateStep(routingStep);
  }

  // Step 2: Execute tools
  const toolResults: ToolResult[] = [];
  
  for (const call of toolCalls) {
    const toolStep: ExecutionStep = {
      id: `tool-${call.tool}-${Date.now()}`,
      type: 'tool',
      status: 'running',
      label: `Running ${call.tool}`,
      detail: call.params.file || call.params.fileName || call.params.query,
      startTime: new Date(),
    };
    updateStep(toolStep);

    const result = await executeTool(projectId, call);
    toolResults.push(result);

    toolStep.status = result.success ? 'completed' : 'error';
    toolStep.endTime = new Date();
    toolStep.detail = result.success 
      ? (result.metadata?.fileName || 'Done')
      : result.error;
    updateStep(toolStep);
  }

  // Step 3: Generate response
  const responseStep: ExecutionStep = {
    id: 'response',
    type: 'response',
    status: 'running',
    label: 'Generating response...',
    startTime: new Date(),
  };
  updateStep(responseStep);

  // Build context with tool results
  let contextAddition = '';
  if (toolResults.length > 0) {
    const successResults = toolResults.filter(r => r.success);
    if (successResults.length > 0) {
      contextAddition = '\n\n## Tool Results\n' + formatToolResults(successResults);
    }
  }

  const messages = [
    { role: 'system' as const, content: systemPrompt + contextAddition },
    ...conversationHistory.map(m => ({ 
      role: m.role as 'user' | 'assistant', 
      content: m.content 
    })),
    { role: 'user' as const, content: userMessage },
  ];

  const llmResponse = await chatCompletion({ messages });

  responseStep.status = 'completed';
  responseStep.endTime = new Date();
  responseStep.label = 'Response ready';
  updateStep(responseStep);

  return {
    response: llmResponse.content,
    toolsUsed: toolCalls,
    toolResults,
  };
}

