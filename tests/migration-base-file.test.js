import { describe, expect, test } from "bun:test";

import { buildMigratedBaseFileContent } from "../src/migration/base-file";

describe("buildMigratedBaseFileContent", () => {
  test("includes cumban and table views with board filter", () => {
    const content = buildMigratedBaseFileContent(
      "legacyKanbanSource",
      "old-kanban.md",
      "status",
    );

    expect(content.includes("type: cumban")).toBe(true);
    expect(content.includes("type: table")).toBe(true);
    expect(
      content.includes('legacyKanbanSource.contains("old-kanban.md")'),
    ).toBe(true);
    expect(content.includes("property: status")).toBe(true);
  });
});
