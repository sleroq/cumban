import { Notice, TFile } from "obsidian";

import { buildMigratedBaseFileContent } from "./base-file";
import { buildUniqueMarkdownPath, sanitizeNoteTitle } from "./naming";
import { parseLegacyKanbanMarkdown } from "./parser";
import type BasesKanbanPlugin from "../main";
import type { MigrationResult } from "./types";

const LEGACY_MARKER = "%% kanban:settings";
const DEFAULT_QUERY_PROPERTY = "legacyKanbanSource";
const DEFAULT_GROUP_PROPERTY = "status";

function hasKanbanFrontmatter(file: TFile, plugin: BasesKanbanPlugin): boolean {
  const cache = plugin.app.metadataCache.getFileCache(file);
  const frontmatter = cache?.frontmatter;
  if (frontmatter === undefined) {
    return false;
  }

  const value = frontmatter["kanban-plugin"];
  return typeof value === "string";
}

async function ensureFolderExists(
  plugin: BasesKanbanPlugin,
  folderPath: string,
): Promise<void> {
  if (folderPath.length === 0) {
    return;
  }

  const parts = folderPath.split("/").filter((part) => part.length > 0);
  let current = "";
  for (const part of parts) {
    current = current.length === 0 ? part : `${current}/${part}`;
    if (plugin.app.vault.getAbstractFileByPath(current) !== null) {
      continue;
    }
    await plugin.app.vault.createFolder(current);
  }
}

function createNewNoteContent(
  groupProperty: string,
  queryProperty: string,
  cardText: string,
  laneName: string,
  boardPath: string,
): string {
  return [
    "---",
    `${groupProperty}: ${JSON.stringify(laneName)}`,
    `${queryProperty}: ${JSON.stringify(boardPath)}`,
    "---",
    "",
    cardText,
    "",
  ].join("\n");
}

function getBoardFolder(boardFile: TFile): string {
  const parentPath = boardFile.parent?.path ?? "";
  return parentPath.length === 0
    ? boardFile.basename
    : `${parentPath}/${boardFile.basename}`;
}

function getBasePath(boardFile: TFile): string {
  const parentPath = boardFile.parent?.path ?? "";
  const fileName = `${boardFile.basename}.base`;
  return parentPath.length === 0 ? fileName : `${parentPath}/${fileName}`;
}

function assertMigrationDoesNotExist(
  plugin: BasesKanbanPlugin,
  boardFile: TFile,
): void {
  const basePath = getBasePath(boardFile);
  const legacyBugBasePath = `${basePath}.md`;
  const boardFolder = getBoardFolder(boardFile);
  const existingBase = plugin.app.vault.getAbstractFileByPath(basePath);
  const existingLegacyBugBase =
    plugin.app.vault.getAbstractFileByPath(legacyBugBasePath);
  const existingBoardFolder =
    plugin.app.vault.getAbstractFileByPath(boardFolder);
  const queryProperty =
    plugin.settings.migrationQueryProperty.trim().length === 0
      ? DEFAULT_QUERY_PROPERTY
      : plugin.settings.migrationQueryProperty.trim();

  let hasPreviouslyMigratedNotes = false;
  const markdownFiles = plugin.app.vault.getMarkdownFiles();
  for (const markdownFile of markdownFiles) {
    const cache = plugin.app.metadataCache.getFileCache(markdownFile);
    const frontmatter = cache?.frontmatter;
    if (frontmatter === undefined) {
      continue;
    }

    const value = frontmatter[queryProperty];
    if (typeof value === "string" && value === boardFile.path) {
      hasPreviouslyMigratedNotes = true;
      break;
    }
  }

  if (
    existingBase !== null ||
    existingLegacyBugBase !== null ||
    existingBoardFolder !== null ||
    hasPreviouslyMigratedNotes
  ) {
    throw new Error(
      [
        "Migration already exists for this board.",
        `Delete previous migration artifacts first: ${basePath}, ${legacyBugBasePath} (if present), and ${boardFolder}/`,
      ].join(" "),
    );
  }
}

function getLinkTargetTitle(linkTarget: string): string {
  const normalized = linkTarget.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  const sliceStart = lastSlash === -1 ? 0 : lastSlash + 1;
  const basePart = normalized.slice(sliceStart);
  const withoutExt = basePart.endsWith(".md")
    ? basePart.slice(0, -3)
    : basePart;
  return sanitizeNoteTitle(withoutExt);
}

