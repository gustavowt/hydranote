/**
 * Chat Service
 * Handles chat initialization with project context, system prompts, and context window management
 */

import type {
  Project,
  ChatMessage,
  ChatSession,
  ToolDefinition,
  ContextWindowConfig,
  ManagedContext,
  SearchResult,
} from '../types';
import { DEFAULT_CONTEXT_CONFIG } from '../types';
import { getProject, get_project_files, getProjectStats, searchProject } from './projectService';

// ============================================
// Tool Definitions
// ============================================

const TOOLS: ToolDefinition[] = [
  {
    name: 'read',
    description: 'Read a specific file from the project. Returns the full content or chunked text for large files.',
    triggers: ['read', 'open', 'show', 'explain file', 'mostre o arquivo', 'abrir', 'mostrar'],
  },
  {
    name: 'search',
    description: 'Perform semantic search across all project files to find relevant information.',
    triggers: ['search', 'find', 'look for', 'buscar', 'encontrar', 'procure', 'o que diz sobre'],
  },
  {
    name: 'summarize',
    description: 'Create concise summaries of documents or specific sections.',
    triggers: ['summarize', 'summary', 'tl;dr', 'resuma', 'resumo', 'resumir'],
  },
  {
    name: 'write',
    description: 'Generate new documents (PDF or DOCX) based on project context and user requirements.',
    triggers: ['write', 'create document', 'generate', 'crie um documento', 'escreva', 'gerar pdf', 'gerar documento'],
  },
];

// ============================================
// System Prompt Builder
// ============================================

/**
 * Build the system prompt for a project chat session
 */
export async function buildSystemPrompt(projectId: string): Promise<string> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const files = await get_project_files(projectId);
  const stats = await getProjectStats(projectId);

  const fileList = files.map(f => `  - ${f.name} (${f.type}, ${formatSize(f.size)})`).join('\n');

  const toolsDescription = TOOLS.map(tool => {
    return `**${tool.name}**: ${tool.description}\n  Triggers: ${tool.triggers.join(', ')}`;
  }).join('\n\n');

  return `You are DocuSage, an AI assistant specialized in document analysis and interaction.

## Project Context
**Project Name:** ${project.name}
${project.description ? `**Description:** ${project.description}` : ''}
**Status:** ${project.status}
**Statistics:** ${stats.fileCount} files, ${stats.chunkCount} chunks indexed

### Project Files
${fileList || 'No files uploaded yet.'}

## Available Tools
You have access to the following tools to help answer user questions:

${toolsDescription}

## Instructions
1. When the user asks about specific content, use the **search** tool to find relevant information.
2. When the user wants to see a specific file, use the **read** tool.
3. When the user needs a summary, use the **summarize** tool.
4. When the user wants to create a new document, use the **write** tool.
5. If you're unsure which tool to use, ask the user for clarification.

## Response Guidelines
- Use clear, simple language
- Be concise and direct
- Always cite the source file when quoting content
- If you cannot find relevant information, say so honestly
- Respond in the same language the user is using

## Constraints
- Only reference information from the indexed project documents
- Do not make up information that is not in the documents
- If a file is too large, summarize key points instead of quoting everything`;
}

/**
 * Format file size for display
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================
// Context Window Manager
// ============================================

/**
 * Estimate token count for text (rough approximation: ~4 chars per token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Manage context window to avoid exceeding limits
 */
export async function manageContext(
  projectId: string,
  messages: ChatMessage[],
  userQuery: string,
  config: ContextWindowConfig = DEFAULT_CONTEXT_CONFIG
): Promise<ManagedContext> {
  // Build system prompt
  const systemPrompt = await buildSystemPrompt(projectId);
  const systemTokens = estimateTokens(systemPrompt);

  // Calculate available tokens for messages and context
  const availableTokens = config.maxTokens - config.reservedForResponse - systemTokens;

  // Estimate tokens for existing messages
  let messageTokens = 0;
  const includedMessages: ChatMessage[] = [];

  // Include messages from newest to oldest until we hit the limit
  // Reserve space for context chunks
  const reservedForContext = Math.min(availableTokens * 0.4, 20000); // 40% or 20k max for context
  const maxMessageTokens = availableTokens - reservedForContext;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const msgTokens = estimateTokens(msg.content);
    
    if (messageTokens + msgTokens <= maxMessageTokens) {
      messageTokens += msgTokens;
      includedMessages.unshift(msg);
    } else {
      break;
    }
  }

  // Search for relevant context based on user query
  const relevantChunks = await searchProject(projectId, userQuery, 10);

  // Filter chunks to fit in remaining context budget
  const remainingTokens = availableTokens - messageTokens;
  const filteredChunks: SearchResult[] = [];
  let contextTokens = 0;

  for (const chunk of relevantChunks) {
    const chunkTokens = estimateTokens(chunk.text);
    if (contextTokens + chunkTokens <= remainingTokens) {
      contextTokens += chunkTokens;
      filteredChunks.push(chunk);
    } else {
      break;
    }
  }

  const totalTokens = systemTokens + messageTokens + contextTokens;
  const truncated = includedMessages.length < messages.length || filteredChunks.length < relevantChunks.length;

  return {
    systemPrompt,
    messages: includedMessages,
    relevantChunks: filteredChunks,
    totalTokens,
    truncated,
  };
}

