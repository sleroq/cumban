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
| Install deps | `bun install` |

**Note**: No test framework is configured in this project.

## Build System

- **Bundler**: esbuild (`esbuild.config.mjs`)
- **Package Manager**: Bun (bun.lock present)
- **Entry Point**: `src/main.ts` → `main.js`
- **Target**: ES2018, CommonJS format
- **External**: `obsidian`, `electron`, and CodeMirror packages are externalized
- **Debug Flags**: Build-time defines in esbuild.config.mjs control logging

### Type Patterns

- Prefer `type` over `interface` for object shapes
- Use explicit return types on all functions
- Use `unknown` over `any` for catch clauses
- Nullable handling: check with `=== null` or `=== undefined`
- Use `Map` and `Set` for collections when appropriate

Example:
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

### Error Handling

- Use `try/catch` for async operations with vault operations
- Log errors with context: `console.error("Failed to trash ${file.path}:", error)`
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
├── main.ts                 # Plugin entry point
├── settings.ts             # Settings interface and UI
├── kanban-view.ts         # Main view component
└── kanban-view/
    ├── constants.ts       # String constants and keys
    ├── debug.ts          # Debug logging utilities
    ├── drag-controller.ts # Drag and drop logic
    ├── indexing.ts        # DOM element indexing utilities
    ├── mutations.ts       # File/vault mutations
    ├── options.ts         # View options configuration
    ├── renderer.ts        # DOM rendering
    └── utils.ts           # Helper functions
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

## Key Implementation Patterns

### View Lifecycle
- `onDataUpdated()` triggers renders when data changes
- Implement partial rendering for performance on card moves
- Use session storage for scroll position persistence
- Partial render currently applies only when column structure is unchanged and <=5 columns changed; otherwise it falls back to full render.
- Column scroll restoration is session-scoped (`kanban-col-scroll-${viewSessionId}-${columnKey}`), so column scroll positions are restored within a view session, not across app restarts.

### Drag and Drop
- Use `KanbanDragController` for drag state management
- Implement both card and column drag behaviors
- Update local order state before mutating files

## Debug Logging

Build-time flags control debug output:
- `DEBUG_ENABLED`: Master switch
- `DEBUG_RENDERS`: Render cycle logging
- `DEBUG_DRAG`: Drag operation logging
- `DEBUG_SCROLL`: Scroll position logging
- `DEBUG_CACHE`: Cache hit/miss logging

All debug functions are in `kanban-view/debug.ts`.

## A note to the agent

We are building this together. When you learn something non-obvious, add it to the AGENTS.md file of the corresponding project so future changes can go faster.
