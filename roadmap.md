# DocuSage – Full Roadmap (AI Pipeline & Tools)

## Overview
DocuSage is an AI‑powered document indexing and interaction system.  
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
- [ ] Implement router logic:
  - “Read”, “open”, “show”, “explain file”, “mostre o arquivo”, etc.  
- [ ] Tool behavior:
  - Input: `file_id`
  - Output: file text (or chunked + stitched)
  - [ ] Automatically perform OCR if needed.
  - [ ] Handle extremely large files via progressive reading.

---

# Phase 4 — Tool: **search**
### Purpose  
Perform **semantic search** across *all project files* based on similarity.

### Technique  
- Convert user query into embedding.
- Run vector similarity search.
- Return the top‑K most relevant chunks.
- LLM then uses chunks to answer.

### Tasks
- [ ] Router keywords:
  - “Buscar”, “search”, “encontrar”, “procure”, “o que diz sobre…”
- [ ] Implement vector search API
- [ ] Return ranked results with source file references

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
- [ ] Router triggers: “resuma”, “summary”, “tl;dr”
- [ ] Support hierarchical summarization
- [ ] Ignore images; focus on text

---

# Phase 6 — Tool: **write**
### Purpose  
Allow the user to create **new documents** (PDF or DOCX) using LLM-generated content.

### Technique  
- LLM writes structured text based on user request + project context.
- Backend converts:
  - To PDF (reportlab)
  - To DOCX (python-docx)

### Tasks
- [ ] Router triggers: “crie um documento”, “escreva”, “gerar pdf”, “write a report”, etc.
- [ ] Inputs:
  - `format`: pdf | docx
  - `title`
  - `content`
- [ ] Generate file and store it in the project.
- [ ] Return downloadable link to user.

---

# Phase 7 — Router Design
### Goal  
Ensure LLM calls the right tool depending on user intent.

### Tasks
- [ ] Provide natural‑language instructions inside the system prompt:
  - When user wants to read → use **read**
  - When user wants to search broadly → use **search**
  - When user wants a summary → use **summarize**
  - When user wants to generate content → use **write**
- [ ] Add examples in the system prompt
- [ ] Add fallback logic (if unsure → ask user)

---

# Phase 8 — Future Enhancements (Optional)
- [ ] Tool: “extract tables”
- [ ] Tool: “extract entities”
- [ ] Tool: “translate”
- [ ] Offline mode using smaller local LLMs
- [ ] Document diffing tool
- [ ] Automatic document classification

---

# End of Roadmap
This roadmap is designed for execution by an LLM inside your Ionic app.  
Each phase and item should be marked as done when completed.
