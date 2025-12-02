/**
 * Chat Service
 * Handles chat initialization with project context, system prompts, and context window management
 */

import type {
  ChatMessage,
  ChatSession,
  ContextWindowConfig,
  ManagedContext,
  SearchResult,
} from '../types';
import { DEFAULT_CONTEXT_CONFIG } from '../types';
import { getProject, get_project_files, getProjectStats, searchProject } from './projectService';

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

  const fileList = files.map(f => `  - ${f.name} (${f.type}, ${formatSize(f.size)}, id: ${f.id})`).join('\n');

  return `You are DocuSage, an AI assistant specialized in document analysis and interaction.

## Project Context
**Project Name:** ${project.name}
${project.description ? `**Description:** ${project.description}` : ''}
**Status:** ${project.status}
**Statistics:** ${stats.fileCount} files, ${stats.chunkCount} chunks indexed

### Project Files
${fileList || 'No files uploaded yet.'}

## Available Tools
You have access to the following tools to help answer user requests:

### 1. READ Tool
**Purpose:** Read the full content of a specific file.
**When to use:**
- User asks to see, open, view, read, or examine a file
- User says "show me the file", "open document", "read the contract"
- User asks "what's in [filename]?" or "mostre o arquivo"

### 2. SEARCH Tool
**Purpose:** Perform semantic search across ALL project documents.
**When to use:**
- User asks a question about the content (e.g., "what does it say about...")
- User wants to find specific information across files
- Keywords: search, find, look for, buscar, encontrar, procure, "o que diz sobre"

### 3. SUMMARIZE Tool
**Purpose:** Create a concise summary of a document.
**When to use:**
- User asks for a summary, overview, or TL;DR
- Keywords: summarize, summary, resuma, resumo, overview, synopsis

### 4. WRITE Tool
**Purpose:** Generate a new document (PDF, DOCX, or Markdown) based on content.
**When to use:**
- User wants to create, write, or generate a new document
- Keywords: create document, generate PDF, write report, escreva, crie, gerar pdf/docx/markdown, create note, save as markdown

## Tool Usage Examples

**READ examples:**
- "Read the contract.pdf" → uses READ on contract.pdf
- "Show me what's in the proposal" → uses READ on proposal
- "Mostre o arquivo de requisitos" → uses READ on requirements file

**SEARCH examples:**
- "What does it say about payment terms?" → uses SEARCH for "payment terms"
- "Find information about deadlines" → uses SEARCH for "deadlines"
- "O que diz sobre garantias?" → uses SEARCH for "garantias"

**SUMMARIZE examples:**
- "Summarize the annual report" → uses SUMMARIZE on annual report
- "Give me a TL;DR of the contract" → uses SUMMARIZE on contract
- "Resuma o documento principal" → uses SUMMARIZE on main document

**WRITE examples:**
- "Create a PDF report about the findings" → uses WRITE with format=pdf
- "Generate a summary document in DOCX" → uses WRITE with format=docx
- "Crie um documento com os pontos principais" → uses WRITE
- "Create a markdown note" → uses WRITE with format=md
- "Save this as markdown" → uses WRITE with format=md

## Instructions
- When answering questions, use the context provided below from the project documents.
- If tool results are provided, use them to give accurate responses about file contents.
- Always cite the source file when quoting or referencing content.
- If you cannot find relevant information, say so honestly.
- Respond in the same language the user is using.

## Fallback Behavior
If you are unsure what the user wants:
- Ask a clarifying question before proceeding
- Suggest available options based on the project files
- Examples: "Would you like me to search across all files or read a specific document?"

## Response Guidelines
- Use clear, simple language
- Be concise and direct
- If a file was read, summarize key points rather than dumping all content

## Constraints
- Only reference information from the indexed project documents
- Do not make up information that is not in the documents`;
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

