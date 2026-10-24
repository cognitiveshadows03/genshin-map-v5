#!/usr/bin/env python3
"""Download, authenticate, and extract the pinned official Rc1.0.1 client."""
from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import shutil
import zipfile

FILE_ID = "1n_8a-Do14OdTfKdQGhFOfnPKRDsV6QnP"
EXPECTED_BYTES = 378_803_283
EXPECTED_SHA256 = "2a0c5cedf836e03898851e98a549b1d4159c0cc037c0905d0a0fde5c35c01c36"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_archive(path: Path) -> None:
    if not path.is_file():
        raise RuntimeError(f"Official archive is missing: {path}")
    actual_bytes = path.stat().st_size
    actual_sha256 = sha256(path)
    if actual_bytes != EXPECTED_BYTES or actual_sha256 != EXPECTED_SHA256:
        raise RuntimeError(
            "Official archive identity mismatch: "
            f"bytes={actual_bytes}, sha256={actual_sha256}"
        )
    with zipfile.ZipFile(path) as archive:
        bad_file = archive.testzip()
        if bad_file is not None:
            raise RuntimeError(f"Official archive CRC failure: {bad_file}")
        names = set(archive.namelist())
        for required in ("Map.exe", "GameAssembly.dll", "Map_Data/app.info"):
            if required not in names:
                raise RuntimeError(f"Official archive lacks {required}")


def safe_extract(archive_path: Path, destination: Path) -> None:
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    root = destination.resolve()
    with zipfile.ZipFile(archive_path) as archive:
        for info in archive.infolist():
            target = (destination / info.filename).resolve()
            if target != root and root not in target.parents:
                raise RuntimeError(f"Unsafe ZIP member: {info.filename!r}")
        archive.extractall(destination)
    if not (destination / "Map.exe").is_file():
        raise RuntimeError("Extracted official client does not contain Map.exe")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True, help="Pinned official ZIP")
    parser.add_argument("--extract-to", type=Path, help="Optional clean extraction directory")
    args = parser.parse_args()
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    if output.is_file():
        try:
            verify_archive(output)
            print(f"Using verified cached official archive: {output}")
        except Exception:
            output.unlink()
    if not output.is_file():
        import gdown

        temporary = output.with_name(f".{output.name}.{os.getpid()}.part")
        temporary.unlink(missing_ok=True)
        try:
            result = gdown.download(
                f"https://drive.google.com/uc?id={FILE_ID}",
                str(temporary),
                quiet=False,
            )
            if result is None or not temporary.is_file():
                raise RuntimeError("Google Drive download did not produce an archive")
            verify_archive(temporary)
            os.replace(temporary, output)
        finally:
            temporary.unlink(missing_ok=True)
        print(f"Downloaded and verified official archive: {output}")

    if args.extract_to:
        destination = args.extract_to.resolve()
        safe_extract(output, destination)
        print(f"Extracted pinned official client: {destination}")


if __name__ == "__main__":
    main()
