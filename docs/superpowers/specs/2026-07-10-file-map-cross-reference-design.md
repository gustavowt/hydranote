# File Map Cross-Reference Design

**Date:** 2026-07-10  
**Status:** Approved for implementation  
**Scope:** Cross-file link index, File Map workspace overlay, editor wikilink usability, chat-aware linking

## Goal

Build a **project knowledge graph** of file-to-file references so users can open a dedicated **File Map** view (Timeline-style workspace overlay) and see how notes connect via a force-directed graph. Standardize in-note linking on `[[path]]`, index additional link forms found in content, and teach chat to insert real wikilinks when writing notes (only for known files).

## Non-goals (v1)

- Semantic / embedding-based “related” edges
- Orphan (unlinked) nodes on the map
- Broken-link nodes on the map (unresolved edges may be stored, not rendered as nodes)
- Dedicated editor backlinks sidebar
- New chat tool for “list backlinks” (prompt-only awareness in v1)
- New router path (no `/file-map` route)
- Fixing Live TipTap round-trip preservation of wikilinks beyond clickable behavior in preview/edit where already feasible

## Decisions

| Topic | Choice |
| --- | --- |
| Primary job | Orient in a project-wide knowledge graph |
| Link sources indexed | `[[wikilink]]`, relative markdown links, `@file:` in note bodies |
| Canonical authoring | `[[project-relative/path]]`; cross-project `[[ProjectName/path]]` |
| Chat mentions | Keep `@file:` for chat; use `[[…]]` when writing note content |
| Chat proactivity | Insert links only for known/strong path matches; never invent |
| Graph scope | Current project by default; toggle to all projects |
| Visualization | Force-directed graph (e.g. `d3-force` + SVG/canvas) |
| Nodes | Only files with ≥1 resolved link (in or out) |
| Access | Workspace header toggle → center-panel overlay (mirror Timeline) |
| Persistence | Indexed `note_links` table + reindex on save (Approach 1) |

## Architecture

Mirror Timeline’s indexed overlay pattern:

```
Editor / Chat-written notes
  → linkDetectionService (parse)
  → note_links (DuckDB)
  → linkIndexService (query, events, backfill)
  → FileMapView (force graph)
WorkspacePage header → showFileMap (mutually exclusive with showTimeline)
```

### Key files (planned)

| Layer | Path | Role |
| --- | --- | --- |
| Overlay shell | `src/views/WorkspacePage.vue` | `showFileMap`, header button, `v-if` before editors |
| UI | `src/components/FileMapView.vue` | Force graph, project/all toggle, empty/loading |
| Detect | `src/services/linkDetectionService.ts` | Extract link candidates from content |
| Index | `src/services/linkIndexService.ts` | Reindex, query graph, events, lazy backfill |
| DB | `src/services/database.ts` | `note_links` schema + CRUD |
| Lifecycle | `src/services/projectService.ts` | Hooks beside date reindex |
| Graph pure logic | `src/composables/buildFileLinkGraph.ts` (or similar) | Nodes/edges from resolved links |
| Chat | `src/services/toolService.ts` `PLANNER_PROMPT` | Wikilink rules when writing notes |
| Editor | `src/components/MarkdownEditor.vue` (+ live if needed) | Clickable `[[…]]` open-file |

## Data model

### Table `note_links`

| Column | Purpose |
| --- | --- |
| `id` | Primary key |
| `source_file_id` | Source file |
| `source_project_id` | Source project |
| `source_file_name` | Denormalized path for display |
| `target_raw` | Exact link text as authored |
| `target_file_id` | Resolved target (nullable if broken) |
| `target_project_id` | Resolved target project (nullable) |
| `target_file_name` | Resolved path or raw fallback |
| `link_type` | `wikilink` \| `markdown` \| `at_file` |
| `context_snippet` | Short surrounding text |
| `start_index` | Offset in source content |

### Detection rules

Scan `.md` / `.txt` content for:

1. Wikilinks: `\[\[([^\]]+)\]\]`
2. Markdown links whose href is a **relative file path** (exclude `http(s):`, `mailto:`, `#` anchors-only, and other non-file schemes)
3. `@file:([^\s]+)` appearing in note body text

### Resolution

Reuse `findFileByPath` / `findFileGlobal` from `projectService`. Persist unresolved rows with null `target_file_id`. **Map rendering** includes only edges where both source and target resolve; nodes are the unique set of those file ids.

### Events & backfill

- `onNoteLinksChanged` (mirror `onNoteDatesChanged`)
- `ensureNoteLinksBackfill()` on first File Map open
- Reindex failures log and must not block file save

## File Map UI

### Shell

- Props: `projectId?: string | null`
- Emits: `close`, `open-file(fileId, projectId)`
- Header: title, **This project** / **All projects** toggle, close
- Opening File Map closes Timeline and vice versa

### Interactions

- Pan / zoom canvas
- Hover node → filename tooltip (include project name in all-projects mode)
- Click node → close map and open file
- Drag nodes; simulation may cool after interaction
- Empty state when no resolved edges: explain `[[path]]` and that chat can add known-file links
- Brief loading state during first backfill if needed

### Visual encoding (v1)

- Node = file; size by degree (in + out)
- Directed edges (source → target)
- No orphan nodes; no broken-link nodes

## Editor & chat

### Editor

- Keep existing `[[…]]` autocomplete as the primary insert path
- Make wikilinks clickable in preview (and live where practical) to open the resolved file
- Markdown relative links and `@file:` in bodies remain indexed but are not the preferred authoring UX

### Chat

- Extend `PLANNER_PROMPT`: when writing or updating note content that names another **known** file, insert `[[path]]` (project-relative; `ProjectName/path` when cross-project)
- Keep `@file:` for chat mentions and tool targeting
- Never invent paths — only link if the file is in the provided inventory or resolves via lookup
- No new backlinks tool in v1

## Lifecycle

Hook alongside date indexing in `projectService`:

| Event | Behavior |
| --- | --- |
| create/update md\|txt | Replace outgoing `note_links` for that file |
| delete file | Delete all rows where the file is source or target |
| rename/move | Re-resolve affected source paths and targets that pointed at the old path |

## Testing

| Area | Coverage |
| --- | --- |
| `linkDetectionService` | Wikilink / markdown / `@file:` extraction; ignore external URLs |
| Resolution | Match, miss, cross-project prefix |
| Graph builder | Only resolved pairs → nodes/edges; degree inputs |
| Planner prompt | Fixture/assert instructions for `[[…]]` + no inventing |

## Acceptance criteria (v1)

1. Saving a note containing `[[other.md]]` (resolved) shows both files linked on the File Map.
2. Header opens File Map overlay; clicking a node opens that file and closes the map.
3. Project vs all-projects toggle filters the graph correctly.
4. Chat-driven note updates may insert `[[path]]` for known files; unknown names remain plain text.
5. Relative markdown links and `@file:` strings inside note bodies contribute edges when resolvable.
6. First open backfills existing notes without blocking ordinary editing.

## Open follow-ups (post-v1)

- Broken-links panel / count
- Orphan toggle
- Editor backlinks panel
- Chat tool: list backlinks / neighborhood
- Live-mode full wikilink round-trip preservation
