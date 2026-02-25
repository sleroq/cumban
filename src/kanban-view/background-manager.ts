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

function resolveBackgroundInput(app: App, input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const normalizedPath = normalizePath(trimmed);
  const file = app.vault.getAbstractFileByPath(normalizedPath);
  if (file instanceof TFile) {
    return app.vault.getResourcePath(file);
  }

  return null;
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

export function resolveBackgroundStyles(
  app: App,
  config: BackgroundConfig,
): ResolvedBackgroundStyles {
  const imageUrl =
    typeof config.imageInput === "string"
      ? resolveBackgroundInput(app, config.imageInput)
      : null;

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
