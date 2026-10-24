#!/usr/bin/env python3
"""Run the Windows client under Wine/Xvfb and capture an offline smoke test."""
from __future__ import annotations
import argparse, json, os, shutil, signal, subprocess, time
from pathlib import Path


def run(command, env, check=False):
    try:
        return subprocess.run(command, env=env, text=True, stdout=subprocess.PIPE,
                              stderr=subprocess.STDOUT, check=check, timeout=15)
    except subprocess.TimeoutExpired as exc:
        return subprocess.CompletedProcess(command, 124,
                                           stdout=f"TIMEOUT after {exc.timeout}s: {command}")

def memory_sample(xvfb_pid, wine_session):
    result = {"availableMiB": None, "xvfbRssMiB": 0, "wineSessionRssMiB": 0}
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemAvailable:"):
                result["availableMiB"] = round(int(line.split()[1]) / 1024, 1)
    except OSError: pass
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit(): continue
        try:
            status = (entry / "status").read_text()
            rss = next((int(line.split()[1]) for line in status.splitlines() if line.startswith("VmRSS:")), 0)
            if int(entry.name) == xvfb_pid: result["xvfbRssMiB"] = round(rss / 1024, 1)
            stat = (entry / "stat").read_text()
            fields = stat[stat.rfind(")") + 2:].split()
            if len(fields) > 3 and int(fields[3]) == wine_session:
                result["wineSessionRssMiB"] = round(result["wineSessionRssMiB"] + rss / 1024, 1)
        except (OSError, ValueError, StopIteration): pass
    return result

