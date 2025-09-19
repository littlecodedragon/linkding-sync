# Linkding Bookmark Sync

Browser extension for Firefox and Chrome that mirrors the bookmarks stored in your
[Linkding](https://github.com/sissbruecker/linkding) instance into the browser's
bookmark tree. The extension creates a top-level folder named **Linkding** and a
subfolder for each Linkding tag. Bookmarks that have multiple tags appear in each
corresponding folder, and entries without any tag are grouped into an
**Untagged** folder. The current implementation is read-only: no browser
bookmark changes are pushed back to Linkding.

## Features

- Periodically syncs bookmarks from Linkding into the browser
- Mirrors Linkding tags as bookmark subfolders
- Places untagged bookmarks into `Linkding/Untagged`
- Skips archived bookmarks so only your active list is synced
- Manual "Sync now" button and status view in the options page

## Credits & Licensing

- Original linkding extension: Sascha Ißbrücker
- Logos adapted from the linkding project assets

This project is released under the MIT License (see `LICENSE.txt`).

## Configuration

1. Open the extension options (click the toolbar button or use your browser's
   extension manager).
2. Enter the base URL of your Linkding server (without a trailing slash).
3. Paste an API token generated from the Linkding settings page.
4. Choose how often the extension should refresh (default: every 30 minutes).
5. Press **Save and Test**. The extension validates the connection and stores
   the configuration. A sync runs automatically afterwards.

## Development

### Requirements

- Node.js (LTS recommended)
- npm

### Running a build

```bash
npm install
npm run build
```

The build artifacts are written to the `build/` directory. Load the unpacked
extension in Firefox or Chrome by pointing the browser at the repository root
(where `manifest.json` lives).

### Development build with watch mode

```bash
npm run dev
```

## Roadmap

- Smarter incremental syncing to avoid rebuilding the folder tree every time.
