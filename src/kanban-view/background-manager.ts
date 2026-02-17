import { normalizePath, type App, TFile } from "obsidian";

export type BackgroundConfig = {
  imageInput: unknown;
  brightness: number;
  blur: number;
  columnTransparency: number;
  columnBlur: number;
};

export type BackgroundManagerState = {
  bgEl: HTMLElement | null;
  cachedImageUrl: string | null;
  cachedBackgroundInput: string | null;
  cachedResolvedImageUrl: string | null;
  cachedBackgroundFilter: string | null;
  cachedColumnTransparencyValue: number | null;
  cachedColumnBlurValue: number | null;
  imageLoadVersion: number;
};

export function createBackgroundManagerState(): BackgroundManagerState {
  return {
    bgEl: null,
    cachedImageUrl: null,
    cachedBackgroundInput: null,
    cachedResolvedImageUrl: null,
    cachedBackgroundFilter: null,
    cachedColumnTransparencyValue: null,
    cachedColumnBlurValue: null,
    imageLoadVersion: 0,
  };
}

function resolveBackgroundInput(
  app: App,
  input: string,
): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // Check if it's a URL (http:// or https://)
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // Treat as vault file path
  const normalizedPath = normalizePath(trimmed);
  const file = app.vault.getAbstractFileByPath(normalizedPath);
  if (file instanceof TFile) {
    return app.vault.getResourcePath(file);
  }

  return null;
}

function resolveBackgroundImageUrl(
  app: App,
  state: BackgroundManagerState,
  rawInput: unknown,
): string | null {
  if (typeof rawInput !== "string") {
    state.cachedBackgroundInput = null;
    state.cachedResolvedImageUrl = null;
    return null;
  }

  if (rawInput === state.cachedBackgroundInput) {
    return state.cachedResolvedImageUrl;
  }

  const resolvedImageUrl = resolveBackgroundInput(app, rawInput);
  state.cachedBackgroundInput = rawInput;
  state.cachedResolvedImageUrl = resolvedImageUrl;
  return resolvedImageUrl;
}

function preloadBackgroundImage(
  rootEl: HTMLElement,
  state: BackgroundManagerState,
  imageUrl: string,
): void {
  const currentVersion = state.imageLoadVersion + 1;
  state.imageLoadVersion = currentVersion;
  const image = new Image();
  image.onload = () => {
    if (currentVersion !== state.imageLoadVersion) {
      return;
    }

    if (state.bgEl === null || !rootEl.contains(state.bgEl)) {
      return;
    }

    state.bgEl.style.backgroundImage = `url("${imageUrl}")`;
    state.cachedImageUrl = imageUrl;
  };
  image.onerror = () => {
    if (currentVersion !== state.imageLoadVersion) {
      return;
    }

    console.error(`Failed to load background image: ${imageUrl}`);
  };
  image.src = imageUrl;
}

function getConfigNumber(
  rawValue: unknown,
  globalDefault: number,
  min: number,
  max: number,
): number {
  if (typeof rawValue === "number" && !Number.isNaN(rawValue)) {
    return Math.max(min, Math.min(max, rawValue));
  }
  return globalDefault;
}

export function applyBackground(
  app: App,
  rootEl: HTMLElement,
  state: BackgroundManagerState,
  config: BackgroundConfig,
): void {
  const imageUrl = resolveBackgroundImageUrl(app, state, config.imageInput);

  // Get configuration values
  const brightness = getConfigNumber(config.brightness, 100, 0, 100);
  const blur = getConfigNumber(config.blur, 0, 0, 20);
  const columnTransparency = getConfigNumber(config.columnTransparency, 0, 0, 100);
  const columnBlur = getConfigNumber(config.columnBlur, 0, 0, 20);

  // Apply column transparency CSS variable
  const columnTransparencyValue = columnTransparency / 100;
  if (state.cachedColumnTransparencyValue !== columnTransparencyValue) {
    rootEl.style.setProperty(
      "--bases-kanban-column-transparency",
      String(columnTransparencyValue),
    );
    state.cachedColumnTransparencyValue = columnTransparencyValue;
  }

  // Apply column blur CSS variable
  if (state.cachedColumnBlurValue !== columnBlur) {
    rootEl.style.setProperty(
      "--bases-kanban-column-blur",
      `${columnBlur}px`,
    );
    state.cachedColumnBlurValue = columnBlur;
  }

  // Manage background element
  if (imageUrl !== null) {
    const urlChanged = imageUrl !== state.cachedImageUrl;
    let createdBackgroundElement = false;

    if (state.bgEl === null || !rootEl.contains(state.bgEl)) {
      state.bgEl = rootEl.createDiv({ cls: "bases-kanban-background" });
      createdBackgroundElement = true;
    }

    if (state.bgEl === null) {
      return;
    }

    if (createdBackgroundElement && state.cachedImageUrl !== null) {
      state.bgEl.style.backgroundImage = `url("${state.cachedImageUrl}")`;
    }

    if (urlChanged) {
      preloadBackgroundImage(rootEl, state, imageUrl);
    } else if (createdBackgroundElement) {
      state.bgEl.style.backgroundImage = `url("${imageUrl}")`;
    }

    const nextFilter = `blur(${blur}px) brightness(${brightness}%)`;
    if (
      createdBackgroundElement ||
      state.cachedBackgroundFilter !== nextFilter
    ) {
      state.bgEl.style.filter = nextFilter;
      state.cachedBackgroundFilter = nextFilter;
    }
    return;
  }

  state.imageLoadVersion += 1;
  if (state.bgEl !== null) {
    state.bgEl.remove();
    state.bgEl = null;
  }
  state.cachedImageUrl = null;
  state.cachedBackgroundFilter = null;
  state.cachedColumnBlurValue = null;
}

export function cleanupBackground(state: BackgroundManagerState): void {
  state.imageLoadVersion += 1;
  if (state.bgEl !== null) {
    state.bgEl.remove();
    state.bgEl = null;
  }
  state.cachedImageUrl = null;
  state.cachedBackgroundInput = null;
  state.cachedResolvedImageUrl = null;
  state.cachedBackgroundFilter = null;
  state.cachedColumnTransparencyValue = null;
  state.cachedColumnBlurValue = null;
}
