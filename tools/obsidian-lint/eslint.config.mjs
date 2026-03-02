import path from "node:path";
import { fileURLToPath } from "node:url";

import tsParser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(thisDir, "../..");

export default defineConfig([
  ...obsidianmd.configs.recommendedWithLocalesEn,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: path.join(rootDir, "tsconfig.json"),
        tsconfigRootDir: rootDir,
      },
    },
  },
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    ignores: ["**/node_modules/**", "main.js", "versions.json"],
  },
]);
