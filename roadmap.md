# HydraNote – Full Roadmap (AI Pipeline & Tools)

## Overview

HydraNote is an AI‑powered document indexing and interaction system.  
The LLM will execute this roadmap step‑by‑step inside the Ionic app environment.

The system provides:

- Project creation
- Document ingestion + embedding indexing
- Chat with project context
- Tools the LLM can call: **read**, **search**, **summarize**, **write**

Each phase contains clear tasks for the LLM to mark as done.

---

# Phase 1 — Core AI Pipeline Setup

### Goal: Prepare internal structures so the LLM can work with project files.

### Tasks

- [x] Define the schema for stored embeddings.
- [x] Implement ingestion of project documents:
  - [x] Extract text from supported file types (pdf, txt, docx, md, images via OCR).
  - [x] Chunk documents into segments.
  - [x] Generate embeddings for each segment.
  - [x] Store: `{project_id, file_id, chunk_id, text, embedding_vector}`.
- [x] Store metadata for each project and file.
- [x] Connect the LLM runtime to the indexed embedding data.
- [x] Provide helper functions:
  - [x] `get_project_files(project_id)`
  - [x] `get_file_chunks(file_id)`
  - [x] `get_embeddings(project_id)`
  - [x] `vector_search(project_id, query_embedding, k=5)`

---

# Phase 2 — Chat Initialization With Project Context

### Goal: After a project is indexed, open a chat with access to embeddings.

### Tasks

- [x] Create system prompt for the project chat:
  - Include project metadata
  - Explain available tools
  - Provide constraints (simple language, avoid restricted vocabulary, etc.)
- [x] Chat should automatically load embeddings belonging to the project.
- [x] Provide context window manager to avoid exceeding context length.

---

# Phase 3 — Tool: **read**

### Purpose

Let the LLM read a **specific file** when the user explicitly asks for it.

### Technique

- Retrieve file chunks.
- Optionally summarize if file is too large.
- Return structured text back to the LLM.

### Tasks

- [x] Implement router logic:
  - "Read", "open", "show", "explain file", "mostre o arquivo", etc.
- [x] Tool behavior:
  - Input: `file_id`
  - Output: file text (or chunked + stitched)
  - [x] Automatically perform OCR if needed.
  - [x] Handle extremely large files via progressive reading.

---

# Phase 4 — Tool: **search**

### Purpose

Perform **semantic search** across _all project files_ based on similarity.

### Technique

- Convert user query into embedding.
- Run vector similarity search.
- Return the top‑K most relevant chunks.
- LLM then uses chunks to answer.

### Tasks

- [x] Router keywords:
  - "Buscar", "search", "encontrar", "procure", "o que diz sobre…"
- [x] Implement vector search API
- [x] Return ranked results with source file references

---

# Phase 5 — Tool: **summarize**

### Purpose

Create concise summaries of large documents.

### Technique

- If file < model context → summarize directly.
- If too large:
  - Summarize chunks
  - Merge chunk summaries
  - Produce final abstraction

### Tasks

- [x] Router triggers: "resuma", "summary", "tl;dr"
- [x] Support hierarchical summarization
- [x] Ignore images; focus on text

---

# Phase 6 — Tool: **write**

### Purpose

Allow the user to create **new documents** (PDF or DOCX) using LLM-generated content.

### Technique

- LLM writes structured text based on user request + project context.
- Frontend converts using JavaScript libraries:
  - To PDF (jsPDF)
  - To DOCX (docx library)

### Tasks

- [x] Router triggers: "crie um documento", "escreva", "gerar pdf", "write a report", etc.
- [x] Inputs:
  - `format`: pdf | docx
  - `title`
  - `content`
- [x] Generate file and store it in the project.
- [x] Return downloadable link to user.

---

# Phase 7 — Router Design

### Goal

Ensure LLM calls the right tool depending on user intent.

### Tasks

