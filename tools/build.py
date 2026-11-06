#!/usr/bin/env python3
"""Configure and build native modules, GameEngine, or a game profile."""

import argparse
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]


def positive(value):
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be at least 1")
    return number


def run(command, dry_run=False):
    command = list(map(str, command))
    print("+", subprocess.list2cmdline(command) if os.name == "nt" else shlex.join(command), flush=True)
    if not dry_run:
        subprocess.run(command, cwd=ROOT, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, epilog="Examples: game dev --test; game ship --buildtype release --package dist/hearthold; engine library --buildtype debug")
    parser.add_argument("target", choices=["core", "ui", "game", "engine"])
    parser.add_argument("mode", nargs="?", help="game: witheditor (default), dev, ship; engine: standalone (default), library")
    parser.add_argument("--buildtype", choices=["plain", "debug", "debugoptimized", "release", "minsize"], default="debugoptimized", help="Meson build type; release uses O3 for every module regardless of game profile")
    parser.add_argument("--renderer", choices=["gl", "wgpu"], default="gl")
    parser.add_argument("--build-dir", type=Path)
    parser.add_argument("--cpp-std", choices=["c++26", "c++latest", "c++23"], help="Override the project's C++26-first compiler selection")
    parser.add_argument("--tests", choices=["auto", "enabled", "disabled"], default="auto")
    parser.add_argument("--test", action="store_true", help="Enable and run tests after building")
    parser.add_argument("--jobs", "-j", type=positive, default=min(os.cpu_count() or 2, 8))
    parser.add_argument("--configure-only", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="Print commands without changing files")
    parser.add_argument("--package", type=Path, metavar="DIR", help="Stage a game ship package after building")
    args = parser.parse_args()

    modes = {"game": ("witheditor", "dev", "ship"), "engine": ("standalone", "library")}
    if args.target in modes:
        args.mode = args.mode or modes[args.target][0]
        if args.mode not in modes[args.target]:
            parser.error(f"{args.target} mode must be one of: {', '.join(modes[args.target])}")
    elif args.mode:
        parser.error(f"{args.target} does not take a mode")
    if args.test and args.tests == "disabled":
        parser.error("--test conflicts with --tests disabled")
    if args.configure_only and (args.test or args.package):
        parser.error("--configure-only cannot run tests or package a build")
    if args.package and (args.target, args.mode) != ("game", "ship"):
        parser.error("--package requires game ship")

    components = [args.target, args.mode, args.renderer if args.target != "core" else None, args.buildtype]
    build = (args.build_dir or ROOT / "build" / "native" / "-".join(filter(None, components))).expanduser().resolve()
    info_file = build / "meson-info" / "meson-info.json"
    if info_file.exists():
        info = json.loads(info_file.read_text(encoding="utf-8"))
        if Path(info["directories"]["source"]).resolve() != ROOT:
            parser.error("Build directory belongs to a different source tree")
        machine_file = build / "meson-info" / "intro-machines.json"
        machines = json.loads(machine_file.read_text(encoding="utf-8"))
        if any(machines["host"][key] != machines["build"][key] for key in ("system", "cpu_family")):
            parser.error("Choose a native build directory; web builds use tools/web_build.py")
    profile = args.mode if args.target == "game" else "witheditor"
    engine_mode = args.mode if args.target == "engine" else "standalone"
    command = ["meson", "setup", build, ROOT, "--backend=ninja", "--buildtype=" + args.buildtype,
               "-Dtargets=" + args.target, "-Dprofile=" + profile, "-Dengine_mode=" + engine_mode,
               "-Drenderer=" + args.renderer, "-Dtests=" + ("enabled" if args.test else args.tests)]
    if args.cpp_std:
        command.append("-Dcpp_std=" + args.cpp_std)
    if (build / "meson-private" / "coredata.dat").exists():
        command.append("--reconfigure")
    run(command, args.dry_run)
    if args.configure_only:
        return
    run(["meson", "compile", "-C", build, "-j", args.jobs], args.dry_run)
    if args.test:
        run(["meson", "test", "-C", build, "--no-rebuild", "--print-errorlogs"], args.dry_run)
    if args.package:
        run([sys.executable, ROOT / "tools/package.py", build, "--output", args.package.expanduser().resolve()], args.dry_run)
    print("Build:", build)


if __name__ == "__main__":
    try:
        main()
    except (OSError, subprocess.CalledProcessError) as error:
        print(f"build: {error}", file=sys.stderr)
        sys.exit(error.returncode if isinstance(error, subprocess.CalledProcessError) else 1)
