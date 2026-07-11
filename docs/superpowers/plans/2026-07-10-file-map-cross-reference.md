# File Map Cross-Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Index file-to-file references (`[[wikilink]]`, relative markdown links, `@file:` in note bodies), expose a Timeline-style force-directed File Map overlay, make wikilinks clickable in preview, and teach the chat planner to insert known-file `[[path]]` when writing notes.

**Architecture:** Mirror Timeline: detect links on save → persist `note_links` in DuckDB → `linkIndexService` queries/events/backfill → `FileMapView` renders a force graph. Workspace header toggles the overlay. Chat awareness is prompt-only in v1.

**Tech Stack:** Vue 3 + Ionic, DuckDB WASM, `d3-force` for layout, Vitest.

---

## File map

| File | Responsibility |
|------|----------------|
| `src/services/linkDetectionService.ts` | Pure parse of link candidates from content |
| `src/services/linkIndexService.ts` | Resolve → persist → query → events → backfill |
| `src/services/database.ts` | `note_links` table + CRUD |
| `src/services/projectService.ts` | Lifecycle hooks beside date index |
| `src/composables/buildFileLinkGraph.ts` | Pure nodes/edges from resolved links |
| `src/components/FileMapView.vue` | Force-directed overlay UI |
| `src/views/WorkspacePage.vue` | Header toggle, mutual exclusion with Timeline |
| `src/components/MarkdownEditor.vue` | Clickable `[[…]]` in preview |
| `src/services/toolService.ts` | Planner wikilink rules |
| `src/services/index.ts` | Re-exports |
| `tests/unit/linkDetectionService.spec.ts` | Detection tests |
| `tests/unit/buildFileLinkGraph.spec.ts` | Graph builder tests |
| `tests/unit/fileMapPlannerPrompt.spec.ts` | Prompt contract |

---

### Task 1: Link detection (pure)

**Files:**
- Create: `src/services/linkDetectionService.ts`
- Test: `tests/unit/linkDetectionService.spec.ts`

- [ ] Extract `DetectedLink` with `raw`, `type` (`wikilink` \| `markdown` \| `at_file`), `startIndex`, `context`
- [ ] Match `[[…]]`, relative md hrefs (skip http/mailto/#), `@file:…`
- [ ] Unit tests for extract / ignore external URLs

### Task 2: Graph builder (pure)

**Files:**
- Create: `src/composables/buildFileLinkGraph.ts`
- Test: `tests/unit/buildFileLinkGraph.spec.ts`

- [ ] Input: resolved link rows (`sourceFileId`, `targetFileId` non-null, names, project ids)
- [ ] Output: unique nodes (degree = in+out) + directed edges
- [ ] Drop unresolved; optional `projectId` filter

### Task 3: DB + index service + lifecycle

**Files:**
- Modify: `src/services/database.ts` (schema after `note_dates`, CRUD)
- Create: `src/services/linkIndexService.ts`
- Modify: `src/services/projectService.ts` (create/update/delete/rename/move)
- Modify: `src/services/index.ts`

- [ ] Table `note_links` per design spec
- [ ] `reindexFileLinks`, `clearFileLinks`, sync name/project, `queryNoteLinks`, `ensureNoteLinksBackfill`, `onNoteLinksChanged`
- [ ] Resolve via `findFileByPath` / `findFileGlobal`
- [ ] Hooks mirror date index; delete removes rows where file is source or target

### Task 4: FileMapView + WorkspacePage

**Files:**
- Create: `src/components/FileMapView.vue`
- Modify: `src/views/WorkspacePage.vue`
- Dependency: `d3-force`

- [ ] Header button; `showFileMap` mutually exclusive with `showTimeline`
- [ ] Force graph: pan/zoom, hover, click → `open-file`, project/all toggle, empty/loading states

### Task 5: Editor clickable wikilinks + chat prompt

**Files:**
- Modify: `src/components/MarkdownEditor.vue`
- Modify: `src/views/WorkspacePage.vue` (handle open-wikilink)
- Modify: `src/services/toolService.ts`
- Test: `tests/unit/fileMapPlannerPrompt.spec.ts`

- [ ] Inject `.wikilink` spans in preview; click resolves and emits open
- [ ] Export `FILE_MAP_WIKILINK_PLANNER_RULES` concatenated into `PLANNER_PROMPT`; assert known-path / never-invent rules

### Task 6: Verify

- [ ] `yarn test:unit` for new specs
- [ ] `yarn lint` on touched files (or project lint)

---

## Spec coverage

| Spec requirement | Task |
|------------------|------|
| Index wikilink / md / @file | 1, 3 |
| note_links + backfill + events | 3 |
| Force map overlay + project toggle | 4 |
| Linked-only nodes | 2, 4 |
| Clickable `[[…]]` | 5 |
| Chat known-file wikilinks | 5 |
| Lifecycle create/update/delete/rename/move | 3 |

## Acceptance

1. Save `[[other.md]]` → edge on map  
2. Header opens map; click node opens file  
3. Project / all-projects toggle  
4. Chat may insert known `[[path]]`  
5. Relative md + `@file:` in bodies contribute edges  
6. First open backfills  
