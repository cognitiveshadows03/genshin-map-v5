#!/usr/bin/env python3
"""Verify a packed offline Kongying client and write a JSON report."""
from __future__ import annotations
import argparse, importlib.util, json, sys
from pathlib import Path
from PIL import Image
import UnityPy


def load_repack_helpers():
    path = Path(__file__).with_name("repack_official_client.py")
    spec = importlib.util.spec_from_file_location("offline_repack", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--client", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    client = args.client.resolve()
    helpers = load_repack_helpers()
    build = json.loads((client / "offline-build-report.json").read_text())
    native = build["nativeBootstrap"]
    native_path = client / native["file"]
    native_bytes = native_path.read_bytes()
    assert helpers.digest(native_bytes, "sha256") == native["sha256"], "Native bootstrap hash mismatch"
    assert native["sha256"] != native["originalSha256"], "Native bootstrap was not changed"
    for patch in native["patches"]:
        offset = patch["offset"]
        assert native_bytes[offset:offset + len(bytes.fromhex(patch["after"]))] == bytes.fromhex(patch["after"]), f"Native patch missing: {patch['name']}"
    data_root = client / "Map_Data"
    data_report = json.loads((data_root / "offline-data-manifest.json").read_text())
    package = client / "Map_Data" / "StreamingAssets" / "package" / "DefaultPackage"
    manifest_path = client / build["manifest"]["file"]
    manifest = helpers.YooManifest(manifest_path.read_bytes())
    target = next(b for b in manifest.bundles if b["name"] == "assets_assetraw_dll.bundle")
    bundle_path = package / manifest.bundle_filename(target)
    bundle_bytes = bundle_path.read_bytes()
    assert helpers.digest(bundle_bytes) == target["fileHash"], "DLL bundle MD5 mismatch"
    assert helpers.yoo_crc(bundle_bytes) == target["fileCRC"], "DLL bundle CRC mismatch"
    assert len(bundle_bytes) == target["fileSize"], "DLL bundle size mismatch"
    assert helpers.digest(manifest_path.read_bytes()) == manifest_path.with_suffix(".hash").read_text(), "Manifest hash mismatch"

    env = UnityPy.load(str(bundle_path))
    assemblies = {}
    for obj in env.objects:
        if obj.type.name == "TextAsset":
            asset = obj.read()
            assemblies[asset.m_Name] = asset.m_Script.encode("utf-8", "surrogateescape")
    expected_assemblies = build["dllBundle"]["assemblies"]
    assert set(assemblies) == set(expected_assemblies), "Managed assembly set mismatch"
    for name, payload in assemblies.items():
        assert helpers.digest(payload, "sha256") == expected_assemblies[name], f"Assembly hash mismatch: {name}"

    poi = data_root / "Resources" / "POI_JSON_API"
    required = ["UGIndex.json", "area.json", "type.json", "icon.json", "item.json", "item1.json", "id_stamp.json", "marker_link.json"]
    for name in required:
        assert (poi / name).is_file(), f"Missing {name}"
    assert len(data_report["markers"]) == 54, "Expected 54 verified official marker payloads"
    for entry in data_report["markers"]:
        assert entry.get("downloadMd5Verified") is True, f"Unverified source payload: {entry['source']}"
        runtime = poi / entry["runtime"]
        assert helpers.file_hash(runtime) == entry["runtimeSha256"], f"Runtime marker hash mismatch: {runtime.name}"
    numbered = sorted((p for p in poi.glob("*.json") if p.stem.isdigit()), key=lambda p: int(p.stem))
    assert [int(p.stem) for p in numbered] == list(range(1, len(numbered) + 1)), "Marker files are not contiguous"
    assert len(numbered) == len(data_report["numberedMarkerFiles"]), "Marker file count mismatch"

    marker_ids, item_references, area_references = set(), set(), set()
    marker_count = picture_count = 0
    for path in numbered:
        markers = json.loads(path.read_text(encoding="utf-8-sig"))
        assert isinstance(markers, list), f"Marker file is not an array: {path.name}"
        for marker in markers:
            marker_id = marker["id"]
            assert marker_id not in marker_ids, f"Duplicate marker ID {marker_id}"
            marker_ids.add(marker_id); marker_count += 1
            if marker.get("picture") or marker.get("videoPath"): picture_count += 1
            assert not marker.get("picture") and not marker.get("videoPath"), f"Remote media reference remains on marker {marker_id}"
            for item in marker["itemList"]:
                assert "iconTag" in item and item["iconTag"] is not None, f"Missing itemList iconTag on marker {marker_id}"
                item_references.add(item["itemId"])
            override = (marker.get("extra") or {}).get("iconOverride")
            if override:
                assert override.get("tag"), f"Missing override icon tag on marker {marker_id}"

    adaptation_counts = data_report["schemaAdaptation"]["counts"]
    assert marker_count == adaptation_counts["retainedMarkers"], "Retained marker count mismatch"
    assert adaptation_counts["sourceMarkers"] == marker_count + adaptation_counts["unsupportedRegionMarkersExcluded"], "Marker compatibility-filter accounting mismatch"

    items = {}
    unreferenced_placeholder_items = []
    for name in ("item.json", "item1.json"):
        for item in json.loads((poi / name).read_text(encoding="utf-8-sig")):
            assert item["id"] not in items, f"Duplicate item ID {item['id']}"
            assert "iconTag" in item and item["iconTag"] is not None, f"Missing item iconTag {item['id']}"
            items[item["id"]] = item
            if item["areaId"] in (-1, 0) and item["id"] not in item_references:
                unreferenced_placeholder_items.append(item["id"])
            else:
                area_references.add(item["areaId"])
    areas = {entry["id"]: entry for entry in json.loads((poi / "area.json").read_text(encoding="utf-8-sig"))}
    for area in areas.values():
        assert "iconTag" in area and area["iconTag"] is not None, f"Missing area iconTag {area['id']}"
    assert not (item_references - set(items)), f"Missing item references: {sorted(item_references - set(items))[:20]}"
    assert not (area_references - set(areas)), f"Missing area references: {sorted(area_references - set(areas))}"

    icon_index = json.loads((poi / "icon.json").read_text(encoding="utf-8-sig"))
    assert len({entry["id"] for entry in icon_index}) == len(icon_index), "Duplicate icon IDs"
    icon_results = data_report["icons"]
    expected_icons = {entry["file"] for entry in icon_results if not entry["missing"]}
    icon_dir = data_root / "Resources" / "POI_ICON_API"
    actual_icons = {p.name for p in icon_dir.iterdir() if p.is_file()}
    assert actual_icons == expected_icons, f"Icon file set mismatch: extra={sorted(actual_icons - expected_icons)[:5]}, missing={sorted(expected_icons - actual_icons)[:5]}"
    for entry in icon_results:
        if entry["missing"]: continue
        path = icon_dir / entry["file"]
        assert helpers.file_hash(path) == entry["sha256"], f"Icon hash mismatch: {path.name}"
        with Image.open(path) as image: image.verify()

    lang_dir = data_root / "Resources" / "LANGUAGE"
    languages = data_report["languages"]
    assert len(languages) == 9, "Expected nine official language files"
    for entry in languages:
        path = lang_dir / entry["file"]
        values = json.loads(path.read_text(encoding="utf-8-sig"))
        assert len(values) == entry["keys"] == 2333, f"Language key mismatch: {path.name}"
        assert helpers.digest(path.read_bytes()) == entry["md5"], f"Language hash mismatch: {path.name}"
    assert json.loads((data_root / "Resources" / "item_selected.json").read_text()) in ([], {}), "Completion state is not empty"

    report = {
        "schemaVersion": 1, "passed": True,
        "client": str(client),
        "bundle": {"file": bundle_path.name, "md5": target["fileHash"], "crc": target["fileCRC"],
                   "bytes": len(bundle_bytes), "assemblies": len(assemblies)},
        "nativeBootstrap": {"file": native["file"], "sha256": native["sha256"],
                            "verifiedPatches": [p["name"] for p in native["patches"]]},
        "data": {"markerFiles": len(numbered), "markers": marker_count, "uniqueMarkers": len(marker_ids),
                 "items": len(items), "referencedItems": len(item_references), "areas": len(areas),
                 "unreferencedPlaceholderItems": unreferenced_placeholder_items,
                 "iconIndexEntries": len(icon_index), "bundledIcons": len(actual_icons),
                 "upstreamMissingIconUrls": sum(e["missing"] for e in icon_results),
                 "languageFiles": len(languages), "languageKeysEach": 2333,
                 "markersWithRemoteMediaReferences": picture_count,
                 "unsupportedRegionMarkersExcluded": adaptation_counts["unsupportedRegionMarkersExcluded"],
                 "supportedAreaIds": data_report["schemaAdaptation"]["supportedAreaIds"],
                 "remotePicturesCleared": adaptation_counts.get("remotePicturesCleared", 0),
                 "remoteVideosCleared": adaptation_counts.get("remoteVideosCleared", 0)},
        "schemaAdaptation": data_report["schemaAdaptation"],
        "notes": [
            "All core marker/item/area references resolve locally.",
            "All available referenced icon images passed format and hash validation.",
            "Upstream-missing icons use the client's original default sprite.",
            "Marker title/content/details are local; remote comment images and videos are not bundled.",
        ],
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report["data"], ensure_ascii=False, indent=2))
    print("Offline client static verification: PASS")

if __name__ == "__main__":
    try: main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
