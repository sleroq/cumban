import { AbstractInputSuggest, App } from "obsidian";

type PropertyValueEditorSuggestArgs = {
  app: App;
  inputEl: HTMLElement;
  getItems: (query: string) => string[];
  onChoose: (value: string) => void;
};

export class PropertyValueEditorSuggest extends AbstractInputSuggest<string> {
  private readonly getItems: (query: string) => string[];
  private readonly onChoose: (value: string) => void;

  constructor(args: PropertyValueEditorSuggestArgs) {
    super(args.app, args.inputEl as HTMLInputElement);
    this.getItems = args.getItems;
    this.onChoose = args.onChoose;
  }

  protected getSuggestions(query: string): string[] {
    return this.getItems(query);
  }

  renderSuggestion(item: string, el: HTMLElement): void {
    el.setText(item);
  }

  selectSuggestion(item: string, evt: MouseEvent | KeyboardEvent): void {
    super.selectSuggestion(item, evt);
    this.onChoose(item);
    this.close();
  }
}
