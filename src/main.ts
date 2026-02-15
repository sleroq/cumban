import { Plugin } from "obsidian";
import { KanbanView } from "./kanban-view";

export default class BasesKanbanPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerBasesView("kanban", {
      name: "Kanban",
      icon: "lucide-kanban",
      factory: (controller, containerEl) =>
        new KanbanView(controller, containerEl),
      options: () => KanbanView.getViewOptions(),
    });
  }
}