- [x] Provide natural‑language instructions inside the system prompt:
  - When user wants to read → use **read**
  - When user wants to search broadly → use **search**
  - When user wants a summary → use **summarize**
  - When user wants to generate content → use **write**
- [x] Add examples in the system prompt
- [x] Add fallback logic (if unsure → ask user)

## Phase 8 – First‑class Markdown support

Goal: allow HydraNote to **create, store, render, and edit Markdown files** consistently across tools and UI.

### 8.1 – Backend & tools

- [x] **Standardize Markdown file type**
  - [x] Define a canonical file type for Markdown notes, e.g.:
    - `extension: ".md"`
    - `mime_type: "text/markdown"`
  - [x] Make this type reusable by any tool that writes files (especially `WriteFile` and `AddNote`).

- [x] **Extend `WriteFile` tool to accept file type**
  - [x] Add a parameter like `file_type` or `content_type` (string enum, e.g. `"markdown"`, `"pdf"`, `"docx"`, etc.).
  - [x] Ensure that when `file_type = "markdown"`:
    - [x] The file extension is `.md` (unless explicitly overridden by the caller).
    - [x] The encoding is UTF‑8.
    - [x] Line breaks are preserved as‑is (no extra transformations).
  - [x] Update tool documentation so the LLM knows how to request Markdown files properly.

- [x] **Add Markdown awareness to any indexing pipeline**
  - [x] Ensure Markdown files are correctly ingested and chunked when a project is indexed.
  - [x] Treat Markdown headings (`#`, `##`, etc.) as potential chunk boundaries if that is supported / makes sense.
  - [x] Confirm that Markdown content is searchable via the existing embeddings/search pipeline.

### 8.2 – Frontend rendering

- [x] **Project chat & message view**
  - [x] Enable Markdown rendering for:
    - [x] AI responses that include Markdown.
    - [x] User messages marked as Markdown.
  - [x] Support at least:
    - [x] Headings
    - [x] Bold/italic
    - [x] Lists
    - [x] Code blocks (with syntax highlighting)
    - [x] Links
    - [x] Blockquotes

- [x] **Note viewer/editor integration**
  - [x] Ensure that when opening a `.md` note from a project:
    - [x] The content is rendered as Markdown in "view" mode.
    - [x] The user can switch to "edit" mode to edit raw Markdown text.
  - [x] Confirm that saving changes keeps the `.md` extension and does not break indexing.

---

## Phase 9 – `AddNote` tool (per‑project pipeline)

Goal: create a **dedicated IA pipeline** for adding notes to a specific project, always resulting in a Markdown file written via `WriteFile`.

### 9.1 – Settings & user instructions

- [x] **Settings model for note formatting**
  - [x] Add a configuration entry (per user, or per project) for note formatting, e.g.:
    - [x] `note_format_instructions: string`
  - [x] This string will be appended/injected into the system prompt when formatting notes.

- [x] **LLM contract: note formatting**
  - [x] Define a prompt template for a "FormatNote" step:
    - [x] Inputs: raw note text, user `note_format_instructions`, optional metadata (language, audience, etc.).
    - [x] Output: a single, coherent Markdown note string.
  - [x] Document for the LLM:
    - [x] Always answer with **only** the formatted Markdown, no explanations.
    - [x] Follow the instructions as strictly as possible.

### 9.2 – `AddNote` tool API design

- [x] Define a new tool: **`AddNote`**
  - [x] Inputs (example):
    - [x] `project_id` (required)
    - [x] `raw_note_text` (required)
    - [x] `context_metadata` (optional: tags, topic, source, etc.)
  - [x] Output:
    - [x] Final file path (e.g. `notes/2025/add-note-title.md`)
    - [x] Any metadata relevant to the UI (title, directory, created_at).

### 9.3 – `AddNote` pipeline steps

- [x] **Step 1 – Format note (Markdown)**
  - [x] Call the "FormatNote" prompt using `raw_note_text` + `note_format_instructions`.
  - [x] Receive `formatted_markdown_note` as output.

