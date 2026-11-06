# Inspector and game HUD optimization — 2026-11-08

This work cut back the path that draws off-screen Inspector entries every frame and the game HUD's redundant text measurement, and applied the final link optimization missing from the default web build. It used C++26 native and Wasm builds, and changed only private implementations, using existing standard library features that MSVC also supports. Public headers and module APIs were not changed. An actual MSVC executable build could not be verified in this Linux environment.

## Changes made

- `GameEngine::propertiesPanel` submits the rows that overlap the current clip. The scroll height is still based on all rows, and a row holding an input being edited or a focused button is kept even off screen. Scrolling mid-edit and then pressing Enter therefore still commits the input.
- Scene Objects also submits the rows that overlap the clip. Tests were added that render the 6 visible objects out of 128 and that scroll to and select the last object. The selected ID is read once per list frame.
- The game resource HUD measures the width of each of its six strings once and reuses it for background layout, the text area and the next item's position. That is **18 → 6 measurements per frame**. Values are re-measured every frame, so resource or font changes show up immediately.

## Final Inspector before/after measurements

The existing `Hearthold-engine-profile inspector` was used. With GCC 16.2, C++26, O2/debugoptimized and the same ThorVG, the before and after executables were kept and run 5 times each in alternating order. The CPU core was pinned, and each run measures 200 frames after 5 warm-up frames. The values below are the median of the per-run means. They are CPU scene submission costs, excluding windows, GPU drawing and audio, and not a whole-game FPS improvement rate.

| Inspector with 128 properties | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| CPU time per frame | 3.537ms | 0.298ms | 91.6% |
| C++ allocations per frame | 9,227 | 1,262 | 86.3% |

Allocations are the profiler's `operator new/new[]` count and do not represent every Lua or ThorVG malloc, or GPU memory. Raw results are in [engine-final.json](../artifacts/performance-editor-runtime/engine-final.json).

## Web game link-stage optimization

The default `debugoptimized` build compiled C++ at O2, but the final `em++` link command had no optimization flag. Emscripten performs Binaryen and JavaScript optimizations when the final link uses O2 or higher. [Official guide](https://emscripten.org/docs/optimizing/Optimizing-Code.html#how-emscripten-optimizes).

The comparison kept identical object files and libraries and changed only the link option to O2. The SHA-256 of the `.data` file holding fonts and JSON also matches. Both were run 3 times each, in alternating order, in real Chromium WebGL 2 on an NVIDIA RTX 3060 Ti. The times below are medians of frame-callback statistics from each 30-event wheel test, not FPS itself.

| Item | No link optimization | Link O2 | Reduction |
| --- | ---: | ---: | ---: |
| Game Wasm | 4.36MB | 3.67MB | 15.7% |
| Game JavaScript | 580KB | 366KB | 36.9% |
| Wheel frame callback mean | 18.96ms | 14.50ms | 23.5% |
| Wheel frame callback p95 | 33.60ms | 26.30ms | 21.7% |

[File comparison](../artifacts/performance-editor-runtime/wasm-link.json), [raw browser results](../artifacts/performance-editor-runtime/wasm-link-browser.json).

The final settings apply per app. The default web build uses O2, Release uses O3 and Minsize uses Os. Debug adds no extra optimization, and the game's Dev build adds no final link optimization to its O0 input. A standalone GameEngine built alongside the Dev game follows its own buildtype. Native builds receive no web link flags. The actual generated commands for the five combinations are in the [configuration verification record](../artifacts/performance-editor-runtime/wasm-link-configurations.json).

Late audio callbacks were still observed, 28→25 in total over the 3 wheel runs. This report does not claim the audio delay is fixed; a follow-up investigation is needed to decouple audio callbacks from main-thread frame delays.

## Game and web verification

- Final native run: 42 UI and 48 engine tests passed. The 3 new regression tests check the number of submitted property rows, preservation of uncommitted input while scrolling, and object list scrolling and selection.
- The real game was run with a hidden OpenGL window and offline audio to measure a fixed camera and wheel input with 32 roads and 30 workers. Full frame times vary widely with GPU and system load, so they are not used as this work's FPS improvement rate. That initial measurement also included a text experiment that was later withdrawn.
- In the browser, the checks cover GameEngine staying stopped in Edit mode, property editing and Save/Load, Step, Play/Pause/Stop with state restored, audio output of 0 when stopped, and a standalone Lua scene. The editor checks also passed on the final O2-linked build. The game itself is checked with a fixed view and wheel input in real WebGL 2. Final results are kept in the [browser game record](../artifacts/performance-editor-runtime/browser-game-final.json).
- In the initial web before/after images, the RGB pixels of the toolbar, Inspector and footer were identical. `tree_painter` and `world_renderer` were being changed concurrently, so the world area was excluded from the pixel-equality comparison. [Comparison record](../artifacts/performance-editor-runtime/editor-pixels.json).

The full check found **14 failures** related to map shape, Ymir's position, trees and map editing. That map code was changed separately during this work and was not modified by it. This is not reported as a full pass. The failure names and the final results of the related tests are in [tests.json](../artifacts/performance-editor-runtime/tests.json).

## Items left for the next investigation

Reusing a temporary Text in text elision was tried. Allocations dropped, but the version that enlarged the shared Context storage was about 7% slower in the Lua shape test, and the version scoped to inside the call did not improve CPU time consistently either, so it was withdrawn from the final change. Text measurement currently uses the existing implementation.

Further candidates are the cost of exact glyph width calculation, building metadata vectors for many objects, and GPU path preparation when the camera moves. The next optimization should also compare before and after with the same executable, scene and build options.

```sh
meson setup build-perf -Dtargets=game,engine -Dprofile=witheditor \
  -Dcpp_std=c++26 -Dtests=enabled --buildtype=debugoptimized
meson compile -C build-perf Hearthold-engine-profile Hearthold-gameplay-profile
SDL_AUDIODRIVER=dummy build-perf/src/Hearthold-engine-profile inspector
SDL_AUDIODRIVER=dummy SDL_VIDEODRIVER=offscreen \
  build-perf/src/game/Hearthold-gameplay-profile --frames 90 --roads 32 --audio
```
