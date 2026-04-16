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

**Workspace / DuckDB load patterns (performance):**

- `WorkspacePage` loads the project list in `onIonViewWillEnter` only, so entering the workspace does not run the same `getAllProjects` work twice on first mount.
- `getAllFilesForAutocomplete` uses one SQL query (files joined with projects) instead of one query per project; it backs the header search index and other autocomplete callers.
- Chat scope changes use `loadActiveSessionAndHistory` so session list + active session load share one session-list query when the in-memory cache does not already hold the active session.

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
| `formatNoteWithConversation(messages)` | Multi-turn formatting with accumulated conversation |
| `buildFormatNotePrompt(instructions)` | Build the system prompt for formatting |
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
| `summarize` | Summarize documents (returns attachment) |
| `write` | Create files (AI pipeline for MD, direct for PDF/DOCX) |
| `updateFile` | Update existing files using chain-of-thought analysis and unified diff |
| `webResearch` | Search the web for information |
| `createProject` | Create a new project (global mode) |
| `moveFile` | Rename, move within project, or move between projects |
| `deleteFile` | Delete a file |
| `deleteProject` | Delete a project (global mode) |
| `generateImage` | Generate an image from a text description (returns image attachment) |
| `listEvents` | List upcoming/past Google Calendar events (no project needed) |
| `createEvent` | Create a new Google Calendar event (no project needed) |
| `searchTranscripts` | Search meeting transcripts from Zoom/Google Meet |
| `prepareMeeting` | Prepare for an upcoming meeting with calendar + notes context (returns attachment) |

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

**Auto-Execute Tools** (no confirmation needed): `read`, `search`, `summarize`, `listEvents`, `searchTranscripts`, `prepareMeeting`

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

**Tool Attachments:**
- Tools can return an `attachment` field in their `ToolResult` for rich content that should be displayed separately from the chat response
- The `summarize` tool produces attachments of type `'summary'`
- When attachments are present, `formatToolOutputsForDisplay` replaces the full content with a placeholder `[Attachment: ...]` so the interpretation LLM doesn't compress the content
- Attachments render as clickable cards below the assistant message in the chat
- Clicking a card opens a fixed overlay panel showing the full content rendered as markdown
- Attachments are persisted to the `chat_messages` table as a JSON `attachments` column and survive session reloads
- To make a new tool produce attachments: return `attachment: { id, type, title, content, metadata? }` in the `ToolResult`
- Types: `ToolAttachment { id: string, type: 'summary' | 'image', title: string, content: string, imageData?: string, imageMimeType?: string, metadata?: { fileName?, fileId?, projectId?, ... } }`
- The `generateImage` tool produces attachments of type `'image'` with `imageData` (base64) and `imageMimeType`
- Image attachments render inline in chat with an "Insert into Editor" button that inserts markdown image syntax at the cursor position

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
| `loadActiveSessionAndHistory(projectId?)` | Resolve active session + history with minimal duplicate queries |
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

### Image Generation Service (`imageGenerationService.ts`)

AI image generation supporting OpenAI and Google Gemini providers.

**Supported Providers:**
| Provider | Models | API |
|----------|--------|-----|
| OpenAI | `gpt-image-1`, `dall-e-3`, `dall-e-2` | `/v1/images/generations` (b64_json) |
| Google Gemini (Nano Banana) | `gemini-3.1-flash-image-preview` (Nano Banana 2), `gemini-2.0-flash-preview-image-generation` | Native multimodal `generateContent` |
| Google Imagen | `imagen-4.0-generate-001`, `imagen-4.0-ultra-generate-001`, `imagen-4.0-fast-generate-001`, `imagen-3.0-generate-002` | Predict API |

**Configuration:**
- Settings stored in `LLMSettings.imageGeneration` (provider, model, globalInstructions)
- API keys inherited from the main AI provider settings (no separate key)
- Global instructions prepended to all prompts (configured in Settings > AI Instructions)
- Settings UI in Settings > Image Generation

**Flow:**
1. Chat LLM calls `generateImage` tool with a prompt
2. Service calls the configured provider API
3. Image saved as project file in `images/` directory (DB + filesystem)
4. Returns `ToolAttachment` with type `'image'` containing base64 data
5. Chat displays image inline with "Insert into Editor" button
6. Insert button emits event that calls `MarkdownEditor.insertAtCursor()` with `![alt](images/filename.png)`

**Image Path Resolution:**
- MarkdownEditor uses a custom `marked` renderer for images
- Relative paths (e.g., `images/generated.png`) are resolved to data URLs by looking up `binary_data_base64` from the DB
- External URLs and data URLs pass through unchanged

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

### Update Service (`updateService.ts`)

Checks for new app releases by fetching the latest tag from the GitHub repository (`gustavowt/hydranote`). Compares the tag version against the current `package.json` version using semantic versioning. Runs on app startup and every 6 hours.

**Key Functions:**
| Function | Description |
|----------|-------------|
| `startUpdateChecker()` | Begin periodic checks (called on app mount) |
| `stopUpdateChecker()` | Stop the periodic timer |
| `checkForUpdates()` | Single check against GitHub API |
| `dismissUpdate()` | Dismiss the banner for the current version |

