# HydraNote Developer Documentation

Technical documentation for HydraNote - an AI-powered document indexing and interaction system.

## Architecture Overview

**Tech Stack:**
- **Frontend**: Ionic Vue (Vue 3 + TypeScript)
- **Database**: DuckDB (in-browser WASM with OPFS persistence)
- **AI Providers**: OpenAI, Anthropic (Claude), Google (Gemini), Ollama (local daemon — cloud-tagged models proxied via the daemon after `ollama signin`), Hugging Face Local
- **Embedding Providers**: OpenAI, Gemini, Ollama (local daemon or Ollama Cloud), Hugging Face Local (independent from LLM provider)
- **Document Processing**: PDF.js, Mammoth (DOCX), Tesseract.js (OCR)
- **Markdown**: marked + highlight.js + Mermaid (diagrams); **Live** mode is a Tiptap (ProseMirror) WYSIWYG editor — markdown is rendered to HTML via `marked` on load and serialized back to markdown via `turndown` + `turndown-plugin-gfm` on edit, so the editing surface looks identical to the reading view
- **Rich Text Editor**: Tiptap (ProseMirror-based) for DOCX editing
- **File System Sync**: File System Access API (bidirectional sync with local directories)

### Workspace Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Logo  │        [  Search Bar  ]          │  New Note │ Settings│
├──────────────┬─────────────────────────────┬────────────────────┤
│   Projects   │                             │                    │
│     Tree     │      Markdown Editor        │    Chat Sidebar    │
│   Sidebar    │  (edit/split/live/preview)  │                    │
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
| Gemini | gemini-embedding-001 (current GA), gemini-embedding-2 (multimodal, GA Apr 2026), text-embedding-004 (deprecated Jan 14 2026 — kept for migration) |
| Ollama | nomic-embed-text, mxbai-embed-large, all-minilm (local daemon or Ollama Cloud) |
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
| OpenAI | `gpt-image-2` (latest, Apr 2026), `gpt-image-1.5`, `gpt-image-1`, `dall-e-3`, `dall-e-2` | `/v1/images/generations` (b64_json) |
| Google Gemini (Nano Banana) | `gemini-3-pro-image-preview` (Nano Banana 3, latest), `gemini-3.1-flash-image-preview` (Nano Banana 2), `gemini-2.0-flash-preview-image-generation` | Native multimodal `generateContent` |
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

Drives the in-app `UpdateBanner.vue` for new app releases. Has two modes that share the same reactive state and the same banner component:

- **Electron (packaged builds):** uses `electron-updater` against the GitHub Releases provider configured in `electron/electron-builder.config.json`. The main process (`electron/src/index.ts`) wires `autoUpdater` lifecycle events (`checking-for-update`, `update-available`, `update-not-available`, `download-progress`, `update-downloaded`, `error`) and forwards each one to the renderer via `webContents.send('app-updater:event', payload)`. The renderer subscribes via `window.electronAPI.updater.onEvent` and drives a phase machine: `idle → checking → available → downloading → downloaded` (or `error`). The user is asked for consent before any download starts (`autoUpdater.autoDownload = false`), and `autoInstallOnAppQuit = true` ensures that even if the user dismisses the "Restart now" button, the install completes silently on next quit.
- **Web / PWA / unpacked dev builds:** falls back to polling the GitHub repository tags API (`/repos/{owner}/{repo}/tags?per_page=1`), comparing against `package.json` version with semver. The banner shows a "View release" link to the GitHub Releases page (no in-app download).

Both modes run on app startup and re-check every 6 hours.

**Phases (Electron-only):**
| Phase | Banner content |
|-------|----------------|
| `available` | "Version X is available — **Update now** — Later" |
| `downloading` | "Downloading update X… NN%" + thin progress bar |
| `downloaded` | "Update X downloaded — ready to install — **Restart now**" |
| `error` | "Update failed: {message} — Retry / Dismiss" |

**Key Functions:**
| Function | Description |
|----------|-------------|
| `startUpdateChecker()` | Begin periodic checks + attach electron-updater listener (called on app mount) |
| `stopUpdateChecker()` | Stop the periodic timer and detach the electron-updater listener |
| `checkForUpdates()` | Single check (routes through `electron-updater` when available, otherwise GitHub tags) |
| `requestUpdateDownload()` | Electron-only — starts the download (`autoUpdater.downloadUpdate`) |
| `installUpdateNow()` | Electron-only — calls `autoUpdater.quitAndInstall` after flipping the tray's `isQuitting` guard so the relaunch isn't intercepted |
| `dismissUpdate()` | Dismiss the banner for the `available` phase only — once a download starts/finishes the banner persists so the user can install |

**Reactive State:** `hasUpdate`, `latestVersion`, `currentVersion`, `releaseUrl`, `updaterPhase`, `downloadPercent`, `downloadBytesPerSec`, `updaterError` (Vue refs).

