import { logCacheEvent, logScrollEvent } from "./debug";

// ===== Types =====

export type BoardScrollState = {
  left: number;
  top: number;
  sessionId: string;
};

export type ScrollPosition = {
  scrollLeft: number;
  scrollTop: number;
};

// ===== Board Scroll State =====

export function saveBoardScrollState(
  setConfig: (key: string, value: string) => void,
  stateKey: string,
  scrollLeft: number,
  scrollTop: number,
  viewSessionId: string,
): void {
  logScrollEvent("Scroll position saved", {
    scrollLeft,
    scrollTop,
    sessionId: viewSessionId.slice(0, 8) + "...",
  });

  const scrollState: BoardScrollState = {
    left: scrollLeft,
    top: scrollTop,
    sessionId: viewSessionId,
  };

  setConfig(stateKey, JSON.stringify(scrollState));
}

export function loadScrollState(
  getConfig: (key: string) => unknown,
  stateKey: string,
): BoardScrollState | null {
  const stateValue = getConfig(stateKey);
  if (typeof stateValue !== "string" || stateValue.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(stateValue) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("left" in parsed) ||
      !("top" in parsed) ||
      !("sessionId" in parsed)
    ) {
      return null;
    }

    const state = parsed as {
      left: unknown;
      top: unknown;
      sessionId: unknown;
    };

    const left =
      typeof state.left === "number" && !Number.isNaN(state.left)
        ? state.left
        : 0;
    const top =
      typeof state.top === "number" && !Number.isNaN(state.top) ? state.top : 0;
    const sessionId =
      typeof state.sessionId === "string" ? state.sessionId : "";

    return { left, top, sessionId };
  } catch {
    return null;
  }
}

export function loadLegacyScrollPosition(
  getConfig: (key: string) => unknown,
  scrollLeftKey: string,
  scrollTopKey: string,
): ScrollPosition {
  const scrollLeftValue = getConfig(scrollLeftKey);
  const scrollTopValue = getConfig(scrollTopKey);

  let scrollLeft = 0;
  let scrollTop = 0;

  if (typeof scrollLeftValue === "string" && scrollLeftValue.length > 0) {
    const parsedLeft = Number.parseInt(scrollLeftValue, 10);
    if (!Number.isNaN(parsedLeft)) {
      scrollLeft = parsedLeft;
    }
  }

  if (typeof scrollTopValue === "string" && scrollTopValue.length > 0) {
    const parsedTop = Number.parseInt(scrollTopValue, 10);
    if (!Number.isNaN(parsedTop)) {
      scrollTop = parsedTop;
    }
  }

  return { scrollLeft, scrollTop };
}

// ===== Column Order =====

export type ColumnOrderCache = {
  order: string[] | null;
  raw: string;
};

export function parseColumnOrder(
  configValue: unknown,
  cache: ColumnOrderCache,
): { order: string[]; cache: ColumnOrderCache } {
  if (typeof configValue !== "string" || configValue.trim().length === 0) {
    if (cache.order !== null) {
      logCacheEvent("Column order cache cleared - empty config");
    }
    return { order: [], cache: { order: null, raw: "" } };
  }

  if (configValue === cache.raw && cache.order !== null) {
    logCacheEvent("Column order cache HIT");
    return { order: cache.order, cache };
  }

  logCacheEvent("Column order cache MISS - parsing config");

  const result = configValue
    .split(",")
    .map((columnKey) => columnKey.trim())
    .filter((columnKey) => columnKey.length > 0);

  const newCache: ColumnOrderCache = {
    order: result,
    raw: configValue,
  };

  logCacheEvent("Column order cache SAVED", { orderCount: result.length });
  return { order: result, cache: newCache };
}

export function serializeColumnOrder(columnOrder: string[]): string {
  return columnOrder.join(",");
}

// ===== Pinned Columns =====

export type PinnedColumnsCache = {
  columns: string[] | null;
  raw: string;
};