**Reactive State:** `hasUpdate`, `latestVersion`, `currentVersion`, `releaseUrl` (Vue refs).

**UI:** `UpdateBanner.vue` — fixed bottom banner shown when a newer version exists, with a link to the GitHub release and a dismiss button. Dismissed version is remembered in `localStorage`.

---

## Components

### WorkspacePage (`WorkspacePage.vue`)
Main layout orchestrating three-panel workspace. Routes files to appropriate editor based on type.

### MarkdownEditor (`MarkdownEditor.vue`)
Full markdown editor with edit/split/preview modes, Mermaid diagram support, inline saving, version history access.

**Features:**
- Send selected text to chat (`@selection:file:lines` reference)
- AI Format Studio via 3-dots menu (iterative formatting with version navigation)
- Export as PDF/DOCX/Markdown
- Version history restore
- Smart editing predictions via `useMarkdownShortcuts` composable (see below)

**Smart Editing (`src/composables/useMarkdownShortcuts.ts`):**
Composable that attaches to the textarea(s) and provides markdown-aware keyboard behavior:
- **List continuation (Enter)**: Auto-inserts the next list marker for unordered (`-`, `*`, `+`), ordered (`1.`, `2.`), and checkbox (`- [ ]`) lists. Preserves indentation level. Empty marker + Enter removes the marker and exits the list.
- **Blockquote continuation (Enter)**: Auto-inserts `> ` prefix on new lines inside blockquotes. Empty blockquote + Enter exits the blockquote.
- **Fenced code block auto-close (Enter)**: Typing ` ``` ` or `~~~` (with optional language) and pressing Enter inserts a closing fence and positions cursor inside the block.
- **Horizontal rule (Enter)**: Pressing Enter after `---`, `***`, or `___` adds a blank line after the rule for easy continuation.
- **Tab / Shift+Tab indentation**: Indents/outdents single lines or multi-line selections by 2 spaces. Prevents default focus-switch behavior.
- **Auto-pairing**: Pairs `*`, `` ` ``, `~`, `[`, `(` with their closing counterpart. Wraps selected text when typing an opener. Skips pairing for symmetric chars (`*`, `~`, `` ` ``) at line start or after whitespace to avoid interfering with list markers.
- **Checkbox toggle (Alt+X)**: Toggles `- [ ]` / `- [x]` on the current line.
- **Move line (Alt+Up / Alt+Down)**: Swaps the current line or multi-line selection with the line above or below.
- **Duplicate line (Cmd/Ctrl+Shift+D)**: Duplicates the current line or selection below the cursor.
- **Delete line (Cmd/Ctrl+Shift+Backspace)**: Deletes the entire current line.
- **Formatting shortcuts**: Cmd/Ctrl+B (bold), Cmd/Ctrl+I (italic), Cmd/Ctrl+K (link), Cmd/Ctrl+Shift+K (inline code). Toggles wrap/unwrap on selected text or inserts placeholder at cursor.
- **Shortcuts catalog (Cmd/Ctrl+/)**: Opens a modal listing all available keyboard shortcuts, organized by category. Also accessible via a keyboard icon in the editor header next to the filename. The catalog data (`SHORTCUTS_CATALOG`) and category labels (`SHORTCUT_CATEGORIES`) are exported from the composable as a single source of truth.

### FormatStudio (`FormatStudio.vue`)
Iterative AI formatting modal. Users can format a note, preview the result as rendered markdown, request refinements via follow-up prompts, and navigate between versions before applying.

**Flow:**
1. User opens Format Studio from the editor's 3-dots menu
2. Enters optional formatting instructions and clicks "Format"
3. Previews the AI-formatted result as rendered markdown
4. Can type refinement instructions and click "Refine" for additional iterations
5. Navigates between versions (prev/next) to compare
6. Clicks "Apply" to commit the selected version, or "Cancel" to discard

**Architecture:**
- Maintains a hidden `LLMMessage[]` conversation for multi-turn context
- Versions are ephemeral (in-memory only, not persisted to DB)
- Pre-format snapshot is stored via `createFormatVersion()` only when the user clicks "Apply"
- Uses `formatNoteWithConversation()` from `noteService.ts` for LLM calls

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
| OpenAI | GPT-5.2, GPT-5, GPT-5 Mini/Nano, o4-mini, o3, GPT-4.1 series |
| Anthropic | Claude Opus 4.6, Claude Sonnet 4.5, Claude Haiku 4.5, Claude 4 series |
| Google | Gemini 3 Pro/Flash, Gemini 2.5 Pro/Flash/Flash-Lite, Gemini 2.0 |
| Ollama | Local models (Llama, Mistral, etc.) |
| Hugging Face Local | GGUF models via node-llama-cpp (Electron only) |

**OpenAI reasoning model request behavior:**
- For reasoning-capable OpenAI models (`o*` and `gpt-5*`), HydraNote sends `max_completion_tokens` and a valid `reasoning_effort` (`low` by default).
- `reasoning_effort: "none"` is not used because OpenAI reasoning models reject it.

**Anthropic request behavior:**
- HydraNote sends `anthropic-version: "2023-06-01"` for both regular and streaming Claude requests.
- Keep this header on a valid Anthropic API version; unsupported versions are rejected before model execution.

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

**Linux AppImage Known Limitations:**

`node-llama-cpp` validates its native binaries at startup by spawning a child process via Electron's `utilityProcess.fork()`. Inside an AppImage (FUSE-mounted squashfs), this fork/test mechanism can fail with `NoBinaryFoundError`, preventing local AI features from working.

Mitigations applied in the codebase:
- `--no-sandbox` and `--disable-gpu-sandbox` flags are set automatically on Linux (`electron/src/index.ts`) to improve child-process reliability.
- `formatNoBinaryError()` in `inferenceRuntime.ts` surfaces actionable suggestions to users when the binary test fails.

If a user still encounters the issue, recommend:
1. `APPIMAGE_EXTRACT_AND_RUN=1 ./HydraNote-*.AppImage` — bypasses FUSE mount by extracting first.
2. `./HydraNote-*.AppImage --appimage-extract` then run the extracted binary directly.
3. Ensure the system has glibc >= 2.31, and for GPU: `libvulkan1` (Vulkan) or NVIDIA CUDA drivers.

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

**Dictation:**
`dictation:registerShortcut` - Register a global OS-level keyboard shortcut for push-to-talk
`dictation:unregisterShortcut` - Unregister the current dictation shortcut
`dictation:setCompanionTrayEnabled` - Show or hide the "Start dictation" item in the always-on system tray menu
`dictation:getModelStatuses` - Get download status (`Record<string, boolean>`) for all speech models
`dictation:downloadModel` - Pre-download a speech model by its ID (sends progress via `dictation:whisper-status`)
`dictation:deleteModel` - Delete a downloaded speech model from disk
`dictation:toggle` (event, main→renderer) - Notify renderer when the shortcut is pressed
`dictation:whisper-status` (event, main→renderer) - Whisper model download/load progress (`{ status, speechModelId, progress? }`)
`hydranote:tray-action` (event, main→renderer) - Tray menu: `dictation-toggle`, `new-note`, or `focus-chat`

**External Links:**
All clickable links (`<a href>`) and `window.open()` calls to external URLs (http/https) automatically open in the system's native browser instead of within the Electron app.

---

## Dictation (Speech-to-Text)

Two-stage push-to-talk dictation: **Speech models** (transcription) and optional **Cleanup** (LLM post-processing), followed by configurable pipeline actions.

### Architecture

```
Global Shortcut (Electron) → IPC toggle → dictationService (mic capture)
  → Speech Model (transcribe audioBlob) → Cleanup with LLM (optional)
  → Review Modal (user reviews/edits text) → Pipeline Actions (insert, create note, chat, clipboard)
```

### Transcription Providers

| Provider | Type | Configuration |
|----------|------|---------------|
| OpenAI Whisper | Cloud | Uses OpenAI API key from AI Providers settings |
| Deepgram | Cloud | Dedicated API key in Dictation settings |
| Local Whisper | Local (Electron only) | Transformers.js in Electron main process |

Providers implement `TranscriptionProviderInterface` from `transcriptionProviders/base.ts`.

### Local Speech Models

When using Local Whisper, users pick from a catalog of ONNX Whisper models (defined in `LOCAL_SPEECH_MODELS` in `src/types/index.ts`):

| Model | Size | Best for |
|-------|------|----------|
| Whisper tiny.en | ~75 MB | Fastest, English only |
| Whisper base.en | ~142 MB | Fast, English only |
| Whisper small.en | ~466 MB | Best accuracy, English only |
| Whisper tiny | ~75 MB | Fastest, multilingual |
| Whisper base | ~142 MB | Fast, multilingual |
| Whisper small | ~466 MB | Good accuracy, multilingual |
| Whisper medium | ~1.5 GB | High accuracy, multilingual |
| Whisper large v3 turbo | ~3 GB | Best accuracy, multilingual |

Models are downloaded explicitly from Settings > Dictation and cached in `<userData>/whisper-models/`. The settings UI shows download status per model with progress bars, and allows deleting cached models. Runtime: `electron/src/whisperRuntime.ts`.

### Cleanup (LLM Post-Processing)

Optional stage between transcription and pipeline actions. Uses the configured LLM provider (OpenAI, Anthropic, local model, etc.) to clean up raw transcription: fix grammar, remove filler words, punctuation. Configured via `settings.cleanup` (toggle + custom instructions).

### Review Modal

After transcription and optional cleanup, a review modal (`DictationReviewModal.vue`) is shown so the user can inspect and edit the text before pipeline actions execute. The modal displays the raw transcription, the AI-cleaned version (when cleanup is enabled), and an editable textarea pre-filled with the final text. Confirming runs the pipeline actions; discarding cancels the flow.

The pipeline service exposes `runCleanup(rawText)` and `runActions(text)` as separate functions so `App.vue` can insert the review step between them.

### Pipeline Actions

After the user confirms the review modal, enabled actions run in order:

| Action | Description |
|--------|-------------|
| `insert_at_cursor` | Insert text at current editor cursor position |
| `create_note` | Create a new note via `globalAddNote` |
| `send_to_chat` | Send text to the active chat sidebar |
| `copy_to_clipboard` | Copy text to system clipboard |

`WorkspacePage.vue` registers listeners via `onPipelineAction()` / `offPipelineAction()` on mount to wire `insert_at_cursor` → `MarkdownEditor.insertAtCursor()` and `send_to_chat` → `ChatSidebar.sendMessage()`.

### Services

| Service | Purpose |
|---------|---------|
| `dictationSettingsService.ts` | Settings persistence (localStorage) |
| `dictationService.ts` | Mic capture, recording lifecycle, provider dispatch |
| `dictationPipelineService.ts` | Cleanup stage + pipeline action execution |
| `transcriptionProviders/base.ts` | Provider interface |
| `transcriptionProviders/openaiWhisperProvider.ts` | OpenAI Whisper API |
| `transcriptionProviders/deepgramProvider.ts` | Deepgram API |
| `transcriptionProviders/localWhisperProvider.ts` | Local Whisper via Electron IPC |

### Components

| Component | Purpose |
|-----------|---------|
| `DictationSettings.vue` | Settings UI: provider selection, speech model picker, cleanup toggle, pipeline config |
| `DictationIndicator.vue` | Floating status indicator (recording, transcribing, cleaning up, processing, error) |
| `DictationReviewModal.vue` | Post-transcription review: shows raw text, cleaned text, editable final text, confirm/discard |

### localStorage Keys

| Key | Contents |
|-----|----------|
| `hydranote_dictation_settings` | Provider config, speech model, cleanup config, shortcut, pipeline actions, enabled state |

### Electron Integration

- **Global Shortcut**: Uses Electron's `globalShortcut` API for OS-level push-to-talk. The shortcut sends a `dictation:toggle` IPC event to the renderer.
- **Preload Bridge**: Exposes `electronAPI.dictation` with `registerShortcut`, `unregisterShortcut`, `setCompanionTrayEnabled`, `onToggle`, `offToggle`, `onTrayAction`, `offTrayAction`, `transcribeLocal`, `getModelStatuses`, `downloadModel`, `deleteModel`, `onWhisperStatus`, `offWhisperStatus`.
- **Local Whisper Runtime**: `electron/src/whisperRuntime.ts` loads ONNX Whisper models via `@huggingface/transformers` and runs transcription in the main process. Audio is sent as base64 via IPC.
- **App.vue**: Initializes IPC listeners on mount, registers the saved shortcut, syncs the companion tray from dictation enabled state. On transcription complete, runs cleanup and opens the review modal; on confirm, dispatches pipeline actions.
- **System tray dictation item**: When dictation is enabled (`saveDictationSettings` / app load), the always-on app tray menu is rebuilt to include a "Start dictation" item at the top. Disabling dictation removes that item from the menu but the tray itself remains. See System Tray section for full details.

---

## System Tray

HydraNote keeps running when the main window is closed so background features (dictation global shortcuts, MCP server, sync services) can stay active.

**Window close behavior:**
- Closing the main window **hides** it instead of quitting (unless the user chooses Quit from a menu that sets the quitting flag).

**Always-on app tray:**
- Created automatically on `app.whenReady()` in `electron/src/index.ts`.
- Context menu always includes: **Add a note**, **Open chat**, **Show HydraNote**, **Quit HydraNote**.
- When dictation is enabled in settings, a **Start dictation** item is prepended to the menu.
- Left-click opens the context menu (platform-consistent).
- Menu actions focus the main window and send `hydranote:tray-action` to the renderer; `App.vue` routes workspace actions via `ELECTRON_TRAY_WORKSPACE_EVENT` to `WorkspacePage.vue`.

**Optional Capacitor tray** (`trayIconAndMenuEnabled` in Capacitor Electron config):
- If enabled in template setup, click toggles window visibility; context menu may include Show / Quit. This is independent of the always-on app tray.

**Configuration:**
- Always-on tray is created in `electron/src/index.ts` (`createAppTray()`)
- Dictation item visibility toggled via `setDictationVisibleInTray()` (called from `dictation:setCompanionTrayEnabled` IPC)
- Window close interception and tray show/hide logic in `electron/src/index.ts` and `electron/src/setup.ts`

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

**Local builds:**

```bash
# macOS (must run on Mac for Metal support)
npm run build && npx cap sync @capacitor-community/electron
cd electron && npm run electron:make -- --mac

# Windows
npm run build && npx cap sync @capacitor-community/electron
cd electron && npm run electron:make -- --win

# Linux
npm run build && npx cap sync @capacitor-community/electron
cd electron && npm run electron:make -- --linux
```

**GitHub Actions (CI/CD):**

Each platform has a dedicated workflow triggered by version tags (`v*`), manual dispatch, or the release workflow:

| Workflow | Runner | Output | GPU Backend |
|----------|--------|--------|-------------|
| `.github/workflows/build-windows.yml` | `windows-latest` | NSIS `.exe` installer | CUDA / Vulkan |
| `.github/workflows/build-macos.yml` | `macos-14` (ARM64) | `.dmg` | Metal |
| `.github/workflows/build-linux.yml` | `ubuntu-latest` | `.AppImage` | Vulkan |

The macOS workflow uses `macos-14` (Apple Silicon) so `npm ci` installs `@node-llama-cpp/mac-arm64-metal` with Metal GPU support.

**Release Workflow (`.github/workflows/release.yml`):**

The unified release workflow automates the full release pipeline. Trigger it manually from the Actions tab with a version bump type:

1. **Prepare** — Bumps version in `package.json` and `electron/package.json`, commits, creates a `vX.Y.Z` tag, and pushes
2. **Build** — Calls all 3 platform build workflows in parallel (via `workflow_call`), which publish artifacts to GitHub Releases
3. **Update Pages** — Rewrites the landing page download links to point to the new release assets, commits to `main` (auto-triggers `deploy-pages.yml`)

```
Actions tab → Release → Run workflow → choose patch / minor / major
```

**Required GitHub Secrets:**

| Secret | Used By | Description |
|--------|---------|-------------|
| `GH_TOKEN` | All platforms + release | GitHub token for publishing to Releases and pushing tags |
| `CSC_LINK` | macOS | Base64-encoded Developer ID Application `.p12` certificate |
| `CSC_KEY_PASSWORD` | macOS | Password for the `.p12` certificate |
| `APPLE_ID` | macOS | Apple ID email for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS | App-specific password (generate at appleid.apple.com) |
| `APPLE_TEAM_ID` | macOS | Apple Developer Team ID |

Configure these in the repository: Settings > Secrets and variables > Actions.

---

### Docker Development

HydraNote includes a Docker-based dev workflow for contributor onboarding.

**Files:**
- `Dockerfile.dev` - Development image for Vite app
- `docker-compose.yml` - Local container orchestration with live mount
- `.dockerignore` - Keeps build context lean
- `.env.example` - Example environment variables for local/container setups

**Run:**
```bash
docker compose up --build
```

App URL: `http://localhost:5173`

---

### GitHub Pages (Landing Page)

A static landing/marketing page is deployed to [gustavowt.github.io/hydranote](https://gustavowt.github.io/hydranote/) via GitHub Pages.

**Files:**
- `landing/index.html` — Self-contained landing page (HTML + inline CSS)
- `.github/workflows/deploy-pages.yml` — Deploys `landing/` on push to `main`

**How it works:**
- The workflow copies `public/hydranote-logo.png` and `public/favicon.png` into `landing/` at build time
- Deploys via `actions/deploy-pages@v4` using the GitHub Pages environment
- Only triggers on changes to `landing/**` or the workflow file itself

**Setup (one-time):**
1. Go to repository Settings → Pages
2. Under "Build and deployment", set Source to **GitHub Actions**

**Adding screenshots:** Place images in `landing/` and reference them in `index.html`. The screenshot placeholder in the hero section should be replaced with an actual `<img>` tag.

---

### Open Source Community Files

For public contribution workflows, this repository includes:

- `LICENSE` (MIT)
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `.github/ISSUE_TEMPLATE/bug_report.md`
- `.github/ISSUE_TEMPLATE/feature_request.md`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/GOOD_FIRST_ISSUES.md`

When adding major features, keep these files aligned with the actual workflow and update contributor-facing docs.

---

## File Structure

```
src/
├── components/
│   ├── ChatSidebar.vue              # AI chat with project context
│   ├── DateChipPopover.vue           # Date chip popover with calendar events + create event
│   ├── FileReferenceAutocomplete.vue # @file: autocomplete
│   ├── FileTreeNode.vue             # Recursive file tree node
│   ├── FormatStudio.vue             # Iterative AI formatting modal
│   ├── MarkdownEditor.vue           # Markdown editor (with inline date chips)
│   ├── PDFViewer.vue                # PDF viewer
│   ├── RichTextEditor.vue           # WYSIWYG editor for DOCX
│   ├── ProjectsTreeSidebar.vue      # Projects/files tree
│   ├── SearchAutocomplete.vue       # Global search bar
│   ├── TimelineView.vue             # Date-based timeline view of notes + events
│   ├── UpdateBanner.vue             # App update notification banner
│   ├── DictationIndicator.vue       # Floating recording/transcribing status indicator
│   ├── DictationReviewModal.vue     # Post-transcription review modal
│   └── settings/                    # Reusable settings components
│       ├── AIProviderSelector.vue
│       ├── IndexerProviderSelector.vue
│       ├── GoogleWorkspaceSettings.vue # Google Workspace integration (Meet + Calendar) config panel
│       ├── IntegrationsStore.vue     # Store-like integrations browser
│       ├── StorageSettings.vue
│       ├── DictationSettings.vue    # Dictation provider, shortcut, pipeline config
│       └── ZoomSettings.vue         # Zoom integration configuration panel
├── composables/
│   └── useMarkdownShortcuts.ts      # Smart editing for markdown textareas
├── icons/                           # SVG icon components for providers
├── services/
│   ├── integrationService.ts        # Integration settings (localStorage)
│   ├── googleWorkspaceAuthService.ts # Shared Google Workspace OAuth 2.0 auth, token management, settings
│   ├── googleMeetService.ts         # Google Meet API client
│   ├── googleMeetSyncService.ts     # Google Meet auto-sync orchestrator
│   ├── googleCalendarService.ts     # Google Calendar API client
│   ├── googleCalendarSyncService.ts # Google Calendar auto-sync orchestrator
│   ├── zoomService.ts               # Zoom API client (Server-to-Server OAuth)
│   ├── zoomSyncService.ts           # Zoom auto-sync orchestrator
│   ├── vttParser.ts                 # VTT transcript to Markdown parser
│   ├── chatService.ts               # Chat session management
│   ├── database.ts                  # DuckDB operations (includes calendar_events table)
│   ├── dateDetectionService.ts      # chrono-node date parsing + deadline detection
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
│   ├── updateService.ts             # GitHub version check
│   ├── versionService.ts            # File version history
│   ├── webSearchService.ts          # Web research
│   ├── dictationService.ts          # Mic capture, recording lifecycle, provider dispatch
│   ├── dictationSettingsService.ts  # Dictation settings persistence
│   ├── dictationPipelineService.ts  # Pipeline execution after transcription
│   ├── transcriptionProviders/      # Speech-to-text provider implementations
│   │   ├── base.ts                  # Provider interface
│   │   ├── openaiWhisperProvider.ts # OpenAI Whisper API
│   │   ├── deepgramProvider.ts      # Deepgram API
│   │   └── localWhisperProvider.ts  # Local whisper.cpp (Electron)
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
| `chat_messages` | Chat messages (includes `attachments` JSON column for tool attachments) |
| `file_versions` | Version history (diff-based) |
| `web_search_cache` | Web search result cache |
| `web_search_chunks` | Web search content chunks |
| `calendar_events` | Google Calendar events synced to DuckDB |

---

## Zoom Integration

Auto-syncs meeting transcripts from Zoom Cloud Recordings into HydraNote projects.

### Authentication

Uses **Zoom Server-to-Server OAuth**. Users create an app at [marketplace.zoom.us](https://marketplace.zoom.us) with `recording:read:admin` scope and provide Account ID, Client ID, and Client Secret in Settings > Integrations > Zoom.

Token exchange: `POST https://zoom.us/oauth/token` with `grant_type=account_credentials`. Tokens auto-refresh ~5 min before expiry.

### Auto-Sync Flow

1. `zoomSyncService` polls `GET /users/me/recordings` at a configurable interval (default 5 min)
2. Filters for recordings with `file_type: "TRANSCRIPT"` not already synced
3. Downloads VTT transcript via Zoom download URL
4. `vttParser` converts VTT to Markdown (grouped by speaker with timestamps)
5. Saves as `zoom-meetings/{date}-{topic}.md` in the configured target project via `projectService.createFile()`
6. Tracks synced meeting UUIDs in localStorage to prevent duplicates

### Services

| Service | Purpose |
|---------|---------|
| `zoomService.ts` | OAuth token management, Zoom REST API calls (via `web:fetch` IPC) |
| `zoomSyncService.ts` | Polling orchestrator, event emitter for UI updates |
| `vttParser.ts` | WebVTT to Markdown conversion with speaker grouping |

### localStorage Keys

| Key | Contents |
|-----|----------|
| `hydranote_zoom_settings` | Zoom credentials, sync config, cached token, synced meeting UUIDs |
| `hydranote_integration_settings` | General integration toggles (zoom/google_workspace enabled/disabled) |

---

## Google Workspace Integration

Unified integration for Google Meet and Google Calendar. Users connect their Google account via OAuth 2.0 and select which apps (Meet, Calendar) to enable. A shared access token covers all enabled scopes.

### Authentication

Uses **OAuth 2.0 Authorization Code** flow with a loopback redirect. Each user creates their own GCP project with a Desktop-type OAuth 2.0 Client ID — no Google Workspace admin access or compliance review required. Works with both personal Gmail and Workspace accounts.

**Flow:**
1. User pastes their Client ID and Client Secret into Settings > Integrations > Google Workspace
2. Clicks "Sign in with Google" — Electron main process starts a temporary HTTP server on `127.0.0.1` (random port)
3. System browser opens Google consent screen via `shell.openExternal()`
4. After user grants consent, Google redirects to the loopback server with an authorization code
5. Main process exchanges the code for access + refresh tokens via `POST https://oauth2.googleapis.com/token`
6. Fetches user email from `https://www.googleapis.com/oauth2/v2/userinfo`
7. Returns tokens + email to the renderer; refresh token is persisted in settings

Token refresh: When the cached access token expires (~5 min buffer), `getWorkspaceAccessToken()` calls the `google:refreshToken` Electron IPC handler which exchanges the stored refresh token for a new access token. If the refresh token has been revoked, the user is prompted to re-sign in.

**Electron IPC Handlers:**
- `google:startOAuth` — Full OAuth flow (loopback server + code exchange + userinfo), returns `{ accessToken, refreshToken, expiresAt, email }`
- `google:refreshToken` — Exchanges a refresh token for a new access token, returns `{ accessToken, expiresAt }`

**Scopes per App:**

| App | Required APIs | Scopes |
|-----|---------------|--------|
| Google Meet | Meet REST API, Google Drive API | `meetings.space`, `drive.meet.readonly` |
| Google Calendar | Google Calendar API | `calendar` |

The setup guide in the configuration panel walks users through creating a GCP project, enabling APIs, configuring the OAuth consent screen, and creating a Desktop OAuth Client ID.

### Google Meet Auto-Sync

1. `googleMeetSyncService` polls `GET https://meet.googleapis.com/v2/conferenceRecords` at a configurable interval (default 5 min)
2. For each conference, lists transcripts via `conferenceRecords/{id}/transcripts`
3. Filters for transcripts with `state: FILE_GENERATED` and a `docsDestination.document` ID
4. Downloads transcript content via Drive export API (`GET /drive/v3/files/{docId}/export?mimeType=text/plain`)
5. Formats plain-text transcript into Markdown (grouped by speaker)
6. Saves as `google-meet/{date}-{topic}.md` in the configured target project via `projectService.createFile()`
7. Tracks synced conference record names in settings to prevent duplicates

### Google Calendar Auto-Sync

1. `googleCalendarSyncService` polls at a configurable interval (default 5 min)
2. Builds a date range from the configured past/future days (default: 7 days each direction)
3. For each selected calendar (or primary if none selected), calls `GET /calendar/v3/calendars/{id}/events`
4. Filters out already-synced event IDs and cancelled events
5. Upserts each event into the DuckDB `calendar_events` table (no project/file dependency)
6. Tracks synced event IDs in settings to prevent duplicates

Events are stored globally in DuckDB and queried by date range for display in date chip popovers and the timeline view.

### Services

| Service | Purpose |
|---------|---------|
| `googleWorkspaceAuthService.ts` | Shared OAuth 2.0 auth, token management (via Electron IPC), settings persistence, legacy migration |
| `googleMeetService.ts` | Google Meet + Drive REST API calls (via `web:fetch` IPC) |
| `googleMeetSyncService.ts` | Meet polling orchestrator, event emitter for UI updates, transcript formatting |
| `googleCalendarService.ts` | Google Calendar REST API calls (via `web:fetch` IPC) |
| `googleCalendarSyncService.ts` | Calendar polling orchestrator, event emitter for UI updates |

### localStorage Keys

| Key | Contents |
|-----|----------|
| `hydranote_google_workspace_settings` | OAuth Client ID, Client Secret, refresh token, user email, enabled apps (meet/calendar), per-app sync configs, cached access token |

### Data Migration

On first load, `googleWorkspaceAuthService` checks for legacy keys (`hydranote_google_meet_settings`, `hydranote_google_calendar_settings`). If found, it preserves sync settings and app toggles into the new unified `hydranote_google_workspace_settings` key and removes the old keys. Legacy service account credentials cannot be migrated to OAuth — they are cleared, and the user must re-authenticate via "Sign in with Google". Existing workspace settings with old-format `serviceAccountJson` credentials are also detected and cleared on load. The `hydranote_integration_settings` toggles for `google_meet`/`google_calendar` are migrated to `google_workspace`.

---

## Integration Chat Tools

The integrations (Zoom, Google Meet, Google Calendar) extend the chat with four new tools that leverage synced data and live API access.

### listEvents Tool

Queries Google Calendar in real-time for events within a configurable date range. Requires Google Calendar integration to be enabled.

**Parameters:**
- `days` (number, default 7) — Days ahead to look
- `pastDays` (number, default 0) — Days behind to look
- `calendarId` (string, optional) — Specific calendar, defaults to configured calendars or primary

**Auto-executes** (low complexity, read-only). The LLM system prompt also includes today's upcoming events when Google Calendar is enabled, so the assistant passively knows the user's schedule.

### createEvent Tool

Creates a new event on Google Calendar via the REST API. Always requires user confirmation (high complexity).

**Parameters:**
- `title` (string) — Event summary
- `startTime` (string) — ISO datetime
- `endTime` (string, optional) — ISO datetime, defaults to 1 hour after start
- `allDay` (boolean, optional) — All-day event
- `description`, `location`, `attendees` (string, optional)

### searchTranscripts Tool

Semantic search across meeting transcripts. Prioritizes files in `zoom-meetings/`, `google-meet/`, and `google-calendar/` directories, but falls back to general results.

**Parameters:**
- `query` (string) — Search terms
- `project` (string, optional) — Restrict to a specific project
- `maxResults` (number, default 5)

### prepareMeeting Tool

Combines calendar data with semantic search to generate a meeting preparation document. Returns a `ToolAttachment` of type `'summary'`.

**Flow:**
1. Fetches upcoming events from Google Calendar (next 24h)
2. Matches the specified meeting topic (or picks the next event)
3. Searches project notes/transcripts for related context
4. Uses LLM to generate a structured prep document (overview, context, agenda, questions, action items)

**Parameters:**
- `meeting` (string, optional) — Topic to prepare for; uses next upcoming event if omitted
- `project` (string, optional) — Project to search for context

### @meeting: Reference

Users can type `@meeting:` in the chat input to autocomplete meeting transcript files. The FileReferenceAutocomplete shows a "Meetings" section (with teal styling and microphone icon) for files in `zoom-meetings/`, `google-meet/`, or `google-calendar/` directories. The `@meeting:` reference renders as a distinct pill in the chat input and message display.

### Generate Meeting Notes (Editor)

When a file from a meeting directory (`zoom-meetings/`, `google-meet/`, `google-calendar/`) is open in the MarkdownEditor, the 3-dots menu shows a "Generate Meeting Notes" action. This uses the LLM to extract:
- Meeting summary
- Key decisions
- Action items (with checkbox syntax)
- Discussion points
- Open questions

The generated notes are prepended to the file content, with the original transcript preserved below a separator.

### Calendar Context in System Prompt

When Google Calendar is enabled, `buildSystemPrompt()` and `buildGlobalSystemPrompt()` inject today's upcoming events (next 24 hours) into the system prompt. This gives the LLM passive awareness of the user's schedule without requiring an explicit `listEvents` tool call. The integration tool documentation is conditionally included — only tools for enabled integrations appear in the prompt.

---

## Smart Date Detection

Dates mentioned in notes are detected and rendered as interactive chips, with calendar integration and a timeline view.

### Date Detection Service (`dateDetectionService.ts`)

Uses `chrono-node` to parse natural language date expressions from note content.

**Features:**
- Detects dates like "next Monday", "March 15th", "tomorrow at 3pm", ISO dates, relative dates
- **Deadline detection**: scans preceding text for keywords (`deadline`, `due`, `due by`, `submit`, `finish by`, `expires`, etc.) and marks the date accordingly
- Caches results by content hash (30s TTL) to avoid re-parsing on every render
- Provides `formatDetectedDate()` and `getRelativeTime()` helpers

**Key Functions:**
| Function | Description |
|----------|-------------|
| `detectDates(text, referenceDate?)` | Parse all dates from text, returns `DetectedDate[]` |
| `clearDateCache()` | Clear the detection cache |
| `formatDetectedDate(date)` | Human-readable date string |
| `getRelativeTime(date)` | Relative description ("in 3 days", "yesterday") |

### Inline Date Chips (MarkdownEditor)

When a note is rendered in preview or split mode, detected dates are wrapped in interactive `<span class="date-chip">` elements:

- **Regular dates**: blue-tinted chip
- **Deadline dates**: amber-tinted chip (turns red when overdue)
- Clicking a chip opens the `DateChipPopover` component

The chips are injected by post-processing the `renderedContent` HTML after `marked.parse()`. The `injectDateChips()` function replaces date text in the HTML with styled spans (avoiding replacements inside HTML tags).

### DateChipPopover (`DateChipPopover.vue`)

A floating popover anchored to the clicked date chip. Shows:

- **Resolved date** with relative time indicator
- **Matching calendar events** for that date (from DuckDB `calendar_events` table)
- **Create Event button** (when Google Calendar is enabled):
  - Uses LLM to extract a suggested event title from the surrounding note context
  - Pre-fills start/end time from the detected date
  - Creates the event via Google Calendar API and stores it in DuckDB

### Timeline View (`TimelineView.vue`)

A date-based view of the knowledge base, toggled via the clock icon in the workspace header.

**Data sources:**
- Calendar events from DuckDB (`getCalendarEventsByDateRange`)
- Note date references: runs `detectDates()` on all notes in the current project (or all projects)

**UI:**
- Vertical date axis with day-by-day layout
- Calendar event cards (blue left border) with time, title, location
- Note reference cards (purple left border, amber for deadlines) with filename and context snippet
- Clicking a note card opens that file in the editor
- Date picker / range navigation (back/forward 7 days)
- "Show empty days" toggle
- "Today" jump button

### Calendar Events DuckDB Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | VARCHAR | Primary key (UUID) |
| `google_event_id` | VARCHAR | Google Calendar event ID (indexed, used for dedup) |
| `calendar_id` | VARCHAR | Google Calendar ID |
| `calendar_name` | VARCHAR | Human-readable calendar name |
| `summary` | VARCHAR | Event title |
| `description` | TEXT | Event description |
| `location` | VARCHAR | Event location |
| `start_time` | TIMESTAMP | Start time (indexed) |
| `end_time` | TIMESTAMP | End time |
| `all_day` | BOOLEAN | Whether it's an all-day event |
| `attendees` | TEXT | JSON array of attendees |
| `hangout_link` | VARCHAR | Google Meet link |
| `html_link` | VARCHAR | Link to event in Google Calendar |
| `status` | VARCHAR | Event status (confirmed/tentative/cancelled) |
| `synced_at` | TIMESTAMP | When the event was synced |

**CRUD functions** (in `database.ts`):
| Function | Description |
|----------|-------------|
| `upsertCalendarEvent(event)` | Insert or update by google_event_id |
| `getCalendarEventsByDateRange(start, end)` | Query events overlapping a range |
| `getCalendarEventsForDate(date)` | Query events for a specific day |
| `getCalendarEventByGoogleId(id)` | Lookup by Google event ID |
| `deleteCalendarEventsByCalendarId(id)` | Delete all events for a calendar |
| `getAllCalendarEvents()` | Get all stored events |
