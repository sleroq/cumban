import { App, FuzzySuggestModal } from "obsidian";

type PropertyValueSuggestModalArgs = {
  app: App;
  initialQuery: string;
  items: string[];
  onChoose: (value: string) => void;
};

export class PropertyValueSuggestModal extends FuzzySuggestModal<string> {
  private readonly initialQuery: string;
  private readonly items: string[];
  private readonly onChoose: (value: string) => void;

  constructor(args: PropertyValueSuggestModalArgs) {
    super(args.app);
    this.initialQuery = args.initialQuery;
    this.items = args.items;
    this.onChoose = args.onChoose;
    this.setPlaceholder("Search values");
  }

  onOpen(): void {
    super.onOpen();
    this.inputEl.value = this.initialQuery;
    this.inputEl.dispatchEvent(new Event("input"));
    this.inputEl.focus();
    this.inputEl.selectionStart = this.inputEl.value.length;
    this.inputEl.selectionEnd = this.inputEl.value.length;
  }

  getItems(): string[] {
    return this.items;
  }

  getItemText(item: string): string {
    return item;
  }

  onChooseItem(item: string): void {
    this.onChoose(item);
  }
}
