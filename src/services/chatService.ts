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
  WorkingContext,
} from '../types';
import { DEFAULT_CONTEXT_CONFIG } from '../types';
import { getProject, get_project_files, getProjectStats, searchProject, getAllProjects, searchAllProjects } from './projectService';
import {
  createChatSession as dbCreateSession,
  getChatSession as dbGetSession,
  getChatSessionsByProject as dbGetSessionsByProject,
  updateChatSession as dbUpdateSession,
  touchChatSession as dbTouchSession,
  deleteChatSession as dbDeleteSession,
  pruneOldChatSessions as dbPruneOldSessions,
  createChatMessage as dbCreateMessage,
  getChatMessages as dbGetMessages,
  deleteChatMessages as dbDeleteMessages,
  type DBChatSession,
  type DBChatMessage,
} from './database';

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

## Tool Execution System

You have access to tools that you MUST use when performing actions. Tools are executed by including a \`tool_call\` code block in your response.

### CRITICAL: Tool Call Format

To execute a tool, you MUST include this EXACT format in your response:

\`\`\`tool_call
{"tool": "toolName", "params": {"param1": "value1"}}
\`\`\`

**Rules:**
- The block MUST start with \`\`\`tool_call (no spaces, no other text)
- The JSON must be valid and on a single line or properly formatted
- You can include multiple tool_call blocks in one response
- Add brief explanatory text before/after tool calls if helpful
- NEVER say "I will..." or "Let me..." without including the actual tool_call block

### Available Tools

**1. READ** - Read file content
\`\`\`tool_call
{"tool": "read", "params": {"file": "filename.pdf"}}
\`\`\`

**2. SEARCH** - Semantic search across documents
\`\`\`tool_call
{"tool": "search", "params": {"query": "search terms"}}
\`\`\`

**3. SUMMARIZE** - Summarize a document
\`\`\`tool_call
{"tool": "summarize", "params": {"file": "filename.pdf"}}
\`\`\`

**4. WRITE** - Create a file (MD with AI formatting, PDF/DOCX direct)
\`\`\`tool_call
{"tool": "write", "params": {"format": "md", "content": "note content", "title": "optional title", "path": "optional/directory"}}
\`\`\`
AI generates title if not provided and decides directory for all formats.
For MD: Also formats content via LLM.

**5. UPDATE FILE** - Modify existing file section
\`\`\`tool_call
{"tool": "updateFile", "params": {"file": "filename.md", "section": "Section Name", "operation": "replace", "newContent": "new content"}}
\`\`\`
Operations: "replace", "insert_before", "insert_after"

**6. WEB RESEARCH** - Search the internet
\`\`\`tool_call
{"tool": "webResearch", "params": {"query": "search query"}}
\`\`\`

## When to Use Tools

| User Request | Tool to Use |
|--------------|-------------|
| Read, view, open, show a file | READ |
| Search, find, what does it say about | SEARCH |
| Summarize, overview, TL;DR | SUMMARIZE |
| Create, write, generate, save as file, add note | WRITE |
| Update, edit, modify, change a file | UPDATE FILE |
| Search web, current news, external info | WEB RESEARCH |

## Response Flow

1. **User asks something** → Decide if tools are needed
2. **If tools needed** → Include tool_call block(s) in your response
3. **Tool results arrive** → Review results, then either:
   - Use more tools if needed (include more tool_call blocks)
   - Provide final answer to the user (no tool_call blocks)
4. **If no tools needed** → Respond directly with information

## Guidelines
- Respond in the same language the user uses
- Be concise and helpful
- When tools execute successfully, summarize the outcome
- If a tool fails, explain the error and suggest alternatives
- For multi-step tasks, you can chain multiple tools across responses`;
}

/**
 * Build the system prompt for a GLOBAL chat session (no specific project)
 * Provides access to all projects and cross-project operations
 * @param workingContext - Optional working context from recent creations in this session
 */
