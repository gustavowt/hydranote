# Editor Live Auto-Save Design

**Date:** 2026-07-10  
**Status:** Approved for implementation planning  
**Scope:** Markdown editor (`.md` / `.txt`) and Rich Text / DOCX editor

## Goal

After the user stops typing for **10 seconds**, if an **existing** open file has unsaved changes, automatically persist those changes without creating a version-history entry. Show light inline status feedback (“Saving…” / “Saved”).

## Non-goals

- Auto-creating or auto-routing **new unsaved notes** (they keep the existing Save / manual / hybrid flow).
- Creating version-history entries on auto-save (manual Save / restore / format still create versions).
- Success toasts on every auto-save.
- Changing the 10s idle delay into a user setting (fixed for v1).

## Decisions

| Topic | Choice |
| --- | --- |
| Version history | Auto-save updates file only; no version |
| File scope | Existing files only (`currentFile` present) |
| Editors | MarkdownEditor **and** RichTextEditor |
| UI feedback | Inline “Saving…” / “Saved” near filename |
| Architecture | Shared `useIdleAutoSave` composable + `updateFile` option to skip versions |

## Trigger rules

1. Watch editor content. Any change resets a **10s** idle timer.
2. When the timer fires, auto-save only if:
   - `currentFile` exists
   - content differs from last saved baseline (`hasChanges`)
   - no save already in flight
   - not viewing an old version (markdown version navigation)
3. Switching files or unmounting **cancels** the pending timer (never save into the wrong file).
4. Manual Save cancels any pending auto-save timer, then runs the existing version-creating path (and existing toast behavior).

## Persistence & wiring

### `updateFile` API

Extend `projectService.updateFile` with an options argument, e.g.:

```ts
updateFile(fileId: string, content: string, options?: { createVersion?: boolean })
```

- Default: `createVersion: true` (preserves all existing callers).
- Auto-save calls with `createVersion: false`.
- When `createVersion` is false, skip `createUpdateVersion` only.
- Still perform: DB content update, filesystem sync, reindex (same as today).

### Composable: `useIdleAutoSave`

Location: `src/composables/useIdleAutoSave.ts` (or equivalent existing composables folder).

Responsibilities:

- Configurable idle delay (default **10_000** ms)
- Reset timer on content change
- Dirty / file-present / in-flight / viewing-old-version gates
- Status: `idle` | `saving` | `saved` | `error`
- Cancel on file id change or dispose
- Invoke a caller-provided `save(content)` async function

Editors own how they obtain content and how they wire `save` (emit to parent).

### Workspace wiring

- Editors emit a dedicated autosave path (preferred: `autosave` event, or `save` with a flag).
- `WorkspacePage` handlers call `updateFile(..., { createVersion: false })`.
- **No** success toast for auto-save.
- On failure: editors show inline error status; optional danger toast is acceptable but not required if inline status is clear.
- After successful auto-save, update local `currentFile` / baseline the same way as manual save, without sidebar “reveal” churn if avoidable (reveal on manual save can stay as today).

## Status UI

In both `MarkdownEditor` and `RichTextEditor`, near the filename (same area as the unsaved `•`):

| State | UI |
| --- | --- |
| Saving in flight | “Saving…” |
| Success | “Saved” for ~2s, then clear |
| Failure | Short “Save failed” (or similar); keep unsaved `•` so manual Save remains available |

Manual Save button visibility/behavior unchanged (`hasChanges`).

## Edge cases

### Concurrent edits during save

If the user types while a save is in flight:

1. Do not block editing.
2. When the in-flight save completes, set the saved baseline (`originalContent`) **only** to the content that was actually persisted.
3. If current content still differs, restart the 10s idle timer.

### Stale responses

Before applying auto-save success/failure to local editor state, verify the response still matches the open `fileId`. Ignore late results after a file switch.

### Version viewing (markdown)

While `isViewingOldVersion` (or equivalent), do not schedule or fire auto-save. Restoring remains an explicit manual action.

## Testing

1. **Composable unit tests**
   - Timer resets on each content change
   - Does not save when not dirty
   - Does not save without `currentFile`
   - Cancels on file change / dispose
   - Status transitions: idle → saving → saved / error
   - After save of content A, if content is B, timer restarts

2. **`updateFile` coverage**
   - `{ createVersion: false }` skips `createUpdateVersion`
   - Default / `{ createVersion: true }` still creates a version

## Files likely touched

- `src/services/projectService.ts` — `updateFile` options
- `src/composables/useIdleAutoSave.ts` — new
- `src/components/MarkdownEditor.vue` — wire composable + status UI
- `src/components/RichTextEditor.vue` — wire composable + status UI
- `src/views/WorkspacePage.vue` — autosave handlers (no success toast)
- Unit tests for composable and `updateFile` version skip
- `docs/DEVELOPER.md` — document auto-save behavior when implementing

## Out of scope follow-ups (optional later)

- User-configurable idle delay
- Auto-save for new notes after first successful create
- Debounced reindex throttling if auto-save frequency becomes costly
