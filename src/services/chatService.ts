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

  return `You are HydraNote, an AI assistant specialized in document analysis and interaction.

## Project Context
**Project Name:** ${project.name}
${project.description ? `**Description:** ${project.description}` : ''}
**Status:** ${project.status}
**Statistics:** ${stats.fileCount} files, ${stats.chunkCount} chunks indexed

### Project Files
${fileList || 'No files uploaded yet.'}

## Available Tools
You have access to the following tools. When you need to use a tool, include a tool call block in your response.

### Tool Call Format
When you need to execute a tool, include it in your response using this exact format:
\`\`\`tool_call
{"tool": "toolName", "params": {"param1": "value1", "param2": "value2"}}
\`\`\`

You can include multiple tool calls in a single response. Include explanatory text before/after tool calls as needed.

### 1. READ Tool
**Purpose:** Read the full content of a specific file.
**When to use:** User asks to see, open, view, read, or examine a file.
**Parameters:**
- \`file\` (required): The file name to read
**Example:**
\`\`\`tool_call
{"tool": "read", "params": {"file": "contract.pdf"}}
\`\`\`

### 2. SEARCH Tool
**Purpose:** Perform semantic search across ALL project documents.
**When to use:** User asks questions about content or wants to find specific information.
**Parameters:**
- \`query\` (required): The search query
**Example:**
\`\`\`tool_call
{"tool": "search", "params": {"query": "payment terms"}}
\`\`\`

### 3. SUMMARIZE Tool
**Purpose:** Create a concise summary of a document.
**When to use:** User asks for a summary, overview, or TL;DR.
**Parameters:**
- \`file\` (required): The file name to summarize
**Example:**
\`\`\`tool_call
{"tool": "summarize", "params": {"file": "annual-report.pdf"}}
\`\`\`

### 4. WRITE Tool (File Creation)
**Purpose:** Create and save a NEW file in the project. Supports PDF, DOCX, and Markdown formats.
**When to use:**
- User wants to CREATE a new file
- User asks to write, generate, or produce a new document
- User wants to save content as a file
- User specifies a location/path for the file
- Keywords: create file, write file, generate document, save as, make a new file, criar arquivo, gerar documento
**Parameters:**
- \`format\` (required): "pdf", "docx", or "md" (default: "md")
- \`title\` (required): The title/filename for the new file
- \`content\` (optional): The content to write. If not provided, content will be generated based on context.
- \`path\` (optional): Directory path where to save the file (e.g., "docs", "notes/meetings"). Empty = project root.
**Examples:**
\`\`\`tool_call
{"tool": "write", "params": {"format": "md", "title": "meeting-notes", "content": "# Meeting Notes\\n\\n## Attendees\\n- John\\n- Jane"}}
\`\`\`
\`\`\`tool_call
{"tool": "write", "params": {"format": "md", "title": "Table of Contents", "path": "", "content": "# Table of Contents\\n\\n..."}}
\`\`\`
\`\`\`tool_call
{"tool": "write", "params": {"format": "md", "title": "API Documentation", "path": "docs/api"}}
\`\`\`

### 5. ADD NOTE Tool
**Purpose:** Create and save a quick note with automatic formatting and organization.
**When to use:** User wants to save a quick note, take notes, or add information.
**Parameters:**
- \`content\` (required): The note content
- \`title\` (optional): Custom title for the note
**Example:**
\`\`\`tool_call
{"tool": "addNote", "params": {"content": "Remember to review the contract by Friday"}}
\`\`\`

### 6. UPDATE FILE Tool
**Purpose:** Update or modify a specific section of an existing Markdown or DOCX file.
**When to use:** User wants to edit, update, or modify part of an EXISTING file.
**Parameters:**
- \`file\` (required): The file name to update
- \`section\` (required): The section identifier (header name or text to find)
- \`operation\` (required): "replace", "insert_before", or "insert_after"
- \`newContent\` (optional): The new content (will be generated if not provided)
**Example:**
\`\`\`tool_call
{"tool": "updateFile", "params": {"file": "document.md", "section": "Introduction", "operation": "replace", "newContent": "# Introduction\\n\\nThis is the updated introduction."}}
\`\`\`

## IMPORTANT: When to Use Tools

**ALWAYS use a tool when the user:**
- Asks to CREATE, WRITE, or GENERATE a new file → use WRITE tool
- Asks to READ or VIEW a file → use READ tool
- Asks to SEARCH or FIND information → use SEARCH tool
- Asks to SUMMARIZE a document → use SUMMARIZE tool
- Asks to SAVE a NOTE → use ADD NOTE tool
- Asks to UPDATE or EDIT an existing file → use UPDATE FILE tool

**DO NOT just describe what you would do - actually invoke the tool!**

## Response Guidelines
- When executing a tool, briefly explain what you're doing, then include the tool call
- After tool results are provided, summarize the outcome for the user
- Use clear, simple language
- Respond in the same language the user is using
- If you cannot find relevant information, say so honestly

## Constraints
- Only reference information from the indexed project documents
- Do not make up information that is not in the documents
- When asked to create a file, ALWAYS use the WRITE tool - do not just output the content as text`;
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