def wine_path(path: Path):
    return "Z:" + str(path.resolve()).replace("/", "\\")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--client", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--seconds", type=int, default=105)
    parser.add_argument("--display", default=":88")
    parser.add_argument("--width", type=int, default=1600)
    parser.add_argument("--height", type=int, default=1000)
    parser.add_argument("--quality", help="Optional existing Unity quality level, e.g. 'Very Low'")
    parser.add_argument("--direct-gfx", action="store_true")
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--no-screenshots", action="store_true")
    parser.add_argument("--click-at", type=int, default=0, help="Click to enter after this many seconds")
    parser.add_argument("--click-x", type=int)
    parser.add_argument("--click-y", type=int)
    parser.add_argument("--no-copy-client", action="store_true")
    args = parser.parse_args()
    if args.click_x is None: args.click_x = round(args.width * 0.5)
    if args.click_y is None: args.click_y = round(args.height * 0.93)
    client = args.client.resolve()
    work = args.work.resolve()
    if work.exists(): shutil.rmtree(work)
    work.mkdir(parents=True)
    runtime_client = work / "client"
    if args.no_copy_client:
        runtime_client = client
    else:
        shutil.copytree(client, runtime_client)
    for name in ("prefix", "xdg", "screenshots"): (work / name).mkdir()
    os.chmod(work / "xdg", 0o700)
    env = os.environ.copy()
    env.update({"DISPLAY": args.display, "WINEPREFIX": str(work / "prefix"), "WINEARCH": "win64",
                "XDG_RUNTIME_DIR": str(work / "xdg"), "WINEDEBUG": "-all",
                "WINEDLLOVERRIDES": "winemenubuilder.exe=d;mscoree=d;mshtml=d",
                "LIBGL_ALWAYS_SOFTWARE": "1", "LP_NUM_THREADS": "1", "MALLOC_ARENA_MAX": "1"})
    xvfb_log = open(work / "xvfb.log", "w")
    wine_log = open(work / "wine.log", "w")
    unity_log = work / "unity-player.log"
    xvfb = subprocess.Popen(["Xvfb", args.display, "-screen", "0", f"{args.width}x{args.height}x24",
                             "-nolisten", "tcp", "-ac"], env=env, stdout=xvfb_log, stderr=xvfb_log)
    time.sleep(1)
    command = ["/usr/lib/wine/wine64", str(runtime_client / "Map.exe"), "-screen-fullscreen", "0",
               "-screen-width", str(args.width), "-screen-height", str(args.height), "-popupwindow",
               "-logFile", wine_path(unity_log)]
    if args.quality: command.extend(["-screen-quality", args.quality])
    if args.direct_gfx: command.append("-force-gfx-direct")
    if args.headless: command.extend(["-batchmode", "-nographics"])
    wine = subprocess.Popen(command, cwd=runtime_client, env=env, stdout=wine_log, stderr=wine_log,
                            start_new_session=True)
    started = time.time(); screenshots = []; observations = []; memory = []; clicked = False
    capture_at = [] if args.no_screenshots else [5, 12, 25, 45, 70, 95, 130, 170]
    capture_index = 0
    try:
        for second in range(1, args.seconds + 1):
            time.sleep(1)
            elapsed = round(time.time() - started)
            windows = run(["xdotool", "search", "--onlyvisible", "--name", ".*"], env)
            titles = []
            if windows.returncode == 0:
                for window in windows.stdout.splitlines():
                    title = run(["xdotool", "getwindowname", window], env).stdout.strip()
                    if title: titles.append({"id": window, "title": title})
            if args.click_at and not clicked and elapsed >= args.click_at:
                click = run(["xdotool", "mousemove", str(args.click_x), str(args.click_y), "click", "1"], env)
                observations.append({"elapsedSeconds": elapsed, "action": "click-to-enter",
                                     "x": args.click_x, "y": args.click_y, "returnCode": click.returncode})
                clicked = True
            if (capture_index < len(capture_at) and elapsed >= capture_at[capture_index]) or (second == args.seconds and not screenshots and not args.no_screenshots):
                if capture_index < len(capture_at): capture_index += 1
                shot = work / "screenshots" / f"screen-{elapsed:03d}.png"
                result = run(["import", "-window", "root", str(shot)], env)
                if shot.exists():
                    screenshots.append(str(shot))
                    observations.append({"elapsedSeconds": elapsed, "windows": titles,
                                         "screenshot": shot.name, "captureReturnCode": result.returncode})
            if elapsed % 10 == 0:
                sample = {"elapsedSeconds": elapsed, **memory_sample(xvfb.pid, wine.pid)}
                memory.append(sample)
                print(f"elapsed={elapsed}s wine_alive={wine.poll() is None} windows={titles} memory={sample}", flush=True)
            if wine.poll() is not None and elapsed > 15: break
            if elapsed >= args.seconds: break
    finally:
        if wine.poll() is None:
            run(["xdotool", "key", "alt+F4"], env)
            try: wine.wait(timeout=5)
            except subprocess.TimeoutExpired: pass
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try: os.killpg(wine.pid, sig)
            except ProcessLookupError: break
            try: wine.wait(timeout=3)
            except subprocess.TimeoutExpired: pass
            if wine.poll() is not None: break
        xvfb.terminate()
        try: xvfb.wait(timeout=5)
        except subprocess.TimeoutExpired: xvfb.kill()
        xvfb_log.close(); wine_log.close()
    unity_tail = unity_log.read_text(encoding="utf-8", errors="replace").splitlines()[-120:] if unity_log.exists() else []
    interfaces = sorted(os.listdir("/sys/class/net"))
    report = {
        "schemaVersion": 1, "client": str(client), "durationSeconds": round(time.time() - started),
        "networkIsolation": {"method": "unshare -Urn (caller)", "namespace": os.readlink("/proc/self/ns/net"),
                             "interfaces": interfaces, "isolated": set(interfaces) <= {"lo"}},
        "wineExecutable": "/usr/lib/wine/wine64", "wineExitCode": wine.poll(),
        "runtimeClient": str(runtime_client), "memorySamples": memory,
        "screenshots": screenshots, "observations": observations,
        "completionState": (runtime_client / "Map_Data" / "Resources" / "item_selected.json").read_text(
            encoding="utf-8", errors="replace") if (runtime_client / "Map_Data" / "Resources" / "item_selected.json").exists() else None,
        "unityLogExists": unity_log.exists(), "unityLogTail": unity_tail,
        "wineLog": str(work / "wine.log"), "xvfbLog": str(work / "xvfb.log"),
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("durationSeconds", "wineExitCode", "unityLogExists", "screenshots")}, indent=2), flush=True)

if __name__ == "__main__": main()
