# HydraNote Developer Documentation

Technical documentation for HydraNote - an AI-powered document indexing and interaction system.

## Architecture Overview

**Tech Stack:**
- **Frontend**: Ionic Vue (Vue 3 + TypeScript)
- **Database**: DuckDB (in-browser WASM with OPFS persistence)
- **AI Providers**: OpenAI, Anthropic (Claude), Google (Gemini), Ollama, Hugging Face Local
- **Embedding Providers**: OpenAI, Gemini, Ollama, Hugging Face Local (independent from LLM provider)
- **Document Processing**: PDF.js, Mammoth (DOCX), Tesseract.js (OCR)
- **Markdown**: marked + highlight.js + Mermaid (diagrams)
- **Rich Text Editor**: Tiptap (ProseMirror-based) for DOCX editing
- **File System Sync**: File System Access API (bidirectional sync with local directories)

### Workspace Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Logo  │        [  Search Bar  ]          │  New Note │ Settings│
├──────────────┬─────────────────────────────┬────────────────────┤
│   Projects   │                             │                    │
│     Tree     │      Markdown Editor        │    Chat Sidebar    │
│   Sidebar    │    (edit/split/preview)     │                    │
│  (280px)     │         (flex)              │      (360px)       │
│              │                             │                    │
│  Collapsible │                             │     Collapsible    │
└──────────────┴─────────────────────────────┴────────────────────┘
```

### Core Data Flow

```
User Input → Router → Tool Selection → Tool Execution → LLM Response → UI
                ↓
            Embeddings → Vector Search → Context Retrieval
