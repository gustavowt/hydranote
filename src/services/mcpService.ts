/**
 * MCP Service for HydraNote
 * Handles MCP tool execution requests from the Electron main process
 * Executes tools using existing HydraNote services and returns results
 */

import {
  getAllProjects,
  getProject,
  get_project_files,
  getFile,
  searchProject,
  searchAllProjects,
  getProjectFileTree,
  updateFile,
} from './projectService';
import { addNote } from './noteService';

// ============================================
// Types
// ============================================

interface MCPToolRequest {
  requestId: string;
  toolName: string;
  args: Record<string, unknown>;
}

interface MCPToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ============================================
// Tool Handlers
// ============================================

/**
 * List all projects
 */
async function handleListProjects(): Promise<MCPToolResult> {
  try {
    const projects = await getAllProjects();
    
    // Get file counts for each project
    const projectsWithCounts = await Promise.all(
      projects.map(async (project) => {
        const files = await get_project_files(project.id);
        return {
          id: project.id,
          name: project.name,
          description: project.description,
          status: project.status,
          fileCount: files.length,
          createdAt: project.createdAt.toISOString(),
          updatedAt: project.updatedAt.toISOString(),
        };
      })
    );
    
    return {
      success: true,
      data: { projects: projectsWithCounts },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list projects',
    };
  }
}

/**
 * Get a specific project
 */