export async function buildGlobalSystemPrompt(workingContext?: WorkingContext): Promise<string> {
  const projects = await getAllProjects();
  
  // Build project list with their files
  const projectSections: string[] = [];
  let totalFiles = 0;
  let totalChunks = 0;
  
  for (const project of projects) {
    const files = await get_project_files(project.id);
    const stats = await getProjectStats(project.id);
    totalFiles += stats.fileCount;
    totalChunks += stats.chunkCount;
    
    const fileList = files.map(f => `    - ${f.name} (${f.type}, ${formatSize(f.size)})`).join('\n');
    
    projectSections.push(`### ${project.name} (id: ${project.id})
${project.description ? `  Description: ${project.description}` : ''}
  Files: ${stats.fileCount}
${fileList || '  No files yet.'}`);
  }

  // Build working context section if active project exists
  const workingContextSection = workingContext?.projectId
    ? `
## Current Working Context
**Active Project:** ${workingContext.projectName} (id: ${workingContext.projectId})
${workingContext.recentFiles.length > 0 
  ? `**Recently Created Files:**
${workingContext.recentFiles.map(f => `  - ${f.fileName}`).join('\n')}`
  : ''}

When the user refers to "the project", "add a file", or similar without specifying a project, use the active project above.
`
    : '';

  return `You are HydraNote, an AI assistant specialized in document analysis and interaction.

## Global Mode
You are in **Global Mode** - you have access to ALL projects and can perform cross-project operations.
${workingContextSection}
## All Projects Overview
**Total Projects:** ${projects.length}
**Total Files:** ${totalFiles}
**Total Chunks Indexed:** ${totalChunks}

${projectSections.join('\n\n')}

## Tool Execution System

You have access to tools that you MUST use when performing actions. Tools are executed by including a \`tool_call\` code block in your response.

### CRITICAL: Tool Call Format

To execute a tool, you MUST include this EXACT format in your response:

\`\`\`tool_call
{"tool": "toolName", "params": {"param1": "value1"}}
\`\`\`

**Rules:**
- The block MUST start with \`\`\`tool_call (no spaces, no other text)
- The JSON must be valid and on a single line or properly formatted
- You can include multiple tool_call blocks in one response
- Add brief explanatory text before/after tool calls if helpful
- NEVER say "I will..." or "Let me..." without including the actual tool_call block
- In global mode, include \`project\` param when creating/modifying files

### Available Tools

**1. READ** - Read file content
\`\`\`tool_call
{"tool": "read", "params": {"file": "filename.pdf", "project": "Project Name"}}
\`\`\`

**2. SEARCH** - Semantic search (searches all projects if no project specified)
\`\`\`tool_call
{"tool": "search", "params": {"query": "search terms", "project": "optional"}}
\`\`\`

**3. SUMMARIZE** - Summarize a document
\`\`\`tool_call
{"tool": "summarize", "params": {"file": "filename.pdf", "project": "Project Name"}}
\`\`\`

**4. WRITE** - Create a file (requires project in global mode)
\`\`\`tool_call
{"tool": "write", "params": {"format": "md", "content": "note content", "title": "optional", "project": "Project Name"}}
\`\`\`
AI generates title if not provided and decides directory for all formats. For MD: Also formats content.

**5. UPDATE FILE** - Modify existing file section
\`\`\`tool_call
{"tool": "updateFile", "params": {"file": "filename.md", "section": "Section", "operation": "replace", "newContent": "content", "project": "Project"}}
\`\`\`

**6. CREATE PROJECT** - Create a new project
\`\`\`tool_call
{"tool": "createProject", "params": {"name": "Project Name", "description": "optional"}}
\`\`\`

**7. MOVE FILE** - Move file between projects
\`\`\`tool_call
{"tool": "moveFile", "params": {"file": "filename.md", "fromProject": "Source", "toProject": "Destination"}}
\`\`\`

**8. DELETE FILE** - Delete a file
\`\`\`tool_call
{"tool": "deleteFile", "params": {"file": "filename.md", "project": "Project Name"}}
\`\`\`

**9. DELETE PROJECT** - Delete entire project (requires confirm: "yes")
\`\`\`tool_call
{"tool": "deleteProject", "params": {"project": "Project Name", "confirm": "yes"}}
\`\`\`

**10. WEB RESEARCH** - Search the internet
\`\`\`tool_call
{"tool": "webResearch", "params": {"query": "search query"}}
\`\`\`

## When to Use Tools

| User Request | Tool to Use |
|--------------|-------------|
| Read, view, open a file | READ |
| Search, find information | SEARCH |
| Summarize a document | SUMMARIZE |
| Create, write a new file, add note | WRITE |
| Edit/update a file | UPDATE FILE |
| Create a new project | CREATE PROJECT |
| Move file between projects | MOVE FILE |
| Delete a file | DELETE FILE |
| Delete a project | DELETE PROJECT |
| Web search, external info | WEB RESEARCH |

## Response Flow

1. **User asks something** → Decide if tools are needed
2. **If tools needed** → Include tool_call block(s) in your response
3. **Tool results arrive** → Review results, then either:
   - Use more tools if needed (include more tool_call blocks)
   - Provide final answer to the user (no tool_call blocks)
4. **If no tools needed** → Respond directly with information

## Guidelines
- Respond in the same language the user uses
- Be concise and helpful
- Always specify which project when discussing files across projects
- When tools execute successfully, summarize the outcome
- If a tool fails, explain the error and suggest alternatives
- For multi-step tasks, you can chain multiple tools across responses`;
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
 * @param projectId - Project ID, or undefined for global context
 */
export async function manageContext(
  projectId: string | undefined,
  messages: ChatMessage[],
  userQuery: string,
  config: ContextWindowConfig = DEFAULT_CONTEXT_CONFIG
): Promise<ManagedContext> {
  // Build system prompt (global or project-specific)
  const systemPrompt = projectId 
    ? await buildSystemPrompt(projectId)
    : await buildGlobalSystemPrompt();
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

  // Search for relevant context based on user query (project-specific or global)
  const relevantChunks = projectId
    ? await searchProject(projectId, userQuery, 10)
    : await searchAllProjects(userQuery, 10);

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
// Chat Session Management (with Database Persistence)
// ============================================

// In-memory cache for active sessions
const activeSessions = new Map<string, ChatSession>();

// Maximum sessions to keep per project (for retention)
const MAX_SESSIONS_PER_PROJECT = 20;

/**
 * Generate a title from the first user message
 */
function generateSessionTitle(content: string): string {
  // Take first 50 chars of the message, truncate at word boundary
  const maxLen = 50;
  if (content.length <= maxLen) return content;
  
  const truncated = content.substring(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > 20 ? truncated.substring(0, lastSpace) + '...' : truncated + '...';
}

/**
 * Convert DB session to in-memory session format
 */
function dbSessionToSession(dbSession: DBChatSession, messages: ChatMessage[] = []): ChatSession {
  return {
    id: dbSession.id,
    projectId: dbSession.projectId ?? undefined,
    title: dbSession.title,
    messages,
    createdAt: dbSession.createdAt,
    updatedAt: dbSession.updatedAt,
  };
}

/**
 * Create a new chat session for a project or global
 * @param projectId - Project ID, or undefined for global session
 * @param title - Optional initial title (defaults to "New Chat")
 */
export async function createChatSession(projectId?: string, title?: string): Promise<ChatSession> {
  // Validate project if specified
  if (projectId) {
    const project = await getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
  }

  const now = new Date();
  const sessionTitle = title || 'New Chat';
  
  const dbSession: DBChatSession = {
    id: crypto.randomUUID(),
    projectId: projectId ?? null,
    title: sessionTitle,
    createdAt: now,
    updatedAt: now,
  };

  // Persist to database
  await dbCreateSession(dbSession);
  
  // Prune old sessions to maintain retention limit
  await dbPruneOldSessions(projectId ?? null, MAX_SESSIONS_PER_PROJECT);

  const session: ChatSession = {
    id: dbSession.id,
    projectId,
    title: sessionTitle,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };

  activeSessions.set(session.id, session);
  return session;
}

/**
 * Get an existing chat session (from cache or database)
 */
export async function getChatSession(sessionId: string): Promise<ChatSession | null> {
  // Check cache first
  const cached = activeSessions.get(sessionId);
  if (cached) return cached;
  
  // Load from database
  const dbSession = await dbGetSession(sessionId);
  if (!dbSession) return null;
  
  // Load messages
  const dbMessages = await dbGetMessages(sessionId);
  const messages: ChatMessage[] = dbMessages.map(m => ({
    id: m.id,
    role: m.role,
    content: m.content,
    timestamp: m.createdAt,
  }));
  
  const session = dbSessionToSession(dbSession, messages);
  activeSessions.set(session.id, session);
  return session;
}

/**
 * Get all chat sessions for a project (or global)
 */
export async function getSessionHistory(projectId?: string): Promise<ChatSession[]> {
  const dbSessions = await dbGetSessionsByProject(projectId ?? null, MAX_SESSIONS_PER_PROJECT);
  return dbSessions.map(s => dbSessionToSession(s));
}

/**
 * Load a session and make it the active one (switch to it)
 */
export async function switchToSession(sessionId: string): Promise<ChatSession | null> {
  const session = await getChatSession(sessionId);
  return session;
}

/**
 * Get or create chat session for a project (or global if projectId is undefined)
 * Creates a new session if none exists, otherwise returns the most recent one
 * @param projectId - Project ID, or undefined for global session
 */
export async function getOrCreateSession(projectId?: string): Promise<ChatSession> {
  // Check cache first for an active session
  for (const session of activeSessions.values()) {
    if (projectId === undefined && session.projectId === undefined) {
      return session;
    }
    if (projectId && session.projectId === projectId) {
      return session;
    }
  }
  
  // Check database for existing sessions
  const existingSessions = await dbGetSessionsByProject(projectId ?? null, 1);
  if (existingSessions.length > 0) {
    // Load the most recent session
    const dbSession = existingSessions[0];
    const dbMessages = await dbGetMessages(dbSession.id);
    const messages: ChatMessage[] = dbMessages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.createdAt,
    }));
    
    const session = dbSessionToSession(dbSession, messages);
    activeSessions.set(session.id, session);
    return session;
  }
  
  // Create new session
  return createChatSession(projectId);
}

