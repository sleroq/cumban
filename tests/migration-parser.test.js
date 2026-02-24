import { describe, expect, test } from "bun:test";

import { parseLegacyKanbanMarkdown } from "../src/migration/parser";

describe("parseLegacyKanbanMarkdown", () => {
  test("parses lanes and cards with links", () => {
    const markdown = [
      "---",
      "kanban-plugin: board",
      "---",
      "",
      "## todo",
      "",
      "- [ ] plain task",
      "",
      "## done",
      "",
      "- [ ] [[Existing Note]]",
      "",
      "%% kanban:settings",
      "```",
      '{"kanban-plugin":"board"}',
      "```",
      "%%",
    ].join("\n");

    const result = parseLegacyKanbanMarkdown(markdown);

    expect(result.lanes.length).toBe(2);
    expect(result.lanes[0]?.name).toBe("todo");
    expect(result.lanes[0]?.cards.length).toBe(1);
    expect(result.lanes[0]?.cards[0]?.title).toBe("plain task");
    expect(result.lanes[1]?.cards[0]?.linkTarget).toBe("Existing Note");
  });

  test("parses multiline card content from indented lines", () => {
    const markdown = [
      "## done",
      "",
      "- [ ] duplicated are great",
      "\t",
      "\t",
      "\tmeow",
      "",
      "- [ ] another card",
    ].join("\n");

    const result = parseLegacyKanbanMarkdown(markdown);

    expect(result.lanes[0]?.cards.length).toBe(2);
    expect(result.lanes[0]?.cards[0]?.title).toBe("duplicated are great");
    expect(result.lanes[0]?.cards[0]?.text).toBe("duplicated are great\n\n\nmeow");
  });

  test("does not treat embedded wikilinks as linked-note cards", () => {
    const markdown = ["## todo", "", "- [ ] real [[partial]] link note"].join("\n");

    const result = parseLegacyKanbanMarkdown(markdown);

    expect(result.lanes[0]?.cards.length).toBe(1);
    expect(result.lanes[0]?.cards[0]?.title).toBe("real partial link note");
    expect(result.lanes[0]?.cards[0]?.linkTarget).toBeNull();
  });
});
