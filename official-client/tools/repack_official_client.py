#!/usr/bin/env python3
"""Repack the official Rc1.0.1 client with managed offline patches and local data."""
from __future__ import annotations
import argparse, hashlib, json, shutil, struct, sys, zlib
from pathlib import Path
import UnityPy


def digest(data: bytes, algorithm="md5") -> str:
    return hashlib.new(algorithm, data).hexdigest()

def file_hash(path: Path, algorithm="sha256") -> str:
    h = hashlib.new(algorithm)
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def yoo_crc(data: bytes) -> str:
    # YooAsset's CRC32Algorithm returns the little-endian hash byte sequence.
    return struct.pack("<I", zlib.crc32(data) & 0xFFFFFFFF).hex()

class Reader:
    def __init__(self, data: bytes): self.data, self.offset = data, 0
    def read(self, fmt: str):
        value = struct.unpack_from(fmt, self.data, self.offset)
        self.offset += struct.calcsize(fmt)
        return value[0] if len(value) == 1 else value
    def utf(self) -> str:
        size = self.read("<H")
        value = self.data[self.offset:self.offset + size].decode("utf-8")
        self.offset += size
        return value
    def array(self, reader): return [reader() for _ in range(self.read("<H"))]

class Writer:
    def __init__(self): self.data = bytearray()
    def write(self, fmt: str, value): self.data.extend(struct.pack(fmt, value))
    def utf(self, value: str):
        raw = value.encode("utf-8")
        if len(raw) > 65535: raise ValueError("UTF8 manifest value is too long")
        self.write("<H", len(raw)); self.data.extend(raw)
    def array(self, values, writer):
        if len(values) > 65535: raise ValueError("Manifest array is too long")
        self.write("<H", len(values))
        for value in values: writer(value)

class YooManifest:
    def __init__(self, data: bytes):
        self.original = data
        r = Reader(data)
        self.magic = r.read("<I")
        if self.magic != 5853007: raise ValueError("Invalid YooAsset manifest magic")
        self.file_version = r.utf()
        if self.file_version != "2.0.0": raise ValueError("Unsupported manifest version")
        self.enable_addressable = r.read("<B")
        self.location_to_lower = r.read("<B")
        self.include_asset_guid = r.read("<B")
        self.output_name_style = r.read("<i")
        self.build_pipeline, self.package_name, self.package_version = r.utf(), r.utf(), r.utf()
        self.assets = []
        for _ in range(r.read("<i")):
            self.assets.append((r.utf(), r.utf(), r.utf(), r.array(r.utf), r.read("<i")))
        self.bundles = []
        for _ in range(r.read("<i")):
            self.bundles.append({
                "name": r.utf(), "unityCRC": r.read("<I"), "fileHash": r.utf(),
                "fileCRC": r.utf(), "fileSize": r.read("<q"), "encrypted": r.read("<B"),
                "tags": r.array(r.utf), "dependencies": r.array(lambda: r.read("<i")),
            })
        if r.offset != len(data): raise ValueError("Trailing data in YooAsset manifest")
        if self.to_bytes() != data: raise ValueError("Manifest writer failed byte-exact round-trip")

    def to_bytes(self) -> bytes:
        w = Writer()
        w.write("<I", self.magic); w.utf(self.file_version)
        w.write("<B", self.enable_addressable); w.write("<B", self.location_to_lower)
        w.write("<B", self.include_asset_guid); w.write("<i", self.output_name_style)
        w.utf(self.build_pipeline); w.utf(self.package_name); w.utf(self.package_version)
        w.write("<i", len(self.assets))
        for address, path, guid, tags, bundle_id in self.assets:
            w.utf(address); w.utf(path); w.utf(guid); w.array(tags, w.utf); w.write("<i", bundle_id)
        w.write("<i", len(self.bundles))
        for bundle in self.bundles:
            w.utf(bundle["name"]); w.write("<I", bundle["unityCRC"])
            w.utf(bundle["fileHash"]); w.utf(bundle["fileCRC"])
            w.write("<q", bundle["fileSize"]); w.write("<B", bundle["encrypted"])
            w.array(bundle["tags"], w.utf); w.array(bundle["dependencies"], lambda x: w.write("<i", x))
        return bytes(w.data)

    def bundle_filename(self, bundle) -> str:
        name, extension = bundle["name"], Path(bundle["name"]).suffix
        if self.output_name_style == 0: return bundle["fileHash"] + extension
        if self.output_name_style == 1: return name
        if self.output_name_style == 2:
            return f"{name[:-len(extension)]}_{bundle['fileHash']}{extension}"
        raise ValueError("Unsupported bundle output name style")