async function handleGetProject(args: Record<string, unknown>): Promise<MCPToolResult> {
  const projectId = args.projectId as string;
  
  if (!projectId) {
    return { success: false, error: 'Project ID is required' };
  }
  
  try {
    const project = await getProject(projectId);
    
    if (!project) {
      return { success: false, error: 'Project not found' };
    }
    
    const files = await get_project_files(projectId);
    
    return {
      success: true,
      data: {
        id: project.id,
        name: project.name,
        description: project.description,
        status: project.status,
        fileCount: files.length,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get project',
    };
  }
}

/**
 * List files in a project
 */
async function handleListFiles(args: Record<string, unknown>): Promise<MCPToolResult> {
  const projectId = args.projectId as string;
  const asTree = args.asTree as boolean;
  
  if (!projectId) {
    return { success: false, error: 'Project ID is required' };
  }
  
  try {
    if (asTree) {
      const tree = await getProjectFileTree(projectId);
      return {
        success: true,
        data: { tree },
      };
    } else {
      const files = await get_project_files(projectId);
      return {
        success: true,
        data: {
          files: files.map(file => ({
            id: file.id,
            name: file.name,
            path: file.name,
            type: file.type,
            size: file.size,
            status: file.status,
          })),
        },
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list files',
    };
  }
}

/**
 * Read a file's content
 */
async function handleReadFile(args: Record<string, unknown>): Promise<MCPToolResult> {
  const projectId = args.projectId as string;
  const fileId = args.fileId as string | undefined;
  const fileName = args.fileName as string | undefined;
  
  if (!projectId) {
    return { success: false, error: 'Project ID is required' };
  }
  
  if (!fileId && !fileName) {
    return { success: false, error: 'Either fileId or fileName is required' };
  }
  
  try {
    let file;
    
    if (fileId) {
      file = await getFile(fileId);
    } else if (fileName) {
      // Search for file by name
      const files = await get_project_files(projectId);
      file = files.find(f => 
        f.name.toLowerCase() === fileName.toLowerCase() ||
        f.name.toLowerCase().includes(fileName.toLowerCase())
      );
    }
    
    if (!file) {
      return { success: false, error: 'File not found' };
    }
    
    // Truncate if content is too large (50KB)
    const maxLength = 50000;
    const content = file.content || '';
    const truncated = content.length > maxLength;
    
    return {
      success: true,
      data: {
        id: file.id,
        name: file.name,
        content: truncated ? content.slice(0, maxLength) + '\n\n[Content truncated...]' : content,
        type: file.type,
        size: file.size,
        truncated,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read file',
    };
  }
}

/**
 * Search across documents
 */
async function handleSearch(args: Record<string, unknown>): Promise<MCPToolResult> {
  const query = args.query as string;
  const projectId = args.projectId as string | undefined;
  const maxResults = Math.min((args.maxResults as number) || 5, 20);
  
  if (!query) {
    return { success: false, error: 'Search query is required' };
  }
  
  try {
    let results;
    
    if (projectId) {
      // Search within specific project
      results = await searchProject(projectId, query, maxResults);
      results = results.map(r => ({
        ...r,
        projectId,
        projectName: '', // Will be filled if needed
      }));
    } else {
      // Search across all projects
      results = await searchAllProjects(query, maxResults);
    }
    
    return {
      success: true,
      data: {
        results: results.map(r => ({
          fileId: r.fileId,
          fileName: r.fileName,
          projectId: 'projectId' in r ? r.projectId : projectId,
          projectName: 'projectName' in r ? r.projectName : undefined,
          text: r.text,
          score: r.score,
        })),
        query,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Search failed',
    };
  }
}

/**
 * Create a new note
 */
async function handleCreateNote(args: Record<string, unknown>): Promise<MCPToolResult> {
  const projectId = args.projectId as string;
  const content = args.content as string;
  const directory = args.directory as string | undefined;
  const tags = args.tags as string[] | undefined;
  
  if (!projectId) {
    return { success: false, error: 'Project ID is required' };
  }
  
  if (!content) {
    return { success: false, error: 'Note content is required' };
  }
  
  try {
    const result = await addNote({
      projectId,
      rawNoteText: content,
      contextMetadata: {
        tags,
        topic: directory,
      },
    });
    
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to create note' };
    }
    
    return {
      success: true,
      data: {
        success: true,
        fileId: result.fileId,
        fileName: `${result.title}.md`,
        filePath: result.filePath,
        title: result.title,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create note',
    };
  }
}

/**
 * Update an existing file with line-based editing
 */
async function handleUpdateFile(args: Record<string, unknown>): Promise<MCPToolResult> {
  const projectId = args.projectId as string;
  const fileId = args.fileId as string | undefined;
  const fileName = args.fileName as string | undefined;
  const action = args.action as string;
  const content = args.content as string;
  const startLine = args.startLine as number | undefined;
  const endLine = args.endLine as number | undefined;
  const line = args.line as number | undefined;

  // Validate required parameters
  if (!projectId) {
    return { success: false, error: 'Project ID is required' };
  }

  if (!fileId && !fileName) {
    return { success: false, error: 'Either fileId or fileName is required' };
  }

  if (!action) {
    return { success: false, error: 'Action is required (replace, insert_after, insert_before)' };
  }

  if (!['replace', 'insert_after', 'insert_before'].includes(action)) {
    return { success: false, error: `Invalid action: ${action}. Must be one of: replace, insert_after, insert_before` };
  }

  if (content === undefined || content === null) {
    return { success: false, error: 'Content is required' };
  }

  // Validate action-specific parameters
  if (action === 'replace') {
    if (startLine === undefined || endLine === undefined) {
      return { success: false, error: 'startLine and endLine are required for replace action' };
    }
    if (startLine < 1 || endLine < 1) {
      return { success: false, error: 'Line numbers must be 1 or greater' };
    }
    if (startLine > endLine) {
      return { success: false, error: 'startLine must be less than or equal to endLine' };
    }
  } else {
    // insert_after or insert_before
    if (line === undefined) {
      return { success: false, error: `line is required for ${action} action` };
    }
    if (line < 1) {
      return { success: false, error: 'Line number must be 1 or greater' };
    }
  }

  try {
    // Resolve the file
    let file;
    if (fileId) {
      file = await getFile(fileId);
    } else if (fileName) {
      const files = await get_project_files(projectId);
      file = files.find(f =>
        f.name.toLowerCase() === fileName.toLowerCase() ||
        f.name.toLowerCase().includes(fileName.toLowerCase())
      );
    }

    if (!file) {
      return { success: false, error: 'File not found' };
    }

    // Check if file is editable (markdown/text)
    if (file.type !== 'md' && file.type !== 'txt') {
      return { success: false, error: `Cannot edit file of type: ${file.type}. Only markdown and text files are supported.` };
    }

    // Get current content and split into lines
    const currentContent = file.content || '';
    const lines = currentContent.split('\n');
    const totalLines = lines.length;

    let newLines: string[];
    let description: string;

    if (action === 'replace') {
      // Validate line range
      if (startLine! > totalLines) {
        return { success: false, error: `startLine (${startLine}) exceeds total lines (${totalLines})` };
      }
      
      // Clamp endLine to totalLines
      const effectiveEndLine = Math.min(endLine!, totalLines);
      
      // Replace lines (convert to 0-based index)
      const contentLines = content.split('\n');
      newLines = [
        ...lines.slice(0, startLine! - 1),
        ...contentLines,
        ...lines.slice(effectiveEndLine),
      ];
      description = `Replaced lines ${startLine}-${effectiveEndLine}`;
    } else if (action === 'insert_after') {
      // Validate line number
      if (line! > totalLines) {
        return { success: false, error: `line (${line}) exceeds total lines (${totalLines})` };
      }
      
      // Insert after the specified line (convert to 0-based index)
      const contentLines = content.split('\n');
      newLines = [
        ...lines.slice(0, line!),
        ...contentLines,
        ...lines.slice(line!),
      ];
      description = `Inserted ${contentLines.length} line(s) after line ${line}`;
    } else {
      // insert_before
      // Validate line number
      if (line! > totalLines + 1) {
        return { success: false, error: `line (${line}) exceeds total lines + 1 (${totalLines + 1})` };
      }
      
      // Insert before the specified line (convert to 0-based index)
      const contentLines = content.split('\n');
      newLines = [
        ...lines.slice(0, line! - 1),
        ...contentLines,
        ...lines.slice(line! - 1),
      ];
      description = `Inserted ${contentLines.length} line(s) before line ${line}`;
    }

    // Join lines and update the file
    const newContent = newLines.join('\n');
    const updatedFile = await updateFile(file.id, newContent);

    if (!updatedFile) {
      return { success: false, error: 'Failed to update file' };
    }

    return {
      success: true,
      data: {
        fileId: file.id,
        fileName: file.name,
        action,
        description,
        totalLinesAfter: newLines.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update file',
    };
  }
}

// ============================================
// Tool Dispatcher
// ============================================

/**
 * Execute an MCP tool request
 */
async function executeMCPTool(toolName: string, args: Record<string, unknown>): Promise<MCPToolResult> {
  switch (toolName) {
    case 'list_projects':
      return handleListProjects();
    case 'get_project':
      return handleGetProject(args);
    case 'list_files':
      return handleListFiles(args);
    case 'read_file':
      return handleReadFile(args);
    case 'search':
      return handleSearch(args);
    case 'create_note':
      return handleCreateNote(args);
    case 'update_file':
      return handleUpdateFile(args);
    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}

// ============================================
// MCP Service Initialization
// ============================================

let initialized = false;

/**
 * Initialize the MCP service
 * Sets up listeners for tool execution requests from the main process
 */
export function initializeMCPService(): void {
  if (initialized) {
    return;
  }
  
  // Check if we're in Electron
  if (!window.electronAPI?.mcp) {
    console.log('[MCP Service] Not running in Electron, skipping initialization');
    return;
  }
  
  console.log('[MCP Service] Initializing...');
  
  // Listen for tool execution requests from main process
  window.electronAPI.mcp.onToolRequest(async (request: MCPToolRequest) => {
    console.log(`[MCP Service] Received tool request: ${request.toolName}`);
    
    try {
      const result = await executeMCPTool(request.toolName, request.args);
      
      // Send response back to main process
      window.electronAPI?.mcp.sendToolResponse(request.requestId, result);
    } catch (error) {
      console.error('[MCP Service] Tool execution error:', error);
      
      window.electronAPI?.mcp.sendToolResponse(request.requestId, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
  
  initialized = true;
  console.log('[MCP Service] Initialized successfully');
}

// ============================================
// MCP Settings Helpers (for UI)
// ============================================

export interface MCPSettings {
  enabled: boolean;
  port: number;
  bearerToken: string;
}

export const DEFAULT_MCP_SETTINGS: MCPSettings = {
  enabled: false,
  port: 3847,
  bearerToken: '',
};

/**
 * Load MCP settings from Electron main process
 */
export async function loadMCPSettings(): Promise<MCPSettings> {
  if (!window.electronAPI?.mcp) {
    return { ...DEFAULT_MCP_SETTINGS };
  }
  
  try {
    const result = await window.electronAPI.mcp.getSettings();
    if (result.success && result.settings) {
      return result.settings;
    }
  } catch (error) {
    console.error('[MCP Service] Failed to load settings:', error);
  }
  
  return { ...DEFAULT_MCP_SETTINGS };
}

/**
 * Save MCP settings to Electron main process
 */
export async function saveMCPSettings(settings: MCPSettings): Promise<{ success: boolean; error?: string }> {
  if (!window.electronAPI?.mcp) {
    return { success: false, error: 'Not running in Electron' };
  }
  
  try {
    // Create a plain object copy to avoid Vue reactive proxy serialization issues
    // Vue's reactive proxies cannot be cloned through Electron's contextBridge
    const plainSettings = {
      enabled: Boolean(settings.enabled),
      port: Number(settings.port),
      bearerToken: String(settings.bearerToken || ''),
    };
    const result = await window.electronAPI.mcp.saveSettings(plainSettings);
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save settings',
    };
  }
}

/**
 * Generate a new bearer token
 */
export async function generateMCPToken(): Promise<{ success: boolean; token?: string; error?: string }> {
  if (!window.electronAPI?.mcp) {
    return { success: false, error: 'Not running in Electron' };
  }
  
  try {
    const result = await window.electronAPI.mcp.generateToken();
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate token',
    };
  }
}

/**
 * Get MCP server status
 */
export async function getMCPServerStatus(): Promise<{ running: boolean }> {
  if (!window.electronAPI?.mcp) {
    return { running: false };
  }
  
  try {
    const result = await window.electronAPI.mcp.getStatus();
    return { running: result.running ?? false };
  } catch (error) {
    console.error('[MCP Service] Failed to get status:', error);
    return { running: false };
  }
}

/**
 * Generate MCP configuration JSON for download
 */
export function generateMCPConfig(settings: MCPSettings): string {
  const config = {
    mcpServers: {
      hydranote: {
        url: `http://127.0.0.1:${settings.port}/mcp`,
        transport: {
          type: 'streamable-http',
        },
        headers: {
          Authorization: `Bearer ${settings.bearerToken}`,
        },
        description: 'HydraNote local MCP server - Access your notes, projects, and files',
        tools: [
          'list_projects',
          'get_project',
          'list_files',
          'read_file',
          'search',
          'create_note',
          'update_file',
        ],
      },
    },
  };
  
  return JSON.stringify(config, null, 2);
}

/**
 * Check if MCP server is available (running in Electron)
 */
export function isMCPAvailable(): boolean {
  return !!window.electronAPI?.mcp;
}
