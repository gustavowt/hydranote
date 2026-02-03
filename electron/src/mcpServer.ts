/**
 * MCP Server for HydraNote
 * Exposes HydraNote capabilities via Model Context Protocol over HTTP
 * 
 * Security:
 * - Binds only to 127.0.0.1 (localhost)
 * - Requires bearer token authentication
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import express, { Request, Response, NextFunction } from 'express';
import * as http from 'http';
import { ipcMain, BrowserWindow } from 'electron';

// ============================================
// Types
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

interface MCPToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ============================================
// Tool Definitions
// ============================================

const HYDRANOTE_TOOLS: Tool[] = [
  {
    name: 'list_projects',
    description: 'Get all projects (notebooks/workspaces) in HydraNote with their metadata including name, description, status, and file count.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_project',
    description: 'Get detailed information about a specific project including its files and stats.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project UUID',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'list_files',
    description: 'List all files in a project. Can return as flat list or hierarchical tree structure.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project UUID',
        },
        asTree: {
          type: 'boolean',
          description: 'Return as hierarchical tree (default: false)',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the full content of a file. Supports markdown, text, and other document formats.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project UUID',
        },
        fileId: {
          type: 'string',
          description: 'File UUID (use this or fileName)',
        },
        fileName: {
          type: 'string',
          description: 'File name or path (use this or fileId)',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'search',
    description: 'Search across documents using natural language. Uses semantic/vector search to find relevant content based on meaning, not just keywords.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query',
        },
        projectId: {
          type: 'string',
          description: 'Project UUID (if omitted, searches all projects)',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum results to return (default: 5, max: 20)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_note',
    description: 'Create a new formatted markdown note. The content will be processed and formatted, with an appropriate title and location determined automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Target project UUID',
        },
        content: {
          type: 'string',
          description: 'Note content to save',
        },
        directory: {
          type: 'string',
          description: 'Target directory path (optional, auto-determined if not provided)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for organization',
        },
      },
      required: ['projectId', 'content'],
    },
  },
  {
    name: 'update_file',
    description: 'Update an existing file with line-based editing operations. Supports replacing a range of lines, or inserting content before/after a specific line.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project UUID',
        },
        fileId: {
          type: 'string',
          description: 'File UUID (use this or fileName)',
        },
        fileName: {
          type: 'string',
          description: 'File name or path (use this or fileId)',
        },
        action: {
          type: 'string',
          enum: ['replace', 'insert_after', 'insert_before'],
          description: 'The editing action: "replace" replaces lines from startLine to endLine, "insert_after" inserts after the specified line, "insert_before" inserts before the specified line',
        },
        startLine: {
          type: 'number',
          description: 'Start line number (1-based, inclusive) - required for "replace" action',
        },
        endLine: {
          type: 'number',
          description: 'End line number (1-based, inclusive) - required for "replace" action',
        },
        line: {
          type: 'number',
          description: 'Target line number (1-based) - required for "insert_after" and "insert_before" actions',
        },
        content: {
          type: 'string',
          description: 'The content to insert or replace with',
        },
      },
      required: ['projectId', 'action', 'content'],
    },
  },
];

// ============================================
// MCP Server Class
// ============================================

export class HydraNoteServer {
  private server: Server;
  private httpServer: http.Server | null = null;
  private expressApp: express.Application;
  private settings: MCPSettings;
  private mainWindow: BrowserWindow | null = null;

  constructor(settings: MCPSettings) {
    this.settings = settings;
    this.expressApp = express();
    
    // Initialize MCP server
    this.server = new Server(
      {
        name: 'hydranote-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    this.setupHttpMiddleware();
  }

  /**
   * Set the main window reference for IPC communication
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * Setup HTTP middleware including authentication
   */
  private setupHttpMiddleware(): void {
    // JSON body parser
    this.expressApp.use(express.json());

    // Bearer token authentication
    this.expressApp.use((req: Request, res: Response, next: NextFunction) => {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or invalid authorization header' });
        return;
      }

      const token = authHeader.substring(7);
      if (token !== this.settings.bearerToken) {
        res.status(403).json({ error: 'Invalid bearer token' });
        return;
      }

      next();
    });

    // Health check endpoint
    this.expressApp.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', server: 'hydranote-mcp' });
    });

    // MCP JSON-RPC endpoint
    this.expressApp.post('/mcp', async (req: Request, res: Response) => {
      try {
        const { jsonrpc, method, params, id } = req.body;

        // Validate JSON-RPC format
        if (jsonrpc !== '2.0') {
          res.json({
            jsonrpc: '2.0',
            error: { code: -32600, message: 'Invalid Request: must use JSON-RPC 2.0' },
            id: id || null,
          });
          return;
        }

        let result: unknown;

        switch (method) {
          case 'initialize':
            // MCP initialization - return server capabilities
            result = {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: {},
              },
              serverInfo: {
                name: 'hydranote-mcp',
                version: '1.0.0',
              },
            };
            break;

          case 'initialized':
            // Client acknowledgment - no response needed for notifications
            // Notifications have no id
            if (id === undefined) {
              res.status(204).end();
              return;
            }
            result = {};
            break;

          case 'tools/list':
            result = {
              tools: HYDRANOTE_TOOLS,
            };
            break;

          case 'tools/call':
            const toolResult = await this.handleToolCall(params.name, params.arguments);
            result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(toolResult, null, 2),
                },
              ],
              isError: !toolResult.success,
            };
            break;

          case 'ping':
            result = {};
            break;

          default:
            res.json({
              jsonrpc: '2.0',
              error: { code: -32601, message: `Method not found: ${method}` },
              id: id || null,
            });
            return;
        }

        // Return JSON-RPC success response
        res.json({
          jsonrpc: '2.0',
          result,
          id,
        });
      } catch (error) {
        console.error('[MCP] Error handling request:', error);
        res.json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : 'Internal error',
          },
          id: req.body?.id || null,
        });
      }
    });

    // List tools endpoint (convenience)
    this.expressApp.get('/tools', (_req: Request, res: Response) => {
      res.json({ tools: HYDRANOTE_TOOLS });
    });
  }

  /**
   * Setup MCP tool handlers
   */
  private setupToolHandlers(): void {
    // List tools handler
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: HYDRANOTE_TOOLS };
    });

    // Call tool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const result = await this.handleToolCall(
        request.params.name,
        request.params.arguments as Record<string, unknown>
      );
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    });
  }

  /**
   * Handle a tool call by forwarding to renderer via IPC
   */
  private async handleToolCall(
    toolName: string,
    args: Record<string, unknown> | undefined
  ): Promise<MCPToolResult> {
    if (!this.mainWindow) {
      return { success: false, error: 'Main window not available' };
    }

    try {
      // Forward to renderer process via IPC
      const result = await new Promise<MCPToolResult>((resolve, reject) => {
        const requestId = `mcp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Set up timeout
        const timeout = setTimeout(() => {
          ipcMain.removeListener('mcp:tool-response', responseHandler);
          reject(new Error('Tool execution timeout (30s)'));
        }, 30000);

        // Response handler
        const responseHandler = (_event: Electron.IpcMainEvent, response: { requestId: string; result: MCPToolResult }) => {
          if (response.requestId === requestId) {
            clearTimeout(timeout);
            ipcMain.removeListener('mcp:tool-response', responseHandler);
            resolve(response.result);
          }
        };

        // Listen for response
        ipcMain.on('mcp:tool-response', responseHandler);

        // Send request to renderer
        this.mainWindow?.webContents.send('mcp:tool-request', {
          requestId,
          toolName,
          args: args || {},
        });
      });

      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Start the MCP HTTP server
   */
  async start(): Promise<void> {
    if (this.httpServer) {
      console.log('[MCP] Server already running');
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this.httpServer = this.expressApp.listen(
          this.settings.port,
          '127.0.0.1',
          () => {
            console.log(`[MCP] Server started on http://127.0.0.1:${this.settings.port}`);
            resolve();
          }
        );

        this.httpServer.on('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE') {
            reject(new Error(`Port ${this.settings.port} is already in use`));
          } else {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the MCP HTTP server
   */
  async stop(): Promise<void> {
    if (!this.httpServer) {
      return;
    }

    return new Promise((resolve) => {
      this.httpServer?.close(() => {
        console.log('[MCP] Server stopped');
        this.httpServer = null;
        resolve();
      });
    });
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.httpServer !== null;
  }

  /**
   * Update settings (requires restart to take effect for port changes)
   */
  updateSettings(settings: MCPSettings): void {
    this.settings = settings;
  }
}

// ============================================
// Settings Persistence
// ============================================

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

/**
 * Get the path to the MCP settings file
 */
function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'mcp-settings.json');
}

