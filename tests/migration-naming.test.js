import { describe, expect, test } from "bun:test";

import { buildUniqueMarkdownPath, sanitizeNoteTitle } from "../src/migration/naming";

describe("migration naming", () => {
  test("sanitizes invalid filename characters", () => {
    expect(sanitizeNoteTitle('a:b/c*"<>|')).toBe("a b c");
  });

  test("creates unique markdown path with suffix", () => {
    const used = new Set(["Board/todo.md", "Board/todo (1).md"]);
    const path = buildUniqueMarkdownPath("Board", "todo", (candidate) => {
      return used.has(candidate);
    });

    expect(path).toBe("Board/todo (2).md");
  });
});
