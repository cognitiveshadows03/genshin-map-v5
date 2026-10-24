#!/usr/bin/env python3
"""Seed the official Kongying client's runtime data at build time only."""
from __future__ import annotations
import argparse, concurrent.futures, gzip, hashlib, json, os, shutil, sys, threading, time
import urllib.error, urllib.parse, urllib.request
from pathlib import Path
import py7zr
from PIL import Image

BASE = "https://yuanshen.site/HotUpdate"
USER_AGENT = "KongyingOfflineClientBuilder/1.0"
REQUIRED_JSON = ["UGIndex.json", "area.json", "type.json", "icon.json", "item.json", "id_stamp.json", "marker_link.json"]

def get_bytes(url: str, retries: int = 5) -> bytes:
    parts = urllib.parse.urlsplit(url)
    request_url = urllib.parse.urlunsplit((parts.scheme, parts.netloc,
        urllib.parse.quote(parts.path, safe="/%:@!$&'()*+,;=-._~%"),
        urllib.parse.quote(parts.query, safe="=&?/:;+,%@!$'()*-._~"), parts.fragment))
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(request_url, headers={"User-Agent": USER_AGENT, "Accept": "image/webp,application/json;q=0.9,*/*;q=0.8"})
            with urllib.request.urlopen(req, timeout=90) as response:
                if response.status != 200:
                    raise RuntimeError(f"HTTP {response.status}: {url}")
                return response.read()
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code in (404, 410):
                break
            if attempt + 1 < retries:
                time.sleep(1.5 * (attempt + 1))
        except Exception as exc:
            last = exc
            if attempt + 1 < retries:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Download failed: {url}: {last}")

