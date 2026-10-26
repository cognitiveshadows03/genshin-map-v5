#!/usr/bin/env python3
"""Package the verified portable client with maximum LZMA2 compression."""
from __future__ import annotations
import argparse, hashlib, json, lzma, shutil
from pathlib import Path
import py7zr


def sha256(path: Path):
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b""): h.update(chunk)
    return h.hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--client", type=Path, required=True)
    parser.add_argument("--readme", type=Path, required=True)
    parser.add_argument("--reports", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--dictionary-mib", type=int, default=64,
                        help="LZMA2 dictionary size in MiB (default: 64)")
    args = parser.parse_args()
    if not 1 <= args.dictionary_mib <= 1024:
        raise ValueError("LZMA2 dictionary must be between 1 and 1024 MiB")
    client = args.client.resolve()
    assert (client / "Map.exe").is_file()
    assert (client / "Map_Data" / "Resources" / "item_selected.json").read_text() == "[]", "Reset completion before packaging"
    assert not list(client.rglob("*.part")), "Temporary download files present"
    shutil.copy2(args.readme, client / "OFFLINE_README.md")
    verification = client / "verification"
    verification.mkdir(exist_ok=True)
    for name in ("managed-audit.json", "static-verification.json", "runtime-summary.json"):
        source = args.reports / name
        if source.is_file(): shutil.copy2(source, verification / name)
    files = sorted((p for p in client.rglob("*") if p.is_file()),
                   key=lambda p: (0 if p.suffix.lower() in (".json", ".xml", ".config", ".md") else
                                  1 if p.suffix.lower() in (".dll", ".exe", ".bytes") else
                                  2 if p.suffix.lower() == ".bundle" else 3, str(p.relative_to(client)).lower()))
    extracted_bytes = sum(p.stat().st_size for p in files)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.output.exists(): args.output.unlink()
    filters = [{"id": lzma.FILTER_LZMA2, "preset": 9 | lzma.PRESET_EXTREME,
                "dict_size": args.dictionary_mib * 1024 * 1024}]
    with py7zr.SevenZipFile(args.output, "w", filters=filters) as archive:
        for index, path in enumerate(files, 1):
            archive.write(path, arcname=str(path.relative_to(client)))
            if index % 250 == 0: print(f"Archived {index}/{len(files)} files", flush=True)
    with py7zr.SevenZipFile(args.output, "r") as archive:
        result = archive.test()
        if result is False:
            raise RuntimeError("Archive integrity failure")
        bad_file = archive.testzip()
        if bad_file is not None:
            raise RuntimeError(f"Archive decompression failed: {bad_file}")
    archive_bytes = args.output.stat().st_size
    digest = sha256(args.output)
    args.output.with_suffix(args.output.suffix + ".sha256").write_text(
        f"{digest}  {args.output.name}\n", encoding="ascii")
    report = {
        "schemaVersion": 1, "archive": args.output.name, "files": len(files),
        "extractedBytes": extracted_bytes, "archiveBytes": archive_bytes,
        "ratio": round(archive_bytes / extracted_bytes, 6), "savedBytes": extracted_bytes - archive_bytes,
        "compression": "solid 7z, LZMA2 preset 9 | PRESET_EXTREME",
        "dictionaryMiB": args.dictionary_mib,
        "integrityTestPassed": True, "sha256": digest,
    }
    args.output.with_suffix(args.output.suffix + ".json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)

if __name__ == "__main__": main()
