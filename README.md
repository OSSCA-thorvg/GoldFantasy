# GoldFantasy

A settlement game and reusable ThorVG UI engine that prefer C++26, with an independent GameEngine application for Lua and C++ projects.

| Module | Purpose | Dependencies |
| --- | --- | --- |
| `core` | File loading, encoding, conflict checks, atomic saves | Standard library and OS APIs |
| `ui` | Controls, text, fonts, Lua UI, CPU/OpenGL/WebGPU rendering | `core`, ThorVG, bundled Lua |
| `GameEngine/GameFramework` | Geometry, cameras, animation, JSON building assets and their renderer | `core`, ThorVG |
| `engine` | Live properties, Lua reload, Play/Pause/Stop, optional C++ projects | `core`, `ui`, GameFramework; SDL host only for standalone mode |
| `game` | World simulation, characters, gameplay and optional authoring tools | `core`, `ui`, GameFramework, SDL host |

The GameEngine library has no game or SDL dependency. Applications can embed it through `engine::create()` and the shared [`ui::Application`](src/ui/application.h) interface.

The native game opens the GoldFantasy title scene. **Start Game** starts a new settlement; **Continue** resumes the in-memory session or loads the saved settlement after restarting the application. **Save** and Ctrl/Cmd+S save the current game atomically to the SDL user preference directory (`GoldFantasy/GoldFantasy/continue.goldfantasy`). Use `--save-file PATH` to choose another file. **Back to Title** preserves the current session while returning to the title.

**Character Studio** and **Map Editor** open independent authoring scenes from the title. Returning from either does not edit the active settlement. The map editor's Play action starts a new game scene using the authored map. The title landscape comes from the supplied reference in `src/game/assets/title`.

## Native build

Requires a C compiler and a compiler with C++23 support or newer, Meson 1.3+, Ninja, pkg-config and Python 3. UI builds need ThorVG 1.2+ and, on Linux, Fontconfig. Native applications additionally require SDL3 3.2+ and `wgpu_native` discoverable through pkg-config. Enable ThorVG's GL/WG renderers and TTF/Lottie loaders; the CPU renderer is used by UI library clients and rendering tests. Lua 5.4.8 is bundled. A core-only build needs no graphics dependencies.

New build directories select the first supported mode from `c++26,c++latest,c++23`: GCC/Clang/Emscripten use C++26 when available, and MSVC uses `/std:c++latest` until it has a dedicated C++26 mode. MSVC-style compilers also receive supported conformance, `__cplusplus`, preprocessor and UTF-8 options. Run native MSVC builds from a Visual Studio Developer terminal with dependencies built for the same toolchain; compiler mode selection alone does not verify the Windows port.

