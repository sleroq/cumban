import { App, PluginSettingTab, Setting } from "obsidian";
import type BasesKanbanPlugin from "./main";

export interface BasesKanbanSettings {
  // Display & Labels
  emptyColumnLabel: string;
  placeholderText: string;

  // Behavior
  enableAnimations: boolean;
  scrollDebounceMs: number;
  trashShortcutKey: string;

  // UI Text
  addCardButtonText: string;
  trashMenuText: string;
  trashConfirmButtonText: string;
  cancelButtonText: string;
  failedTrashNoticeText: string;

  // Card Display
  cardTitleSource: "basename" | "filename" | "path";
  cardTitleMaxLength: number;
  cardTitleColor: string;
  propertyValueMaxLength: number;
  propertyValueSeparator: string;
  tagPropertySuffix: string;

  // Column Display
  columnHeaderWidth: number;

  // Visual
  tagSaturation: number;
  tagLightness: number;
  tagAlpha: number;
  columnWidth: number;
  dropIndicatorWidth: number;
  tagTextColor: string;

  // Background (global defaults)
  backgroundBrightness: number;
  backgroundBlur: number;
  columnTransparency: number;
  columnBlur: number;

  // Migration
  migrationGroupProperty: string;
  migrationQueryProperty: string;
}

export const DEFAULT_SETTINGS: BasesKanbanSettings = {
  // Display & Labels
  emptyColumnLabel: "(No value)",
  placeholderText:
    'Set "Group by" in the sort menu to organize cards into columns.',

  // Behavior
  enableAnimations: true,
  scrollDebounceMs: 300,
  trashShortcutKey: "Backspace",

  // UI Text
  addCardButtonText: "+",
  trashMenuText: "Move to trash",
  trashConfirmButtonText: "Move to trash",
  cancelButtonText: "Cancel",
  failedTrashNoticeText: "Failed to move {count} file(s) to trash",

  // Card Display
  cardTitleSource: "basename",
  cardTitleMaxLength: 60,
  cardTitleColor: "var(--text-normal)",
  propertyValueMaxLength: 40,
  propertyValueSeparator: ", ",
  tagPropertySuffix: ".tags",

  // Column Display
  columnHeaderWidth: 150,

  // Visual
  tagSaturation: 80,
  tagLightness: 60,
  tagAlpha: 0.5,
  columnWidth: 280,
  dropIndicatorWidth: 3,
  tagTextColor: "#000000",

  // Background (global defaults)
  backgroundBrightness: 100,
  backgroundBlur: 0,
  columnTransparency: 100,
  columnBlur: 8,

  // Migration
  migrationGroupProperty: "status",
  migrationQueryProperty: "legacyKanbanSource",
};

export class KanbanSettingTab extends PluginSettingTab {
  plugin: BasesKanbanPlugin;

