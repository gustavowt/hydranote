# HydraNote Developer Documentation

This document provides technical documentation for developers working on HydraNote. It covers the main services, tools, and architectural decisions implemented through Phases 1-12 of the roadmap.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Services](#services)
3. [Tools](#tools)
4. [Workspace Components](#workspace-components)
5. [File Management](#file-management)
6. [File System Sync](#file-system-sync)
7. [Telemetry & Metrics](#telemetry--metrics)
8. [Phase 12 Guardrails](#phase-12-guardrails)
9. [Routing](#routing)
10. [Configuration](#configuration)
11. [File Structure](#file-structure)

---

## Architecture Overview

HydraNote is an AI-powered document indexing and interaction system built with:

- **Frontend**: Ionic Vue (Vue 3 + TypeScript)
- **Database**: DuckDB (in-browser, WASM with OPFS persistence)
- **AI**: OpenAI API / Anthropic (Claude) / Google (Gemini) / Ollama (local LLMs)
- **Document Processing**: PDF.js, Mammoth (DOCX), Tesseract.js (OCR)
- **Markdown**: marked + highlight.js + Mermaid (diagrams)
- **File System Sync**: File System Access API (bidirectional sync with local directories)

### Workspace Layout

The app uses a unified three-panel workspace layout:

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

- **Header Search Bar**: Global fuzzy search across all projects (files and content)
- **ProjectsTreeSidebar**: Hierarchical view of projects and files
- **MarkdownEditor**: Full editor with edit/split/preview modes, inline note saving
- **ChatSidebar**: Project-scoped chat with AI, @file references

### Core Data Flow

```
User Input → Router → Tool Selection → Tool Execution → LLM Response → UI
                ↓
            Embeddings → Vector Search → Context Retrieval
```

### Application Bootstrap

The application initializes critical resources before mounting the Vue app. This ensures all services have access to required dependencies (database, etc.) from the start.

```typescript
// main.ts
async function bootstrap() {
  // Initialize database and core services BEFORE mounting
  await initialize();  // from projectService

  const app = createApp(App)
    .use(IonicVue)
    .use(router);

  await router.isReady();
  app.mount('#app');
}
```

**Important:** All services that need database access should use `projectService` functions which internally call `ensureInitialized()`. This pattern guarantees the database is ready before any operations.

---

## Services

### Project Service (`projectService.ts`)

Manages projects and document ingestion. This is the **single source of truth** for all file operations.

**Initialization:** All public functions call `ensureInitialized()` internally, which lazily initializes the database if needed. The `initialize()` function is also called at app boot in `main.ts` for immediate availability.

#### Key Functions

| Function | Description |
|----------|-------------|
| `createProject(name, description?)` | Create a new project (+ sync to FS). **Idempotent**: returns existing project if name matches (case-insensitive) |
| `getProject(projectId)` | Get project by ID |
| `getAllProjects()` | List all projects |
| `deleteProject(projectId)` | Delete project and all files (+ sync to FS) |
| `ingestDocument(file, projectId)` | Process and index a document |
| `get_project_files(projectId)` | Get all files in a project |
| `get_file_chunks(fileId)` | Get chunks for a file |
| `searchProject(projectId, query, k)` | Semantic search within a project |
| `getProjectFileTree(projectId)` | Get hierarchical file tree (Phase 11) |
| `findFileByPath(projectId, path)` | Find file by path (for @file: references) |

#### Centralized File Operations (Single Source of Truth)

These functions handle both database AND file system sync automatically:

| Function | Description |
|----------|-------------|
| `createFile(projectId, path, content, type)` | Create file (DB + FS sync) |
| `updateFile(fileId, content)` | Update file content (DB + FS sync) |
| `renameFile(fileId, newName)` | Rename file within same project (DB + FS sync) |
| `deleteFile(fileId)` | Delete file (DB + FS sync) |
| `moveFile(fileId, targetProjectId, targetDir?)` | Move file (DB + FS sync) |
| `indexFileForSearch(projectId, fileId, content, type)` | Create chunks and embeddings |
| `createEmptyMarkdownFile(projectId, fileName, dir?)` | Create empty file (DB + FS sync) |

### Note Service (`noteService.ts`)

Handles the AddNote tool pipeline for creating Markdown notes.

#### Key Functions

| Function | Description |
|----------|-------------|
| `formatNote(rawText, metadata?)` | Transform raw text to structured Markdown |
| `generateNoteTitle(content)` | Generate a title from note content |
| `titleToSlug(title)` | Convert title to URL-safe filename |
| `decideNoteDirectory(projectId, title, metadata?)` | AI-decide best directory |
| `decideNoteDirectoryWithDirs(projectId, title, dirs, metadata?)` | AI-decide directory (with pre-fetched dirs for parallel execution) |
| `addNote(params)` | Full pipeline: format → title → directory → save → index |
| `globalAddNote(params, onProgress?)` | Dashboard flow with project routing |
| `decideTargetProject(content, tags?)` | AI-decide which project for a note |

#### AddNote Pipeline (Phase 9 + Phase 13 Optimization)

**Original Sequential Flow:**
```
Raw Text → Format Note → Generate Title → Decide Directory → Persist → Index
           (LLM #1)       (LLM #2)         (LLM #3)
```

**Optimized Parallel Flow (Phase 13):**
```
                    ┌─── Format Note (LLM) ───┐
Raw Text ──────────►├─── Generate Title (LLM) ├───► Decide Directory (LLM) → Persist → Index
                    └─── Pre-fetch Dirs (DB) ─┘
                         (PARALLEL)                    (SEQUENTIAL)
```

This reduces total time by running 2 LLM calls + 1 DB call in parallel instead of 3 sequential LLM calls.

#### Global AddNote Pipeline (Phase 10 + Phase 13 Optimization)

**Original Sequential Flow:**
```
Raw Text → Decide Project* → Format Note → Generate Title → Decide Directory → Persist → Index
              (LLM #1)        (LLM #2)       (LLM #3)         (LLM #4)
```

**Optimized Parallel Flow (Phase 13):**
```
                                          ┌─── Format Note (LLM) ───┐
Raw Text → Decide Project* ──────────────►├─── Generate Title (LLM) ├───► Decide Directory → Persist → Index
              (LLM #1)                    └─── Pre-fetch Dirs (DB) ─┘         (LLM #2)
                ↓                              (PARALLEL)
        (* May require user confirmation - Phase 12)
```

This reduces from 4 sequential LLM calls to 2 sequential phases (1 LLM + 2 parallel LLM calls + 1 LLM).

### Tool Service (`toolService.ts`)

Handles tool routing and execution.

#### Available Tools

| Tool | Purpose | Keywords |
|------|---------|----------|
| `read` | Read file content | read, open, show, view |
| `search` | Semantic search | search, find, buscar, encontrar |
| `summarize` | Summarize documents | summarize, summary, tl;dr |
| `write` | Generate documents (PDF/DOCX/MD) | write, create, generate |
| `addNote` | Create and save notes | add note, save note, criar nota |
| `updateFile` | Update sections in existing files | update, edit, modify, replace, insert |
| `webResearch` | Search the web for information | web search, google, look up online, current news |

#### Router Prompt

The router analyzes user messages and returns a JSON response:

```json
{
  "tools": [{"name": "toolName", "params": {"key": "value"}}]
}
```

Or for clarification:

```json
{
  "tools": [],
  "clarification": "What would you like me to do?"
}
```

### Chat Service (`chatService.ts`)

Manages chat sessions and context windows.

#### Key Functions

| Function | Description |
|----------|-------------|
| `buildSystemPrompt(projectId)` | Build system prompt with project context |
| `manageContext(projectId, messages, query)` | Manage context window size |
| `createChatSession(projectId)` | Create new chat session |
| `prepareChatRequest(sessionId, message)` | Prepare API request with context |

### Telemetry Service (`telemetryService.ts`) - Phase 12

Tracks events and metrics for monitoring AI behavior.

#### Event Types

| Event | Description |
|-------|-------------|
| `note_created` | Note successfully created |
| `project_created` | Project created (auto or user) |
| `directory_created` | AI created new directory |
| `note_creation_failed` | Note creation failed |

#### Key Functions

```typescript
// Track events
trackNoteCreated({ source, projectId, autoSelected, filePath })
trackProjectCreated({ projectId, automatic, reason })
trackDirectoryCreated({ projectId, directoryPath, triggeringNoteTitle, reasoning })

// Query metrics
getMetrics()           // Returns aggregated TelemetryMetrics
getMetricsSummary()    // Returns human-readable summary
getAllEvents()         // Returns all tracked events
```

---

## Tools

### WriteFile Tool (Phase 6 + 8)

Generates documents in multiple formats.

#### Parameters

```typescript
interface WriteToolParams {
  format: 'pdf' | 'docx' | 'md';
  title: string;
  content: string;
  useContext?: boolean;
  fileType?: 'pdf' | 'docx' | 'markdown';
}
```

#### Markdown Support (Phase 8)

- Extension: `.md`
- MIME type: `text/markdown`
- Encoding: UTF-8
- Heading-aware chunking for indexing

### AddNote Tool (Phase 9)

Creates formatted Markdown notes within a project.

#### Parameters

```typescript
interface AddNoteParams {
  projectId: string;
  rawNoteText: string;
  contextMetadata?: {
    tags?: string[];
    topic?: string;
    source?: string;
    language?: string;
  };
}
```

### UpdateFile Tool

Updates or modifies specific sections of existing Markdown or DOCX files.

#### Parameters

```typescript
interface UpdateFileToolParams {
  fileId?: string;
  fileName?: string;
  operation: 'replace' | 'insert_before' | 'insert_after';
  sectionIdentifier: string;
  identificationMethod?: 'header' | 'exact_match' | 'semantic' | 'line_number';
  newContent: string;
}
```

#### Operations

| Operation | Description |
|-----------|-------------|
| `replace` | Replace the identified section with new content |
| `insert_before` | Insert new content before the identified section |
| `insert_after` | Insert new content after the identified section |

#### Section Identification Methods

| Method | Description |
|--------|-------------|
| `header` | Match by markdown header (e.g., `## Section Name`) or DOCX heading |
| `exact_match` | Find and replace exact text |
| `semantic` | Use fuzzy matching and embeddings to locate the section |
| `line_number` | Specify by line number (e.g., `line:42` or `lines:10-25`) |

#### Multi-Level Cascade Matching

The section identification uses a cascade of matching strategies for robustness:

```
1. Special Keywords → (end, start, bottom, top, append, prepend)
2. Line Number Spec → (line:42, lines:10-25)
3. Exact Text Match → (indexOf)
4. Structural Parse  → (markdown headers with normalized matching)
5. Fuzzy Match      → (Levenshtein distance, typo tolerance)
6. Semantic Match   → (embedding similarity via chunks)
7. LLM Fallback     → (line-number based response)
```

**Special Keywords:**
- End/append: `end`, `bottom`, `eof`, `fim`, `final`, `append`
- Start/prepend: `start`, `beginning`, `top`, `prepend`

**Path-based Lookups:**
- Support for hierarchical paths: `Features/API`, `Features > API`

**Fuzzy Matching:**
- Tolerates typos and partial matches
- Uses Levenshtein distance with configurable threshold (default: 60%)

**Semantic Embeddings:**
- Leverages existing chunk embeddings for similarity matching
- No additional LLM calls, uses vector comparison

#### Preview Flow

The tool uses a preview/confirmation flow:

1. `executeUpdateFileTool` identifies the section and generates a preview
2. Preview includes diff visualization (added/removed lines)
3. User confirms or cancels the update
4. On confirm, `applyFileUpdate` commits changes and re-indexes the file

#### Supported File Types

- Markdown (`.md`)
- DOCX (`.docx`)

### WebResearch Tool

Searches the web for current information not available in project documents.

#### Architecture

```
User Query → Check Cache → Web Search API → Fetch Pages → Extract Text
                ↓                                              ↓
         If cache hit                                   Chunk Content
                ↓                                              ↓
         Use cached                                   Generate Embeddings
                ↓                                              ↓
         Vector Search ←────────────────────────── Store in Cache
                ↓
         Return Relevant Chunks
```

#### Supported Providers

| Provider | Configuration | Notes |
|----------|--------------|-------|
| SearXNG | Instance URL | Self-hosted, private, recommended |
| Brave Search | API Key | Free tier: 2000 queries/month |
| DuckDuckGo | None | Instant Answers API, limited results |

#### Parameters

```typescript
interface WebResearchToolParams {
  query: string;           // Search query (required)
  maxResults?: number;     // Max URLs to fetch (default: 5)
  maxChunks?: number;      // Max chunks to return (default: 10)
}
```

#### Caching

- Results are cached in DuckDB (`web_search_cache` and `web_search_chunks` tables)
- Default cache duration: 60 minutes
- Cache is keyed by query hash
- Expired entries are automatically cleaned up

#### CORS Handling

- **Electron/Capacitor**: Direct fetch, no CORS issues
- **Browser**: Requires CORS proxy configuration in settings

---

## Workspace Components

### WorkspacePage (`WorkspacePage.vue`)

Main layout orchestrating the three-panel workspace.

#### State Management

| State | Description |
|-------|-------------|
| `selectedProjectId` | Currently active project |
| `selectedFileId` | Currently open file |
| `currentFile` | File object with content |
| `currentProject` | Project object |

#### Child Component Communication

```typescript
// ProjectsTreeSidebar events
@select-project="handleProjectSelect"
@select-file="handleFileSelect"
@create-project="showCreateProjectModal = true"
@delete-project="handleDeleteProject"
@file-created="handleFileCreatedFromSidebar"
@file-moved="handleFileMoved"

// MarkdownEditor events
@save="handleSaveExistingFile"
@content-change="handleContentChange"
@note-saved="handleNoteSaved"

// ChatSidebar events
@project-change="handleChatProjectChange"
```

### MarkdownEditor (`MarkdownEditor.vue`)

Full-featured markdown editor with three view modes.

#### Props

| Prop | Type | Description |
|------|------|-------------|
| `currentFile` | `ProjectFile \| null` | File being edited |
| `currentProject` | `Project \| null` | Current project context |
| `initialContent` | `string` | Initial editor content |

#### View Modes

- **edit**: Raw markdown textarea
- **split**: Side-by-side editor and preview
- **view**: Rendered markdown preview

#### Mermaid Diagram Support

The markdown editor supports Mermaid flowcharts and diagrams. Users can create diagrams using fenced code blocks with the `mermaid` language identifier:

````markdown
```mermaid
flowchart TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Proceed]
    B -->|No| D[Stop]
```
````

**Supported Diagram Types:**
- Flowcharts (`flowchart`, `graph`)
- Sequence diagrams (`sequenceDiagram`)
- Class diagrams (`classDiagram`)
- State diagrams (`stateDiagram-v2`)
- Entity relationship diagrams (`erDiagram`)
- Gantt charts (`gantt`)
- Pie charts (`pie`)
- And more (see [Mermaid documentation](https://mermaid.js.org/))

**Implementation Notes:**
- Mermaid is initialized with `theme: 'dark'` to match the editor aesthetic
- Diagrams are rendered asynchronously after DOM updates (debounced 300ms)
- Invalid syntax shows an error message instead of breaking the preview
- Mermaid code is base64-encoded in data attributes to preserve special characters

**Syntax Tips:**
- When node labels contain special characters like `()`, `{}`, `[]`, or quotes, wrap in double quotes:
  - ✅ `A["Label with (parentheses)"]`
  - ❌ `A[Label with (parentheses)]`
- The note formatter prompt automatically applies these rules when generating mermaid diagrams

#### Exposed Methods

```typescript
setContent(content: string)   // Set editor content
clearContent()                // Clear editor
focusEditor()                 // Focus textarea
```

#### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `save` | `(content: string, file?: ProjectFile)` | Emitted when saving existing file |
| `content-change` | `(content: string)` | Emitted on editor content change |
| `note-saved` | `(result: GlobalAddNoteResult)` | Emitted after new note saved |
| `rename` | `(fileId: string, newName: string)` | Emitted when file is renamed |

#### Actions Menu

The editor header includes a 3-dots menu (visible when editing an existing file) with the following actions:

| Action | Description |
|--------|-------------|
| **Run AI Formatting** | Opens a modal for manually triggering AI formatting with optional custom instructions |
| **Rename** | Enables inline editing of the file name in the header |

**AI Formatting:**
- Uses `formatNote()` from noteService
- Combines user's additional instructions with settings-based formatting instructions
- Replaces editor content with formatted result
- Does not auto-save (allows user to review changes first)

**Rename:**
- Transforms the file title into an editable input field
- Save button confirms the rename, Escape cancels
- Emits `rename` event to parent for processing via `renameFile()` service
- Sidebar is refreshed after successful rename

### ChatSidebar (`ChatSidebar.vue`)

Collapsible AI chat panel with project context.

#### Props

| Prop | Type | Description |
|------|------|-------------|
| `initialProjectId` | `string?` | Initial project to select |

#### Features

- Project selector dropdown
- @file: autocomplete for file references
- Markdown rendering in responses
- Quick action buttons for common queries

#### Exposed Methods

```typescript
selectProject(projectId: string)  // Switch to project
refresh()                         // Reload projects
```

### ProjectsTreeSidebar (`ProjectsTreeSidebar.vue`)

Collapsible hierarchical project/file navigator.

#### Props

| Prop | Type | Description |
|------|------|-------------|
| `selectedProjectId` | `string?` | Currently selected project |
| `selectedFileId` | `string?` | Currently selected file |

#### Exposed Methods

```typescript
refresh()                              // Reload projects and file trees
revealFile(projectId, fileId)          // Expand parents and scroll file into view
```

#### Drag and Drop

Files can be dragged and dropped between projects or into directories:

| Action | Result |
|--------|--------|
| Drag file to project header | Move file to project root |
| Drag file to directory | Move file into that directory |

**Events emitted:**

| Event | Payload | Description |
|-------|---------|-------------|
| `file-moved` | `(sourceProjectId, targetProjectId, file)` | File moved between projects |

**Implementation notes:**
- Source project ID is stored when drag starts for reliable cross-project moves
- Both database and file system are updated via `moveFile()` in projectService
- Target project is auto-expanded after move
- File is revealed (scrolled into view) in its new location

#### File Reveal Feature

When a file is created or saved, the sidebar automatically:
1. Expands the project containing the file
2. Expands all parent directories to reveal the file
3. Scrolls the file into view
4. Highlights the file with a brief animation

This is triggered automatically when `selectedFileId` prop changes, or can be called manually via `revealFile()`.

### SearchAutocomplete (`SearchAutocomplete.vue`)

Global search bar with fuzzy autocomplete across all projects.

#### Features

- **Fuzzy search**: JavaScript-based fuzzy matching (exact, prefix, contains, character sequence)
- **Multi-target search**: Searches project names, file names, and file paths
- **Lazy loading**: Data loaded on first focus, cached for subsequent searches
- **Keyboard navigation**: Arrow keys, Enter to select, Escape to close
- **Visual feedback**: Loading spinner, match highlighting, project/file sections

#### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `select-file` | `FileItem` | Emitted when user selects a file |
| `select-project` | `Project` | Emitted when user selects a project |

#### Search Algorithm

The fuzzy scoring function uses a multi-tier approach:

```typescript
// Scoring priority:
1.0  - Exact match
0.9  - Starts with query
0.7  - Contains query
0.6  - All query characters found in sequence (fuzzy match)
```

#### Data Loading

Uses existing `getAllFilesForAutocomplete()` and `getAllProjects()` functions to load data on first focus. This reuses the same pattern as `FileReferenceAutocomplete.vue` for consistency.

---

## File Management

### Centralized File Operations (Single Source of Truth)

All file creation and modification operations are centralized in `projectService.ts` to ensure consistent database persistence AND file system synchronization.

```
┌─────────────────────────────────────────────────────────────┐
│                    Consumer Services                         │
│  (toolService, noteService, chatService, components)        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   projectService.ts                          │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  Centralized File Operations                            ││
│  │  • createFile(projectId, path, content, type)           ││
│  │  • updateFile(fileId, content)                          ││
│  │  • deleteFile(fileId)                                   ││
│  │  • moveFile(fileId, targetProject, targetPath)          ││
│  │  • indexFileForSearch(projectId, fileId, content, type) ││
│  └─────────────────────────────────────────────────────────┘│
│                    │                    │                    │
│                    ▼                    ▼                    │
│              ┌──────────┐        ┌─────────────┐            │
│              │ database │        │ syncService │            │
│              └──────────┘        └─────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

#### Key Functions

| Function | Description |
|----------|-------------|
| `createFile(projectId, path, content, type)` | Create file in DB + sync to FS |
| `updateFile(fileId, content)` | Update content in DB + sync to FS |
| `deleteFile(fileId)` | Delete from DB + sync to FS |
| `moveFile(fileId, targetProjectId, targetDir?)` | Move file + sync to FS |
| `indexFileForSearch(projectId, fileId, content, type)` | Create chunks + embeddings |

#### Usage Pattern

All services that create or modify files should use these centralized functions:

```typescript
// ✅ Correct: Use centralized functions
import { createFile, indexFileForSearch } from './projectService';

const file = await createFile(projectId, 'notes/my-note.md', content, 'md');
await indexFileForSearch(projectId, file.id, content, 'md');

// ❌ Wrong: Direct database calls (bypasses file system sync)
await conn.query(`INSERT INTO files ...`);
```

### File Tree API (Phase 11)

```typescript
interface FileTreeNode {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'directory';
  fileType?: SupportedFileType;
  children?: FileTreeNode[];
  expanded?: boolean;
}
```

### @file: Reference Syntax (Phase 11)

Users can reference files in chat/editor using:

```
@file:path/to/file.md
@file:document-name.pdf
```

The router detects these references and automatically uses the `read` tool.

---

## File System Sync

HydraNote supports bidirectional file system synchronization, allowing projects and files to be mirrored to actual directories on disk.

### Overview

When enabled, the sync system:
- Creates a directory for each project in the configured root folder
- Writes markdown files to the corresponding project directories
- Detects changes made externally (outside HydraNote) and imports them
- Supports automatic sync on save and manual sync

### File System Structure

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

### Services

#### File System Service (`fileSystemService.ts`)

Handles low-level file system operations. Supports both:
- **Browser**: File System Access API (Chrome, Edge, Opera)
- **Electron**: Native file system via IPC handlers

All functions automatically detect the runtime environment and use the appropriate API.

| Function | Description |
|----------|-------------|
| `selectRootDirectory()` | Prompt user to select root sync directory |
| `createProjectDirectory(projectName)` | Create project directory in root folder |
| `ensureFileSystemPermission()` | Ensure FS permission early (call during user gesture) |
| `writeFile(projectName, filePath, content)` | Write file to disk |
| `readFile(projectName, filePath)` | Read file from disk |
| `deleteFile(projectName, filePath)` | Delete file from disk |
| `listProjectFiles(projectName)` | List all files in project directory |
| `listRootDirectories()` | List all project directories in root |
| `isSyncAvailable()` | Check if sync is enabled and configured |
| `isFileSystemAccessSupported()` | Check if FS sync is supported (browser API or Electron) |
| `isElectron()` | Check if running in Electron environment |

#### Sync Service (`syncService.ts`)

Handles bidirectional synchronization logic.

**Important:** Sync service uses `projectService` functions for all database operations, ensuring proper initialization and consistent behavior. Never call database functions directly from syncService.

| Function | Description |
|----------|-------------|
| `syncAll()` | Full sync of all projects (both directions) |
| `syncProject(projectId)` | Sync a single project |
| `syncFileToFileSystem(projectName, filePath, content)` | Sync single file to disk |
| `syncFileFromFileSystem(projectId, projectName, filePath)` | Import file from disk |
| `startFileWatcher()` | Start polling for external changes |
| `stopFileWatcher()` | Stop the file watcher |

### Automatic Sync Triggers

All file operations automatically sync to the file system when sync is enabled. This is handled by the centralized functions in `projectService.ts`:

| Action | Function | Sync Behavior |
|--------|----------|---------------|
| Create project | `createProject()` | Creates project directory |
| Delete project | `deleteProject()` | Deletes project directory |
| Create file | `createFile()` | Writes file to disk |
| Save/edit file | `updateFile()` | Updates file on disk |
| Delete file | `deleteFile()` | Deletes file from disk |
| Move file | `moveFile()` | Moves file on disk |
| AI creates file | `createFile()` (via tools) | Writes file to disk |
| AI updates file | `updateFile()` (via tools) | Updates file on disk |

**Important:** All services (toolService, noteService, etc.) must use the centralized functions from `projectService.ts` to ensure consistent sync behavior.

### Import from File System

When "Sync Now" is clicked:
1. Existing projects sync bidirectionally
2. New directories in root folder become new projects
3. New `.md` files are imported into the database
4. Modified external files update the database

### Configuration

Settings stored in `localStorage` under `hydranote_filesystem_settings`:

```typescript
interface FileSystemSettings {
  enabled: boolean;           // Whether sync is enabled
  rootPath: string;           // Display path of root directory
  syncOnSave: boolean;        // Auto-sync when files are saved
  watchForChanges: boolean;   // Poll for external changes
  watchInterval: number;      // Polling interval (ms)
  lastSyncTime?: string;      // ISO timestamp of last sync
}
```

### Browser Compatibility

The File System Access API is supported in:
- Chrome (recommended)
- Edge
- Opera

Not supported in:
- Firefox
- Safari

For unsupported browsers, a warning message is displayed in Settings.

### User Gesture Requirement

The File System Access API requires a **user gesture** (click, keypress) to request permissions. This means:
- Permission must be obtained during a click/keypress event handler
- After multiple `await` calls, the user gesture may be "consumed" by the browser

To handle this, the `ensureFileSystemPermission()` function should be called early in any user-initiated flow that may need file system access. For example, `ChatSidebar.vue` calls this at the start of `sendMessage()` before any other async operations.

### Settings UI

The Storage section in Settings (`SettingsPage.vue`) provides:
- Enable/disable sync toggle
- Directory picker button
- Sync on save toggle
- Watch for external changes toggle
- Manual "Sync Now" button
- Disconnect button
- Last sync time display

---

## Telemetry & Metrics

### Phase 12 Metrics Tracked

| Metric | Description |
|--------|-------------|
| `notesCreated` | Total notes created |
| `notesFromDashboard` | Notes created via dashboard |
| `notesFromProjectChat` | Notes created via project chat |
| `projectsAutoCreated` | Projects created by AI |
| `projectsUserCreated` | Projects created by user |
| `directoriesCreated` | Directories created by AI |

### Audit Logging

Directory and automatic project creation are logged to console:

```
[AUDIT] New directory created by AI: { project, directory, note, reasoning, timestamp }
[AUDIT] Project auto-created by AI: { type, timestamp, projectId, automatic, reason }
```

---

## Phase 12 Guardrails

### Directory Creation Guardrails

The `decideNoteDirectory` prompt includes strict rules:

1. **Default to existing directories** - Always prefer existing directories
2. **Avoid creating new directories** unless:
   - No existing directory can contain the note
   - The note represents a completely new domain
   - Multiple future notes would use this directory
3. **Naming rules**: lowercase, hyphen-separated, max 1 level deep
4. **When in doubt**: Use "notes" directory

### Project Creation Guardrails

The `decideTargetProject` prompt includes:

1. **Always use existing project** when topic loosely relates
2. **Never create new project** unless:
   - No projects exist
   - Note is completely unrelated domain
3. **Broad interpretation**: "Work" can contain any work-related notes
4. **Confirmation required**: New projects always require user confirmation

### User Confirmation Flow

When AI suggests creating a new project:

1. `globalAddNote` returns `pendingConfirmation` with proposal
2. UI shows confirmation modal
3. User can:
   - Confirm the new project
   - Choose an existing project
   - Cancel
4. Pipeline resumes with user's choice

---

## Types Reference

### Core Types

```typescript
type SupportedFileType = 'pdf' | 'txt' | 'docx' | 'md' | 'png' | 'jpg' | 'jpeg' | 'webp';
type ProjectStatus = 'created' | 'indexing' | 'indexed' | 'error';
type ToolName = 'read' | 'search' | 'summarize' | 'write' | 'addNote' | 'updateFile' | 'webResearch';
type DocumentFormat = 'pdf' | 'docx' | 'md';
type UpdateOperation = 'replace' | 'insert_before' | 'insert_after';
type SectionIdentificationMethod = 'header' | 'exact_match' | 'semantic';
type WebSearchProvider = 'searxng' | 'brave' | 'duckduckgo';
```

### File System Sync Types

```typescript
type FileSyncStatus = 'synced' | 'pending' | 'conflict' | 'error';
type SyncDirection = 'to_filesystem' | 'from_filesystem' | 'bidirectional';

interface FileSystemEntry {
  relativePath: string;
  name: string;
  isDirectory: boolean;
  size?: number;
  modifiedTime: Date;
  content?: string;
}

interface SyncResult {
  success: boolean;
  filesWritten: number;
  filesRead: number;
  filesDeleted: number;
  conflictsDetected: number;
  conflicts: SyncConflict[];
  error?: string;
  syncTime: Date;
}
```

### Telemetry Types

```typescript
type TelemetryEventType = 'note_created' | 'project_created' | 'directory_created' | 'note_creation_failed';
type NoteCreationSource = 'dashboard' | 'project_chat';
```

### Web Search Types

```typescript
type WebSearchProvider = 'searxng' | 'brave' | 'duckduckgo';

interface WebSearchSettings {
  provider: WebSearchProvider;
  searxngUrl?: string;        // SearXNG instance URL
  braveApiKey?: string;       // Brave Search API key
  cacheMaxAge: number;        // Cache duration in minutes
  maxResults: number;         // Max URLs to fetch per search
}

interface WebChunk {
  id: string;
  cacheId: string;
  url: string;
  title: string;
  text: string;
  chunkIndex: number;
  embedding: number[];
  score?: number;             // Similarity score after vector search
}

interface WebResearchResult {
  query: string;
  sources: Array<{ url: string; title: string }>;
  relevantContent: WebChunk[];
  fromCache: boolean;
  searchTime: number;
  error?: string;
}
```

---

## Routing

All routes redirect to the unified workspace:

```typescript
const routes = [
  { path: '/', redirect: '/workspace' },
  { path: '/workspace', component: WorkspacePage },
  { path: '/home', redirect: '/workspace' },
  { path: '/project/:id/chat', redirect: '/workspace' },
  { path: '/settings', component: SettingsPage },
];
```

---

## Configuration

### LLM Settings

Stored in localStorage under `hydranote_llm_settings`:

```typescript
interface LLMSettings {
  provider: 'openai' | 'ollama' | 'anthropic' | 'google';
  openai: { apiKey, model, baseUrl? };
  ollama: { baseUrl, model };
  anthropic: { apiKey, model };
  google: { apiKey, model };
  noteSettings: { formatInstructions, defaultDirectory, autoGenerateTitle };
}
```

### Supported AI Providers

| Provider | Models | Configuration |
|----------|--------|---------------|
| OpenAI | GPT-4.1, GPT-4.1 Mini/Nano, o3, o3-mini, GPT-4o, GPT-4o-mini | API Key + optional custom base URL |
| Anthropic (Claude) | Claude Opus 4.5/4.1, Claude Sonnet 4, Claude 3.5 Sonnet/Haiku | API Key |
| Google (Gemini) | Gemini 2.5 Pro/Flash/Flash-Lite, Gemini 2.0, Gemini 1.5 Pro/Flash | API Key |
| Ollama | Llama, Mistral, and other local models | Local URL + model name |

### File System Settings

Stored in localStorage under `hydranote_filesystem_settings`:

```typescript
interface FileSystemSettings {
  enabled: boolean;           // Whether sync is enabled
  rootPath: string;           // Display path of root directory
  syncOnSave: boolean;        // Auto-sync when files are saved
  watchForChanges: boolean;   // Poll for external changes
  watchInterval: number;      // Polling interval in ms (default: 5000)
  lastSyncTime?: string;      // ISO timestamp of last sync
}
```

The directory handle is stored in IndexedDB (`HydraNoteFSHandles`) for persistence across sessions.

### Context Window

Default configuration for GPT-4 Turbo:

```typescript
const DEFAULT_CONTEXT_CONFIG = {
  maxTokens: 128000,
  reservedForResponse: 4096,
  reservedForSystemPrompt: 2000,
};
```

---

## Electron Configuration

### Content Security Policy (CSP)

The Electron app (`electron/src/setup.ts`) configures CSP to balance security with functionality:

```typescript
// Key CSP directives:
script-src: 'self' capacitor-electron://* blob: https://cdn.jsdelivr.net
worker-src: 'self' blob: capacitor-electron://* https://cdn.jsdelivr.net
connect-src: 'self' https://* http://localhost:* (for APIs)
```

**DuckDB WASM Requirement:** The `https://cdn.jsdelivr.net` source is required because DuckDB WASM loads worker scripts from jsdelivr CDN. Without this, database initialization will fail with a CSP violation error.

### IPC Handlers

Electron exposes file system operations via IPC handlers in `electron/src/index.ts`:

| Handler | Description |
|---------|-------------|
| `fs:selectDirectory` | Open directory picker dialog |
| `fs:readFile` | Read file contents |
| `fs:writeFile` | Write file (creates parent dirs) |
| `fs:deleteFile` | Delete a file |
| `fs:createDirectory` | Create directory recursively |
| `fs:deleteDirectory` | Delete directory recursively |
| `fs:listDirectory` | List directory contents with metadata |
| `fs:exists` | Check if path exists |
| `fs:getStats` | Get file/directory statistics |

---

## Development Tips

### Adding a New Tool

1. Add tool name to `ToolName` type in `types/index.ts`
2. Add parameter/result types in `types/index.ts`
3. Add router keywords in `ROUTER_PROMPT` in `toolService.ts`
4. Implement `executeYourTool()` function in `toolService.ts`
5. Add case in `executeTool()` switch statement
6. Update system prompt in `chatService.ts`
7. Export from `services/index.ts`
8. Update `docs/DEVELOPER.md`

#### Example: updateFile Tool

The `updateFile` tool was added following this pattern:
- Types: `UpdateFileToolParams`, `UpdateFilePreview`, `UpdateFileResult`, `DiffLine`
- Router: Added keywords like "update", "edit", "modify", "replace", "insert"
- Executor: `executeUpdateFileTool()` with section identification and preview generation
- Helper: `applyFileUpdate()` for committing confirmed changes
- UI: Preview component in `ChatSidebar.vue` with diff visualization

### Debugging Telemetry

```typescript
import { getMetricsSummary, getAllEvents, getRecentEvents } from '@/services';

// In console:
console.log(getMetricsSummary());
console.log(getRecentEvents(10));
```

---

## File Structure

```
src/
├── components/
│   ├── ChatSidebar.vue              # Right panel: AI chat with project context
│   ├── FileReferenceAutocomplete.vue # @file: autocomplete dropdown
│   ├── FileTreeNode.vue             # Recursive file tree node component
│   ├── FileTreeSidebar.vue          # Legacy file tree (Phase 11)
│   ├── MarkdownEditor.vue           # Center panel: markdown editor
│   ├── MarkdownViewerEditor.vue     # Read-only markdown viewer
│   ├── ProjectsTreeSidebar.vue      # Left panel: projects/files tree
│   └── SearchAutocomplete.vue       # Header: global fuzzy search bar
├── services/
│   ├── chatService.ts        # Chat session management
│   ├── database.ts           # DuckDB operations (OPFS persistence)
│   ├── documentProcessor.ts  # File processing
│   ├── embeddingService.ts   # Vector embeddings
│   ├── fileSystemService.ts  # File System Access API wrapper
│   ├── llmService.ts         # LLM API calls
│   ├── noteService.ts        # AddNote pipeline
│   ├── projectService.ts     # Project management (with FS sync)
│   ├── syncService.ts        # Bidirectional file system sync
│   ├── telemetryService.ts   # Metrics tracking (Phase 12)
│   ├── toolService.ts        # Tool routing/execution
│   ├── webSearchService.ts   # Web research with caching and embeddings
│   └── index.ts              # Service exports
├── types/
│   └── index.ts              # Type definitions
└── views/
    ├── WorkspacePage.vue     # Main unified workspace layout
    └── SettingsPage.vue      # Settings (AI Providers, AI Instructions, Web Research, Storage)
```