C++26 features must be checked with their `__cpp_*` or `__cpp_lib_*` feature macros and retain a portable fallback when needed by MSVC, Emscripten or the C++23 compatibility build. Standard reflection is not required: the editor uses portable member metadata because enabling C++26 does not guarantee reflection support. Third-party libraries retain their own language settings. See [Meson's standard selection](https://mesonbuild.com/Builtin-options.html#compiler-options), [MSVC language modes](https://learn.microsoft.com/en-us/cpp/build/reference/std-specify-language-standard-version), and [Clang's feature status](https://clang.llvm.org/cxx_status.html).

Existing build directories keep their saved standard. Update them explicitly, or require a specific mode:

```sh
meson configure build -Dcpp_std=c++26,c++latest,c++23
meson setup build-cpp23 -Dcpp_std=c++23
```

```sh
meson setup build -Dtargets=game -Dprofile=witheditor -Drenderer=gl
meson compile -C build
build/src/game/Hearthold
build/src/GameEngine/GameEngine
```

Both applications accept `--renderer gl|wgpu`. `-Drenderer` selects the default; applications require a working GPU backend.

New games start in the world as designed: a continent in three realms, Niflheim's ice to the north and Muspelheim's fire to the south of Ginnungagap, where the stone giant Ymir sits. `--world random` rolls a fresh world and prints its seed; `--seed N` starts in that world again.

The starting party consists of two human settlers: Askr (male) and Embla (female).

`profile` selects game features and its default compiler settings:

| Game profile | Default optimization | Included authoring tools |
| --- | --- | --- |
| `witheditor` (default) | O2, debug symbols and assertions | Map Editor, Character Studio, Building Studio, game module, GameEngine |
| `dev` | O0, debug symbols and assertions | None |
| `ship` | O3, assertions and debug symbols disabled | None; tests disabled by default |

`--buildtype=release` uses **O3 for every module**, including game code with `witheditor` or `dev`. Web release builds also pass `-O3` to the Emscripten linker. Game profiles still control authoring tools, debug symbols and assertions; other build types retain the defaults above.

Core, UI and GameEngine optimization otherwise follow Meson's `--buildtype`. Select modules and GameEngine mode separately:

```sh
meson setup build-core -Dtargets=core --buildtype=release
meson setup build-ui -Dtargets=ui --buildtype=debugoptimized
meson setup build-engine -Dtargets=engine -Dengine_mode=standalone --buildtype=debug
meson setup build-engine-lib -Dtargets=engine -Dengine_mode=library --buildtype=release
meson compile -C build-engine
```

The build helper configures and compiles the same targets:

```sh
python3 tools/build.py game dev --test
python3 tools/build.py engine library --buildtype=release
python3 tools/build.py core
python3 tools/build.py ui
python3 tools/build.py game ship --buildtype=release --package dist/hearthold
```

Use `--build-dir PATH` to choose its output directory, and `--cpp-std c++26|c++latest|c++23` to override its language mode, including an existing build. Packages include assets and third-party graphics runtime libraries; system libraries remain platform dependencies. Linux packaging also requires `patchelf`.

## GameEngine and Lua

The standalone GameEngine opens a Lua demo without the game. Edit its source externally: valid saves reload automatically, preserving runtime state and edited properties. Use Play/F5, Pause/F6 and Stop/F7; properties remain editable in every mode. Save/Load persists authored property values beside the script. See the [Lua project API](src/GameEngine/README.md).

```sh
build/src/GameEngine/GameEngine --script src/GameEngine/assets/demo.lua
build/src/GameEngine/GameEngine --building-editor
build/src/GameEngine/GameEngine --module build/src/game/libhearthold-project.so
build/src/game/Hearthold --ui-script src/game/scripts/hud.lua
```

The module example uses the Linux filename; use the library produced for your platform. C++ modules implement `ui::Application` and the exports shown in [`game/module.cpp`](src/game/module.cpp), using a compatible compiler and C++ ABI. Pass both `--module` and `--script` to add Lua UI to a native project.

In `witheditor` games, Character Studio and Map Editor are available from the title scene; F4 opens Building Studio. Launch directly with `Hearthold --character-studio`, `--map-editor`, or `--building-studio`.

Character Studio edits static reference-derived heads: the original artwork plus earlier reference pools, independent skull/jaw interpolation, dot or open eyes, separate eyebrow controls, hair fitting anchors, and 14 copied whole outfit sets. Gender tags guide weighted asset selection. Face variations preserve the selected outfit, and Human/God metadata remains independent. See the [character assets, controls and regeneration workflow](docs/character-system/README.md).

Building appearances live in [`src/game/assets/buildings`](src/game/assets/buildings) as JSON. Use **Buildings** in GameEngine or **Building Studio** in the game to edit blocks, roofs, colors and details, with rotation and construction previews. **Save** writes the asset; **Apply** updates the running game. Gameplay costs and collision footprints remain game rules. See the [asset format and editor workflow](docs/building-assets.md).

Press `1` for the road pen: hold and draw in one continuous stroke, then release to build. Endpoints join nearby roads; `Esc` cancels the stroke.

Select units and press `M` (Move), `A` (Attack) or `W` (Work), then right-click a target. The cursor shows the pending command. Trees and rock deposits accept Attack or Work. A new Move or Attack immediately interrupts harvesting. Move follows its destination without fighting, gathering or delivery detours; Attack on the ground fights nearby enemies while advancing. `S` stops the selected units; `T` toggles Auto. Auto-off residents stay put between orders, and nightfall does not send residents to bed.

With nothing selected, hover over the thin handle at the bottom center to expand **Build**. The same surface morphs between categories, building choices and unit information; its centered width follows the number of buttons. Selecting a unit suppresses the global hover handle, and the unit **Build** button or `B` reuses the surface for the selected crew. Global building choices assign an available resident, including idle residents with Auto off. Existing direct orders take priority; stopped residents wait for a new request. Road construction starts from the connected portion of the network, including when another unfinished road must be built first.

Unit conditions appear as simultaneous tags beside the current action: a resident can be cold, hungry and exhausted while building. Auto handles meals, fatigue and stress before resuming a saved order; a condition without an available remedy does not repeatedly restart the action. Blocked construction stays waiting until clearance is possible.

Right-click their own housing with units selected to send them inside to rest. With no units selected, click the building to see its residents, incoming units and current occupants. Click a resident's name to control them; **Leave** exits through the door and holds outside. A Move order also interrupts rest. Explicit rest continues until a new order, including after rest is full; available beds are reserved as units are sent.

Auto residents without a job or player order stroll around the settlement looking for work. They harvest nearby trees or exposed boulders when storage has room, using an axe or pickaxe, then carry three units to a reachable camp or store. Resources enter stock on delivery. Mined boulders disappear and remain depleted when maps are saved. Building and road plans preserve trees until workers clear them. See [gathering behavior and verification](docs/woodcutting.md).

Character voices reserve one channel for selected units and two for nearby unselected units. With no selection, up to two nearby units can speak; selecting a unit allows three voices in total. Work and combat sounds follow unit selection. The audio EffectManager admits at most eight effects, applies per-effect cooldowns and priorities, and drops excess requests without a replay queue. Environmental ambience and interface alerts remain available. See the [visibility optimization and audio verification](docs/performance-vision-audio.md).

The raid war horn and automatic battle music are disabled. Voice alerts and the other environmental sounds remain available.

## WebAssembly

With an installed Emscripten SDK, the web helper builds ThorVG and packages browser applications:

```sh
python3 tools/web_build.py --emsdk /path/to/emsdk --profile witheditor \
  --renderer gl --targets game,engine --build-dir build-web
python3 -m http.server --directory build-web/web 8080
```

Open `http://localhost:8080/Hearthold.html` or `GameEngine.html`. GL uses WebGL 2; `?renderer=wgpu` requires a browser with WebGPU on localhost or HTTPS. The browser dock supports Lua projects and building JSON upload. Use **Save in browser** to retain a building asset after reload, or **Download JSON** to keep a separate file. Browser files persist through IDBFS under `/data`. Browser game modules are linked statically; native dynamic modules are unavailable.

Web applications use the same C++26-first selection. Pass `--cpp-std c++26` to require it, or `--cpp-std c++23` for a compatibility build; this does not change ThorVG's own language mode. Use `--thorvg-source PATH` to build from a local checkout or `--dependencies-only` to prepare dependencies. Otherwise the helper downloads pinned ThorVG sources.

## Tests

```sh
meson test -C build --print-errorlogs
```

Tests follow the selected modules. Set `-Dtests=enabled` or `-Dtests=disabled` explicitly; `auto` enables them except for game `ship` builds. For isolated GameEngine coverage, configure with `-Dtargets=engine -Dengine_mode=library -Dtests=enabled`.
