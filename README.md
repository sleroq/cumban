# Bases Kanban

<img width="1687" height="1008" alt="image" src="https://github.com/user-attachments/assets/9ee5e365-0dae-4208-b9e8-d2c1153e0721" />

## Features

- Inline editing of properties on the cards with suggestions
- Custom backgrounds with brightness/blur controls
- Integration with [Pretty Properties](https://github.com/anareaty/pretty-properties) for user-defined tag colors
- Drag column headers to reorder columns
- Tag styling with consistent colors based on tag name
- Rendering of any selected properties
- Multi-select cards (Shift/Cmd/Ctrl + click) and batch move between the columns, reorder or trash
- Group by any property to organize cards (status, priority, tags, etc.)
- Pin columns so they stay even when there are no cards

## Planned Features

- Horizontal groups
- Card blockers
- Multi-card editing of properties
- Card covers

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

## Privacy and network usage

- No telemetry is collected by this plugin.
- If you configure a background image with an `http://` or `https://` URL, Obsidian will request that image from the specified host.
