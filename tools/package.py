#!/usr/bin/env python3
"""Stage a native ship build with assets, runtime libraries, and a relative launcher."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile


def run(command, capture=False):
    command = list(map(str, command))
    if not capture:
        print("+", subprocess.list2cmdline(command) if os.name == "nt" else shlex.join(command), flush=True)
    result = subprocess.run(command, check=True, text=True, stdout=subprocess.PIPE if capture else None)
    return result.stdout


def introspect(build, name):
    return json.loads(run(["meson", "introspect", "--" + name, build], capture=True))


def staged_path(stage, prefix, directory):
    path = Path(directory)
    if not path.is_absolute():
        path = Path(prefix) / path
    return stage.joinpath(*path.parts[1:])


def system_library(path, system):
    path = path.resolve()
    if system == "windows":
        return path.is_relative_to(Path(os.environ.get("SystemRoot", "C:/Windows")).resolve())
    roots = ["/usr/lib", "/System/Library"] if system == "darwin" else ["/lib", "/lib64", "/usr/lib", "/usr/lib64"]
    return any(path.is_relative_to(Path(root).resolve()) for root in roots)


def dependencies(binary, system, search):
    if system == "linux":
        output = run(["ldd", binary], capture=True)
        for line in output.splitlines():
            line = line.strip()
            if "=> not found" in line:
                raise RuntimeError(f"Unresolved dependency of {binary}: {line}")
            if "=>" in line:
                name, location = line.split("=>", 1)
                yield name.strip(), Path(location.rsplit(" (", 1)[0].strip())
            elif line.startswith("/"):
                location = line.rsplit(" (", 1)[0]
                yield location, Path(location)
    elif system == "darwin":
        lines = run(["otool", "-L", binary], capture=True).splitlines()[1:]
        rpaths = []
        load_commands = run(["otool", "-l", binary], capture=True)
        for match in re.finditer(r"cmd LC_RPATH\s+cmdsize \d+\s+path (.*?) \(offset", load_commands):
            rpaths.append(match.group(1).replace("@loader_path", str(binary.parent)))
        for line in lines:
            name = line.strip().split(" (compatibility version", 1)[0]
            if name.startswith(("/usr/lib/", "/System/Library/")):
                yield name, Path(name)
                continue
            resolved = name.replace("@loader_path", str(binary.parent)).replace("@executable_path", str(search[0]))
            candidates = [Path(resolved)] if not name.startswith("@rpath/") else [Path(root) / name[7:] for root in rpaths]
            candidates += [root / Path(name).name for root in search]
            found = next((path for path in candidates if path.is_file()), None)
            if not found:
                raise RuntimeError(f"Cannot resolve {name} from {binary}; pass --runtime-library PATH")
            if found.resolve() != binary.resolve():
                yield name, found
    else:
        if shutil.which("dumpbin"):
            output = run(["dumpbin", "/DEPENDENTS", binary], capture=True)
            names = re.findall(r"^\s+([^\r\n]+\.dll)\s*$", output, re.MULTILINE | re.IGNORECASE)
        else:
            objdump = shutil.which("llvm-objdump") or shutil.which("objdump")
            if not objdump:
                raise RuntimeError("Windows packaging requires dumpbin or llvm-objdump/objdump to discover DLLs")
            names = re.findall(r"DLL Name:\s*(.+)", run([objdump, "-p", binary], capture=True))
        for name in names:
            name = name.strip()
            if name.lower().startswith(("api-ms-", "ext-ms-")):
                continue
            found = next((root / name for root in [binary.parent, *search] if (root / name).is_file()), None)
            if not found:
                raise RuntimeError(f"Cannot resolve {name} from {binary}; pass --runtime-library PATH")
            yield name, found


def bundle_runtime(binary, output, system, extra):
    destination = output / ("bin" if system == "windows" else "lib")
    destination.mkdir(exist_ok=True)
    search = [binary.parent, *(path.parent for path in extra)]
    search += [Path(item) for item in os.environ.get("PATH", "").split(os.pathsep) if item]
    if system == "windows":
        search += [Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32"]
    copied, imports, external = {}, {}, set()
    pending = [binary]

    def copy_library(name, source):
        name = Path(name).name
        if name in copied:
            if copied[name].resolve() != source.resolve():
                raise RuntimeError(f"Two different runtime libraries have the same name: {name}")
            return
        copied[name] = source
        shutil.copy2(source, destination / name)
        search.append(source.parent)
        pending.append(source)

    for path in extra:
        copy_library(path.name, path)
    visited = set()
    while pending:
        source = pending.pop()
        if source.resolve() in visited:
            continue
        visited.add(source.resolve())
        for name, path in dependencies(source, system, search):
            known_runtime = re.search(r"(thorvg|SDL3|wgpu_native)", path.name, re.IGNORECASE)
            if system_library(path, system) and not known_runtime:
                external.add(name)
                continue
            copy_library(name, path)
            imports[name] = Path(name).name

    binaries = [output / "bin" / binary.name, *(destination / name for name in copied)]
    if system == "linux":
        for target in binaries:
            for needed in run(["patchelf", "--print-needed", target], capture=True).splitlines():
                if needed in imports and needed != imports[needed]:
                    run(["patchelf", "--replace-needed", needed, imports[needed], target])
            run(["patchelf", "--set-rpath", "$ORIGIN/../lib" if target.parent.name == "bin" else "$ORIGIN", target])
    elif system == "darwin":
        for target in binaries:
            command = ["install_name_tool"]
            for name, filename in imports.items():
                command += ["-change", name, "@loader_path/../lib/" + filename]
            if target.parent == destination:
                command += ["-id", "@rpath/" + target.name]
            if len(command) > 1:
                run([*command, target])
            run(["codesign", "--force", "--sign", "-", target])
    return copied, sorted(external)


def copy_licenses(source, output, libraries, extra):
    directory = output / "share" / "licenses"
    directory.mkdir(parents=True)
    for name, relative in [("Hearthold.txt", "LICENSE"), ("stb.txt", "subprojects/stb/LICENSE"),
                           ("Unicode.txt", "src/ui/text/font/UNICODE-LICENSE.txt"),
                           ("voice-NOTICE.md", "src/game/assets/voice/NOTICE.md")]:
        shutil.copy2(source / relative, directory / name)
    lua = (source / "subprojects/lua/lua.h").read_text(encoding="utf-8")
    notice = lua[lua.rfind("/******************************************************************************"):].split("#endif", 1)[0]
    if "Permission is hereby granted" not in notice:
        raise RuntimeError("Cannot locate Lua copyright notice")
    (directory / "Lua.txt").write_text(notice, encoding="utf-8")

    supplied = set()
    for entry in extra:
        name, separator, filename = entry.partition("=")
        path = Path(filename if separator else name).expanduser().resolve()
        name = name if separator else path.stem
        if not name or Path(name).name != name or name in {".", ".."}:
            raise RuntimeError("--license must use a simple NAME=PATH")
        target = directory / name
        if path.is_dir():
            shutil.copytree(path, target)
        else:
            shutil.copy2(path, target)
        supplied.add(re.sub(r"[^a-z0-9]", "", name.lower()))
    missing = []
    for component, aliases, pattern in [("ThorVG", ["thorvg", "ThorVG", "libthorvg"], "thorvg"),
                                         ("SDL3", ["sdl3", "SDL3", "libsdl3"], "sdl3"),
                                         ("wgpu-native", ["wgpu-native", "wgpu_native"], "wgpu_native")]:
        paths = [path for name, path in libraries.items() if pattern in name.lower()]
        if not paths or any(item.startswith(re.sub(r"[^a-z0-9]", "", component.lower())) for item in supplied):
            continue
        prefixes = [path.resolve().parent.parent for path in paths] + [Path("/usr"), Path("/usr/local")]
        candidates = [prefix / "share" / folder / alias for prefix in prefixes for folder in ["licenses", "doc"] for alias in aliases]
        found = next((path for path in candidates if path.is_dir() and any(path.iterdir())), None)
        if found:
            shutil.copytree(found, directory / component)
        else:
            missing.append(component)
    return missing


def launcher(output, system):
    if system == "windows":
        (output / "Hearthold.cmd").write_text('@echo off\r\n"%~dp0bin\\Hearthold.exe" %*\r\n', encoding="utf-8")
    else:
        path = output / "Hearthold"
        variable = "DYLD_LIBRARY_PATH" if system == "darwin" else "LD_LIBRARY_PATH"
        path.write_text('#!/bin/sh\nset -eu\nroot=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\n'
                        + f'export {variable}="$root/lib${{{variable}:+:${variable}}}"\n'
                        + 'exec "$root/bin/Hearthold" "$@"\n', encoding="utf-8")
        path.chmod(0o755)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("build_dir", type=Path)
    parser.add_argument("--output", required=True, type=Path, help="New directory for the relocatable package")
    parser.add_argument("--runtime-library", action="append", type=Path, default=[], metavar="PATH", help="Additional runtime library (repeatable)")
    parser.add_argument("--license", action="append", default=[], metavar="NAME=PATH", help="Additional dependency license file or directory (repeatable)")
    args = parser.parse_args()
    build, output = args.build_dir.expanduser().resolve(), args.output.expanduser().resolve()
    if output.exists():
        parser.error(f"Output already exists: {output}; choose a new directory")
    options = {item["name"]: item["value"] for item in introspect(build, "buildoptions")}
    if options.get("profile") != "ship" or set(options.get("targets", [])) != {"game"}:
        parser.error("Packaging requires a game-only ship build (-Dtargets=game -Dprofile=ship)")
    machines = introspect(build, "machines")
    system = machines["host"]["system"]
    if system not in {"linux", "darwin", "windows"} or any(machines["host"][key] != machines["build"][key] for key in ("system", "cpu_family")):
        parser.error("Use a native Linux, macOS, or Windows build; web builds use tools/web_build.py")
    if system == "linux" and not shutil.which("patchelf"):
        parser.error("Linux packaging requires patchelf to remove absolute build dependency paths")
    info = json.loads((build / "meson-info" / "meson-info.json").read_text(encoding="utf-8"))
    source = Path(info["directories"]["source"])
    targets = introspect(build, "targets")
    application = next((item for item in targets if item["name"] == "Hearthold" and item["type"] == "executable"), None)
    if not application:
        raise RuntimeError("Build has no Hearthold executable")
    binary = Path(application["filename"][0])
    if not binary.is_file():
        raise RuntimeError("Build Hearthold before packaging")
    extras = [path.expanduser().resolve(strict=True) for path in args.runtime_library]
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".hearthold-package-", dir=output.parent) as temporary:
        temporary = Path(temporary)
        stage, package = temporary / "install", temporary / "package"
        run(["meson", "install", "-C", build, "--no-rebuild", "--destdir", stage])
        (package / "bin").mkdir(parents=True)
        installed = staged_path(stage, options["prefix"], options["bindir"]) / binary.name
        shutil.copy2(installed, package / "bin" / binary.name)
        assets = staged_path(stage, options["prefix"], options["datadir"]) / "hearthold"
        shutil.copytree(assets, package / "share" / "hearthold")
        for name in ["fonts/DejaVuSans.ttf", "fonts/DejaVuSans-Bold.ttf", "fonts/DejaVuSans.LICENSE", "scripts/hud.lua"]:
            if not (package / "share/hearthold" / name).is_file():
                raise RuntimeError("Installed asset is missing: " + name)
        for asset in (source / "src/game/assets/buildings").glob("*.json"):
            installed_asset = package / "share/hearthold/assets/buildings" / asset.name
            if not installed_asset.is_file() or installed_asset.read_bytes() != asset.read_bytes():
                raise RuntimeError("Installed building asset is missing or stale: " + asset.name)
        libraries, external = bundle_runtime(binary, package, system, extras)
        missing_licenses = copy_licenses(source, package, libraries, args.license)
        launcher(package, system)
        manifest = {"profile": "ship", "renderer": options["renderer"], "platform": machines["host"],
                    "runtime_libraries": sorted(libraries), "system_dependencies": external,
                    "dependency_licenses_not_found": missing_licenses,
                    "files": {str(path.relative_to(package)): hashlib.sha256(path.read_bytes()).hexdigest()
                              for path in sorted(package.rglob("*")) if path.is_file()}}
        (package / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        package.rename(output)
    print("Package:", output)
    if missing_licenses:
        print("Dependency licenses not found locally:", ", ".join(missing_licenses), "(supply --license NAME=PATH)")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"package: {error}", file=sys.stderr)
        sys.exit(error.returncode if isinstance(error, subprocess.CalledProcessError) else 1)
