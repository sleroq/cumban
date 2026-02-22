import { normalizePath, type App, TFile } from "obsidian";

export type BackgroundConfig = {
  imageInput: unknown;
  brightness: number;
  blur: number;
  columnTransparency: number;
  columnBlur: number;
};

export type ResolvedBackgroundStyles = {
  hasImage: boolean;
  imageUrl: string | null;
  backgroundFilter: string;
  columnTransparencyValue: number;
  columnBlurValue: number;
};

/**
 * Resolve a background image input to a usable URL.
 * Supports HTTP(S) URLs and vault file paths.
 */
function resolveBackgroundInput(app: App, input: string): string | null {
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

/**
 * Clamp a numeric config value to a valid range.
 */
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

/**
 * Resolve background configuration to concrete style values.
 * Returns an object with computed CSS values and image URL.
 */
export function resolveBackgroundStyles(
  app: App,
  config: BackgroundConfig,
): ResolvedBackgroundStyles {
  // Resolve image URL
  let imageUrl: string | null = null;
  if (typeof config.imageInput === "string" && config.imageInput.length > 0) {
    imageUrl = resolveBackgroundInput(app, config.imageInput);
  }

  // Get configuration values
  const brightness = getConfigNumber(config.brightness, 100, 0, 100);
  const blur = getConfigNumber(config.blur, 0, 0, 20);
  const columnTransparency = getConfigNumber(
    config.columnTransparency,
    0,
    0,
    100,
  );
  const columnBlur = getConfigNumber(config.columnBlur, 0, 0, 20);

  return {
    hasImage: imageUrl !== null,
    imageUrl,
    backgroundFilter: `blur(${blur}px) brightness(${brightness}%)`,
    columnTransparencyValue: columnTransparency / 100,
    columnBlurValue: columnBlur,
  };
}

/**
 * Preload a background image and apply it to an element when ready.
 * Returns a cleanup function to cancel the load operation.
 */
export function preloadBackgroundImage(
  imageUrl: string,
  bgEl: HTMLElement,
  onLoad?: () => void,
  onError?: () => void,
): () => void {
  let cancelled = false;
  const image = new Image();

  image.onload = () => {
    if (cancelled) return;
    bgEl.style.backgroundImage = `url("${imageUrl}")`;
    onLoad?.();
  };

  image.onerror = () => {
    if (cancelled) return;
    console.error(`Failed to load background image: ${imageUrl}`);
    onError?.();
  };

  image.src = imageUrl;

  // Return cleanup function
  return () => {
    cancelled = true;
  };
}