export function parsePinnedColumns(
  configValue: unknown,
  cache: PinnedColumnsCache,
): { columns: string[]; cache: PinnedColumnsCache } {
  if (typeof configValue !== "string" || configValue.trim().length === 0) {
    if (cache.columns !== null) {
      logCacheEvent("Pinned columns cache cleared - empty config");
    }
    return { columns: [], cache: { columns: null, raw: "" } };
  }

  if (configValue === cache.raw && cache.columns !== null) {
    logCacheEvent("Pinned columns cache HIT");
    return { columns: cache.columns, cache };
  }

  logCacheEvent("Pinned columns cache MISS - parsing config");

  const result = configValue
    .split(",")
    .map((columnKey) => columnKey.trim())
    .filter((columnKey) => columnKey.length > 0);

  const newCache: PinnedColumnsCache = {
    columns: result,
    raw: configValue,
  };

  logCacheEvent("Pinned columns cache SAVED", { columnCount: result.length });
  return { columns: result, cache: newCache };
}

export function serializePinnedColumns(columns: string[]): string {
  return columns.join(",");
}

// ===== Local Card Order =====

export type CardOrderCache = {
  order: Map<string, string[]> | null;
  raw: string;
};

export function parseLocalCardOrder(
  configValue: unknown,
  cache: CardOrderCache,
): { order: Map<string, string[]>; cache: CardOrderCache } {
  if (typeof configValue !== "string" || configValue.trim().length === 0) {
    if (cache.order !== null) {
      logCacheEvent("Card order cache cleared - empty config");
    }
    return { order: new Map(), cache: { order: null, raw: "" } };
  }

  if (configValue === cache.raw && cache.order !== null) {
    logCacheEvent("Card order cache HIT");
    return { order: cache.order, cache };
  }

  logCacheEvent("Card order cache MISS - parsing config");

  try {
    const parsedValue = JSON.parse(configValue) as unknown;
    if (parsedValue === null || typeof parsedValue !== "object") {
      return { order: new Map(), cache: { order: null, raw: configValue } };
    }

    const orderByColumn = new Map<string, string[]>();
    for (const [columnKey, pathsValue] of Object.entries(parsedValue)) {
      if (!Array.isArray(pathsValue) || columnKey.trim().length === 0) {
        continue;
      }

      const paths: string[] = [];
      const seenPaths = new Set<string>();
      for (const pathValue of pathsValue) {
        if (typeof pathValue !== "string" || pathValue.length === 0) {
          continue;
        }

        if (seenPaths.has(pathValue)) {
          continue;
        }

        seenPaths.add(pathValue);
        paths.push(pathValue);
      }

      if (paths.length > 0) {
        orderByColumn.set(columnKey, paths);
      }
    }

    const newCache: CardOrderCache = {
      order: orderByColumn,
      raw: configValue,
    };

    logCacheEvent("Card order cache SAVED", {
      columnCount: orderByColumn.size,
    });
    return { order: orderByColumn, cache: newCache };
  } catch {
    logCacheEvent("Card order parse FAILED");
    return { order: new Map(), cache: { order: null, raw: configValue } };
  }
}

export function serializeLocalCardOrder(
  orderByColumn: Map<string, string[]>,
): string {
  if (orderByColumn.size === 0) {
    return "";
  }

  const serialized: Record<string, string[]> = {};
  for (const [columnKey, paths] of orderByColumn.entries()) {
    if (paths.length === 0) {
      continue;
    }

    serialized[columnKey] = paths;
  }

  return Object.keys(serialized).length === 0 ? "" : JSON.stringify(serialized);
}

// ===== Column Scroll Position =====

export function saveColumnScrollPosition(
  viewSessionId: string,
  columnKey: string,
  scrollTop: number,
): void {
  const key = `kanban-col-scroll-${viewSessionId}-${columnKey}`;
  sessionStorage.setItem(key, String(scrollTop));
}

export function loadColumnScrollPosition(
  viewSessionId: string,
  columnKey: string,
): number {
  const key = `kanban-col-scroll-${viewSessionId}-${columnKey}`;
  const saved = sessionStorage.getItem(key);
  if (saved === null) {
    return 0;
  }
  const parsed = Number.parseInt(saved, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}