```

### Application Bootstrap

The app initializes the database before mounting Vue. All services use `projectService` functions which call `ensureInitialized()` internally.

---

## Services

### Project Service (`projectService.ts`)

Single source of truth for all file and project operations. Handles both database AND file system sync automatically.

**Key Functions:**
| Function | Description |
|----------|-------------|
| `createProject(name, description?)` | Create project (idempotent - returns existing if name matches) |
| `deleteProject(projectId)` | Delete project and all files |
| `createFile(projectId, path, content, type)` | Create file (DB + FS sync) |
| `updateFile(fileId, content)` | Update file content (DB + FS sync) |
| `deleteFile(fileId)` | Delete file (DB + FS sync) |
| `moveFile(fileId, targetProjectId, targetDir?)` | Move/rename file (DB + FS sync) |
| `renameFile(fileId, newName)` | Rename file within same project |
| `searchProject(projectId, query, k)` | Semantic search within project |
| `getProjectFileTree(projectId)` | Get hierarchical file tree |
| `indexFileForSearch(projectId, fileId, content, type)` | Create chunks and embeddings |

### Note Service (`noteService.ts`)

AI-powered note formatting and organization. Used internally by the `write` tool for Markdown files.

**Key Functions:**
| Function | Description |
|----------|-------------|
| `formatNote(rawText, metadata?)` | Transform raw text to structured Markdown |
| `generateNoteTitle(content)` | Generate title from content |
| `decideNoteDirectory(projectId, title, metadata?)` | AI-decide best directory |
| `globalAddNote(params, onProgress?)` | Dashboard flow with project routing |
| `decideTargetProject(content, tags?)` | AI-decide which project for a note |

### Tool Service (`toolService.ts`)

Handles tool execution with Planner → Executor → Checker architecture.

**Available Tools:**
| Tool | Purpose |
|------|---------|
| `read` | Read file content |
| `search` | Semantic search |
| `summarize` | Summarize documents |
| `write` | Create files (AI pipeline for MD, direct for PDF/DOCX) |
| `updateFile` | Update existing files using chain-of-thought analysis and unified diff |
| `webResearch` | Search the web for information |
| `createProject` | Create a new project (global mode) |
| `moveFile` | Rename, move within project, or move between projects |
| `deleteFile` | Delete a file |
| `deleteProject` | Delete a project (global mode) |

**Orchestration Flow:**
1. **Planner**: Analyze request, create ordered tool execution plan (passes file + instruction to updateFile)
2. **Auto-Execute Check**: Single-step read-only tools execute immediately; multi-step shows Plan UI
3. **Executor**: Execute plan with context passing between steps
4. **Checker**: Verify completion, replan if needed, generate interpretation

**updateFile Tool Architecture:**
The updateFile tool uses a chain-of-thought approach for precise file modifications:
1. **Planner** passes only: `file` (filename) + `instruction` (natural language) + optional `selectionContext`
2. **Tool** receives file content with line numbers and uses a structured CoT prompt to:
   - Analyze file structure and type
   - Identify exactly which lines need to change
   - Generate a unified diff for the changes
3. **Diff Application**: The unified diff is parsed and applied to produce the new content
4. **Preview**: Shows reasoning + diff preview for user confirmation

This architecture ensures:
- The Planner focuses on workflow orchestration, not content analysis
- The Tool has full context to make precise, minimal changes
- Changes are atomic and reviewable via unified diff format

**Auto-Execute Tools** (no confirmation needed): `read`, `search`, `summarize`

**File Update Confirmation Behavior:**
- Single `updateFile` in plan: Shows confirmation dialog with diff preview
- Multiple `updateFile` in plan: Auto-applies all updates (user already approved the plan), shows summary message

**Sidebar Refresh Behavior:**
- Sidebar refreshes immediately after each persisting tool completes (not just at the end of plan execution)
- Tools declare persistence via `persistedChanges: true` in their `ToolResult` - no hardcoded list in UI
- When adding a new tool that persists data, set `persistedChanges: true` in the success return

**Response Conciseness:**
- Final responses show only the LLM interpretation, not raw tool outputs (tool results visible in collapsible log)
- LLM interpretation is capped at 500 tokens with low temperature for concise output
- For multiple file updates, the verbose preview text is replaced with a simple summary

**Working Context (Global Mode):**
- In global mode, the chat tracks recently created projects and files as "working context"
- When a project is created, subsequent messages automatically use that project without explicit specification

**Planner Context:**
The planner receives rich context to understand user intent:
- **Project context**: Current project ID and available files
- **Working context**: Recently created projects/files (global mode)
- **Current file context**: The file currently open in the editor
  - When user says "this file", "here", "this document" → planner uses the open file
  - Includes: file name, path, type, and project
- **Conversation context**: Recent messages for continuity
- **Runtime context**: Date, time, platform, locale
- Working context is session-scoped (resets on new chat or session switch)
- Injected into both system prompt and planner prompt so LLM maintains awareness
- Type: `WorkingContext { projectId?, projectName?, recentFiles[] }`

**Structured Output Retry Logic:**
- When the LLM returns malformed JSON, the planner automatically retries up to 2 additional times
- Each retry sends the malformed response back to the LLM with the parse error, asking for correction
- The conversation context is preserved so the LLM can fix its response
- Only shows the "trouble understanding" error message after all retries are exhausted
- Helps with local models that don't always produce well-formed JSON on the first attempt

**Key Functions:**
| Function | Description |
|----------|-------------|
| `createExecutionPlan()` | Create plan from user message (with JSON retry logic) |
| `executePlan()` | Execute plan with context passing |
| `runPlannerFlow()` | Full orchestration with tool logs and LLM interpretation |

### Chat Service (`chatService.ts`)

Manages chat sessions with persistent history in DuckDB.

**Key Functions:**
| Function | Description |
|----------|-------------|
| `buildSystemPrompt(projectId)` | Build system prompt with project context |
| `buildGlobalSystemPrompt(workingContext?)` | Build global system prompt with optional working context |
| `createChatSession(projectId, title?)` | Create new session (max 20 per project) |
| `getSessionHistory(projectId?)` | Get all sessions for project/global |
| `switchToSession(sessionId)` | Load and switch to session |
| `addMessage(sessionId, role, content)` | Add message (persisted) |

### Embedding Service (`embeddingService.ts`)

Multi-provider embedding generation, independent from LLM provider.

**Supported Providers:**
| Provider | Models |
|----------|--------|
| OpenAI | text-embedding-3-small, text-embedding-3-large |
| Gemini | text-embedding-004 |
| Ollama | nomic-embed-text, mxbai-embed-large, all-minilm |
| Hugging Face Local | Xenova/all-MiniLM-L6-v2, etc. (Electron only, offline) |

**Key Functions:**
| Function | Description |
|----------|-------------|
| `generateEmbedding(text)` | Generate embedding using configured provider |
| `reindexAllFiles(onProgress?)` | Full re-index of all files |
| `detectStaleEmbeddings(projectId?)` | Find files needing re-indexing |

### Web Search Service (`webSearchService.ts`)

Web research with caching and semantic search over results.

**Supported Providers:** SearXNG, Brave Search, DuckDuckGo

**Features:**
- Results cached in DuckDB (60 min default)
- Pages chunked and embedded for semantic search
- Safety limits: 30s timeout, 5s per page, max 5 chunks/page

### Sync Service (`syncService.ts`)

Bidirectional file system synchronization.

**Key Functions:**
| Function | Description |
|----------|-------------|
| `syncAll()` | Full sync of all projects |
| `syncProject(projectId)` | Sync single project |
| `syncFileToFileSystem(projectName, filePath, content)` | Sync file to disk |

### Version Service (`versionService.ts`)

File version history with diff-based storage (last 10 versions per file).

**Key Functions:**
| Function | Description |
|----------|-------------|
| `createVersion(fileId, content, source)` | Create new version |
| `getVersionHistory(fileId)` | Get version metadata list |
| `getVersionContent(fileId, versionNumber)` | Reconstruct content at version |

### Export Service (`exportService.ts`)

File export for downloading content as PDF, DOCX, or Markdown.

**Key Functions:**
| Function | Description |
|----------|-------------|
| `exportToFile(title, content, format, options?)` | Export and trigger download |
| `exportToPDF/DOCX/Markdown()` | Convenience wrappers |

### Telemetry Service (`telemetryService.ts`)

Tracks events for monitoring AI behavior: `note_created`, `project_created`, `directory_created`.

---

## Components

### WorkspacePage (`WorkspacePage.vue`)
Main layout orchestrating three-panel workspace. Routes files to appropriate editor based on type.

### MarkdownEditor (`MarkdownEditor.vue`)
Full markdown editor with edit/split/preview modes, Mermaid diagram support, inline saving, version history access.

**Features:**
- Send selected text to chat (`@selection:file:lines` reference)
- AI Formatting via 3-dots menu
- Export as PDF/DOCX/Markdown
- Version history restore

### ChatSidebar (`ChatSidebar.vue`)
AI chat panel with project context, `@file:` autocomplete, `@selection:` references from editor.

**Reference Visual Rendering:**
User messages containing `@` references are parsed and rendered as styled UI components:
- `@file:path/file.md` → File pill (compact badge with file icon and name)
- `@project:ProjectName` → Project pill (badge with folder icon)
- `@selection:file:lines` + code block → Selection card with collapsible syntax-highlighted code

This is a display-only feature - the raw content is preserved for LLM processing.

### ProjectsTreeSidebar (`ProjectsTreeSidebar.vue`)
Hierarchical project/file navigator with drag-and-drop between projects.

### PDFViewer (`PDFViewer.vue`)
Read-only PDF viewer loading from file system path (Electron only).

### RichTextEditor (`RichTextEditor.vue`)
Tiptap WYSIWYG editor for DOCX files.

### SearchAutocomplete (`SearchAutocomplete.vue`)
Global fuzzy search across all projects (files and content).

---

## File Type Handling

| File Type | Editor | Storage |
|-----------|--------|---------|
| `.md`, `.txt` | MarkdownEditor | `content` (synced to FS) |
| `.pdf` | PDFViewer (readonly) | `content` (extracted text) + `systemFilePath` |
| `.docx` | RichTextEditor | `content` + `binaryData` (base64) + `htmlContent` |

---

## Configuration

### localStorage Keys

| Key | Description |
|-----|-------------|
| `hydranote_llm_settings` | LLM provider config (provider, API keys, models, note settings) |
| `hydranote_indexer_settings` | Embedding provider config |
| `hydranote_filesystem_settings` | File system sync config (enabled, rootPath, syncOnSave) |
| `hydranote_wizard_completed` | Setup wizard completion flag |
| `hydranote_web_search_settings` | Web search provider config |

### LLM Settings Structure
```typescript
{
  provider: 'openai' | 'ollama' | 'anthropic' | 'google' | 'huggingface_local';
  openai: { apiKey, model, baseUrl? };
  ollama: { baseUrl, model };
  anthropic: { apiKey, model };
  google: { apiKey, model };
  huggingfaceLocal: { modelId, contextLength, gpuLayers };
  noteSettings: { formatInstructions, defaultDirectory, autoGenerateTitle };
}
```

### Supported AI Providers
| Provider | Models |
|----------|--------|
| OpenAI | GPT-4.1, GPT-4.1 Mini/Nano, o3, o3-mini, GPT-4o, GPT-4o-mini |
| Anthropic | Claude Opus 4.5/4.1, Claude Sonnet 4, Claude 3.5 Sonnet/Haiku |
| Google | Gemini 2.5 Pro/Flash/Flash-Lite, Gemini 2.0, Gemini 1.5 |
| Ollama | Local models (Llama, Mistral, etc.) |
| Hugging Face Local | GGUF models via node-llama-cpp (Electron only) |

---

## File System Sync

When enabled, creates a directory per project in the configured root folder. All file operations in `projectService` automatically sync to the file system.

**File System Structure:**
```
[Root Path]/
├── Project-A/
│   ├── notes/
│   │   └── meeting-notes.md
│   └── research/
│       └── api-design.md
└── Project-B/
    └── notes/
        └── quick-note.md
