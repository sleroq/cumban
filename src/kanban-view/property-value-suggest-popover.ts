import { AbstractInputSuggest, App, setIcon } from "obsidian";

import { parseWikiLinks } from "./utils";

type PropertyValueEditorSuggestArgs = {
  app: App;
  inputEl: HTMLElement;
  sourcePath: string;
  getItems: (query: string) => string[];
  onChoose: (value: string) => void;
};

export class PropertyValueEditorSuggest extends AbstractInputSuggest<string> {
  private readonly inputEl: HTMLElement;
  private readonly sourcePath: string;
  private readonly getItems: (query: string) => string[];
  private readonly onChoose: (value: string) => void;

  constructor(args: PropertyValueEditorSuggestArgs) {
    super(args.app, args.inputEl as HTMLInputElement);
    this.inputEl = args.inputEl;
    this.sourcePath = args.sourcePath;
    this.getItems = args.getItems;
    this.onChoose = args.onChoose;
  }

  protected getSuggestions(query: string): string[] {
    return this.getItems(query);
  }

  renderSuggestion(item: string, el: HTMLElement): void {
    const linkInfo = this.getEditableLinkInfo(item);
    el.dataset.suggestionValue = item;

    if (linkInfo === null) {
      el.setText(item);
      return;
    }

    const contentEl = el.createDiv({ cls: "suggestion-content" });
    const titleEl = contentEl.createDiv({ cls: "suggestion-title" });

    const linkEl = titleEl.createSpan({
      cls: "internal-link",
      text: linkInfo.display + " ",
    });
    linkEl.dataset.href = linkInfo.target;

    const iconEl = titleEl.createSpan({ cls: "suggestion-flair" });
    setIcon(iconEl, "link");
  }

  completeSelectedSuggestion(): string | null {
    const selected = document.querySelector<HTMLElement>(
      ".suggestion-container .suggestion-item.is-selected",
    );
    const value = selected?.dataset.suggestionValue?.trim() ?? "";
    if (value.length === 0) {
      return null;
    }

    this.inputEl.textContent = value;
    this.inputEl.dispatchEvent(new Event("input"));
    this.close();
    return value;
  }

  selectSuggestion(item: string, evt: MouseEvent | KeyboardEvent): void {
    super.selectSuggestion(item, evt);
    this.onChoose(item);
    this.close();
  }

  private getEditableLinkInfo(
    value: string,
  ): { target: string; display: string } | null {
    const trimmedValue = value.trim();
    if (trimmedValue.length === 0) {
      return null;
    }

    const wikiLinks = parseWikiLinks(trimmedValue);
    if (
      wikiLinks.length === 1 &&
      trimmedValue.startsWith("[[") &&
      trimmedValue.endsWith("]]")
    ) {
      return wikiLinks[0];
    }

    const linkedFile = this.app.metadataCache.getFirstLinkpathDest(
      trimmedValue,
      this.sourcePath,
    );
    if (linkedFile !== null) {
      return {
        target: trimmedValue,
        display: trimmedValue,
      };
    }

    return null;
  }
}
