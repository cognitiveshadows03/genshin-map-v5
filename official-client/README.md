# Kongying Tavern Rc1.0.1 — Offline Client Conversion

This project converts the **official Kongying Tavern downloadable Windows client** for offline use. It is separate from the earlier `genshin-map-v5` conversion. The original Unity client and its native map presentation are retained, including its cursor, boot animation, interface animation, and sound effects.

## Deliverable

`release/KongYingMap-Rc1.0.1-offline-portable.7z` is the maximum-compressed portable Windows package produced from the official `KongYingMap-Rc1.0.1-portable.zip` archive. Use 7-Zip or a compatible archiver to extract it.

### Use

1. Extract the **entire** 7z archive to a normal, user-writable folder. Do not extract only `Map.exe`, and do not use Program Files.
2. Run `Map.exe` directly. The updater is not needed and should not be run.
3. Internet access is not required for installation or the first launch. Keep `Map_Data` beside the executable.

The package is intended for Windows x64. It is a personal, unofficial conversion; the original application, game assets, and data remain the property of their respective owners.

## Offline scope

- Official bundled YooAsset map tiles, base map sprites, atlas art, boot sequence, cursor, animation, and audio.
- Official marker data, item/area/type indexes, underground metadata, and marker-linkage data stored locally.
- 102,565 unique, client-compatible markers in 46 contiguous marker files; 4,969 source items and 47 source areas. Every retained marker item reference and referenced item area resolves.
- 25,540 markers belonging only to later regions absent from Rc1.0.1's `Area` enum/map selectors are excluded rather than consuming memory for maps the executable cannot display. All markers for supported regions, including supported underground maps, are retained.
- Local marker filtering and local marker text/details.
- All available official icon images bundled at their original filenames. An upstream-unavailable icon is not replaced with invented art; the client's existing default sprite is used.
- Nine bundled official languages, with English fallback, and local language selection.
- Locally persisted marker completion and completion timestamps.
- First-launch local empty save files.

## Deliberately offline-disabled or out of scope

- Update checks, online data downloads, online login, cloud saves, analytics, online notices, and automatic companion/overlay startup.
- Windows position tracking and the companion overlay process are not required for this conversion and are not part of the supported offline scope.
- Remote user-submitted marker comment pictures and videos are **not bundled**. Their network loading is disabled so the client does not stall or retry while offline. Local marker titles, content, item information, icons, and completion remain available.
- Advanced underground presentation, route planning, multi-mark workflows, and overlay features have not been expanded for this conversion.
- This retains the Rc1.0.1 client's bundled map package (`2025-01-15-1144`). Newer data for an area with no corresponding map asset in that client cannot create a new map by itself.

## Saves and backup

The converted client uses a portable data root beside the application:

```text
Map_Data/
```

Important files:

- `Resources/item_selected.json` — completed markers.
- `Resources/item_time_selected.json` — completion timestamps.
- `PlayerPrefs.json` — local application data stored by the client's custom preference serializer.

Back up the save files listed above before replacing or moving an installation; the large map bundles can be restored from the archive. Completion writes are immediate; the client also flushes on application pause/quit. The original read-only marker data and completion arrays are distinct and are not merged together.

## Data compatibility and provenance

The base executable and assets come from the official Kongying Tavern Rc1.0.1 portable archive distributed through the official download page. Marker and language data are fetched **at build time only** from the official Kongying endpoints and then packaged locally.

The current official JSON uses `iconId`, while Rc1.0.1 reads `iconTag`. The build performs a deterministic join against the official `icon.json` index and adds `iconTag` to items, areas, marker item lists, and icon overrides. Source IDs are retained. Placeholder IDs `0` and `-1` become an empty icon tag and use the original default icon behavior. Unknown non-placeholder IDs fail the build rather than silently dropping markers.