```

**Browser Support:** Chrome, Edge, Opera (File System Access API). Not supported in Firefox/Safari.

---

## MCP Server (Electron Only)

Local MCP server exposing app capabilities to external LLM tools (Claude Desktop, etc.).

**Configuration:** Binds to `127.0.0.1:3847`, requires bearer token authentication.

**Available Tools:**
| Tool | Description |
|------|-------------|
| `list_projects` | Get all projects |
| `get_project` | Get project details |
| `list_files` | List files in project |
| `read_file` | Read file content |
| `search` | Semantic search |
| `create_note` | Create a new note |

---

## Local Models (Electron Only)

Supports running GGUF models from Hugging Face locally via node-llama-cpp.

**Features:**
- Downloads models to user data directory
- GPU acceleration with automatic backend detection
- Offline inference

**GPU Acceleration:**
| Platform | Backend | Hardware |
|----------|---------|----------|
| macOS | Metal | Apple Silicon (M1/M2/M3/M4) and Intel Macs |
| Windows | CUDA | NVIDIA GPUs (requires CUDA drivers) |
| Windows | Vulkan | AMD, Intel, and NVIDIA GPUs (fallback) |
| Linux | CUDA | NVIDIA GPUs (requires CUDA drivers) |
| Linux | Vulkan | AMD, Intel, and NVIDIA GPUs (fallback) |

The runtime automatically detects and uses the best available GPU backend. If no GPU is available, it falls back to CPU inference.

**Recommended Models for Tool Use:**
- Functionary Small v3.2 (~6GB) - specialized for function calling
- Hermes 3 (Llama 3.1 8B) (~8GB) - excellent for tool use with improved reasoning
- Qwen 2.5 Coder 7B (~6GB) - optimized for structured output and code agents

**Custom Model Support:**
Users can download any GGUF model from Hugging Face by entering:
- A repository ID (e.g., `bartowski/Phi-4-GGUF`)
- A full Hugging Face URL (e.g., `https://huggingface.co/bartowski/Phi-4-GGUF`)