- [x] **Step 2 – Generate file name**
  - [x] Ask an LLM (or deterministic code) to:
    - [x] Generate a short, human‑readable title for the note.
    - [x] Convert the title into a slug for the filename.
  - [x] Construct something like: `YYYY/MM/<slug>.md` or `notes/<slug>.md` according to project conventions.
  - [x] Ensure uniqueness (e.g. add a numeric suffix or timestamp if needed).

- [x] **Step 3 – Decide directory / path**
  - [x] Define a second prompt "DecideNoteDirectory":
    - [x] Inputs:
      - [x] Project's current directory tree (summarized if large).
      - [x] Candidate file title + context (tags, topic, etc.).
    - [x] Behavior:
      - [x] **Strongly prefer an existing directory**.
      - [x] Only propose creating a new directory for clearly new categories or when explicitly instructed.
    - [x] Output:
      - [x] `target_directory_path` (e.g. `notes/meetings/2025/`)
      - [x] `should_create_directory: boolean` (true only in special cases).
  - [x] Implement the logic that:
    - [x] If `should_create_directory == true`, create the directory in the project.
    - [x] Otherwise, reuse the existing directory.

- [x] **Step 4 – Persist note via `WriteFile`**
  - [x] Call the updated `WriteFile` tool with:
    - [x] `project_id`
    - [x] `file_path = target_directory_path + filename`
    - [x] `content = formatted_markdown_note`
    - [x] `file_type = "markdown"`
  - [x] Return final information to the caller (path, title, created_at, etc.).

- [x] **Step 5 – Indexing hook**
  - [x] After the file is written, enqueue/index it in the project's embeddings/indexing pipeline so it becomes searchable.

---

## Phase 10 – Dashboard “Add Note” entry point + project router

Goal: allow the user to add a note **from the main dashboard**, with an IA deciding which project the note belongs to (or if a new project should be created), and then reuse the `AddNote` pipeline.

### 10.1 – UI: Dashboard button & editor

- [ ] **Dashboard button**
  - [ ] Add a prominent `Add Note` button to the main dashboard.
  - [ ] Label and icon should clearly indicate “quick note creation”.

- [ ] **Markdown editor modal/page**
  - [ ] When the user clicks `Add Note`:
    - [ ] Open a full‑screen or modal editor inspired by Obsidian:
      - [ ] Raw Markdown editing area.
      - [ ] Optional preview mode or split view (optional for v1).
    - [ ] Provide fields or inline controls for:
      - [ ] Note content (required).
      - [ ] Optional tags or quick metadata.

  - [ ] On “Save note”:
    - [ ] Trigger the **global Add‑Note pipeline** described below.

### 10.2 – Global project router (pre‑AddNote step)

- [ ] **Define router prompt: `DecideTargetProjectForNote`**
  - [ ] Inputs:
    - [ ] Note content (as typed by the user).
    - [ ] List of existing projects with:
      - [ ] `project_id`
      - [ ] `name`
      - [ ] Short description / tags.
    - [ ] Optional: user preferences (e.g. “default project for notes”).
  - [ ] Behavior:
    - [ ] Choose the **most appropriate existing project** whenever possible.
    - [ ] Only choose “create new project” when clearly justified (e.g. note is about a completely new domain).
  - [ ] Output:
    - [ ] `target_project_id` **or**
    - [ ] A structure like `{ action: "create_project", proposed_name, proposed_description }`.

- [ ] **Implement router step**
  - [ ] Call the router prompt when the user saves the note from the dashboard editor.
  - [ ] If the router suggests an existing project:
    - [ ] Call the per‑project `AddNote` tool for that project.
  - [ ] If the router suggests creating a project:
    - [ ] Use the existing “CreateProject” tool/flow with the suggested name/description.
    - [ ] After creation, call `AddNote` for the new project.

### 10.3 – UX feedback