def text_assets(bundle_path: Path) -> dict[str, bytes]:
    env = UnityPy.load(str(bundle_path))
    result = {}
    for obj in env.objects:
        if obj.type.name == "TextAsset":
            asset = obj.read()
            result[asset.m_Name] = asset.m_Script.encode("utf-8", "surrogateescape")
    return result

def repack_dll_bundle(source: Path, destination: Path, replacements: dict[str, bytes]):
    env = UnityPy.load(str(source))
    replaced = set()
    for obj in env.objects:
        if obj.type.name != "TextAsset": continue
        asset = obj.read()
        if asset.m_Name in replacements:
            asset.m_Script = replacements[asset.m_Name].decode("utf-8", "surrogateescape")
            asset.save()
            replaced.add(asset.m_Name)
    if replaced != set(replacements):
        raise RuntimeError(f"DLL TextAssets not found: {set(replacements) - replaced}")
    destination.write_bytes(env.file.save(packer="original"))
    before, after = text_assets(source), text_assets(destination)
    if before.keys() != after.keys(): raise RuntimeError("TextAsset names changed during repack")
    for name in before:
        expected = replacements.get(name, before[name])
        if after[name] != expected:
            raise RuntimeError(f"Managed payload mismatch after UnityFS repack: {name}")
    return {"assemblyCount": len(after), "replaced": sorted(replaced),
            "assemblies": {name: digest(after[name], "sha256") for name in sorted(after)}}