The system validates that the repository contains compatible GGUF files before allowing download.

---

## Electron IPC Handlers

**File System:**
`fs:selectDirectory`, `fs:readFile`, `fs:writeFile`, `fs:deleteFile`, `fs:listDirectory`, `fs:exists`

**Embeddings:**
`embeddings:generate`, `embeddings:generateBatch`, `embeddings:loadModel`, `embeddings:getStatus`

**Local Models:**
`models:getCatalog`, `models:install`, `models:remove`, `models:loadModel`, `models:infer`

**Shell:**
`shell:openPath` - Open file in system default app
`shell:openExternal` - Open URL in system default browser

**External Links:**
All clickable links (`<a href>`) and `window.open()` calls to external URLs (http/https) automatically open in the system's native browser instead of within the Electron app.

---

## Development

### Adding a New Tool

1. Add tool name to `ToolName` type in `types/index.ts`
2. Add parameter/result types in `types/index.ts`
3. Add router keywords in `ROUTER_PROMPT` in `toolService.ts`
4. Implement `executeYourTool()` function in `toolService.ts`
5. Add case in `executeTool()` switch statement
6. Update system prompt in `chatService.ts`
7. Export from `services/index.ts`
8. Update this documentation

### Building for Distribution

**macOS:**
```bash
npm run build && npx cap sync @capacitor-community/electron
cd electron && npm run electron:make -- --mac
```

