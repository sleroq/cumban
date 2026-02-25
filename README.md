# Bases Kanban

<img width="1240" height="844" alt="image" src="https://github.com/user-attachments/assets/71bdadc1-f01f-43c2-b8c8-7a5a19161186" />

## Features

- Inline editing of properties on the cards with suggestions
- Automatically migrate old Kanban boards to Bases with the command
- Custom backgrounds with brightness/blur controls
- Nice animations
- Integration with [Pretty Properties](https://github.com/anareaty/pretty-properties) for user-defined tag colors
- Rename columns and create new
- Rendering of any selected properties
- Multi-select cards (Shift/Cmd/Ctrl + click) and batch move between the columns, reorder or trash
- Group by any property to organize cards (status, priority, tags, etc.)
- Pin columns so they stay visible even when there are no cards
- Drag column headers to reorder columns

## Planned Features

- Card covers
- Card blockers
- Navigation between cards with HJKL
- Commands for moving the cards around
- Click-on-tag filter (maybe?)
- Search (maybe?)
- Horizontal groups (maybe?)
- Multi-card editing of properties (maybe?)

## Installation

Until this plugin is available in the official plugins menu it can be installed via BRAT:

1. Install the BRAT plugin from "Community plugins" page.
2. Go to the BRAT settings.
3. Click "Add Beta Plugin" button.
4. Paste the following URL in the text field: https://github.com/sleroq/cumban
5. Select the latest release.
6. Make sure that "Enable after installing the plugin" is checked.
7. Click "Add Plugin" button.

### Manual install

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/sleroq/cumban/releases).
2. Create `.obsidian/plugins/cumban/` inside your vault.
3. Place the three files in `.obsidian/plugins/cumban/`.
4. Enable the plugin in Obsidian:
   - Open Obsidian Settings
   - Go to "Community Plugins"
   - Enable "Bases Kanban"

## Migration from non-bases Kanban

1. Open your target kanban board
2. Open command palette and select "Bases Kanban: Migrate legacy Kanban board to Bases"

## Privacy and network usage

- No telemetry is collected by this plugin.
- If you configure a background image with an `http://` or `https://` URL, Obsidian will request that image from the specified host.
