import { Notice, Plugin, TFile } from "obsidian";
import { KanbanView } from "./kanban-view";
import {
  isLegacyKanbanFile,
  migrateLegacyKanbanFile,
} from "./migration/migrator";
import {
  type BasesKanbanSettings,
  DEFAULT_SETTINGS,
  KanbanSettingTab,
} from "./settings";

export default class BasesKanbanPlugin extends Plugin {
  settings!: BasesKanbanSettings;
  private readonly kanbanViews = new Set<KanbanView>();

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addSettingTab(new KanbanSettingTab(this.app, this));

    this.addCommand({
      id: "migrate-legacy-kanban-board",
      name: "Migrate legacy Kanban board to Bases",
      checkCallback: (checking) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!(activeFile instanceof TFile) || activeFile.extension !== "md") {
          return false;
        }

        const cache = this.app.metadataCache.getFileCache(activeFile);
        const legacyType = cache?.frontmatter?.["kanban-plugin"];
        const likelyLegacy = typeof legacyType === "string";
        if (!likelyLegacy) {
          return false;
        }

        if (checking) {
          return true;
        }

        void this.handleLegacyKanbanMigration(activeFile);
        return true;
      },
    });

    this.registerBasesView("cumban", {
      name: "Bases Kanban",
      icon: "lucide-kanban",
      factory: (controller, containerEl) =>
        new KanbanView(controller, containerEl, this),
      options: () => KanbanView.getViewOptions(),
    });
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.updateCssVariables();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.updateCssVariables();
    this.notifyKanbanViewsSettingsChanged();
  }

  registerKanbanView(view: KanbanView): void {
    this.kanbanViews.add(view);
  }

  unregisterKanbanView(view: KanbanView): void {
    this.kanbanViews.delete(view);
  }

  private updateCssVariables(): void {
    const root = document.documentElement;
    root.style.setProperty(
      "--bases-kanban-column-width",
      `${this.settings.columnWidth}px`,
    );
    root.style.setProperty(
      "--bases-kanban-drop-indicator-width",
      `${this.settings.dropIndicatorWidth}px`,
    );
    root.style.setProperty(
      "--bases-kanban-tag-text-color",
      this.settings.tagTextColor,
    );
  }

  private notifyKanbanViewsSettingsChanged(): void {
    for (const view of this.kanbanViews) {
      view.onPluginSettingsChanged();
    }
  }

  private async handleLegacyKanbanMigration(file: TFile): Promise<void> {
    const eligible = await isLegacyKanbanFile(this, file);
    if (!eligible) {
      new Notice("Active file is not a supported legacy Kanban board.");
      return;
    }

    try {
      const result = await migrateLegacyKanbanFile(this, file);
      new Notice(`Base file created: ${result.baseFilePath}`);
      const baseFile = this.app.vault.getAbstractFileByPath(result.baseFilePath);
      if (baseFile instanceof TFile) {
        void this.app.workspace.getLeaf(true).openFile(baseFile);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Legacy Kanban migration failed: ${message}`);
    }
  }
}