**Electron IPC (`electronAPI.updater`):** `check()`, `downloadUpdate()`, `quitAndInstall()`, `onEvent(callback)`, `offEvent()`. All three invocations short-circuit with a friendly error in dev mode (`app-update.yml` is not present in unpacked builds).

**Signing requirements:** `electron-updater` requires code-signed + notarized bundles on macOS — your release CI (`.github/workflows/release.yml`) already sets `CSC_LINK`, `APPLE_ID`, etc. Local unsigned macOS builds surface the signing error inline in the banner (`phase: 'error'`) instead of crashing. Linux uses AppImage in-place updates (the user must run the AppImage directly, not extracted). Windows uses the NSIS installer's silent update path.

**Dismiss persistence:** the dismissed version is remembered in `localStorage` (`hydranote_dismissed_update_version`). Re-checks against the same version stay quiet until a newer one ships.

---

## Components

### WorkspacePage (`WorkspacePage.vue`)
Main layout orchestrating three-panel workspace. Routes files to appropriate editor based on type.

### MarkdownEditor (`MarkdownEditor.vue`)
Full markdown editor with edit, split, **Live** (hybrid), and preview modes, Mermaid diagram support, inline saving, version history access.

**Default mode:** Existing `.md` files open in **Live** (`viewMode === 'hybrid'`); brand-new notes start in `edit` so the user can type raw markdown.

**Live mode:** `MarkdownLiveEditor.vue` mounts a Tiptap editor with the same extensions as `RichTextEditor.vue` (StarterKit, Link, Image, Table*, TaskList/Item, CodeBlockLowlight) plus a custom **`MermaidBlock`** node (`MermaidBlockNodeView.vue`) that renders the diagram inline and toggles to a textarea on click for source editing (⌘/Ctrl+Enter to apply, Esc to cancel). YAML frontmatter (`---\n…\n---`) is split off via `splitFrontmatter` (in `services/markdownConverter.ts`) before sending the body to Tiptap and re-prepended on every emit, so it round-trips losslessly.

Markdown ↔ HTML conversion lives in `services/markdownConverter.ts`:

- `markdownToHtml(md)` uses the same `marked` instance as the reading view.
- `htmlToMarkdown(html)` uses `turndown` + GFM (tables / strikethrough / task lists), with extra rules to preserve fenced-code language attributes and to round-trip the `<div data-mermaid-source>` produced by the Mermaid node back into a ` ```mermaid ` block.

**Live mode caveats** (round-trip is HTML-based, not source-preserving):

- HTML comments (`<!-- … -->`) and Obsidian-style wikilinks (`[[…]]`) are not preserved through the round-trip — use `edit` / `split` to author them.
- Project-relative images are still rendered by the `marked` preview path used by `edit` / `split` / `view`; in Live they appear as plain `<img>`.
- Format Studio, AI updates, and version restore continue to operate on the markdown string; Live just re-renders when `content` changes externally.

**Live mode date chips:** dates detected by `dateDetectionService` are rendered in Live mode via a Tiptap inline-decoration plugin (`DateChipExtension` in `MarkdownLiveEditor.vue`) that mirrors the `injectDateChips` post-processing used by the `marked` preview path. Chip clicks bubble up as a `date-chip-click` event on `MarkdownLiveEditor` and are routed into the same `DateChipPopover` flow used by `view` / `split`.

**Live mode scrolling:** `MarkdownLiveEditor`'s root `.live-editor-host` owns its own scroll container (`overflow-y: auto`). The parent `MarkdownEditor.vue` must not pass `class="editor-pane full"` to it, because `.editor-pane`'s `overflow: hidden` would clip the editor and prevent scrolling on long documents. The component already declares `flex: 1; width: 100%; height: 100%` on its host, so it fills the flex parent without the extra class.

**Features:**
- Send selected text to chat (`@selection:file:lines` reference)
- AI Format Studio via 3-dots menu (iterative formatting with version navigation)
- Export as PDF/DOCX/Markdown
- Version history restore
- Smart editing predictions via `useMarkdownShortcuts` composable (see below)

**Smart Editing (`src/composables/useMarkdownShortcuts.ts`):**
Composable that attaches to the **plain textarea** in edit and split modes (not Live mode). Live mode uses Tiptap's built-in keymaps (e.g. `Cmd/Ctrl+B` bold, `Cmd/Ctrl+I` italic, list continuation, etc.). It provides markdown-aware keyboard behavior for the textarea modes:
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
Hierarchical project/file navigator with drag-and-drop between projects. Dropping a file onto a **directory row** moves it into that directory; dropping onto the **project header** moves it to that project's root — this also works within the same project, so a file can be dragged out of a subdirectory back to the project root (files already at root are ignored).

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
| `.pdf` | PDFViewer (readonly) | `content` (extracted text, joined per page) + `systemFilePath`; chunks + embeddings produced via the page-aware ingestion pipeline (see "PDF Ingestion") |
| `.docx` | RichTextEditor | `content` + `binaryData` (base64) + `htmlContent` |

---

## PDF Ingestion

PDFs are ingested via a page-aware pipeline that extracts text, detects visual pages, runs the configured AI provider's vision model on those pages, and embeds everything for semantic search. The pipeline is invoked automatically by `syncService` after `createFile(... 'pdf' ...)` and by `reindexFile('pdf', ...)`.

### Pipeline Stages

```
syncService.createFile(pdf)
       ↓