- [ ] After the pipeline finishes:
  - [ ] Show a confirmation/toast with:
    - [ ] The project where the note was created.
    - [ ] The final note title.
  - [ ] Offer a quick link to:
    - [ ] “Open note in project”.
    - [ ] “Go to project chat with this note as context”.

---

## Phase 11 – Project sidebar file tree + `@` references in chat/editor

Goal: improve navigation and **make it easy to reference project files** while chatting or editing notes.

### 11.1 – Sidebar file tree (per project)

- [ ] **Backend: project file listing**
  - [ ] Expose an API to retrieve the full file tree for a project:
    - [ ] Directory structure.
    - [ ] File paths, names, and types.
  - [ ] Support pagination/lazy‑loading for large trees if necessary.

- [ ] **Frontend: tree UI**
  - [ ] In the project view, add a **left sidebar** showing:
    - [ ] Collapsible directories (like VS Code).
    - [ ] Files as leaf nodes, with icons by type (`.md`, `.pdf`, etc.).
  - [ ] When the user clicks a file:
    - [ ] Open the file in a viewer/editor panel (depending on type).
    - [ ] Optionally highlight the selected file in the tree.

### 11.2 – `@`‑based file reference autocomplete

- [ ] **Reference syntax definition**
  - [ ] Decide a canonical syntax to represent file references in text, for example:
    - [ ] `@file:path/to/file.md`
    - [ ] or `@file:display-name` (mapped internally to path).
  - [ ] Ensure the LLM router understands this syntax and can map it to the correct file/tool.

- [ ] **Chat/editor behavior**
  - [ ] While the user types in the project chat or note editor:
    - [ ] When the user types `@`, start an autocomplete for project files.
    - [ ] Allow searching by file name and maybe by directory.
  - [ ] When the user selects a file from the autocomplete:
    - [ ] Insert the chosen reference token into the text.

- [ ] **LLM integration**
  - [ ] Update the router/system prompt so that:
    - [ ] When it detects `@file:...` references, it:
      - [ ] Resolves them to actual project file paths.
      - [ ] Uses the appropriate tool(s) (`ReadFile`, `Search`, etc.) to fetch content.
    - [ ] The LLM includes referenced file content or summaries in its responses where appropriate.

### 11.3 – Optional enhancements

- [ ] Hover preview:
  - [ ] When hovering over a file in the tree or over an `@file` reference, show a small preview (first lines or a short summary).

- [ ] Recent / pinned files:
  - [ ] Add a section in the sidebar for “Recent files” or “Pinned files” to speed up navigation.

---

## Phase 12 – Polish & guardrails for the new flows

Goal: refine the IA behavior and UX around the new note and project routing features.

- [ ] **Guardrails for directory creation**
  - [ ] Add explicit instructions to directory‑deciding prompts to:
    - [ ] Avoid creating too many directories.
    - [ ] Reuse existing categories whenever possible.
  - [ ] Log cases where new directories are created to audit later.

- [ ] **Guardrails for project creation**
  - [ ] Add clear rules when the IA is allowed to create new projects from dashboard notes.
  - [ ] Optionally add a confirmation step:
    - [ ] “The AI suggests creating a new project ‘X’. Confirm?”

- [ ] **Telemetry & metrics**
  - [ ] Track how often:
    - [ ] Notes are created from the dashboard vs. inside a project.
    - [ ] New projects are created automatically vs. user-initiated.
    - [ ] New directories are created by the IA.
  - [ ] Use this data to tweak prompts and defaults.

- [ ] **Documentation**
  - [ ] Update developer documentation for:
    - [ ] `WriteFile` changes.
    - [ ] `AddNote` tool interface.
    - [ ] Global project router behavior.
    - [ ] Sidebar and `@file` reference semantics.
  - [ ] Update any in‑app help/onboarding related to notes and Markdown support.

# End of Roadmap

This roadmap is designed for execution by an LLM inside your Ionic app.  
Each phase and item should be marked as done when completed.
