import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig(
  {
    ignores: ["node_modules/**", "main.js", "versions.json"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs["flat/recommended"],
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
      },
    },
  },
  {
    plugins: {
      obsidianmd,
    },
    rules: {
      // Obsidian-specific rules
      "obsidianmd/commands/no-command-in-command-id": "error",
      "obsidianmd/commands/no-command-in-command-name": "error",
      "obsidianmd/commands/no-default-hotkeys": "error",
      "obsidianmd/commands/no-plugin-id-in-command-id": "error",
      "obsidianmd/commands/no-plugin-name-in-command-name": "error",
      "obsidianmd/detach-leaves": "error",
      "obsidianmd/hardcoded-config-path": "error",
      "obsidianmd/no-forbidden-elements": "error",
      "obsidianmd/no-plugin-as-component": "error",
      "obsidianmd/no-sample-code": "error",
      "obsidianmd/no-static-styles-assignment": "error",
      "obsidianmd/no-tfile-tfolder-cast": "error",
      "obsidianmd/no-view-references-in-plugin": "error",
      "obsidianmd/object-assign": "error",
      "obsidianmd/platform": "error",
      "obsidianmd/prefer-abstract-input-suggest": "error",
      "obsidianmd/prefer-file-manager-trash-file": "warn",
      "obsidianmd/regex-lookbehind": "error",
      "obsidianmd/sample-names": "error",
      "obsidianmd/settings-tab/no-manual-html-headings": "error",
      "obsidianmd/settings-tab/no-problematic-settings-headings": "error",
      "obsidianmd/ui/sentence-case": ["warn", { enforceCamelCaseLower: true }],
      "obsidianmd/ui/sentence-case-json": "warn",
      "obsidianmd/ui/sentence-case-locale-module": "warn",
      "obsidianmd/validate-license": "error",
      "obsidianmd/validate-manifest": "error",
      "obsidianmd/vault/iterate": "error",
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
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: [".svelte"],
        parser: tseslint.parser,
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
);