/**
 * Format context chunks for inclusion in prompt
 */
export function formatContextForPrompt(chunks: SearchResult[]): string {
  if (chunks.length === 0) return '';

  const formatted = chunks.map((chunk, i) => {
    return `[Source ${i + 1}: ${chunk.fileName}]\n${chunk.text}`;
  }).join('\n\n---\n\n');

  return `\n\n## Relevant Context from Documents\n\n${formatted}`;
}

// ============================================
// Chat Session Management
// ============================================

const activeSessions = new Map<string, ChatSession>();

/**
 * Create a new chat session for a project
 */
export async function createChatSession(projectId: string): Promise<ChatSession> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const session: ChatSession = {
    id: crypto.randomUUID(),
    projectId,
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  activeSessions.set(session.id, session);
  return session;
}

/**
 * Get an existing chat session
 */
export function getChatSession(sessionId: string): ChatSession | null {
  return activeSessions.get(sessionId) || null;
}

/**
 * Get or create chat session for a project
 */
export async function getOrCreateSession(projectId: string): Promise<ChatSession> {
  // Find existing session for this project
  for (const session of activeSessions.values()) {
    if (session.projectId === projectId) {
      return session;
    }
  }
  
  // Create new session
  return createChatSession(projectId);
}

/**
 * Add a message to a chat session
 */
export function addMessage(
  sessionId: string,
  role: ChatMessage['role'],
  content: string,
  contextChunks?: SearchResult[]
): ChatMessage {
  const session = activeSessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const message: ChatMessage = {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: new Date(),
    contextChunks,
  };

  session.messages.push(message);
  session.updatedAt = new Date();

  return message;
}

/**
 * Get all messages from a session (returns a copy)
 */
export function getMessages(sessionId: string): ChatMessage[] {
  const session = activeSessions.get(sessionId);
  return session ? [...session.messages] : [];
}

/**
 * Clear a chat session
 */
export function clearSession(sessionId: string): void {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.messages = [];
    session.updatedAt = new Date();
  }
}

/**
 * Delete a chat session
 */
export function deleteSession(sessionId: string): void {
  activeSessions.delete(sessionId);
}

// ============================================
// Prepare Chat Request
// ============================================

/**
 * Prepare a complete chat request with context
 */
export async function prepareChatRequest(
  sessionId: string,
  userMessage: string
): Promise<{
  systemPrompt: string;
  messages: Array<{ role: string; content: string }>;
  context: ManagedContext;
}> {
  const session = activeSessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  // Manage context
  const context = await manageContext(session.projectId, session.messages, userMessage);

  // Build messages array for API
  const apiMessages: Array<{ role: string; content: string }> = [];

  // Add context-enhanced system message
  let enhancedSystem = context.systemPrompt;
  if (context.relevantChunks.length > 0) {
    enhancedSystem += formatContextForPrompt(context.relevantChunks);
  }

  // Convert messages to API format
  for (const msg of context.messages) {
    apiMessages.push({
      role: msg.role,
      content: msg.content,
    });
  }

  return {
    systemPrompt: enhancedSystem,
    messages: apiMessages,
    context,
  };
}

/**
 * Record assistant response
 */
export function recordAssistantResponse(
  sessionId: string,
  content: string,
  contextChunks?: SearchResult[]
): ChatMessage {
  return addMessage(sessionId, 'assistant', content, contextChunks);
}

