import { AbstractInputSuggest, App } from "obsidian";

type PropertyValueEditorSuggestArgs = {
  app: App;
  inputEl: HTMLElement;
  getItems: (query: string) => string[];
  onChoose: (value: string) => void;
};

export class PropertyValueEditorSuggest extends AbstractInputSuggest<string> {
  private readonly inputEl: HTMLElement;
  private readonly getItems: (query: string) => string[];
  private readonly onChoose: (value: string) => void;

  constructor(args: PropertyValueEditorSuggestArgs) {
    super(args.app, args.inputEl as HTMLInputElement);
    this.inputEl = args.inputEl;
    this.getItems = args.getItems;
    this.onChoose = args.onChoose;
  }

  protected getSuggestions(query: string): string[] {
    return this.getItems(query);
  }

  renderSuggestion(item: string, el: HTMLElement): void {
    el.setText(item);
  }

  completeSelectedSuggestion(): string | null {
    const selected = document.querySelector<HTMLElement>(
      ".suggestion-container .suggestion-item.is-selected",
    );
    const value = selected?.textContent?.trim() ?? "";
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
}