pdfIngestionService.ingestPdfForSearch
       ↓
Per page (CPU queue, parallel):
   • PDF.js getTextContent()          → page text
   • PDF.js getOperatorList()         → image XObjects + path-density check
   • PDF.js getOutline() / getPageIndex → nearest section title
       ↓
For pages flagged "visual" (Vision queue, parallel):
   • render to in-memory PNG (OffscreenCanvas-style HTMLCanvasElement)
   • visionService.describeImage(provider, base64, prompt)
   • bitmap discarded immediately after
       ↓
Chunks (text + visual_description) → embeddings → DuckDB
```

### Visual Page Detection

A page counts as "visual" if either is true:
- Its operator list contains any image XObject op (`OPS.paintImageXObject`, `OPS.paintInlineImageXObject`, `OPS.paintImageMaskXObject`, plus the `*Repeat` variants).
- Its text is sparse (< 200 trimmed characters) **and** its operator list has a high concentration of vector-drawing ops (`OPS.constructPath` / `fill` / `stroke` ≥ 80). This catches charts and diagrams drawn with vector paths rather than raster images.

### Vision Provider Mapping (auto, no settings UI)

| Active LLM provider | Vision model used | API shape |
|---|---|---|
| OpenAI | `gpt-4o` | `chat/completions` with `image_url` content parts |
| Anthropic | `claude-3-5-sonnet-latest` | `messages` with base64 `image` blocks |
| Google | `gemini-3.1-flash` | `generateContent` with `inlineData` parts |
| Ollama (local daemon) | first installed match from `OLLAMA_VISION_CANDIDATES` (`llama3.2-vision`, `llava`, `llava-llama3`, `bakllava`, `minicpm-v`, …); skipped if none installed. Always hits the configured local daemon URL with no auth header — cloud-tagged vision models, if any, are proxied transparently by the daemon. | `/api/chat` with `images: [base64]` |
| Hugging Face Local | not supported — pages are text-only | — |

The vision prompt is fixed: it asks for plain-prose description of charts, diagrams, images, axes, labels and key values, with a small page+section context block appended.

### Storage

- Extracted per-page text is joined with blank lines and persisted on `files.content` (kept identical to the previous behavior so the existing `read` tool keeps working unchanged).
- Each page produces 0–N text chunks (via the existing `chunkText` helper) plus at most one `visual_description` chunk.
- All chunks carry `page_number` and (when the PDF has a bookmark outline) `section`. The `kind` column is `'text'` or `'visual_description'`.
- Rendered page bitmaps are **never persisted**: they exist only in memory long enough to call the vision model, then are dropped. There is no on-disk image cache.

### Concurrency

Two bounded queues isolate CPU work from network/local-LLM work:
- **Render/extract queue**: `getCpuConcurrency()` = `max(2, min(navigator.hardwareConcurrency / 2, 6))`.
- **Vision queue**: hardcoded to 3 (override via `PdfIngestionOptions.visionConcurrency` in tests).

Both come from `src/utils/concurrencyQueue.ts` (`runWithLimit`, in-order results, propagates the first error).

### Re-Indexing

`reindexAllFiles` and `reindexStaleFiles` (in `embeddingService.ts`) include `pdf` rows. Re-indexing a PDF re-renders every visual page and re-asks the vision model, which can be expensive — switching embedding providers on a knowledge base of large PDFs may take a long time and consume tokens. The pipeline reads the binary back from disk via `electronAPI.fs.readBinaryFile` using the file's `systemFilePath`. PDFs without a `systemFilePath` (purely in-DB rows) cannot be re-indexed and are skipped with a recorded error.

### Chat Retrieval

The `search` tool's output is annotated with the matched chunk's page and section: `(Source: report.pdf, p. 7 — Methodology, Score: 82.4%)`. Visual chunks get an additional `[visual]` tag so the LLM and the user can tell when the snippet came from the vision model rather than the document text. The existing `read` tool path is unchanged — it returns `files.content` (joined per-page text).

### Schema

The `chunks` table gained three columns (idempotently added on app start via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`):

| Column | Type | Notes |
|---|---|---|
| `page_number` | INTEGER | NULL for non-paginated sources (md, txt) |
| `section` | VARCHAR | Outline title for the nearest enclosing PDF section, NULL when unknown |
| `kind` | VARCHAR | `'text'` (default) or `'visual_description'` |