/**
 * Load MCP settings from disk
 */
export function loadMCPSettings(): MCPSettings {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      return { ...DEFAULT_MCP_SETTINGS, ...JSON.parse(data) };
    }
  } catch (error) {
    console.error('[MCP] Failed to load settings:', error);
  }
  return { ...DEFAULT_MCP_SETTINGS };
}

/**
 * Save MCP settings to disk
 */
export function saveMCPSettings(settings: MCPSettings): void {
  try {
    const settingsPath = getSettingsPath();
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log('[MCP] Settings saved');
  } catch (error) {
    console.error('[MCP] Failed to save settings:', error);
  }
}

/**
 * Generate a secure random bearer token
 */
export function generateBearerToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const length = 32;
  let token = '';
  const randomBytes = require('crypto').randomBytes(length);
  for (let i = 0; i < length; i++) {
    token += chars[randomBytes[i] % chars.length];
  }
  return token;
}

// ============================================
// Singleton Instance
// ============================================

let mcpServerInstance: HydraNoteServer | null = null;

/**
 * Get or create the MCP server instance
 */
export function getMCPServer(): HydraNoteServer | null {
  return mcpServerInstance;
}

/**
 * Initialize the MCP server with settings
 */
export function initializeMCPServer(settings: MCPSettings): HydraNoteServer {
  if (mcpServerInstance) {
    mcpServerInstance.updateSettings(settings);
    return mcpServerInstance;
  }
  
  mcpServerInstance = new HydraNoteServer(settings);
  return mcpServerInstance;
}

/**
 * Start MCP server if enabled in settings
 */
export async function startMCPServerIfEnabled(): Promise<void> {
  const settings = loadMCPSettings();
  
  if (!settings.enabled) {
    console.log('[MCP] Server disabled in settings');
    return;
  }

  if (!settings.bearerToken) {
    console.log('[MCP] No bearer token configured');
    return;
  }

  try {
    const server = initializeMCPServer(settings);
    await server.start();
  } catch (error) {
    console.error('[MCP] Failed to start server:', error);
  }
}
