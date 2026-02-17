<img width="1433" height="853" alt="image" src="https://github.com/user-attachments/assets/a195e6d8-059c-42ae-975b-076402482a67" /># Bases Kanban

<img width="1433" height="853" alt="image" src="https://github.com/user-attachments/assets/96219c18-abfb-4999-a78e-a1ed9cfc64c0" />

## Features

- Kanban view for Obsidian Bases with drag-and-drop cards between columns
- Group by any property to organize cards (status, priority, tags, etc.)
- Drag column headers to reorder columns
- Create new cards from column headers with auto-filled properties
- Multi-select cards (Shift/Cmd/Ctrl + click) and batch move to trash
- Custom backgrounds with brightness/blur controls
- Tag styling with consistent colors based on tag name
- Wiki links render as clickable on cards

## Installation

1. Clone this repository into your Obsidian plugins directory:
   ```bash
   cd /path/to/your/vault/.obsidian/plugins
   git clone https://github.com/sleroq/bases-kanban bases-kanban
   ```

2. Navigate to the plugin directory and build:
   ```bash
   cd bases-kanban
   bun build
   ```

3. Enable the plugin in Obsidian:
   - Open Obsidian Settings
   - Go to "Community Plugins"
   - Enable "Bases Kanban"
