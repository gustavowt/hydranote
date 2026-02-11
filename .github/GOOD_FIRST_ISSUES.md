# Good First Issues

Starter tasks for new contributors. These are scoped to be small, clear, and easy to review.

## UI and UX

1. Add keyboard shortcut to toggle chat sidebar visibility (`src/views/WorkspacePage.vue`).
2. Add keyboard shortcut to focus global search (`src/components/SearchAutocomplete.vue`).
3. Improve empty state copy for projects sidebar when there are no projects (`src/components/ProjectsTreeSidebar.vue`).
4. Add loading skeleton for file tree while project files are loading (`src/components/FileTreeSidebar.vue`).

## Editor

5. Add word and character count in markdown editor footer (`src/components/MarkdownEditor.vue`).
6. Add one-click "copy markdown" action in preview mode (`src/components/MarkdownEditor.vue`).
7. Improve code block toolbar accessibility labels (`src/components/MarkdownEditor.vue`).

## AI and Tools

8. Add user-friendly error text for invalid API key responses in provider setup (`src/components/settings/AIProviderSelector.vue`).
9. Add input validation for `webResearch` query length before execution (`src/services/toolService.ts`).
10. Add tests for planner JSON retry behavior (`src/services/toolService.ts` + `tests/`).

## Sync and Files

11. Add confirmation modal before deleting a project from sidebar (`src/components/ProjectsTreeSidebar.vue`).
12. Add conflict warning UI when file sync detects remote and local changes (`src/services/syncService.ts` + relevant components).

## Documentation and DX

13. Add architecture diagram image to README from existing ASCII flow.
14. Add "Troubleshooting" section for common startup issues in README.
15. Add a contributor script section (`npm run lint`, `npm run test:unit`) to `CONTRIBUTING.md`.

## Labels for Maintainers

When creating these as GitHub issues, label with:

- `good first issue`
- `help wanted`
- one domain label like `ui`, `docs`, `ai`, `sync`, or `tests`