Plus an index `idx_chunks_file_page (file_id, page_number)` for per-page lookups.

### Files

| File | Role |
|---|---|
| `src/services/pdfIngestionService.ts` | Page-aware ingestion pipeline (entry point: `ingestPdfForSearch`) |
| `src/services/visionService.ts` | Provider-aware vision adapter (`describeImage`, `isVisionAvailable`) |
| `src/utils/concurrencyQueue.ts` | `runWithLimit`, `getCpuConcurrency` |

---

## External File Drop (Drag & Drop Import)

Files and folders dragged onto the project tree from the OS file manager are imported in-place using the same pipelines as the FS sync, with live per-row progress.

### Drop Targets

| Drop target row | Resolved destination |
|---|---|
| Project header | Project root |
| Directory row | That directory |
| File row | The file's parent directory |

The OS drag is recognized whenever `dataTransfer.types` contains `'Files'`. While such a drag is over a row, the row gets a distinct `os-drag-over` outline (purple-tinged, falling back to teal on themes without `--hn-purple-muted`). Both `ProjectsTreeSidebar.vue` (project header) and `FileTreeNode.vue` (rows) are wired to this branch; the file-tree node forwards the raw `DragEvent` up via the new `os-files-drop` Vue event so the sidebar can call the ingestion service.

### Folder Recursion

Folder drops use `DataTransferItem.webkitGetAsEntry()` to walk the dropped tree, so a dropped folder preserves its full subdirectory structure under the drop target. Files where `webkitGetAsEntry` is unavailable (older browsers, some Linux DEs) fall back to a flat list via `dataTransfer.files`.

### Per-File Routing

`fileIngestionService.ingestExternalFiles` runs imports sequentially (one file at a time, ordered by drop list) and routes each file by `detectFileType`:

| Type | Path |
|---|---|
| `md`, `txt` | `createFile` → `indexFileForSearch` (synchronous text indexing) |
| `pdf` | `extractFullPdfText` → `createFile` (with joined text **and** raw bytes persisted to `binary_data_base64` so `PDFViewer` can re-render the document later) → `ingestPdfForSearch` (page-aware vision pipeline) |
| `docx` | `getFileBinaryData` + `convertDOCXToHTML` → `createFile` with binary + HTML body |
| `png`, `jpg`, `jpeg`, `webp` | `createFile` with raw bytes |

Unsupported types are recorded in the `failed[]` of the result and surfaced via an Ionic alert at the end of the batch. PDFs imported by drop have **no** `systemFilePath` — they live in the DB only. Their raw bytes are persisted on the `files` row (`binary_data_base64`) so `PDFViewer` can render them by reading the column back through `getFile`, but they still cannot be re-indexed via `reindexFile` without supplying the `File` again (the re-index pipeline reads from `systemFilePath`).

### Live Per-Row Progress

`fileIngestionService` exposes two reactive Vue refs that drive the live tree UI:

| Ref | Key | Purpose |
|---|---|---|
| `ingestionProgress: Ref<Map<string, IngestionProgressEntry>>` | transient `drop:...` id, then `files.id` after createFile | percent + stage for the progress bar / suffix |
| `pendingDrops: Ref<Map<string, PendingDropEntry>>` | transient `drop:...` id | ghost rows rendered before `createFile` returns |

#### Ghost rows (immediate visibility on drop)

When the user drops a file, the ingestion pipeline doesn't have a `files.id` to attach UI to until `createFile` returns — which for PDFs is *after* `extractFullPdfText` blocks for several seconds. To avoid a long invisible gap, the service publishes a `PendingDropEntry` to `pendingDrops` **before** any work starts and clears it the moment `createFile` resolves.

`ProjectsTreeSidebar.vue` exposes `renderedNodesFor(projectId)`, a helper that merges ghosts into the project's real tree:

- Ghosts grouped by their `targetDirectory`.
- A group whose target directory already exists in the tree is injected as that directory's children (the directory is forced `expanded: true` so the activity is visible).
- A group whose target either is the project root or doesn't yet exist in the tree (e.g. a folder drop whose intermediate dirs `createFile` hasn't materialized yet) surfaces at the top of the project's root level so the user still sees the file activity.

The transient drop id is reused as the ghost node's `id`, so `FileTreeNode.vue`'s existing `ingestionProgress.get(node.id)` lookup picks up the progress bar without any special-casing for ghosts.

#### Per-file tree refresh

`ingestExternalFiles(entries, projectId, targetDirectory, onFileCreated?)` accepts an optional callback invoked synchronously after each `createFile` resolves. The sidebar passes a callback that drops the cached file tree for the project and calls `loadProjectFiles(projectId)`. Net effect:

1. Drop hits sidebar → ghost row appears immediately (with shimmer + 0% bar).
2. Pre-`createFile` work runs (PDF extract, docx mammoth, etc.) — bar advances within its stage band.
3. `createFile` returns → ghost cleared, callback fires, tree reloads, real row appears at its correct nested path with progress continuing under the new `files.id` key.
4. Post-`createFile` work (indexing, vision, embedding) → bar finishes within 85..100% band.
5. Settle delay of ~600 ms at 100%, then `ingestionProgress` entry is dropped.

A final batch-level tree refresh runs after `ingestExternalFiles` returns as a safety net.

#### Bar + shimmer

`FileTreeNode.vue` reads `ingestionProgress` by `node.id` and renders three layered cues while a row is being processed:

- A small `NN%` suffix to the right of the filename
- A 2px progress bar at the bottom of the row
- A CSS-only moving sheen (`.node-row.ingesting::after`) — purely an "actively working" signal; disabled under `prefers-reduced-motion: reduce`

Cursor switches to `progress`, text is slightly dimmed, and click + context menu + dragstart are disabled while a row is ingesting (its content may be incomplete).

#### Stage → percent bands

For PDFs the three internal ingestion stages are mapped onto a single 0..100 band so the bar always advances forward:

| Stage | Percent band |
|---|---|
| extracting (text + visual detection) | 20..50 |
| visual_describe (vision per visual page) | 50..85 |
| embedding (chunk + embedding write) | 85..100 |

After ingestion the entry is held at 100% for ~600 ms (so the user sees the bar fill) and then cleared.

### Files

| File | Role |
|---|---|
| `src/services/fileIngestionService.ts` | Orchestrator: folder recursion, per-type routing, `ingestionProgress` + `pendingDrops` reactive stores, `onFileCreated` per-file hook |
| `src/components/ProjectsTreeSidebar.vue` | Project-level OS drop handler, `renderedNodesFor()` ghost merge, per-file tree refresh, alerts |
| `src/components/FileTreeNode.vue` | Row-level OS drop handler, progress bar + percent suffix + shimmer overlay (reads `ingestionProgress` by `node.id` — works for ghosts and persisted rows alike) |

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
  ollama: { mode: 'local' | 'cloud', baseUrl, apiKey, model };
  anthropic: { apiKey, model };
  google: { apiKey, model };
  huggingfaceLocal: { modelId, contextLength, gpuLayers };
  noteSettings: { formatInstructions, defaultDirectory, autoGenerateTitle };
}
```

The Ollama indexer config in `IndexerSettings.ollama` mirrors this shape (`mode`, `baseUrl`, `apiKey`, `model`).

### Supported AI Providers
| Provider | Models |
|----------|--------|
| OpenAI | GPT-5.5 / 5.5 Pro (latest, Apr 2026), GPT-5.4 / 5.4 Mini / 5.4 Nano, GPT-5.2, GPT-5 / Mini / Nano, o4-mini, o3, GPT-4.1 series |
| Anthropic | Claude Opus 4.7 (latest, Apr 2026), Claude Sonnet 4.6, Claude Opus 4.6, Claude Sonnet 4.5, Claude Haiku 4.5, Claude 4 series |
| Google | Gemini 3.5 Flash (latest, May 2026), Gemini 3.1 Pro/Flash-Lite, Gemini 3 Pro/Flash, Gemini 2.5 Pro/Flash/Flash-Lite, Gemini 2.0 |
| Ollama | Local daemon (Llama, Mistral, etc.) plus cloud-tagged models proxied via the daemon (`*:cloud` and `*-cloud` tags like `deepseek-v4-pro:cloud`, `gpt-oss:120b-cloud`, `qwen3-coder:480b-cloud` — requires `ollama signin` once) |
| Hugging Face Local | GGUF models via node-llama-cpp (Electron only) |

**OpenAI reasoning model request behavior:**
- For reasoning-capable OpenAI models (`o*` and `gpt-5*`), HydraNote sends `max_completion_tokens` and a valid `reasoning_effort` (`low` by default).
- `reasoning_effort: "none"` is not used because OpenAI reasoning models reject it.

**Anthropic request behavior:**
- HydraNote sends `anthropic-version: "2023-06-01"` for both regular and streaming Claude requests.
- Keep this header on a valid Anthropic API version; unsupported versions are rejected before model execution.

**Ollama (chat / vision — local-daemon-only with cloud-tagged model proxy):**

The chat-side Ollama provider is **local-daemon-only**. It always targets the configured local daemon URL (default `http://localhost:11434`). Cloud-tagged models are first-class citizens because the local Ollama daemon (since v0.6+) transparently proxies them to ollama.com after the user runs `ollama signin` in a terminal once.

> **CORS / Electron origin gotcha (why chat is IPC-routed):** the Ollama daemon rejects any request that carries the packaged renderer's custom-scheme origin (`Origin: capacitor-electron://-`) with `403 Forbidden` — this applies to `/api/chat` **and** `/api/tags`, for local *and* cloud-tagged models. "localhost" does **not** exempt the request; the daemon's CORS check keys off the `Origin` header. Therefore, under Electron, the chat/vision/tags calls are routed through the main-process `web:fetch` / `web:fetchStream` IPC bridge, where the request originates in Node with no browser origin attached. On the web/PWA build there is no custom scheme, so a native `fetch()` fallback is used.