  constructor(app: App, plugin: BasesKanbanPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Display").setHeading();

    new Setting(containerEl)
      .setName("Empty column label")
      .setDesc("Text shown for columns with no value")
      .addText((text) =>
        text
          .setPlaceholder("(no value)")
          .setValue(this.plugin.settings.emptyColumnLabel)
          .onChange(async (value) => {
            this.plugin.settings.emptyColumnLabel =
              value || DEFAULT_SETTINGS.emptyColumnLabel;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Placeholder text")
      .setDesc("Message shown when 'group by' is not configured")
      .addText((text) =>
        text
          .setPlaceholder(
            'Set "group by" in the sort menu to organize cards into columns.',
          )
          .setValue(this.plugin.settings.placeholderText)
          .onChange(async (value) => {
            this.plugin.settings.placeholderText =
              value || DEFAULT_SETTINGS.placeholderText;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName("Card display").setHeading();

    new Setting(containerEl)
      .setName("Card title source")
      .setDesc("Which file attribute to use as the card title")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("basename", "File name (without extension)")
          .addOption("filename", "File name (with extension)")
          .addOption("path", "Full file path")
          .setValue(this.plugin.settings.cardTitleSource)
          .onChange(async (value) => {
            this.plugin.settings.cardTitleSource = value as
              | "basename"
              | "filename"
              | "path";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Maximum card title length")
      .setDesc(
        'Titles longer than this will be truncated with "...". Set to 0 for no limit.',
      )
      .addSlider((slider) =>
        slider
          .setLimits(0, 200, 10)
          .setValue(this.plugin.settings.cardTitleMaxLength)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.cardTitleMaxLength = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Card title color")
      .setDesc(
        "CSS color value for card titles (for example: var(--text-normal), #1f2937, rgb(31, 41, 55))",
      )
      .addText((text) =>
        text
          .setPlaceholder("Any CSS color")
          .setValue(this.plugin.settings.cardTitleColor)
          .onChange(async (value) => {
            this.plugin.settings.cardTitleColor =
              value || DEFAULT_SETTINGS.cardTitleColor;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Maximum property value length")
      .setDesc('Property values longer than this will be truncated with "...".')
      .addSlider((slider) =>
        slider
          .setLimits(10, 60, 5)
          .setValue(this.plugin.settings.propertyValueMaxLength)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.propertyValueMaxLength = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Property value separator")
      .setDesc("Text used to separate multiple property values")
      .addText((text) =>
        text
          .setPlaceholder(", ")
          .setValue(this.plugin.settings.propertyValueSeparator)
          .onChange(async (value) => {
            this.plugin.settings.propertyValueSeparator =
              value || DEFAULT_SETTINGS.propertyValueSeparator;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Tag property suffix")
      .setDesc("Property names ending with this suffix will be styled as tags")
      .addText((text) =>
        text
          .setPlaceholder(".tags")
          .setValue(this.plugin.settings.tagPropertySuffix)
          .onChange(async (value) => {
            this.plugin.settings.tagPropertySuffix =
              value || DEFAULT_SETTINGS.tagPropertySuffix;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName("Column display").setHeading();

    new Setting(containerEl)
      .setName("Column header width")
      .setDesc(
        "Fixed width in pixels for the column name area. Names longer than this will show ellipsis.",
      )
      .addSlider((slider) =>
        slider
          .setLimits(50, 300, 10)
          .setValue(this.plugin.settings.columnHeaderWidth)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.columnHeaderWidth = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName("Behavior").setHeading();

    new Setting(containerEl)
      .setName("Scroll debounce")
      .setDesc("Milliseconds to wait before saving scroll position")
      .addSlider((slider) =>
        slider
          .setLimits(100, 1000, 50)
          .setValue(this.plugin.settings.scrollDebounceMs)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.scrollDebounceMs = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Trash shortcut key")
      .setDesc("Key to press with ctrl/cmd to trash selected cards")
      .addText((text) =>
        text
          .setPlaceholder("Backspace")
          .setValue(this.plugin.settings.trashShortcutKey)
          .onChange(async (value) => {
            this.plugin.settings.trashShortcutKey =
              value || DEFAULT_SETTINGS.trashShortcutKey;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName("UI text").setHeading();

    new Setting(containerEl)
      .setName("Add card button text")
      .setDesc("Text shown on the add card button in column headers")
      .addText((text) =>
        text
          .setPlaceholder("+")
          .setValue(this.plugin.settings.addCardButtonText)
          .onChange(async (value) => {
            this.plugin.settings.addCardButtonText =
              value || DEFAULT_SETTINGS.addCardButtonText;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Trash menu text")
      .setDesc("Text for the trash option in the context menu")
      .addText((text) =>
        text
          .setPlaceholder("Move to trash")
          .setValue(this.plugin.settings.trashMenuText)
          .onChange(async (value) => {
            this.plugin.settings.trashMenuText =
              value || DEFAULT_SETTINGS.trashMenuText;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Trash confirm button text")
      .setDesc("Text for the confirm button in trash dialog")
      .addText((text) =>
        text
          .setPlaceholder("Move to trash")
          .setValue(this.plugin.settings.trashConfirmButtonText)
          .onChange(async (value) => {
            this.plugin.settings.trashConfirmButtonText =
              value || DEFAULT_SETTINGS.trashConfirmButtonText;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Cancel button text")
      .setDesc("Text for the cancel button in dialogs")
      .addText((text) =>
        text
          .setPlaceholder("Cancel")
          .setValue(this.plugin.settings.cancelButtonText)
          .onChange(async (value) => {
            this.plugin.settings.cancelButtonText =
              value || DEFAULT_SETTINGS.cancelButtonText;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName("Appearance").setHeading();

    new Setting(containerEl)
      .setName("Enable animations")
      .setDesc("Enable flip animations when cards and columns are reordered")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAnimations)
          .onChange(async (value) => {
            this.plugin.settings.enableAnimations = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Column width")
      .setDesc("Width of each kanban column in pixels")
      .addSlider((slider) =>
        slider
          .setLimits(200, 500, 10)
          .setValue(this.plugin.settings.columnWidth)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.columnWidth = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Drop indicator width")
      .setDesc("Width of the drop indicator line in pixels")
      .addSlider((slider) =>
        slider
          .setLimits(1, 10, 1)
          .setValue(this.plugin.settings.dropIndicatorWidth)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.dropIndicatorWidth = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName("Tag colors").setHeading();

    new Setting(containerEl)
      .setName("Saturation")
      .setDesc("Color saturation for generated tag backgrounds (0-100)")
      .addSlider((slider) =>
        slider
          .setLimits(0, 100, 5)
          .setValue(this.plugin.settings.tagSaturation)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.tagSaturation = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Lightness")
      .setDesc("Color lightness for generated tag backgrounds (0-100)")
      .addSlider((slider) =>
        slider
          .setLimits(0, 100, 5)
          .setValue(this.plugin.settings.tagLightness)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.tagLightness = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Opacity")
      .setDesc("Opacity for generated tag backgrounds (0-1)")
      .addSlider((slider) =>
        slider
          .setLimits(0, 1, 0.1)
          .setValue(this.plugin.settings.tagAlpha)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.tagAlpha = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Text color")
      .setDesc("Color for tag text")
      .addColorPicker((color) =>
        color
          .setValue(this.getHexColorValue(this.plugin.settings.tagTextColor))
          .onChange(async (value) => {
            this.plugin.settings.tagTextColor =
              value || DEFAULT_SETTINGS.tagTextColor;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName("Background").setHeading();

    new Setting(containerEl)
      .setName("Background brightness")
      .setDesc("Brightness of the background image (0-100%)")
      .addSlider((slider) =>
        slider
          .setLimits(0, 100, 5)
          .setValue(this.plugin.settings.backgroundBrightness)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.backgroundBrightness = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Background blur")
      .setDesc("Blur amount for the background image (0-20px)")
      .addSlider((slider) =>
        slider
          .setLimits(0, 20, 1)
          .setValue(this.plugin.settings.backgroundBlur)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.backgroundBlur = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Column transparency")
      .setDesc("Transparency of kanban columns (0-100%)")
      .addSlider((slider) =>
        slider
          .setLimits(0, 100, 5)
          .setValue(this.plugin.settings.columnTransparency)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.columnTransparency = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Column blur")
      .setDesc("Blur amount for column backgrounds (0-20px)")
      .addSlider((slider) =>
        slider
          .setLimits(0, 20, 1)
          .setValue(this.plugin.settings.columnBlur)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.columnBlur = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName("Migration").setHeading();

    new Setting(containerEl)
      .setName("Migration group property")
      .setDesc("Property used for lane name, used as base group-by")
      .addText((text) =>
        text
          .setPlaceholder("Property name")
          .setValue(this.plugin.settings.migrationGroupProperty)
          .onChange(async (value) => {
            this.plugin.settings.migrationGroupProperty =
              value.trim().length === 0
                ? DEFAULT_SETTINGS.migrationGroupProperty
                : value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Migration query property")
      .setDesc("Property used to filter all notes migrated from one board")
      .addText((text) =>
        text
          .setPlaceholder("Property name")
          .setValue(this.plugin.settings.migrationQueryProperty)
          .onChange(async (value) => {
            this.plugin.settings.migrationQueryProperty =
              value.trim().length === 0
                ? DEFAULT_SETTINGS.migrationQueryProperty
                : value.trim();
            await this.plugin.saveSettings();
          }),
      );
  }

  private getHexColorValue(color: string): string {
    if (/^#[0-9a-fA-F]{6}$/.test(color)) {
      return color;
    }

    const temp = document.createElement("div");
    temp.style.color = color;

    if (temp.style.color === "") {
      return DEFAULT_SETTINGS.tagTextColor;
    }

    document.body.appendChild(temp);
    const computedColor = getComputedStyle(temp).color;
    document.body.removeChild(temp);

    const matches = computedColor.match(/\d+/g);
    if (matches === null || matches.length < 3) {
      return DEFAULT_SETTINGS.tagTextColor;
    }

    const [r, g, b] = matches.slice(0, 3).map(Number);
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  }
}
