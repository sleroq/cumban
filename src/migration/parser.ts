import type { LegacyKanbanBoard, LegacyKanbanCard, LegacyKanbanLane } from "./types";

const HEADING_REGEX = /^##\s+(.+)$/;
const CARD_REGEX = /^\s*-\s*\[[ xX]\]\s+(.+)$/;
const WIKILINK_REGEX = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/;

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

  const linkMatch = text.match(WIKILINK_REGEX);
  const linkTarget = linkMatch === null ? null : linkMatch[1].trim();

  return {
    text,
    title: normalizeTitle(text),
    linkTarget,
  };
}

export function parseLegacyKanbanMarkdown(markdown: string): LegacyKanbanBoard {
  const lines = markdown.split(/\r?\n/);
  const lanes: LegacyKanbanLane[] = [];
  let currentLane: LegacyKanbanLane | null = null;

  for (const line of lines) {
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
      currentLane.cards.push(card);
    }
  }

  return { lanes };
}
