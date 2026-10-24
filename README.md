# Genshin Offline Map

An English-first, completely offline build of `cognitiveshadows03/genshin-map-v5` (a personal Kongying Tavern fork). The map tiles, marker icons, marker data, UI images, fonts, and application code are bundled with the app.

**A fresh profile works on first launch without an Internet connection.** No account, remote API, cloud database, Service Worker, pre-existing browser cache, or runtime data download is required.

## Included data

The bundled snapshot is **Teyvat Full v7.1.1** from `kxxoling/genshin-map-data`, with matched English and Simplified Chinese marker labels.

| Resource | Bundled amount |
| --- | ---: |
| Game data version | 7.1.0 |
| Map version | `eea752b746ae1f2e0c1988a574f2b7b0` |
| Packed map tiles | 13,770 (76,927,502 bytes) |
| Packed marker icons | 793 (1,598,012 bytes) |
| Surface markers | 85,788 |
| Categories / items with markers | 13 / 702 |
| Excluded floor-specific markers | 2,896 |

English is the default interface and marker language. Open **Settings → General → Marker language** to select Simplified Chinese. Switching languages rebuilds only the bundled map data; completion records and preferences are retained.

### Scope and storage

- Only the official Teyvat **surface** map is included. Underground and other floor-specific maps are not included, so their 2,896 markers are deliberately excluded rather than placed on the wrong layer.
- The snapshot supplies official marker names and coordinates. It does not include Kongying Tavern's detailed descriptions, videos, or refresh-time metadata.
- Online accounts, cloud sync, online editing, uploads, remote databases, and automatic updates have been removed.
- Completion state, filters, and preferences are stored locally in IndexedDB/localStorage.
- Browser data is isolated by origin. Changing the web server's host or port creates a separate browser profile; clearing site data deletes its completion records.

## Run the offline web app

Use Node.js 22 and a modern desktop browser with WebGL2 support.

```bash
npm ci
npm start
```

Open <http://localhost:13101>. If `dist/` is missing, `npm start` builds it before starting the static server. You can also run `start.bat` on Windows or `./start.sh` on macOS/Linux.

To serve an existing production build without installing app dependencies:

```bash
cd dist
python -m http.server 13101 --bind 127.0.0.1
```

Serve the `dist/` directory over HTTP; do not double-click `index.html`. Browsers restrict module loading, Fetch, IndexedDB, and workers on `file://` pages.

## Run the desktop app

The Electron shell serves the same production build from a random loopback-only port. It uses a sandboxed renderer, denies permissions and new windows, and blocks every non-loopback request.

```bash
npm ci
npm run desktop
```

### Build the Windows x64 portable executable

On Windows:

```bash
npm run pack:portable
```

Output:

```text
release/Genshin-Offline-Map-0.2.0-Windows-x64.exe
```

The portable build needs no installation or administrator rights. Run it from a writable folder. Its local completion/preferences directory is `GenshinMapData` beside the executable.

The workflow in `.github/workflows/windows-portable.yml` also builds and uploads this executable as the `Genshin-Offline-Map-Windows-x64` artifact on pushes to `main`, version tags, or manual dispatch. A workflow run is required to produce the Windows artifact.

## Using the map

1. Expand the left panel and select **Teyvat → category → item**. Selecting an area intentionally clears the previous category.
2. Drag or zoom the map. Select a marker to view its local details.
3. Use **Complete / Completed** to toggle its completion state.
4. Open the top settings panel for display preferences, marker language, shortcuts, and local-data controls.

The first launch reads roughly 77 MiB of local tile data plus the marker snapshot, so initialization can take several seconds. Cached local packs may speed up later launches, but no cache is required for offline operation.

## Verification

Install Playwright Chromium once on a development machine for web verification (normal app use does not need Playwright):

```bash
npx playwright install chromium
npm run verify:offline
npm run verify:desktop
```

`verify:offline` checks:

- Pack sizes, SHA-256 hashes, entry bounds, and WebP signatures.
- Matching English/Chinese label IDs and every surface marker's label/icon references.
- The absence of runtime external URLs and the production Content Security Policy.
- A fresh Chromium profile with Service Workers disabled and external requests blocked.
- First-launch rendering, all 85,788 IndexedDB markers, UI filtering, 62 Statue of The Seven markers, persistence, and reload behavior.

`verify:desktop` builds the renderer and checks the Electron shell. The verifier also covers English → Chinese → English switching, completion preservation, loopback-only requests, and zero console errors. Set `ELECTRON_EXECUTABLE` to test a packaged binary instead.

Reports and screenshots are written to `artifacts/`.

## Development commands

```bash
npm run dev            # Vite development server
npm run build          # Static production build in dist/
npm start              # Build if needed and serve the web app
npm run desktop        # Build and launch Electron
npm run pack:dir       # Build an unpacked desktop directory
npm run pack:portable  # Build the Windows x64 portable executable
```

The production build contains a restrictive Content Security Policy and does not generate or register a Service Worker. When deploying the web build, preserve the `offline/`, `assets/`, and `icons/` directory structure at the site root.

## Update the bundled snapshot (maintainers only)

Normal users never need to download data. To import an already-downloaded snapshot:

```bash
npm run import:offline -- /absolute/path/to/extracted/teyvat
npm run build
```

The importer rebuilds the tile/icon packs and indexes, strips remote URL metadata, and validates that `labels-en.json` covers exactly the same label IDs as the new Chinese `labels.json`. Update the English snapshot alongside the source data before importing a different map version.

## Main implementation files

- `src/offline/bootstrap.ts`: first-launch IndexedDB initialization and language-aware reseeding.
- `src/offline/tilePack.ts`, `src/offline/iconPack.ts`: local pack readers and versioned cache handling.
- `src/pages/pageMapV2/config/layers.ts`: official Teyvat layer and projection.
- `electron/main.cjs`: loopback server, sandboxed window, and external-request blocking.
- `scripts/serve-offline.mjs`: dependency-free web production server.
- `scripts/import-offline-snapshot.mjs`: snapshot importer and pack generator.
- `scripts/verify-offline.mjs`, `scripts/verify-electron.mjs`: acceptance tests.

Game assets remain the property of their respective rights holders. Snapshot attribution is retained in `public/offline/source.json`.
