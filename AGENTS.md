# AGENTS.md - Bases Kanban

Obsidian plugin providing a Kanban view for Bases.

## Commands

| Task | Command |
|------|---------|
| Dev build (watch) | `bun run dev` |
| Production build | `bun run build` |
| Type check only | `bun run typecheck` |
| Lint | `bun run lint` |
| Lint specific file | `bun eslint ./src/path/to/file.ts` |
| Svelte check | `bun run svelte-check` |
| Install deps | `bun install` |

**Note**: No test framework is configured in this project.

## Build System

- **Bundler**: esbuild (`esbuild.config.mjs`)
- **Package Manager**: Bun (bun.lock present)
- **Entry Point**: `src/main.ts` → `main.js`
- **Target**: ES2018, CommonJS format
- **External**: `obsidian`, `electron`, and CodeMirror packages are externalized
- **Debug Flags**: Build-time defines in esbuild.config.mjs control logging

## Code Style

### Types

- Prefer `type` over `interface` for object shapes
- Use explicit return types on all functions
- Use `unknown` over `any` for catch clauses
- Nullable handling: check with `=== null` or `=== undefined`
- Use `Map` and `Set` for collections when appropriate

```typescript
export type RenderContext = {
  selectedProperties: BasesPropertyId[];
  groupByProperty: BasesPropertyId | null;
};

function getColumnName(groupKey: unknown): string | null {
  if (groupKey === null || groupKey === undefined) {
    return null;
  }
  return String(groupKey);
}
```

### Imports

Order imports in three groups separated by blank lines:
1. External libraries (obsidian, svelte)
2. Internal modules (absolute paths from src/)
3. Relative imports (./ or ../)

```typescript
import { App, Plugin } from "obsidian";
import { mount } from "svelte";

import type BasesKanbanPlugin from "./main";

import { logDebug } from "./kanban-view/debug";
```

### Naming Conventions

- **Files**: kebab-case.ts for modules, PascalCase.svelte for components
- **Types/Interfaces**: PascalCase (e.g., `KanbanSettings`)
- **Functions**: camelCase, verb-first (e.g., `getColumnName`)
- **Constants**: SCREAMING_SNAKE_CASE for module-level constants
- **CSS Classes**: kebab-case with `bases-kanban-` prefix
- **Private Members**: Use `private readonly` for class fields

### Error Handling

- Use `try/catch` for async operations with vault operations
- Log errors with context: `console.error(`Failed to trash ${file.path}:`, error)`
- Show user-facing notices for recoverable errors via Obsidian's `Notice` API
- Validate JSON parsing with type guards

### DOM/CSS Patterns

- Use Obsidian's API for element creation (`createDiv`, `createEl`)
- Use CSS custom properties for theming (`--bases-kanban-column-width`)
- Dataset attributes for element identification (`data-card-path`)
- CSS classes use kebab-case: `bases-kanban-card`

## Project Structure

```
src/
├── main.ts                      # Plugin entry point
├── settings.ts                  # Settings interface and UI
├── kanban-view.ts              # Main view component (Svelte integration)
├── kanban-view/
│   ├── constants.ts            # String constants and keys
│   ├── debug.ts               # Debug logging utilities
│   ├── drag-state.ts          # Drag state management (Svelte 5)
│   ├── indexing.ts            # Entry indexing utilities
│   ├── mutations.ts           # File/vault mutations
│   ├── options.ts             # View options configuration
│   ├── state-persistence.ts   # Scroll position persistence
│   ├── background-manager.ts  # Background image handling
│   ├── render-pipeline.ts   # Render group building
│   ├── selection-state.ts     # Selection state management
│   ├── utils.ts               # Helper functions
│   └── context.ts             # Svelte context definitions
└── components/                # Svelte 5 components
    ├── KanbanRoot.svelte      # Root component with context
    ├── KanbanBoard.svelte     # Board layout and scroll handling
    ├── KanbanColumn.svelte    # Column component
    ├── KanbanCard.svelte      # Card component
    └── KanbanBackground.svelte # Background image component
```

## Obsidian API Usage

- Extend `Plugin` for main plugin class
- Extend `BasesView` for custom views
- Use `PluginSettingTab` for settings UI
- Use `Menu`, `Modal`, `Notice` for UI interactions
- Access vault via `this.app.vault`
- Use `registerBasesView` to register custom Bases views

## ESLint Rules

- Uses `typescript-eslint` recommended config
- Unused vars must start with `_` (ignored)
- Ignores: `old-version/`, `node_modules/`, `main.js`, `versions.json`
- Project-aware parsing with type information

## Svelte 5 Patterns

### Reactivity

- Use `$props()` for component props (not exported let)
- Use `$derived()` for computed values that depend on reactive data
- Use `$state()` for local mutable state
- Access stores with `$store` prefix (not `store()`)
- Avoid store/value mixups in handlers: always use `$store` when you need the current boolean/value
- For context values that must stay live across prop updates, prefer getter-backed context objects or context stores (do not destructure snapshot values that should remain reactive)

```svelte
<script lang="ts">
  let { entry, onSelect }: Props = $props();
  
  const filePath = $derived(entry.file.path);
  const selected = $derived($selectedPathsStore.has(filePath));
</script>
```

### Drag and Drop

- HTML5 drag events fire `dragleave` with `relatedTarget === null` frequently
- Only clear drop state when `relatedTarget !== null` and not contained in current element
- Use `requestAnimationFrame` to throttle dragover calculations
- Keep card-column drop highlight scoped to the hovered column key/path

### Component Structure

- Define explicit `interface Props` for all component props
- Use Svelte context for deeply shared data (settings, stores)
- Pass callbacks as props rather than using events for parent communication
- Use keyed `{#each}` blocks with unique identifiers: `{#each items as item (item.id)}`

## Key Implementation Patterns

### View Lifecycle

- `onDataUpdated()` triggers renders when data changes
- Use `skipNextDataUpdateRender` flag to prevent redundant renders after drop operations
- Use session storage for scroll position persistence
- Column scroll restoration is session-scoped (`kanban-col-scroll-${viewSessionId}-${columnKey}`)

### Drag and Drop

- Use `createCardDragState()` for per-column drag state management
- Update local order state before mutating files (optimistic UI)
- Use data-driven operations instead of DOM queries for card order

### Debug Logging

Build-time flags control debug output:
- `DEBUG_ENABLED`: Master switch
- `DEBUG_RENDERS`: Render cycle logging
- `DEBUG_DRAG`: Drag operation logging
- `DEBUG_SCROLL`: Scroll position logging
- `DEBUG_CACHE`: Cache hit/miss logging

Runtime toggle: `window.__KANBAN_DEBUG__ = true`

All debug functions are in `kanban-view/debug.ts`.

## A note to the agent

We are building this together. When you learn something non-obvious, add it to the AGENTS.md file of the corresponding project so future changes can go faster.