def patch_native_bootstrap(path: Path):
    """Patch the two early AOT paths that run before HybridCLR loads managed DLLs."""
    expected_sha256 = "b5992211606b639b3de4a88e6dc7b93d90b15c39ddef65cd7db4439f3b2d7017"
    data = bytearray(path.read_bytes())
    original_hash = digest(data, "sha256")
    if original_hash != expected_sha256:
        raise RuntimeError(f"Unexpected GameAssembly.dll SHA-256: {original_hash}")
    patches = [
        {
            "name": "ProcedureLaunch.OnEnter enters existing local StartUpdate path",
            "rva": 0x4DE0FD, "offset": 0x4DC6FD,
            "before": bytes.fromhex("33c9e89c09a80185c0746433c9e8c11f0d01"),
            # Preserve the assigned procedure owner, call StartUpdate(this), then
            # use OnEnter's existing epilogue. Three NOPs end at the next block.
            "after": bytes.fromhex("4889f933d2e8c9090000e9e8000000909090"),
            "targets": {"StartUpdateRVA": 0x4DEAD0, "epilogueRVA": 0x4DE1F4},
        },
        {
            "name": "AppStatic uses Application.dataPath before HybridCLR loads",
            "rva": 0x15A63BE, "offset": 0x15A49BE,
            "before": bytes.fromhex("e80d8a9b00"),
            "after": bytes.fromhex("e8bd859b00"),
            "targets": {"Application.get_dataPathRVA": 0x1F5E980},
        },
        {
            "name": "ResourceModule.PlayMode is always OfflinePlayMode",
            "rva": 0x1B5FFC0, "offset": 0x1B5E5C0,
            "before": bytes.fromhex("837950007507"),
            "after": bytes.fromhex("b801000000c3"),
            "targets": {"YooAsset.EPlayMode.OfflinePlayMode": 1},
        },
        {
            "name": "ResourceModule.Start also sets its inlined playMode field offline",
            "rva": 0x1B5F629, "offset": 0x1B5DC29,
            "before": bytes.fromhex("837b50007560c7435001000000"),
            "after": bytes.fromhex("c7435001000000909090909090"),
            "targets": {"YooAsset.EPlayMode.OfflinePlayMode": 1},
        },
        {
            "name": "Language selection diverts post-preference setup to its bundled callback",
            "rva": 0x15AC5A2, "offset": 0x15AABA2,
            "before": bytes.fromhex("33c9e8273b0000488b0dd0a26301488bf84c"),
            "after": bytes.fromhex("488bce33d24533c0e8a1020000e995000000"),
            "targets": {"LanguageManager.LocalCallbackRVA": 0x15AC850, "LanguageManager.EpilogueRVA": 0x15AC649},
        },
        {
            "name": "Language selection returns normally after the bundled callback",
            "rva": 0x15AC662, "offset": 0x15AAC62,
            "before": bytes.fromhex("e9c9689f00"),
            "after": bytes.fromhex("c390909090"),
            "targets": {},
        },
        {
            "name": "Language callback always takes the bundled dictionary and notification branch",
            "rva": 0x15AC980, "offset": 0x15AAF80,
            "before": bytes.fromhex("4885db0f84"),
            "after": bytes.fromhex("e9aa050000"),
            "targets": {"LanguageManager.LocalBranchRVA": 0x15ACF2F},
        },
    ]
    for patch in patches:
        offset, before, after = patch["offset"], patch["before"], patch["after"]
        if len(before) != len(after): raise RuntimeError("Native patch length mismatch")
        if data[offset:offset + len(before)] != before:
            raise RuntimeError(f"Native bootstrap bytes mismatch: {patch['name']}")
        data[offset:offset + len(before)] = after
        patch["before"], patch["after"] = before.hex(), after.hex()
    path.write_bytes(data)
    return {"file": path.name, "originalSha256": original_hash,
            "sha256": digest(data, "sha256"), "patches": patches}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--client", type=Path, required=True)
    parser.add_argument("--managed", type=Path, required=True)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    client, managed, data = args.client.resolve(), args.managed.resolve(), args.data.resolve()
    output = args.output.resolve()
    if output.exists():
        if not args.overwrite: raise RuntimeError(f"Output exists: {output}")
        shutil.rmtree(output)
    if not (client / "Map.exe").is_file(): raise RuntimeError("Official Map.exe not found")
    if not (data / "offline-data-manifest.json").is_file(): raise RuntimeError("Validated OfflineData not found")
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(client, output)

    package = output / "Map_Data" / "StreamingAssets" / "package" / "DefaultPackage"
    manifests = list(package.glob("PackageManifest_*.bytes"))
    if len(manifests) != 1: raise RuntimeError(f"Expected one package manifest, found {len(manifests)}")
    manifest_path = manifests[0]
    manifest = YooManifest(manifest_path.read_bytes())
    targets = [b for b in manifest.bundles if b["name"] == "assets_assetraw_dll.bundle"]
    if len(targets) != 1: raise RuntimeError("DLL bundle entry not found")
    target = targets[0]
    old_filename = manifest.bundle_filename(target)
    old_bundle_path = package / old_filename
    old_bundle_bytes = old_bundle_path.read_bytes()
    if digest(old_bundle_bytes) != target["fileHash"]: raise RuntimeError("Original DLL bundle MD5 mismatch")
    if yoo_crc(old_bundle_bytes) != target["fileCRC"]: raise RuntimeError("Original DLL bundle CRC mismatch")
    if len(old_bundle_bytes) != target["fileSize"]: raise RuntimeError("Original DLL bundle size mismatch")
    if target["encrypted"]: raise RuntimeError("Unexpected encrypted DLL bundle")

    replacements = {
        "HotFix.dll": (managed / "HotFix.dll").read_bytes(),
        "NotHotfix.dll": (managed / "NotHotfix.dll").read_bytes(),
    }
    temp_bundle = package / ".offline-dll-repack.tmp"
    bundle_report = repack_dll_bundle(old_bundle_path, temp_bundle, replacements)
    new_bundle_bytes = temp_bundle.read_bytes()
    original_target = dict(target)
    target["fileHash"] = digest(new_bundle_bytes)
    target["fileCRC"] = yoo_crc(new_bundle_bytes)
    target["fileSize"] = len(new_bundle_bytes)
    # UnityCRC is intentionally preserved: this unencrypted bundle is loaded by
    # YooAsset through AssetBundle.LoadFromFile(path), which does not pass a CRC.
    target["unityCRC"] = original_target["unityCRC"]
    new_filename = manifest.bundle_filename(target)
    if new_filename == old_filename: raise RuntimeError("Repacked bundle filename did not change")
    temp_bundle.replace(package / new_filename)
    old_bundle_path.unlink()

    manifest_bytes = manifest.to_bytes()
    manifest_path.write_bytes(manifest_bytes)
    manifest_hash = digest(manifest_bytes)
    manifest_path.with_suffix(".hash").write_text(manifest_hash, encoding="ascii")
    validated = YooManifest(manifest_path.read_bytes())
    validated_target = next(b for b in validated.bundles if b["name"] == target["name"])
    if validated_target != target: raise RuntimeError("Updated manifest target mismatch")
    if validated.bundle_filename(validated_target) != new_filename: raise RuntimeError("Updated bundle filename mismatch")
    if manifest_path.with_suffix(".hash").read_text() != digest(manifest_path.read_bytes()):
        raise RuntimeError("Updated manifest hash mismatch")

    native_report = patch_native_bootstrap(output / "GameAssembly.dll")
    shutil.copytree(data, output / "Map_Data", dirs_exist_ok=True)

    excluded = {
        Path("GameAssembly.dll"),
        Path("Map_Data/StreamingAssets/package/DefaultPackage") / old_filename,
        Path("Map_Data/StreamingAssets/package/DefaultPackage") / manifest_path.name,
        Path("Map_Data/StreamingAssets/package/DefaultPackage") / manifest_path.with_suffix(".hash").name,
    }
    unchanged_count = 0
    for source in client.rglob("*"):
        if not source.is_file(): continue
        relative = source.relative_to(client)
        if relative in excluded: continue
        destination = output / relative
        if not destination.is_file() or file_hash(source) != file_hash(destination):
            raise RuntimeError(f"Unexpected change to official file: {relative}")
        unchanged_count += 1

    report = {
        "schemaVersion": 1,
        "clientExecutable": "Map.exe",
        "dataDirectory": "Map_Data",
        "nativeBootstrap": native_report,
        "packageVersion": manifest.package_version,
        "manifest": {"file": str(manifest_path.relative_to(output)), "md5": manifest_hash,
                     "assetCount": len(manifest.assets), "bundleCount": len(manifest.bundles)},
        "dllBundle": {"oldFilename": old_filename, "newFilename": new_filename,
                      "old": original_target, "new": target,
                      "sha256": file_hash(package / new_filename), **bundle_report},
        "unchangedOfficialFilesVerified": unchanged_count,
        "offlineDataFiles": sum(1 for p in data.rglob("*") if p.is_file()),
        "outputBytes": sum(p.stat().st_size for p in output.rglob("*") if p.is_file()),
    }
    (output / "offline-build-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ["packageVersion", "unchangedOfficialFilesVerified", "offlineDataFiles", "outputBytes"]}, indent=2))
    print(f"Offline client ready: {output}")

if __name__ == "__main__":
    try: main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
