# Roadwork, wheel zoom and browser audio investigation — 2026-11-07

After confirming that the game is used in the browser, this investigation examined wheel input and audio callbacks in a real browser together with real OpenGL game drawing. It goes beyond the earlier road and shared-UI analyses, whose measurements excluded screen drawing, by also including canvas updates and draw/sync.

## Reproduced causes

### Off-screen path updates when zooming

The wheel event itself measured as a camera update of under 1µs. What followed was expensive: once the parent scene's zoom matrix changed, GPU paths were prepared again for the trees, rocks and mountains of the whole island and even for past fog masks. Unlike the editor, the regular game kept its static tree rows active even off screen.

Conservative row bounds are now built from every point and control point of the static paths, and off-screen rows get an opacity of 0. ThorVG GL skips path preparation in that case. Past fog circles also record their actual soft outer radius and are excluded when off screen. A margin for the screen edges is included, and scene order, fog compositing and building assets are unchanged. Pixels were checked to match a full software render exactly after zooming, panning, new discoveries and map resets.

### Stalls as exploration records grow

`paintFog` checked every other circle for each sight circle to determine containment. With 4,096 records this took about 72ms. It now uses descending radius order and a spatial index so that only circles that could contain it are checked. The actual distance test and the final drawing order are unchanged, and special inputs use the original all-pairs comparison. WorldMap's exploration records and revealed area are neither deleted nor compacted.

| Fog rebuild / record count | CPU before | CPU after |
| --- | ---: | ---: |
| 1,024 records | 4.709ms | 0.344ms |
| 4,096 records | 71.704ms | 1.527ms |

These are medians of three alternating before/after runs at O3.

### How browser audio relates to frame delays

The current SDL3 Emscripten backend calls the mixer from `ScriptProcessorNode.onaudioprocess`. This callback runs on the same browser main thread as game rendering, so long frames can also delay the audio supply. The audio period in the actual test was 42.67ms.

Separate problems were also reproduced in the audio code itself.

- Sound effects were removed only at buffer ends, so the point where a sound's tail was cut off depended on how the buffers were split. Rendering the same 2 seconds in one pass and in 257-frame chunks originally differed in 35,050 samples. With termination handled per sample and the last 10ms faded out, the two results are now identical.
- The 4.4kHz cricket waveform used absolute time as a float. After 256 seconds, the spacing of representable time values exceeded the audio sample interval and the waveform became rough. Computing that phase in double reduced the regression test's maximum adjacent-sample change 0.01195→0.00751.
- Each SDL request created a buffer and reallocated the active voice vector. A fixed-size callback scratch buffer and reused vectors are now used. Fixed panning for voices and music is computed at creation, and the set of continuously playing speakers is reused as well.
- While the vector was moved out during mixing, new sound effects could bypass the limit and pile up. In-flight voices are now counted inside the lock as well, preventing excess buildup and CPU spikes.

Median CPU time for mixing 512 frames went 0.616→0.509ms for music and 1.050→0.887ms for music plus 24 sound effects. Mixer C++ allocations for 3 sustained character voices went 4→0 per buffer. The browser buffer size was not changed.

## Real browser results

In an isolated, muted headless Chromium with ANGLE/NVIDIA RTX3060Ti, WebGL2 and a logical size of 1280×767, the previous deployed build and the latest verified build were compared on the same demo and wheel input. rAF callback execution time includes game processing and WebGL submission, but is not pure GPU time from GPU timestamps. The deployed-build comparison also includes shared engine and building changes that were integrated alongside, so the overall differences below should not be attributed to any single change.

| Wheel-input segment | Previous deployed build | Fixed build |
| --- | ---: | ---: |
| Frame processing mean | 25.79ms | 14.68ms |
| Frame processing p95 | 61.20ms | 24.60ms |
| Frame processing max | 102.80ms | 35.60ms |
| Long Tasks of 50ms or more | 24 | 0 |
| Audio callback interval p95 | 80.60ms | 64.60ms |
| Callback intervals above 1.5× the period | 20/120 | 7/113 |

Callback intervals are a delay indicator, not a direct measurement of sample loss on a real device. Isolated large-interval samples remain after the fix, so this report does not claim that browser-wide scheduling delays have disappeared as well. The separately identified sound-effect boundary and long-run waveform defects were verified with automated audio regression tests.

Play and wheel input were also checked in the browser for the game embedded in the updated `GameEngine.html`. The wheel segment had a p95 of 18.3ms and 0 Long Tasks, and both browser runs ended without JS exceptions or game errors. The user's existing browser and server were not touched; a separate temporary server and an isolated profile were used.

## Renderer-only comparison

A hidden OpenGL 640×480 test on the same renderer scene, changing only the before/after code. It repeatedly zooms the camera and measures canvas update+draw+sync, excluding warm-up frames.

| Condition | Mean before→after | p95 before→after |
| --- | ---: | ---: |
| Initial town | 14.00→10.65ms | 17.81→13.51ms |
| 949 past sight records | 33.92→19.24ms | 45.79→26.17ms |

`tools/profile_gameplay.cpp` is a separate reproduction tool that creates 30 workers and 32 valid road plans in a real GameApp and draws them with real hidden OpenGL. `--sights 1024` adds the exploration state of a long session. Single samples of this full-game test were affected by concurrent work and parallel building changes, so the initial-town figures varied, and they were not used as evidence of a general FPS improvement rate. With past sight records, the full-frame p95 went 52.6→31.9ms. The raw values are kept in the files listed below.

## Verification and deployment

- Full native regression suite: **271 passed**, with no failures or skips.
- 8 new regression tests: audio buffer boundaries, long-run high-pitch precision, the concurrent sound-effect limit, tree/fog pixel preservation while zooming and panning, and sight containment tests and compositing order.
- Existing tests for voice delay, stopping, replacement, panning, music and Pause/Stop also passed.
- Hearthold and GameEngine from the web witheditor release build were verified in a real browser.
- The 8 verified HTML/JS/WASM/data files were deployed to `artifacts/web-witheditor`. The user's existing 8080 server was kept running. Pages that are already open need a hard reload to load the new WASM.
- All game instances, test browsers and temporary servers used for this work were shut down. Building JSON assets were not modified, and changes from parallel work were preserved.

To distinguish this from parallel work after the verification point, the deployed file hashes and the backup location of the previous files are recorded in `artifacts/performance-gameplay/web-manifest.json`. The last full regression log is `/tmp/tellin-road-profile/meson-logs/testlog.txt`.

Reproduction:

```sh
meson compile -C /tmp/tellin-road-profile Hearthold-gameplay-profile
SDL_AUDIODRIVER=dummy /tmp/tellin-road-profile/src/game/Hearthold-gameplay-profile --frames 240
SDL_AUDIODRIVER=dummy /tmp/tellin-road-profile/src/game/Hearthold-gameplay-profile --frames 120 --sights 1024
node tools/profile_browser_gameplay.mjs artifacts/web-witheditor /tmp/gameplay-browser.json
node tools/profile_browser_gameplay.mjs artifacts/web-witheditor /tmp/gameplay-embedded.json GameEngine.html
```

The browser tool uses Node22+ and Linux Chromium. If needed, specify the executable with `CHROMIUM_PATH`. It uses `--mute-audio`, an isolated profile and a temporary server, and cleans them up on exit.

The measurement files are in `artifacts/performance-gameplay/`: `browser-before.json`, `browser-after.json`, `browser-embedded-after.json`, `renderer-results.json`, `fog-results.json`, `audio-results.json`, `native-after.txt`, `native-history-after.txt`.