- `OllamaConfig` keeps a `mode: 'local' | 'cloud'` field on the type for backwards compatibility with persisted data, but `loadSettings()` migrates any persisted `mode: 'cloud'` config to `'local'` on read. The migration:
  - Sets `mode = 'local'`.
  - Fills `baseUrl` with `'http://localhost:11434'` only if the persisted value is empty (custom URLs are kept).
  - **Preserves the model name.** A `qwen3-coder:480b-cloud` selection survives the migration and continues to work because the local daemon proxies it.
  - **Preserves `apiKey` on disk (dormant).** The field is no longer read or sent on requests, but is kept in storage to avoid silent data loss for users who had a HydraNote-side cloud key configured.
- The settings UI in `AIProviderSelector.vue` no longer shows a Local/Cloud mode toggle or an API key field. It shows the daemon URL plus two model lists:
  - **Available Models** — pulled from `/api/tags` on the configured daemon.
  - **Cloud Models (via local daemon)** — the static `SUGGESTED_OLLAMA_CLOUD_MODELS` set (`src/types/index.ts`: `gpt-oss:120b-cloud`, `qwen3-coder:480b-cloud`, `kimi-k2:1t-cloud`, etc.). A help hint reminds the user to run `ollama signin` once; on first use the daemon will pull the cloud-tagged model on demand.
- Chat non-streaming (`callOllama`), tag discovery (`getOllamaModels`), and vision (`visionService.describeWithOllama`) go through `ollamaJsonFetch(url, init)`, which uses the Electron `web:fetch` IPC bridge when available and falls back to native `fetch()` on web. Chat streaming (`streamOllama`) goes through the dedicated `web:fetchStream` IPC bridge under Electron (token-by-token chunks forwarded via `web:fetchStream:chunk` events, correlated by `requestId`), and falls back to a native streaming `fetch()` reader on web. All four Ollama timeouts are bumped to 300s to tolerate cold cloud-model pulls on first use.
- The streaming IPC handler treats `timeout` as an **idle** timeout (it resets on every received chunk), so long generations are not aborted mid-stream as long as tokens keep flowing.
- `getOllamaRequestConfig(config)` still tolerates `mode === 'cloud'` for one remaining caller: the **embeddings indexer**, whose own `OllamaEmbeddingConfig` retains a `mode: 'local' | 'cloud'` discriminator (see "Embedding service" below). For chat, `config.mode` is always `'local'` after migration, so the cloud branch is unreachable from the chat path.

**Embeddings indexer Ollama (still has local + cloud modes):**