/**
 * Add a message to a chat session (persisted to database)
 */
export async function addMessage(
  sessionId: string,
  role: ChatMessage['role'],
  content: string,
  contextChunks?: SearchResult[]
): Promise<ChatMessage> {
  const session = activeSessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const now = new Date();
  const message: ChatMessage = {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: now,
    contextChunks,
  };

  // Add to in-memory session
  session.messages.push(message);
  session.updatedAt = now;

  // Persist message to database
  const dbMessage: DBChatMessage = {
    id: message.id,
    sessionId,
    role,
    content,
    createdAt: now,
  };
  await dbCreateMessage(dbMessage);
  
  // Update session title from first user message
  if (role === 'user' && session.messages.filter(m => m.role === 'user').length === 1) {
    const newTitle = generateSessionTitle(content);
    session.title = newTitle;
    await dbUpdateSession(sessionId, newTitle);
  } else {
    // Just touch the session to update timestamp
    await dbTouchSession(sessionId);
  }

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
 * Clear a chat session's messages
 */
export async function clearSession(sessionId: string): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.messages = [];
    session.updatedAt = new Date();
  }
  
  // Clear from database
  await dbDeleteMessages(sessionId);
}

/**
 * Delete a chat session completely
 */
export async function deleteSession(sessionId: string): Promise<void> {
  activeSessions.delete(sessionId);
  await dbDeleteSession(sessionId);
}

/**
 * Start a new chat session (creates fresh session for the project/global)
 */
export async function startNewSession(projectId?: string): Promise<ChatSession> {
  // Remove any existing active session for this project from cache
  for (const [id, session] of activeSessions.entries()) {
    if (projectId === undefined && session.projectId === undefined) {
      activeSessions.delete(id);
      break;
    }
    if (projectId && session.projectId === projectId) {
      activeSessions.delete(id);
      break;
    }
  }
  
  return createChatSession(projectId);
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
export async function recordAssistantResponse(
  sessionId: string,
  content: string,
  contextChunks?: SearchResult[]
): Promise<ChatMessage> {
  return addMessage(sessionId, 'assistant', content, contextChunks);
}

