import type {
  LegacyKanbanBoard,
  LegacyKanbanCard,
  LegacyKanbanLane,
} from "./types";

const HEADING_REGEX = /^##\s+(.+)$/;
const CARD_REGEX = /^\s*-\s*\[[ xX]\]\s+(.+)$/;
const FULL_WIKILINK_REGEX = /^\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]$/;

function normalizeTitle(cardText: string): string {
  const withoutLinks = cardText.replace(
    /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g,
    (_match, target: string, alias?: string) => (alias ?? target).trim(),
  );
  const stripped = withoutLinks
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .trim();
  return stripped.length > 0 ? stripped : cardText.trim();
}

function parseCard(line: string): LegacyKanbanCard | null {
  const match = line.match(CARD_REGEX);
  if (match === null) {
    return null;
  }

  const text = match[1].trim();
  if (text.length === 0) {
    return null;
  }

  const linkMatch = text.match(FULL_WIKILINK_REGEX);
  const linkTarget = linkMatch === null ? null : linkMatch[1].trim();

  return {
    text,
    title: normalizeTitle(text),
    linkTarget,
  };
}

function isIndentedContinuationLine(line: string): boolean {
  return /^\s+\S/.test(line);
}

function normalizeContinuationLine(line: string): string {
  return line.replace(/^\s+/, "").trimEnd();
}

export function parseLegacyKanbanMarkdown(markdown: string): LegacyKanbanBoard {
  const lines = markdown.split(/\r?\n/);
  const lanes: LegacyKanbanLane[] = [];
  let currentLane: LegacyKanbanLane | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const headingMatch = line.match(HEADING_REGEX);
    if (headingMatch !== null) {
      currentLane = {
        name: headingMatch[1].trim(),
        cards: [],
      };
      lanes.push(currentLane);
      continue;
    }

    if (currentLane === null) {
      continue;
    }

    const card = parseCard(line);
    if (card !== null) {
      const continuationLines: string[] = [];
      let pendingBlankCount = 0;
      let nextIndex = index + 1;

      while (nextIndex < lines.length) {
        const nextLine = lines[nextIndex] ?? "";

        if (nextLine.match(HEADING_REGEX) !== null) {
          break;
        }

        if (nextLine.match(CARD_REGEX) !== null) {
          break;
        }

        if (nextLine.trim().length === 0) {
          pendingBlankCount += 1;
          nextIndex += 1;
          continue;
        }

        if (!isIndentedContinuationLine(nextLine)) {
          break;
        }

        while (pendingBlankCount > 0) {
          continuationLines.push("");
          pendingBlankCount -= 1;
        }

        continuationLines.push(normalizeContinuationLine(nextLine));
        nextIndex += 1;
      }

      if (continuationLines.length > 0) {
        card.text = `${card.text}\n${continuationLines.join("\n")}`;
      }

      currentLane.cards.push(card);
      index = nextIndex - 1;
    }
  }

  return { lanes };
}
