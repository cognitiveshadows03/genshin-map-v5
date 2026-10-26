#!/usr/bin/env python3
"""Keep the smallest verified compression candidate and discard the others."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--candidates", type=Path, nargs="+", required=True)
    args = parser.parse_args()
    if len(args.candidates) < 2:
        raise ValueError("At least two compression candidates are required")
    output = args.output.resolve()
    candidates = [path.resolve() for path in args.candidates]
    if output in candidates or len(set(candidates)) != len(candidates):
        raise ValueError("Candidate paths must be distinct and different from the output")

    entries = []
    for path in candidates:
        report_path = path.with_suffix(path.suffix + ".json")
        report = json.loads(report_path.read_text(encoding="utf-8"))
        if not path.is_file() or path.stat().st_size != report["archiveBytes"]:
            raise RuntimeError(f"Candidate size mismatch: {path}")
        if sha256(path) != report["sha256"]:
            raise RuntimeError(f"Candidate hash mismatch: {path}")
        if report.get("integrityTestPassed") is not True:
            raise RuntimeError(f"Candidate did not pass integrity testing: {path}")
        entries.append((path, report))

    baseline_size = entries[0][1]["archiveBytes"]
    winner_path, winner = min(entries, key=lambda entry: entry[1]["archiveBytes"])
    output.parent.mkdir(parents=True, exist_ok=True)
    output.unlink(missing_ok=True)
    os.replace(winner_path, output)
    if sha256(output) != winner["sha256"]:
        raise RuntimeError("Selected archive changed while being renamed")

    comparison = [{
        "dictionaryMiB": report["dictionaryMiB"],
        "archiveBytes": report["archiveBytes"],
        "selected": path == winner_path,
    } for path, report in entries]
    final_report = dict(winner)
    final_report.update({
        "archive": output.name,
        "compressionCandidates": comparison,
        "savedBytesVsBaseline": baseline_size - winner["archiveBytes"],
    })
    report_output = output.with_suffix(output.suffix + ".json")
    report_output.write_text(json.dumps(final_report, indent=2), encoding="utf-8")
    output.with_suffix(output.suffix + ".sha256").write_text(
        f"{winner['sha256']}  {output.name}\n", encoding="ascii"
    )

    for path, _ in entries:
        path.unlink(missing_ok=True)
        path.with_suffix(path.suffix + ".json").unlink(missing_ok=True)
        path.with_suffix(path.suffix + ".sha256").unlink(missing_ok=True)
    print(json.dumps(final_report, indent=2), flush=True)


if __name__ == "__main__":
    main()