The compatibility filter is based on the executable's own `Area` enum and map selectors, which end at `NT:NATA2`. Later Natlan areas, Nod-Krai, Snezhnaya, and the newer Mondstadt areas have no corresponding selectable map in this binary. Only markers with no supported-region item are excluded; mixed-region markers are retained. The source, retained, and excluded counts are checked independently during verification.

The official marker payloads retain their published MD5 verification. Some `.7z` payloads are actually gzip; the builder detects the real format before extraction. The official language manifest currently has stale MD5 labels even though all nine JSON files are valid; the offline manifest records the actual hashes. These facts are recorded in the machine-readable data report rather than hidden.

## Verification

- `reports/managed-audit.json` checks the patched managed methods and disabled network/cloud entry points.
- `reports/static-verification.json` verifies the final Unity bundle, manifest, exact assembly hashes, marker schema, item/area references, icon hashes/images, languages, and empty initial completion state.
- `reports/runtime-*.json` and screenshots record isolated Wine/Xvfb runtime checks when available.

Passing decompilation or static checks alone is not treated as proof of runtime operation. CI records `interactiveWindowsRuntimeValidated: false` in `verification/runtime-summary.json`; map/filter/details/completion acceptance still requires a Windows desktop test.

The offline entry retries the map-scene request while the initial `Main` scene is still busy rather than abandoning it after one attempt. Startup and scene-handle diagnostics are written to Unity's normal Windows log:

```text
%USERPROFILE%\AppData\LocalLow\空荧酒馆\Map\Player.log
```

Relevant lines are prefixed `OFFLINE_ENTRY_V2` and `OFFLINE_YSDT`. If a failure remains, this log identifies whether bundled-data initialization finished and whether the map-scene request was rejected, accepted, completed, or failed.

## GitHub Actions build

The **Build official offline Windows client** workflow downloads the pinned official archive at build time, verifies its exact byte count and SHA-256, extracts the original assemblies, applies and audits the offline patches, bundles the official data, runs static verification, and uploads the maximum-compressed 7z with its checksum and reports. The large client archive and intermediate binaries are not committed.

The workflow runs for changes under `official-client/` and can also be started manually with **Run workflow**. Its uploaded artifact is named `KongYingMap-Rc1.0.1-Offline-Windows-x64`. A green CI run proves the managed/static/package checks passed; it is not a substitute for interactive Windows acceptance testing.

Packaging compares solid LZMA2 `9e` archives with 64 MiB and 256 MiB dictionaries, verifies both, and keeps only the smaller one. The selected dictionary and exact saving are recorded in the package report. A 256 MiB dictionary can require approximately 256 MiB of memory during extraction. The official Unity bundles are already compressed, so the improvement may be modest; required assets are not removed for size.

## Rebuild tools

The scripts in `tools/` are the reproducible build implementation:

- `fetch_official_client.py` — pinned Google Drive download, exact archive identity/CRC checks, and safe extraction.
- `extract_managed_assemblies.py` — verified extraction of the original YooAsset managed DLL bundle.
- `fetch_official_data.py` — resumable official-data fetch, MD5 verification, decompression, schema adaptation, icon acquisition, and data report.
- `OfflinePatcher/` — .NET 8 / Mono.Cecil managed patcher and audit.
- `repack_official_client.py` — copies the untouched official client, replaces the YooAsset DLL bundle, applies the guarded early-AOT offline patches, updates the real manifest/hash, and installs local data under `Map_Data`.
- `verify_offline_client.py` — independent static verification of the assembled client.
- `runtime_smoke.py` — isolated Wine/Xvfb runtime checks with fresh profiles, memory samples, screenshots, and guaranteed process cleanup.
- `package_release.py` — configurable-window solid 7z / LZMA2 `9e` packaging, full decompression/CRC verification, and SHA-256 output.
- `select_compression_candidate.py` — validates competing archives and keeps only the smallest.

The large official archive, caches, intermediate clients, and final package are not committed to the source repository. The final archive uses maximum LZMA2 compression. Optional `xmoverlay` bundles are retained because the main scene declares dependencies on them.
