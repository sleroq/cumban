/**
 * Selection state management for Kanban view.
 * Handles selected cards, range selection, and deriving dragged paths.
 */

export type SelectionState = {
  selectedPaths: Set<string>;
  lastSelectedIndex: number | null;
};

/**
 * Create initial selection state.
 */
export function createSelectionState(): SelectionState {
  return {
    selectedPaths: new Set<string>(),
    lastSelectedIndex: null,
  };
}

/**
 * Sync selection state when entries change.
 * Removes selected paths that no longer exist and clears lastSelectedIndex
 * if no selections remain.
 */
export function syncSelectionWithEntries(
  state: SelectionState,
  validPaths: Set<string>,
): SelectionState {
  const nextSelected = new Set<string>();
  for (const path of state.selectedPaths) {
    if (validPaths.has(path)) {
      nextSelected.add(path);
    }
  }

  return {
    selectedPaths: nextSelected,
    lastSelectedIndex: nextSelected.size === 0 ? null : state.lastSelectedIndex,
  };
}

/**
 * Select a card with optional range extension.
 * Returns new state (immutable update).
 */
export function selectCard(
  state: SelectionState,
  filePath: string,
  cardIndex: number,
  extendSelection: boolean,
  getCardOrder: () => string[],
): SelectionState {
  if (extendSelection && state.lastSelectedIndex !== null) {
    const [start, end] = sortRange(state.lastSelectedIndex, cardIndex);
    const cardOrder = getCardOrder();
    const nextSelection = new Set(state.selectedPaths);

    for (let index = start; index <= end; index += 1) {
      const path = cardOrder[index];
      if (path !== undefined) {
        nextSelection.add(path);
      }
    }

    return {
      selectedPaths: nextSelection,
      lastSelectedIndex: cardIndex,
    };
  }

  // Toggle single selection
  if (state.selectedPaths.has(filePath)) {
    const nextSelection = new Set(state.selectedPaths);
    nextSelection.delete(filePath);

    return {
      selectedPaths: nextSelection,
      lastSelectedIndex: nextSelection.size === 0 ? null : cardIndex,
    };
  }

  // New single selection
  return {
    selectedPaths: new Set([filePath]),
    lastSelectedIndex: cardIndex,
  };
}

/**
 * Clear all selections.
 */
export function clearSelection(): SelectionState {
  return {
    selectedPaths: new Set<string>(),
    lastSelectedIndex: null,
  };
}

/**
 * Get paths to drag based on selection state.
 * If the source path is selected, returns all selected paths.
 * Otherwise returns just the source path.
 */
export function getDraggedPaths(
  state: SelectionState,
  sourcePath: string,
  cardOrder: string[],
): string[] {
  if (!state.selectedPaths.has(sourcePath)) {
    return [sourcePath];
  }

  return cardOrder.filter((path) => state.selectedPaths.has(path));
}

/**
 * Check if a path is currently selected.
 */
export function isPathSelected(state: SelectionState, path: string): boolean {
  return state.selectedPaths.has(path);
}

/**
 * Check if selection is empty.
 */
export function hasSelection(state: SelectionState): boolean {
  return state.selectedPaths.size > 0;
}

/**
 * Sort two indices into [lower, higher] tuple.
 */
function sortRange(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}
