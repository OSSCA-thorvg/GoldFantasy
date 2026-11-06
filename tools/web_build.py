#!/usr/bin/env python3
"""Build the SDL3/ThorVG applications for WebAssembly with an isolated SDK cache."""

import argparse
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
THORVG_REVISION = "000bbd013ad716eb3f8a703084e4ac64ee9eb174"


def run(command, env, cwd=None):
    print("+", " ".join(map(str, command)), flush=True)
    subprocess.run(list(map(str, command)), env=env, cwd=cwd, check=True)


def meson_value(value):
    if isinstance(value, list):
        return "[" + ", ".join(meson_value(item) for item in value) + "]"
    return "'" + str(value).replace("\\", "\\\\").replace("'", "\\'") + "'"


def copy_notices(output, deps, compiler):
    directory = output / "licenses"
    directory.mkdir(exist_ok=True)
    notices = {
        "Hearthold.txt": ROOT / "LICENSE",
        "DejaVu.txt": ROOT / "src/ui/assets/fonts/DejaVuSans.LICENSE",
        "Unicode.txt": ROOT / "src/ui/text/font/UNICODE-LICENSE.txt",
        "stb.txt": ROOT / "subprojects/stb/LICENSE",
        "Voice.txt": ROOT / "src/game/assets/voice/NOTICE.md",
        "ThorVG.txt": deps / "thorvg-source/LICENSE",
        "RapidJSON.txt": deps / "thorvg-source/src/loaders/lottie/rapidjson/LICENSE",
        "Emscripten.txt": compiler / "LICENSE",
        "EmdawnWebGPU.txt": deps / "emscripten-cache/ports/emdawnwebgpu/emdawnwebgpu_pkg/webgpu/src/LICENSE",
    }
    for name, path in notices.items():
        if path.exists():
            shutil.copy2(path, directory / name)
    for path in (deps / "emscripten-cache/ports/sdl3").glob("*/LICENSE.txt"):
        shutil.copy2(path, directory / "SDL3.txt")
    lua_header = (ROOT / "subprojects/lua/lua.h").read_text()
    copyright_at = lua_header.index("* Copyright (C)")
    license_text = lua_header[copyright_at:lua_header.index("******************************************************************************/", copyright_at)]
    (directory / "Lua.txt").write_text("\n".join(line.removeprefix("* ").removeprefix("*") for line in license_text.splitlines()) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--emsdk", type=Path, default=os.environ.get("EMSDK"))
    parser.add_argument("--thorvg-source", type=Path, help="Read-only local ThorVG 1.2 checkout; otherwise download the pinned upstream revision")
    parser.add_argument("--build-dir", type=Path)
    parser.add_argument("--cpp-std", choices=["c++26", "c++23"], help="Override the project's C++26-first compiler selection")
    parser.add_argument("--deps-dir", type=Path, default=ROOT / "build-web-deps")
    parser.add_argument("--profile", choices=["witheditor", "dev", "ship"], default="witheditor")
    parser.add_argument("--renderer", choices=["gl", "wgpu"], default="gl")
    parser.add_argument("--targets", default="game,engine")
    parser.add_argument("--engine-mode", choices=["standalone", "library"], default="standalone")
    parser.add_argument("--buildtype", choices=["plain", "debug", "debugoptimized", "release", "minsize"], default="debugoptimized")
    parser.add_argument("--jobs", type=int, default=min(os.cpu_count() or 2, 8))
    parser.add_argument("--dependencies-only", action="store_true")
    args = parser.parse_args()
    selected = set(args.targets.split(','))
    if "game" in selected and args.profile == "witheditor":
        selected.add("engine")
    deps = args.deps_dir.resolve()
    build = (args.build_dir or ROOT / ("build-web-" + args.profile + "-" + args.renderer)).resolve()
    deps.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    # Native pkg-config paths must not override the cross-compiled dependency prefix.
    env["PKG_CONFIG_PATH"] = ""
    if args.emsdk:
        sdk = args.emsdk.resolve()
        compiler = sdk / "upstream/emscripten"
        env["EMSDK"] = str(sdk)
        env["EM_CONFIG"] = str(sdk / ".emscripten")
        env["PATH"] = str(compiler) + os.pathsep + env.get("PATH", "")
    else:
        found = shutil.which("em++")
        if not found:
            parser.error("Pass --emsdk or activate the Emscripten SDK first")
        compiler = Path(found).resolve().parent
    env["EM_CACHE"] = str(deps / "emscripten-cache")
    prefix = deps / "thorvg-install"
    source = deps / "thorvg-source"
    if not source.exists():
        source.mkdir()
        if args.thorvg_source:
            archive = subprocess.check_output(["git", "-C", str(args.thorvg_source.resolve()), "archive", "HEAD"])
            with tarfile.open(fileobj=io.BytesIO(archive)) as contents:
                contents.extractall(source, filter="data")
        else:
            url = f"https://codeload.github.com/thorvg/thorvg/tar.gz/{THORVG_REVISION}"
            with urllib.request.urlopen(url) as response:
                archive = response.read()
            with tarfile.open(fileobj=io.BytesIO(archive)) as contents:
                members = contents.getmembers()
                for item in members:
                    item.name = "/".join(item.name.split("/")[1:])
                contents.extractall(source, members=[item for item in members if item.name], filter="data")
    cross = deps / "emscripten.ini"
    # ThorVG 1.2 leaves the output chain uninitialized. Emdawn requires null.
    wg_source = source / "src/renderer/gpu_engine/wg/tvgWgRenderer.cpp"
    wg_code = wg_source.read_text()
    fixed_wg_code = wg_code.replace("WGPUSurfaceCapabilities capabilities;", "WGPUSurfaceCapabilities capabilities{};")
    patched = fixed_wg_code != wg_code
    if patched:
        wg_source.write_text(fixed_wg_code)
    ports = ["--use-port=sdl3", "--use-port=emdawnwebgpu"]
    pkgpaths = [prefix / "lib/pkgconfig", prefix / "lib/wasm32-emscripten/pkgconfig"]
    cross.write_text("\n".join([
        "[binaries]",
        "c = " + meson_value(compiler / "emcc"),
        "cpp = " + meson_value(compiler / "em++"),
        "ar = " + meson_value(compiler / "emar"),
        "strip = " + meson_value(compiler / "emstrip"),
        "pkg-config = " + meson_value(shutil.which("pkg-config") or "pkg-config"),
        "[host_machine]", "system = 'emscripten'", "cpu_family = 'wasm32'", "cpu = 'wasm32'", "endian = 'little'",
        "[properties]", "needs_exe_wrapper = true", "pkg_config_libdir = " + meson_value(pkgpaths),
        "[built-in options]", "pkg_config_path = []", "c_args = " + meson_value(ports), "cpp_args = " + meson_value(ports + ["-fexceptions"]),
        "c_link_args = " + meson_value(ports), "cpp_link_args = " + meson_value(ports), "",
    ]))
    thorvg_build = deps / "thorvg-build"
    patch_stamp = deps / "thorvg-browser-compat-v1"
    if patched or not patch_stamp.exists() or not (prefix / "lib/pkgconfig/thorvg-1.pc").exists():
        command = ["meson", "setup", thorvg_build, source, "--cross-file", cross, "--prefix", prefix, "--libdir", "lib",
                   "-Ddefault_library=static", "-Dengines=cpu,gl,wg", "-Dloaders=svg,lottie,ttf", "-Dthreads=false",
                   "-Dsimd=false", "-Dextra=", "-Dtests=false", "-Dbuildtype=release"]
        if (thorvg_build / "build.ninja").exists():
            command.append("--reconfigure")
        run(command, env)
        run(["meson", "compile", "-C", thorvg_build, "-j", args.jobs], env)
        run(["meson", "install", "-C", thorvg_build], env)
        patch_stamp.touch()
    if args.dependencies_only:
        return
    fonts = ROOT / "src/ui/assets/fonts"
    resources = ["--preload-file", str(fonts) + "@/fonts"]
    for component, filename, target in [("engine", ROOT / "src/GameEngine/assets/demo.lua", "/scripts/engine.lua"),
                                        ("game", ROOT / "src/game/scripts/hud.lua", "/scripts/hud.lua"),
                                        ("engine", ROOT / "src/GameEngine/assets/building.json", "/assets/engine-building.json"),
                                        ("game", ROOT / "src/game/assets/title", "/assets/title"),
                                        ("game", ROOT / "src/game/assets/buildings", "/assets/buildings")]:
        if component in selected and filename.exists():
            resources += ["--preload-file", str(filename) + "@" + target]
    # SDK 6.0.2's resizable Wasm views are incompatible with TextDecoder/WebGPU.
    # Keep memory growth, using ordinary replacement views for browser APIs.
    flags = ports + ["-fexceptions", "-sALLOW_MEMORY_GROWTH=1", "-sGROWABLE_ARRAYBUFFERS=0", "-sINITIAL_MEMORY=134217728", "-sMAXIMUM_MEMORY=2147483648",
                     "-sMIN_WEBGL_VERSION=2", "-sMAX_WEBGL_VERSION=2", "-sFULL_ES3=1", "-sFORCE_FILESYSTEM=1",
                     "-sEXIT_RUNTIME=0", "-sASSERTIONS=" + ("0" if args.buildtype in {"release", "minsize"} else "1"), "-lidbfs.js",
                     "-sEXPORTED_RUNTIME_METHODS=FS,IDBFS,addRunDependency,removeRunDependency,ccall"] + resources
    command = ["meson", "setup", build, ROOT, "--cross-file", cross, "-Dprofile=" + args.profile,
               "-Drenderer=" + args.renderer, "-Dtargets=" + args.targets, "-Dengine_mode=" + args.engine_mode,
               "-Dbuildtype=" + args.buildtype, "-Dtests=disabled", "-Dpkg_config_path=[]", "-Dcpp_args=" + meson_value(ports + ["-fexceptions"]),
               "-Dcpp_link_args=" + meson_value(flags)]
    if args.cpp_std:
        command.append("-Dcpp_std=" + args.cpp_std)
    if (build / "build.ninja").exists():
        command += ["--reconfigure", "--clearcache"]
    run(command, env)
    run(["meson", "compile", "-C", build, "-j", args.jobs], env)
    output = build / "web"
    output.mkdir(exist_ok=True)
    template = (ROOT / "web/index.html").read_text()
    targets = json.loads(subprocess.check_output(["meson", "introspect", "--targets", str(build)], env=env))
    pages = []
    for target in targets:
        if target["type"] != "executable" or not target.get("build_by_default", True):
            continue
        for filename in target["filename"]:
            executable = Path(filename)
            if executable.suffix != ".js" or not executable.is_file():
                continue
            name = executable.stem
            for artifact in executable.parent.glob(name + ".*"):
                if artifact.suffix in {".js", ".wasm", ".data"}:
                    shutil.copy2(artifact, output / artifact.name)
            page = output / (name + ".html")
            page.write_text(template.replace("@APPLICATION@", name).replace("@RENDERER@", args.renderer))
            pages.append(page.name)
    if not pages:
        if "game" in selected or ("engine" in selected and args.engine_mode == "standalone"):
            raise RuntimeError("No WebAssembly application was generated")
        print("WebAssembly libraries:")
        for target in targets:
            if target["type"] in {"static library", "shared library"} and target.get("subproject") is None:
                for filename in target["filename"]:
                    print(" ", filename)
        return
    copy_notices(output, deps, compiler)
    (output / "index.html").write_text("<!doctype html><meta charset=utf-8><title>Hearthold applications</title>" +
                                     "\n".join(f'<p><a href="{page}">{page[:-5]}</a></p>' for page in pages))
    print("Web applications:", output)
    print("Serve with: python3 -m http.server --directory", output, "8080")


if __name__ == "__main__":
    main()
