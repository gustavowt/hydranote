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
│   ├── FileReferenceAutocomplete.vue # @file: autocomplete
│   ├── FileTreeNode.vue             # Recursive file tree node
│   ├── FormatStudio.vue             # Iterative AI formatting modal
│   ├── MarkdownEditor.vue           # Markdown editor
│   ├── PDFViewer.vue                # PDF viewer
│   ├── RichTextEditor.vue           # WYSIWYG editor for DOCX
│   ├── ProjectsTreeSidebar.vue      # Projects/files tree
│   ├── SearchAutocomplete.vue       # Global search bar
│   ├── UpdateBanner.vue             # App update notification banner
│   └── settings/                    # Reusable settings components
│       ├── AIProviderSelector.vue
│       ├── IndexerProviderSelector.vue
│       ├── IntegrationsStore.vue     # Store-like integrations browser
│       └── StorageSettings.vue
├── composables/
│   └── useMarkdownShortcuts.ts      # Smart editing for markdown textareas
├── icons/                           # SVG icon components for providers
├── services/
│   ├── integrationService.ts        # Integration settings (localStorage)
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
│   ├── updateService.ts             # GitHub version check
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
| `chat_messages` | Chat messages (includes `attachments` JSON column for tool attachments) |
| `file_versions` | Version history (diff-based) |
| `web_search_cache` | Web search result cache |
| `web_search_chunks` | Web search content chunks |