def md5(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def cached_download(url: str, destination: Path, expected_md5: str | None = None) -> bytes:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        data = destination.read_bytes()
        if data and (expected_md5 is None or md5(data) == expected_md5):
            return data
    data = get_bytes(url)
    if expected_md5 is not None and md5(data) != expected_md5:
        raise RuntimeError(f"MD5 mismatch for {url}: expected {expected_md5}, got {md5(data)}")
    temp = destination.with_name(f".{destination.name}.{os.getpid()}.{threading.get_ident()}.part")
    temp.write_bytes(data)
    os.replace(temp, destination)
    return data

def icon_filename(url: str) -> str:
    name = urllib.parse.unquote(url).rsplit("/", 1)[-1]
    if not name or name in {".", ".."} or "/" in name or "\\" in name:
        raise RuntimeError(f"Unsafe icon filename from {url!r}")
    return name

def validate_image(path: Path) -> tuple[str, tuple[int, int]]:
    with Image.open(path) as image:
        image.verify()
    with Image.open(path) as image:
        return image.format or "unknown", image.size

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()
    output, cache = args.output.resolve(), args.cache.resolve()
    if output.exists():
        shutil.rmtree(output)
    resources = output / "Resources"
    poi_dir, icon_dir, lang_dir = resources / "POI_JSON_API", resources / "POI_ICON_API", resources / "LANGUAGE"
    downloads = cache / "downloads"
    for directory in (poi_dir, icon_dir, lang_dir, downloads):
        directory.mkdir(parents=True, exist_ok=True)

    manifest_bytes = cached_download(f"{BASE}/file_md5_new.json", cache / "file_md5_new.json")
    manifest = json.loads(manifest_bytes)
    if not isinstance(manifest, dict) or not manifest:
        raise RuntimeError("Marker manifest is not a non-empty object")

    def fetch_marker(item):
        name, expected = item
        if Path(name).name != name or name.startswith("."):
            raise RuntimeError(f"Unsafe marker manifest path: {name!r}")
        data = cached_download(f"{BASE}/public_new/{urllib.parse.quote(name)}", downloads / name, expected)
        return name, len(data), md5(data)

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        marker_results = list(pool.map(fetch_marker, manifest.items()))

    for name in sorted(manifest):
        source = downloads / name
        if name.endswith(".7z"):
            target_name = name[:-3]
            target = poi_dir / target_name
            # The current official server labels these payloads .7z, but its
            # actual bytes are gzip. Support both formats, keyed by magic bytes.
            if source.read_bytes()[:2] == b"\x1f\x8b":
                target.write_bytes(gzip.decompress(source.read_bytes()))
            else:
                with py7zr.SevenZipFile(source, "r") as archive:
                    names = archive.getnames()
                    if names != [target_name]:
                        raise RuntimeError(f"Unexpected archive layout for {name}: {names!r}")
                    archive.extract(path=poi_dir, targets=[target_name])
            if not target.is_file() or target.stat().st_size == 0:
                raise RuntimeError(f"Archive did not produce {target}")
        else:
            shutil.copy2(source, poi_dir / name)

    for name in REQUIRED_JSON:
        path = poi_dir / name
        if not path.is_file():
            raise RuntimeError(f"Required marker metadata missing: {name}")
        json.loads(path.read_text(encoding="utf-8-sig"))
    numbered = sorted((p for p in poi_dir.glob("*.json") if p.stem.isdigit()), key=lambda p: int(p.stem))
    if not numbered:
        raise RuntimeError("No numbered marker datasets were extracted")
    for path in numbered:
        json.loads(path.read_text(encoding="utf-8-sig"))

    # Rc1.0.1 predates the current API's iconId schema. Add the iconTag fields
    # its existing Newtonsoft models read, using the official icon index join.
    icon_index_for_join = json.loads((poi_dir / "icon.json").read_text(encoding="utf-8-sig"))
    id_to_tag = {entry["id"]: entry["tag"] for entry in icon_index_for_join}
    if len(id_to_tag) != len(icon_index_for_join):
        raise RuntimeError("Duplicate IDs in official icon index")
    schema_adaptation = {"format": "Rc1.0.1 iconId to iconTag compatibility", "counts": {}}

    def add_icon_tag(entry, kind, allow_placeholder=True):
        if "iconId" not in entry:
            return
        icon_id = entry["iconId"]
        if icon_id in id_to_tag:
            entry["iconTag"] = id_to_tag[icon_id]
        elif allow_placeholder and icon_id in (-1, 0):
            entry["iconTag"] = ""
            schema_adaptation["counts"][kind + "Placeholders"] = schema_adaptation["counts"].get(kind + "Placeholders", 0) + 1
        else:
            raise RuntimeError(f"Unknown {kind} iconId {icon_id!r}")
        schema_adaptation["counts"][kind] = schema_adaptation["counts"].get(kind, 0) + 1

    for name in ("area.json", "item.json", "item1.json"):
        path = poi_dir / name
        entries = json.loads(path.read_text(encoding="utf-8-sig"))
        for entry in entries:
            add_icon_tag(entry, name)
        path.write_text(json.dumps(entries, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # Rc1.0.1's Area enum and serialized map selectors end at NT:NATA2.
    # Later regions have no map asset or selectable Area in this client, so
    # retaining their markers only consumes memory and produces unusable filters.
    supported_area_ids = {2, 3, 4, 6, 8, 10, 12, 13, 14, 15, 16, 17, 19, 21,
                          22, 23, 26, 28, 29, 30, 31, 32, 34, 43, 45, 46}
    item_areas = {}
    for name in ("item.json", "item1.json"):
        for entry in json.loads((poi_dir / name).read_text(encoding="utf-8-sig")):
            item_areas[entry["id"]] = entry["areaId"]
    schema_adaptation["supportedAreaIds"] = sorted(supported_area_ids)
    for path in numbered:
        markers = json.loads(path.read_text(encoding="utf-8-sig"))
        retained = []
        schema_adaptation["counts"]["sourceMarkers"] = schema_adaptation["counts"].get("sourceMarkers", 0) + len(markers)
        for marker in markers:
            marker_area_ids = {item_areas[entry["itemId"]] for entry in marker.get("itemList", [])}
            if not marker_area_ids:
                raise RuntimeError(f"Marker {marker['id']} has no resolvable item area")
            if not marker_area_ids & supported_area_ids:
                schema_adaptation["counts"]["unsupportedRegionMarkersExcluded"] = schema_adaptation["counts"].get("unsupportedRegionMarkersExcluded", 0) + 1
                continue
            if len(marker_area_ids) > 1:
                schema_adaptation["counts"]["mixedRegionMarkersRetained"] = schema_adaptation["counts"].get("mixedRegionMarkersRetained", 0) + 1
            for field, count_name in (("picture", "remotePicturesCleared"), ("videoPath", "remoteVideosCleared")):
                if marker.get(field):
                    schema_adaptation["counts"][count_name] = schema_adaptation["counts"].get(count_name, 0) + 1
                    marker[field] = ""
            for entry in marker.get("itemList", []):
                add_icon_tag(entry, "markerItemList")
            override = (marker.get("extra") or {}).get("iconOverride")
            if override:
                icon_id = override["id"]
                if icon_id not in id_to_tag:
                    raise RuntimeError(f"Unknown iconOverride icon ID {icon_id!r}")
                override["tag"] = id_to_tag[icon_id]
                schema_adaptation["counts"]["iconOverride"] = schema_adaptation["counts"].get("iconOverride", 0) + 1
            retained.append(marker)
        schema_adaptation["counts"]["retainedMarkers"] = schema_adaptation["counts"].get("retainedMarkers", 0) + len(retained)
        path.write_text(json.dumps(retained, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    lang_manifest_bytes = cached_download(f"{BASE}/Language/manifest.json", cache / "language-manifest.json")
    lang_manifest = json.loads(lang_manifest_bytes)
    if not isinstance(lang_manifest, list) or not lang_manifest:
        raise RuntimeError("Language manifest is not a non-empty array")
    def fetch_language(entry):
        code, expected = entry["langCode"], entry["md5Hash"]
        name = f"{code}.json"
        if Path(name).name != name:
            raise RuntimeError(f"Unsafe language code: {code!r}")
        # Upstream currently publishes stale language hashes. Validate the JSON
        # and record both hashes; the offline manifest is regenerated below.
        data = cached_download(f"{BASE}/Language/{urllib.parse.quote(name)}", downloads / "languages" / name)
        parsed = json.loads(data)
        if not isinstance(parsed, dict) or not parsed:
            raise RuntimeError(f"Language payload is not a non-empty object: {name}")
        (lang_dir / name).write_bytes(data)
        return {"file": name, "bytes": len(data), "md5": md5(data),
                "publishedMd5": expected, "md5MatchesPublished": md5(data) == expected,
                "keys": len(parsed)}

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        language_results = list(pool.map(fetch_language, lang_manifest))
    actual_lang_md5 = {entry["file"]: entry["md5"] for entry in language_results}
    local_lang_manifest = []
    for entry in lang_manifest:
        local_entry = dict(entry)
        local_entry["md5Hash"] = actual_lang_md5[f"{entry['langCode']}.json"]
        local_lang_manifest.append(local_entry)
    (resources / "file_lang_MD5.json").write_text(
        json.dumps(local_lang_manifest, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")

    icon_index = json.loads((poi_dir / "icon.json").read_text(encoding="utf-8-sig"))
    if not isinstance(icon_index, list):
        raise RuntimeError("icon.json is not an array")
    icon_urls = sorted({entry["url"] for entry in icon_index
                        if entry.get("url") and urllib.parse.unquote(entry["url"])
                        .rsplit("/", 1)[-1].lower().endswith(".png")})
    if not icon_urls:
        raise RuntimeError("No icon URLs found")

    def fetch_icon(url):
        name = icon_filename(url)
        path = downloads / "icons" / name
        try:
            cached_download(url, path)
        except RuntimeError as exc:
            if "HTTP Error 404" in str(exc) or "HTTP Error 410" in str(exc):
                return {"file": name, "url": url, "missing": True, "error": str(exc)}
            raise
        target = icon_dir / name
        if target.exists() and target.read_bytes() != path.read_bytes():
            raise RuntimeError(f"Conflicting icon content for filename {name!r}")
        shutil.copy2(path, target)
        image_format, dimensions = validate_image(target)
        return {"file": name, "url": url, "missing": False, "bytes": target.stat().st_size, "sha256": sha256(target), "format": image_format, "width": dimensions[0], "height": dimensions[1]}

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        icon_results = list(pool.map(fetch_icon, icon_urls))

    update_time = cached_download(f"{BASE}/update_time_new.json", cache / "update_time_new.json")
    json.loads(update_time)
    (resources / "update_time.json").write_bytes(update_time)
    (resources / "item_selected.json").write_text("[]", encoding="utf-8")
    (resources / "item_time_selected.json").write_text("{}", encoding="utf-8")
    player_prefs = {"DicInt": {}, "DicFloat": {}, "DicBool": {}, "DicString": {}, "DicDicString": {}, "DicAreaString": {}, "DicMapListString": {}}
    (output / "PlayerPrefs.json").write_text(json.dumps(player_prefs, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (resources / "lang_md5.json").write_text(json.dumps(actual_lang_md5, separators=(",", ":")), encoding="utf-8")

    marker_report = []
    for name, byte_count, digest in marker_results:
        runtime_name = name[:-3] if name.endswith(".7z") else name
        runtime_path = poi_dir / runtime_name
        marker_report.append({"source": name, "runtime": runtime_name, "downloadBytes": byte_count, "downloadMd5": digest, "downloadMd5Verified": True, "runtimeBytes": runtime_path.stat().st_size, "runtimeSha256": sha256(runtime_path)})
    report = {
        "schemaVersion": 1,
        "sources": {"markerManifest": f"{BASE}/file_md5_new.json", "markerPayloads": f"{BASE}/public_new/", "languageManifest": f"{BASE}/Language/manifest.json", "languagePayloads": f"{BASE}/Language/", "updateTime": f"{BASE}/update_time_new.json"},
        "markers": marker_report,
        "numberedMarkerFiles": [p.name for p in numbered],
        "schemaAdaptation": schema_adaptation,
        "languages": language_results,
        "icons": icon_results,
        "totals": {"markerFiles": len(marker_report), "numberedMarkerFiles": len(numbered), "languageFiles": len(language_results), "languagePublishedMd5Mismatches": sum(not entry["md5MatchesPublished"] for entry in language_results), "iconUrlsReferenced": len(icon_results), "iconUrlsAvailable": sum(not entry["missing"] for entry in icon_results), "iconFiles": len({entry["file"] for entry in icon_results if not entry["missing"]}), "iconUrlsMissingUpstream": sum(entry["missing"] for entry in icon_results), "runtimeBytes": sum(p.stat().st_size for p in output.rglob("*") if p.is_file())},
    }
    (output / "offline-data-manifest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report["totals"], indent=2))
    print(f"Offline data ready: {output}")

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