function isFileAlreadyExistsError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.toLowerCase().includes("file already exists");
}

async function createNoteWithUniquePath(
  plugin: BasesKanbanPlugin,
  boardFolder: string,
  title: string,
  content: string,
  reservedPaths: Set<string>,
): Promise<void> {
  let attempts = 0;
  while (attempts < 10_000) {
    const path = buildUniqueMarkdownPath(
      boardFolder,
      title,
      (candidatePath) => {
        if (reservedPaths.has(candidatePath)) {
          return true;
        }

        return plugin.app.vault.getAbstractFileByPath(candidatePath) !== null;
      },
    );

    try {
      await plugin.app.vault.create(path, content);
      reservedPaths.add(path);
      return;
    } catch (error: unknown) {
      if (!isFileAlreadyExistsError(error)) {
        throw error;
      }

      reservedPaths.add(path);
      attempts += 1;
    }
  }

  throw new Error("Could not create unique note path after many attempts.");
}

async function upsertMigrationProperties(
  plugin: BasesKanbanPlugin,
  file: TFile,
  groupProperty: string,
  queryProperty: string,
  laneName: string,
  boardPath: string,
): Promise<void> {
  await plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
    frontmatter[groupProperty] = laneName;
    frontmatter[queryProperty] = boardPath;
  });
}

export async function isLegacyKanbanFile(
  plugin: BasesKanbanPlugin,
  file: TFile,
): Promise<boolean> {
  if (file.extension !== "md") {
    return false;
  }

  if (hasKanbanFrontmatter(file, plugin)) {
    return true;
  }

  const markdown = await plugin.app.vault.cachedRead(file);
  return markdown.includes(LEGACY_MARKER);
}

export async function migrateLegacyKanbanFile(
  plugin: BasesKanbanPlugin,
  boardFile: TFile,
): Promise<MigrationResult> {
  assertMigrationDoesNotExist(plugin, boardFile);

  const markdown = await plugin.app.vault.read(boardFile);
  const parsedBoard = parseLegacyKanbanMarkdown(markdown);
  const groupProperty =
    plugin.settings.migrationGroupProperty.trim().length === 0
      ? DEFAULT_GROUP_PROPERTY
      : plugin.settings.migrationGroupProperty.trim();
  const queryProperty =
    plugin.settings.migrationQueryProperty.trim().length === 0
      ? DEFAULT_QUERY_PROPERTY
      : plugin.settings.migrationQueryProperty.trim();

  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  if (parsedBoard.lanes.length === 0) {
    throw new Error("No lanes were detected in this legacy Kanban file.");
  }

  const boardFolder = getBoardFolder(boardFile);
  await ensureFolderExists(plugin, boardFolder);
  const reservedPaths = new Set<string>();

  for (const lane of parsedBoard.lanes) {
    for (const card of lane.cards) {
      if (card.text.length === 0) {
        skippedCount += 1;
        continue;
      }

      if (card.linkTarget !== null) {
        const existing = plugin.app.metadataCache.getFirstLinkpathDest(
          card.linkTarget,
          boardFile.path,
        );

        if (existing !== null) {
          await upsertMigrationProperties(
            plugin,
            existing,
            groupProperty,
            queryProperty,
            lane.name,
            boardFile.path,
          );
          updatedCount += 1;
          continue;
        }

        const fallbackTitle = getLinkTargetTitle(card.linkTarget);
        await createNoteWithUniquePath(
          plugin,
          boardFolder,
          fallbackTitle,
          createNewNoteContent(
            groupProperty,
            queryProperty,
            card.text,
            lane.name,
            boardFile.path,
          ),
          reservedPaths,
        );
        createdCount += 1;
        continue;
      }

      await createNoteWithUniquePath(
        plugin,
        boardFolder,
        card.title,
        createNewNoteContent(
          groupProperty,
          queryProperty,
          card.text,
          lane.name,
          boardFile.path,
        ),
        reservedPaths,
      );
      createdCount += 1;
    }
  }

  const basePath = getBasePath(boardFile);
  const baseContent = buildMigratedBaseFileContent(
    queryProperty,
    boardFile.path,
    groupProperty,
  );
  await plugin.app.vault.create(basePath, baseContent);

  new Notice(
    `Legacy Kanban migrated: ${createdCount} created, ${updatedCount} updated, ${skippedCount} skipped.`,
  );

  return {
    createdCount,
    updatedCount,
    skippedCount,
    baseFilePath: basePath,
  };
}
