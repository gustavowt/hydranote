# Contributing to HydraNote

Thanks for your interest in contributing to HydraNote.

## Before You Start

- Check open issues before starting work to avoid duplication.
- For larger changes, open an issue first to align on scope.
- Keep pull requests focused and small when possible.

## Development Setup

### Local Setup

```bash
git clone https://github.com/gustavowt/hydranote.git
cd hydraNote
npm install
npm run dev
```

### Docker Setup

```bash
docker compose up --build
```

The app will be available at `http://localhost:5173`.

## Branch and Commit Guidelines

- Create a feature branch from `main`:
  - `feat/<short-name>` for features
  - `fix/<short-name>` for bug fixes
  - `docs/<short-name>` for documentation changes
- Use clear commit messages in imperative form (e.g., `add file tree keyboard shortcuts`).

## Pull Request Checklist

- [ ] Code follows existing patterns and architecture
- [ ] Lint and tests pass locally (`npm run lint`, `npm run test:unit`)
- [ ] Behavior changes are documented in the PR description
- [ ] UI changes include screenshots or short videos
- [ ] Docs updated when relevant (`README.md`, `docs/DEVELOPER.md`)

## Project Conventions

- Keep business logic in services, not UI components.
- Use `projectService` as the single source of truth for file/project operations.
- Avoid introducing new architecture patterns without discussion first.
- Do not add logging unless explicitly requested by maintainers.

## Adding a New AI Tool

1. Add tool name to `ToolName` type in `src/types/index.ts`
2. Add parameter/result types in `src/types/index.ts`
3. Add router keywords in `ROUTER_PROMPT` in `src/services/toolService.ts`
4. Implement `executeYourTool()` in `src/services/toolService.ts`
5. Add case in `executeTool()` switch statement
6. Update system prompt in `src/services/chatService.ts`
7. Export from `src/services/index.ts`
8. Update documentation (`docs/DEVELOPER.md`)

## Code of Conduct

By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
