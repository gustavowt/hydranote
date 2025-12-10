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
- **AI**: OpenAI API / Ollama (local LLMs)
- **Document Processing**: PDF.js, Mammoth (DOCX), Tesseract.js (OCR)
- **File System Sync**: File System Access API (bidirectional sync with local directories)

### Workspace Layout

The app uses a unified three-panel workspace layout:

```
┌─────────────────────────────────────────────────────────────────┐
│                         Header Bar                              │
├──────────────┬─────────────────────────────┬────────────────────┤
│   Projects   │                             │                    │
│     Tree     │      Markdown Editor        │    Chat Sidebar    │
│   Sidebar    │    (edit/split/preview)     │                    │
│  (280px)     │         (flex)              │      (360px)       │
│              │                             │                    │
│  Collapsible │                             │     Collapsible    │
└──────────────┴─────────────────────────────┴────────────────────┘
```

- **ProjectsTreeSidebar**: Hierarchical view of projects and files
- **MarkdownEditor**: Full editor with edit/split/preview modes, inline note saving
- **ChatSidebar**: Project-scoped chat with AI, @file references

### Core Data Flow

```
User Input → Router → Tool Selection → Tool Execution → LLM Response → UI
                ↓
            Embeddings → Vector Search → Context Retrieval
```

---

## Services

### Project Service (`projectService.ts`)

Manages projects and document ingestion. This is the **single source of truth** for all file operations.

#### Key Functions

| Function | Description |
|----------|-------------|
| `createProject(name, description?)` | Create a new project (+ sync to FS) |
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
| `addNote(params)` | Full pipeline: format → title → directory → save → index |
| `globalAddNote(params, onProgress?)` | Dashboard flow with project routing |
| `decideTargetProject(content, tags?)` | AI-decide which project for a note |

#### AddNote Pipeline (Phase 9)

```
Raw Text → Format Note → Generate Title → Decide Directory → Persist → Index
```

#### Global AddNote Pipeline (Phase 10)

```
Raw Text → Decide Project* → Format Note → Generate Title → Decide Directory → Persist → Index
                ↓
        (* May require user confirmation - Phase 12)
```

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
  identificationMethod?: 'header' | 'exact_match' | 'semantic';
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
| `semantic` | Use LLM to semantically locate the section |

#### Preview Flow

The tool uses a preview/confirmation flow:

1. `executeUpdateFileTool` identifies the section and generates a preview
2. Preview includes diff visualization (added/removed lines)
3. User confirms or cancels the update
4. On confirm, `applyFileUpdate` commits changes and re-indexes the file

#### Supported File Types

- Markdown (`.md`)
- DOCX (`.docx`)

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

#### Exposed Methods

```typescript
setContent(content: string)   // Set editor content
clearContent()                // Clear editor
focusEditor()                 // Focus textarea
```

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
refresh()  // Reload projects and file trees
```

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

Handles low-level file system operations using the File System Access API.

| Function | Description |
|----------|-------------|
| `selectRootDirectory()` | Prompt user to select root sync directory |
| `createProjectDirectory(projectName)` | Create project directory in root folder |
| `ensureFileSystemPermission()` | Ensure FS permission early (call during user gesture) |
| `writeFile(projectName, filePath, content)` | Write file to disk |
| `readFile(projectName, filePath)` | Read file from disk |
| `deleteFile(projectName, filePath)` | Delete file from disk |
| `listProjectFiles(projectName)` | List all files in project directory |
| `listRootDirectories()` | List all project directories |
| `isSyncAvailable()` | Check if sync is enabled and configured |

#### Sync Service (`syncService.ts`)

Handles bidirectional synchronization logic.

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
type ToolName = 'read' | 'search' | 'summarize' | 'write' | 'addNote' | 'updateFile';
type DocumentFormat = 'pdf' | 'docx' | 'md';
type UpdateOperation = 'replace' | 'insert_before' | 'insert_after';
type SectionIdentificationMethod = 'header' | 'exact_match' | 'semantic';
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
  provider: 'openai' | 'ollama';
  openai: { apiKey, model, baseUrl? };
  ollama: { baseUrl, model };
  noteSettings: { formatInstructions, defaultDirectory, autoGenerateTitle };
}
```

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
│   └── ProjectsTreeSidebar.vue      # Left panel: projects/files tree
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
│   └── index.ts              # Service exports
├── types/
│   └── index.ts              # Type definitions
└── views/
    ├── WorkspacePage.vue     # Main unified workspace layout
    └── SettingsPage.vue      # Settings (AI Providers, AI Instructions, Storage)
```


