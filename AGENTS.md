# AGENTS.md - Bases Kanban

Obsidian plugin providing a Kanban view for Bases.

## Day-to-Day Commands

| Task | Command |
|------|---------|
| Install deps | `bun install` |
| Dev build (watch) | `bun run dev` |
| Production build | `bun run build` |
| Type check | `bun run typecheck` |
| Lint | `bun run lint` |
| Svelte check | `bun run svelte-check` |

No test framework is configured in this project.

## Core Conventions

- Prefer `type` over `interface` for object shapes.
- Use explicit return types on functions.
- Use `unknown` instead of `any` in catch/error paths.
- Check nullable values explicitly (`=== null` / `=== undefined`).
- Import order: external, internal, relative (blank line between groups).
- Naming: `kebab-case.ts` modules, `PascalCase.svelte` components, `camelCase` functions.

## Where Things Live

- `src/main.ts`: plugin entry.
- `src/settings.ts`: settings model and settings tab UI.
- `src/kanban-view.ts`: view class and Svelte mounting.
- `src/kanban-view/`: domain logic (drag state, mutations, indexing, render pipeline, persistence, debug).
- `src/components/`: Svelte UI (`KanbanRoot`, `KanbanBoard`, `KanbanColumn`, `KanbanCard`, `KanbanBackground`).

## Svelte 5 Patterns

- Use runes: `$props()`, `$state()`, `$derived()`.
- Use context for deeply shared state.
- Prefer callback props for parent communication.
- Use keyed `{#each}` blocks with stable ids.

## High-Value Implementation Notes

- `onDataUpdated()` drives re-rendering when Bases data changes.
- Settings changes do not trigger `onDataUpdated()`; live views must be notified from `saveSettings()`.
- Keep drag/drop state centralized in `createKanbanDragState()`.
- Prefer drag-state selector stores over ad-hoc `derived(...)` in components.
- For top-of-column drops: `targetPath === null` + `placement: "before"` means insert at index `0`; `"after"` means append.
- For card container drag-over insertion, compute position from cursor Y against card midpoints.

## Debugging

- Debug helpers live in `src/kanban-view/debug.ts`.
- Runtime toggle: `window.__KANBAN_DEBUG__ = true`.

## A note to the agent

When you learn something non-obvious that will help future feature work, add it here.
