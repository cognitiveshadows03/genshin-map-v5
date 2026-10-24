#!/usr/bin/env python3
"""Extract the original managed assemblies from the official YooAsset bundle."""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path


def load_helpers():
    path = Path(__file__).with_name("repack_official_client.py")
    spec = importlib.util.spec_from_file_location("offline_repack", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--client", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    client, output = args.client.resolve(), args.output.resolve()
    helpers = load_helpers()

    package = client / "Map_Data" / "StreamingAssets" / "package" / "DefaultPackage"
    manifests = list(package.glob("PackageManifest_*.bytes"))
    if len(manifests) != 1:
        raise RuntimeError(f"Expected one package manifest, found {len(manifests)}")
    manifest = helpers.YooManifest(manifests[0].read_bytes())
    targets = [bundle for bundle in manifest.bundles if bundle["name"] == "assets_assetraw_dll.bundle"]
    if len(targets) != 1:
        raise RuntimeError("Official DLL bundle entry not found")
    target = targets[0]
    bundle_path = package / manifest.bundle_filename(target)
    payload = bundle_path.read_bytes()
    if helpers.digest(payload) != target["fileHash"]:
        raise RuntimeError("Official DLL bundle MD5 mismatch")
    if helpers.yoo_crc(payload) != target["fileCRC"]:
        raise RuntimeError("Official DLL bundle CRC mismatch")
    if len(payload) != target["fileSize"]:
        raise RuntimeError("Official DLL bundle size mismatch")

    assemblies = helpers.text_assets(bundle_path)
    for required in ("HotFix.dll", "NotHotfix.dll"):
        if required not in assemblies:
            raise RuntimeError(f"Official bundle lacks {required}")
    output.mkdir(parents=True, exist_ok=True)
    for name, data in assemblies.items():
        if Path(name).name != name or not name.endswith(".dll"):
            raise RuntimeError(f"Unsafe assembly name: {name!r}")
        (output / name).write_bytes(data)
    report = {
        "schemaVersion": 1,
        "packageVersion": manifest.package_version,
        "bundle": bundle_path.name,
        "assemblies": {
            name: helpers.digest(data, "sha256") for name, data in sorted(assemblies.items())
        },
    }
    (output / "official-assemblies.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Extracted {len(assemblies)} verified official assemblies to {output}")


if __name__ == "__main__":
    main()