`OllamaEmbeddingConfig` keeps the original `mode: 'local' | 'cloud'` shape. The cloud branch targets `https://ollama.com/api/embeddings` directly (with `Authorization: Bearer <apiKey>`), which the renderer's `capacitor-electron://-` origin can't reach because of CORS. To work around that, the embedding service's Ollama call goes through the Electron `web:fetch` IPC bridge via the shared `ollamaJsonFetch(url, init)` helper exported from `llmService.ts`:
- `ollamaJsonFetch` detects `window.electronAPI?.web?.fetch`. When present, it routes through IPC (main process performs the request, no browser CORS). Otherwise it falls back to native `fetch` (web/PWA build, Vitest jsdom env, etc.).
- The same IPC bridge is also used by the **chat path** now (the daemon 403s the renderer's custom-scheme origin even on localhost — see the chat section above). The embeddings indexer is no longer the only IPC-routed Ollama caller.
- The embeddings indexer settings UI still surfaces both modes; nothing changed there.

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
- Split GGUF files are downloaded as complete shard groups (for example, all `00001-of-00002` and `00002-of-00002` files)

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

**Web (CORS bypass):**
`web:fetch` - One-shot HTTP request executed in the main process (bypasses renderer CORS). Returns `{ success, status, headers, body, finalUrl, error? }`. Used by the embeddings indexer's Ollama cloud mode and the chat-side Ollama non-streaming + tags calls (via `ollamaJsonFetch` in `llmService.ts`), `zoomService`, `googleWorkspaceAuthService`, `webSearchService`, and `deepgramProvider`.
`web:fetchStream` - Streaming HTTP request executed in the main process. Body chunks are forwarded to the renderer via `web:fetchStream:chunk` events (correlated by a caller-supplied `requestId`); the `invoke` promise resolves with `{ success, status, error? }` when the stream ends. `timeout` is an **idle** timeout (resets on each chunk). Used by `streamOllama` so token-by-token streaming still works while keeping the request off the renderer's custom-scheme origin (the local Ollama daemon 403s `capacitor-electron://-`, even on localhost).

**Dictation:**
`dictation:registerShortcut` - Register a global OS-level keyboard shortcut for push-to-talk
`dictation:unregisterShortcut` - Unregister the current dictation shortcut
`dictation:setCompanionTrayEnabled` - Show or hide the "Start dictation" item in the always-on system tray menu
`dictation:ensureMicrophoneAccess` - Check (and prompt if needed) the OS-level microphone permission. Returns `{ granted, status }`. On macOS uses `systemPreferences.getMediaAccessStatus` / `askForMediaAccess`; on other platforms returns `granted: true`.
`dictation:getMicrophoneAccessStatus` - Read the current OS-level microphone permission status without prompting. Returns `{ status }`. Used by the UI (e.g. the chat input dictation button) to grey itself out when access is denied.
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

**OpenAI cloud transcription models:** The Dictation UI lists model IDs from `OPENAI_TRANSCRIPTION_MODELS` in `src/types/index.ts` (Whisper 1 plus GPT-4o transcribe variants). `openaiWhisperProvider.ts` picks a compatible `response_format` for each model (`verbose_json` for `whisper-1`, `json` for GPT-4o transcribe / mini, `diarized_json` with `chunking_strategy=auto` for `gpt-4o-transcribe-diarize`) and normalizes the JSON into plain text for the rest of the pipeline.

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
- **Preload Bridge**: Exposes `electronAPI.dictation` with `registerShortcut`, `unregisterShortcut`, `setCompanionTrayEnabled`, `ensureMicrophoneAccess`, `getMicrophoneAccessStatus`, `onToggle`, `offToggle`, `onTrayAction`, `offTrayAction`, `transcribeLocal`, `getModelStatuses`, `downloadModel`, `deleteModel`, `onWhisperStatus`, `offWhisperStatus`.
- **Local Whisper Runtime**: `electron/src/whisperRuntime.ts` loads ONNX Whisper models via `@huggingface/transformers` and runs transcription in the main process. Audio is sent as base64 via IPC.
- **App.vue**: Initializes IPC listeners on mount, registers the saved shortcut, syncs the companion tray from dictation enabled state. On transcription complete, runs cleanup and opens the review modal; on confirm, dispatches pipeline actions.
- **System tray dictation item**: When dictation is enabled (`saveDictationSettings` / app load), the always-on app tray menu is rebuilt to include a "Start dictation" item at the top. Disabling dictation removes that item from the menu but the tray itself remains. See System Tray section for full details.

### Microphone Permissions

`getUserMedia` for an Electron renderer running under a custom URL scheme is denied by default unless the session explicitly grants the `media` permission, and on macOS the OS-level TCC prompt only fires when the app is properly declared. Without these pieces dictation can appear to run end-to-end while capturing a silent stream. HydraNote handles all of this:

1. **Electron session permission** (`electron/src/setup.ts` → `setupMediaPermissions()`): registers `setPermissionRequestHandler` and `setPermissionCheckHandler` on `session.defaultSession` to allow `media` and `mediaKeySystem`. Wired into the bootstrap from `electron/src/index.ts` right after `setupContentSecurityPolicy()`.
2. **macOS preflight IPC** (`dictation:ensureMicrophoneAccess` in `electron/src/index.ts`): on `darwin`, calls `systemPreferences.getMediaAccessStatus('microphone')` and, when status is `not-determined`, triggers `systemPreferences.askForMediaAccess('microphone')`. Other platforms short-circuit to `granted: true`.
3. **No-prompt status IPC** (`dictation:getMicrophoneAccessStatus` in `electron/src/index.ts`): on `darwin`, returns the current `systemPreferences.getMediaAccessStatus('microphone')` value without ever prompting. UI elements call this on mount to render disabled controls when access is denied.
4. **Renderer preflight** (`src/services/dictationService.ts`): `startRecording()` calls `electronAPI.dictation.ensureMicrophoneAccess()` before `getUserMedia`. If access is denied/restricted, `dictationState` is set to a friendly error pointing the user at System Settings → Privacy & Security → Microphone, and the reactive `micPermissionState` is updated.
5. **Reactive permission state** (`micPermissionState` + `refreshMicPermissionState()` in `dictationService.ts`): `'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'`. Primed once from `App.vue` on mount and again from `ChatSidebar.vue` so the chat dictation button can disable itself without forcing a prompt. Browser fallback uses `navigator.permissions.query({ name: 'microphone' })` when available; otherwise stays at `'unknown'` (treated as enabled).
6. **macOS packaging metadata**:
   - `electron/electron-builder.config.json` → `mac.extendInfo.NSMicrophoneUsageDescription` provides the Info.plist usage string required for the OS prompt and for the app to appear under Privacy & Security → Microphone.
   - `electron/resources/entitlements.mac.plist` includes `com.apple.security.device.audio-input`, which is required at runtime under Hardened Runtime for notarized builds.

### Chat Push-to-Talk (raw)

In addition to the global push-to-talk shortcut (which runs the full pipeline: cleanup → review modal → pipeline actions), the chat input has its own click-to-toggle dictation flow that bypasses cleanup and review entirely and inserts the raw transcribed text straight into the chat input.

- **API** (`src/services/dictationService.ts`):
  - `startPushToTalk(onComplete)` — sets a one-shot raw handler and calls `startRecording()`.
  - `stopPushToTalk()` — alias for `stopRecording()` to make caller intent explicit.
  - When a raw handler is set, `emit()` delivers the result *only* to that handler and does **not** broadcast to the `onTranscriptionComplete` listeners that `App.vue` uses for cleanup + review. The handler is cleared after one delivery (or on cancel/failure).
- **UI** — unified primary-action button in `src/components/ChatSidebar.vue`:
  - A single trailing button in `.input-container` replaces the previous separate mic + send buttons, giving the rich input full horizontal width.
  - The button's icon, color, click handler, and `disabled` state are driven by `primaryActionMode` (`'mic' | 'stop' | 'send'`):
    | Mode | When | Icon | Click |
    |------|------|------|-------|
    | `mic` | Idle, input is empty | `micOutline` | `startChatDictation()` |
    | `stop` | Currently dictating | `stop` (filled square, red + pulse) | `stopChatDictation()` |
    | `send` | Idle, input has content | `sendOutline` | `sendMessage()` |
  - `mic` is disabled when `micPermissionState` is `'denied'`/`'restricted'` (greyed out, tooltip points the user at System Settings → Privacy & Security → Microphone) or when another caller is already dictating. `send` is disabled while `isTyping`. `stop` is never disabled.
  - On stop, the transcription is appended to the existing `inputMessage` (with a leading space when needed) via `appendDictatedText()`, mirroring the rich-input update pattern used by `insertSelection`.
  - Send is intentionally hidden while dictation is active to prevent accidentally firing off a half-baked message; the user must click stop first.

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
| `.github/workflows/build-macos.yml` | `macos-14` (ARM64) | `.dmg` + `.zip` | Metal |
| `.github/workflows/build-linux.yml` | `ubuntu-latest` | `.AppImage` | Vulkan |

The macOS workflow uses `macos-14` (Apple Silicon) so `npm ci` installs `@node-llama-cpp/mac-arm64-metal` with Metal GPU support.

macOS releases publish both a `.dmg` and a `.zip`: the DMG is the manual installer linked from the landing page, while the ZIP is required by `electron-updater` for native in-app auto-updates via `latest-mac.yml`.

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

**Adding screenshots:** Add PNGs under `landing/` and append a slide to the screenshot carousel in `landing/index.html` (same pattern as `screenshot-workspace.png`, `screenshot-dictation.png`, etc.).

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

### Startup WAL Recovery

The DuckDB instance lives in OPFS as `hydranote.duckdb` (data) + `hydranote.duckdb.wal` (write-ahead log). After an unclean shutdown (page closed mid-write, OS sleep killed the worker, crashed migration) the orphan WAL can fail to replay because it references a catalog the data file no longer has. DuckDB surfaces this as a `Binder` exception with the phrase `Failure while replaying WAL`.

`doInitializeDatabase` detects this exact error (`isWalReplayError`) and runs a three-step recovery cycle:

1. **Tear down the failed worker** (`teardownFailedConnection`) — closes the connection if any, calls `db.terminate()`, nulls module state, revokes the worker blob URL. This is critical: until the worker dies it still holds the OPFS access handle on the WAL, which would make step 2 throw `NoModificationAllowedError`.
2. **Clear the WAL sidecar files** (`clearOrphanWal`) — removes `hydranote.duckdb.wal` and (defensively) `hydranote.duckdb.wal-shm` from the OPFS root via `navigator.storage.getDirectory().removeEntry`. Missing entries and lock errors are tolerated; the function returns `true` if any entry was removed.
3. **Spin up a brand new connection** (`openFreshConnection`) — creates a fresh worker, fresh `AsyncDuckDB`, fresh `db.open()` against the now WAL-less data file.

If the second `openFreshConnection` also fails the error propagates unchanged to the normal init error path. Every other init failure (network, wasm load, schema migration) also propagates unchanged — only the WAL-replay signature triggers recovery.

| File / symbol | Role |
|---|---|
| `isWalReplayError(err)` | Exported matcher for the canonical `Failure while replaying WAL` and Binder-on-`.wal` error shapes |
| `clearOrphanWal()` | Exported best-effort OPFS sidecar deletion (returns `true` iff at least one entry was removed) |
| `teardownFailedConnection(workerUrl)` | Internal cleanup: close connection, terminate worker, revoke blob URL |
| `openFreshConnection()` | Internal: build worker + `AsyncDuckDB`, instantiate, open, connect. Reused for both the initial attempt and the post-recovery retry |

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