**Windows:**
```bash
npm run build && npx cap sync @capacitor-community/electron
cd electron && npm run electron:make -- --win
```

Use GitHub Actions for cross-platform builds (see `.github/workflows/build-windows.yml`).

---

## File Structure

```
src/
├── components/
│   ├── ChatSidebar.vue              # AI chat with project context
│   ├── FileReferenceAutocomplete.vue # @file: autocomplete
│   ├── FileTreeNode.vue             # Recursive file tree node
│   ├── MarkdownEditor.vue           # Markdown editor
│   ├── PDFViewer.vue                # PDF viewer
│   ├── RichTextEditor.vue           # WYSIWYG editor for DOCX
│   ├── ProjectsTreeSidebar.vue      # Projects/files tree
│   ├── SearchAutocomplete.vue       # Global search bar
│   └── settings/                    # Reusable settings components
│       ├── AIProviderSelector.vue
│       ├── IndexerProviderSelector.vue
│       └── StorageSettings.vue
├── icons/                           # SVG icon components for providers
├── services/
│   ├── chatService.ts               # Chat session management
│   ├── database.ts                  # DuckDB operations
│   ├── documentGeneratorService.ts  # PDF/DOCX/MD generation
│   ├── documentProcessor.ts         # File processing
│   ├── embeddingService.ts          # Multi-provider embeddings
│   ├── exportService.ts             # File export with download
│   ├── fileSystemService.ts         # File System Access API
│   ├── llmService.ts                # LLM API calls
│   ├── localModelService.ts         # Hugging Face local models
│   ├── mcpService.ts                # MCP server handlers
│   ├── noteService.ts               # AI note formatting
│   ├── projectService.ts            # Project/file operations (single source of truth)
│   ├── setupWizardService.ts        # Setup wizard state
│   ├── syncService.ts               # File system sync
│   ├── telemetryService.ts          # Metrics tracking
│   ├── toolService.ts               # Tool routing/execution
│   ├── versionService.ts            # File version history
│   ├── webSearchService.ts          # Web research
│   └── index.ts                     # Service exports
├── types/
│   └── index.ts                     # Type definitions
└── views/
    ├── SetupWizardPage.vue          # First-run wizard
    ├── WorkspacePage.vue            # Main workspace
    └── SettingsPage.vue             # Settings page
```

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `projects` | Project metadata |
| `files` | File records with content, paths, hashes |
| `chunks` | Document chunks for semantic search |
| `chat_sessions` | Chat session metadata |
| `chat_messages` | Chat messages |
| `file_versions` | Version history (diff-based) |
| `web_search_cache` | Web search result cache |
| `web_search_chunks` | Web search content chunks |
