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
import { getProject, get_project_files, getProjectStats, searchProject, getAllProjects, searchAllProjects } from './projectService';

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

**4. WRITE** - Create a new file (md, pdf, docx)
\`\`\`tool_call
{"tool": "write", "params": {"format": "md", "title": "filename", "content": "file content", "path": "optional/directory"}}
\`\`\`

**5. ADD NOTE** - Create a quick note
\`\`\`tool_call
{"tool": "addNote", "params": {"content": "note content", "title": "optional title"}}
\`\`\`

**6. UPDATE FILE** - Modify existing file section
\`\`\`tool_call
{"tool": "updateFile", "params": {"file": "filename.md", "section": "Section Name", "operation": "replace", "newContent": "new content"}}
\`\`\`
Operations: "replace", "insert_before", "insert_after"

**7. WEB RESEARCH** - Search the internet
\`\`\`tool_call
{"tool": "webResearch", "params": {"query": "search query"}}
\`\`\`

## When to Use Tools

| User Request | Tool to Use |
|--------------|-------------|
| Read, view, open, show a file | READ |
| Search, find, what does it say about | SEARCH |
| Summarize, overview, TL;DR | SUMMARIZE |
| Create, write, generate, save as file | WRITE |
| Take a note, remember this, add note | ADD NOTE |
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
 */
export async function buildGlobalSystemPrompt(): Promise<string> {
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

  return `You are HydraNote, an AI assistant specialized in document analysis and interaction.

## Global Mode
You are in **Global Mode** - you have access to ALL projects and can perform cross-project operations.

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

**4. WRITE** - Create a new file (requires project in global mode)
\`\`\`tool_call
{"tool": "write", "params": {"format": "md", "title": "filename", "content": "content", "project": "Project Name"}}
\`\`\`

**5. ADD NOTE** - Create a quick note (requires project in global mode)
\`\`\`tool_call
{"tool": "addNote", "params": {"content": "note content", "project": "Project Name"}}
\`\`\`

**6. UPDATE FILE** - Modify existing file section
\`\`\`tool_call
{"tool": "updateFile", "params": {"file": "filename.md", "section": "Section", "operation": "replace", "newContent": "content", "project": "Project"}}
\`\`\`

**7. CREATE PROJECT** - Create a new project
\`\`\`tool_call
{"tool": "createProject", "params": {"name": "Project Name", "description": "optional"}}
\`\`\`

**8. MOVE FILE** - Move file between projects
\`\`\`tool_call
{"tool": "moveFile", "params": {"file": "filename.md", "fromProject": "Source", "toProject": "Destination"}}
\`\`\`

**9. DELETE FILE** - Delete a file
\`\`\`tool_call
{"tool": "deleteFile", "params": {"file": "filename.md", "project": "Project Name"}}
\`\`\`

**10. DELETE PROJECT** - Delete entire project (requires confirm: "yes")
\`\`\`tool_call
{"tool": "deleteProject", "params": {"project": "Project Name", "confirm": "yes"}}
\`\`\`

**11. WEB RESEARCH** - Search the internet
\`\`\`tool_call
{"tool": "webResearch", "params": {"query": "search query"}}
\`\`\`

## When to Use Tools

| User Request | Tool to Use |
|--------------|-------------|
| Read, view, open a file | READ |
| Search, find information | SEARCH |
| Summarize a document | SUMMARIZE |
| Create, write a new file | WRITE |
| Take a note | ADD NOTE |
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
// Chat Session Management
// ============================================

const activeSessions = new Map<string, ChatSession>();

// Special key for global session
const GLOBAL_SESSION_KEY = '__global__';

/**
 * Create a new chat session for a project or global
 * @param projectId - Project ID, or undefined for global session
 */
export async function createChatSession(projectId?: string): Promise<ChatSession> {
  // Validate project if specified
  if (projectId) {
    const project = await getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
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
 * Get or create chat session for a project (or global if projectId is undefined)
 * @param projectId - Project ID, or undefined for global session
 */
export async function getOrCreateSession(projectId?: string): Promise<ChatSession> {
  // Find existing session for this project (or global)
  for (const session of activeSessions.values()) {
    if (projectId === undefined && session.projectId === undefined) {
      // Looking for global session and found one
      return session;
    }
    if (projectId && session.projectId === projectId) {
      // Looking for project session and found it
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

