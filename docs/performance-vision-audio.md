# Visibility optimization and three-speaker audio — 2026-11-08

Voices now reserve one channel for selected units and two for nearby unselected units. With no selection, two nearby units can speak; with a selected unit, three speakers can speak together. Effects retain their separate limit of eight, priorities and duplicate suppression. Work and combat sounds still follow selection.

Visibility updates rebuild the union only inside the combined old and new extents of changed sight sources. Unchanged sources overlapping that area also participate, preserving coverage supplied by other residents. Additions, removals, radius changes and reordered sources are handled. A preceding stamp or clear invalidates the source cache and forces a full rebuild.

Fog RGBA conversion uses the combined changed regions of current visibility and exploration. If the resulting pixels do not change, the ThorVG image is not reloaded. Resolution, colors, feathering, logical visibility and immediate frame updates are preserved. This does not add partial GPU uploads to ThorVG: reloading a changed image can still upload the whole texture.

## 100-resident CPU comparison

C++26, GCC 16.2 and O2/debugoptimized were used. Existing static libraries were frozen as normal archives. Only `visibility_map.cpp.o` and `world_renderer.cpp.o` were replaced for the optimized executable; simulation, characters, terrain, UI and profiler objects were identical. Both executables remain in `/tmp/tellin-vision-frozen-native`.

The controlled flat work yard has 100 residents and 32 roads. Each run measures 600 frames, or ten simulated seconds, pinned to CPU 9. Before/after order alternates across five runs each. All 100 residents retained their orders; an average of 79.835 were working and 20.165 were traveling. Values below are medians of run means and exclude GPU drawing. Other system work was active, so absolute timings varied.

| Stage | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Scene update without a road revision | 4.248ms | 1.494ms | 64.8% |
| Simulation, Traffic and scene update total | 4.934ms | 2.251ms | 54.4% |

Total run means ranged from 3.870–5.754ms before and 1.708–3.319ms after. [CPU captures](../artifacts/performance-vision-audio/cpu-comparison.json), [summary](../artifacts/performance-vision-audio/summary.json).

A separate Callgrind comparison of the same 30 frames counted **519,529,956 → 164,976,234 instructions, a 68.2% reduction**. This is an instruction count, not a time or FPS percentage. During this shorter movement-heavy interval, 95.6 residents were traveling and 4.4 were working on average. [Callgrind runs](../artifacts/performance-vision-audio/callgrind-runs.json).

## Actual OpenGL gameplay

The same frozen objects ran the real GameApp, ThorVG OpenGL and offline audio in a hidden 1280×800 window. Each condition has 100 residents, 32 roads and 120 frames. Before/after order alternates over three runs each. Values are medians of run means.

| Condition | Stage | Before | After |
| --- | --- | ---: | ---: |
| Still camera | GameApp update | 2.395ms | 1.126ms |
| Still camera | Whole frame | 13.133ms | 12.391ms |
| Wheel input | GameApp update | 3.078ms | 1.337ms |
| Wheel input | Whole frame | 19.714ms | 13.792ms |

Draw/sync includes renderer CPU preparation and waiting for GPU completion. Whole-frame variability was substantial: wheel run means ranged from 13.868–44.410ms before and 13.351–32.715ms after. These whole-frame numbers do not establish a stable FPS gain. The CPU update reduction is supported by repeat measurements and instruction counts; consistent GPU-stage gains need further isolation. [Gameplay captures](../artifacts/performance-vision-audio/gpu-comparison.json).

## Coverage and pixels

Tests move, remove, add and reorder 100 sight sources over 64 frames, including intervening stamp and clear operations, and compare each result with a fresh full union. They also check changed bounds, invalid/off-map/huge sights, feathering, immediate movement and retained exploration.

The actual WorldRenderer fog after 600 frames with 100 working residents was rendered over white into a 256×256 PPM. Every before/after pixel matches. Both SHA-256 hashes are `b1874a9c72db61c49958eac3469103d63a46f72d24c93d9922cb85f13968a2a7`. [Pixel comparison](../artifacts/performance-vision-audio/fog-pixels.json).

## Voice admission

- Two nearby voices cannot consume the selected unit's reserved channel. A speaker's replacement line invalidates the old voice; changing channels never duplicates that speaker.
- Selection changes cancel requests in the old channel and use the new channel's budget. Deselection allows a voice to join the nearby pool rather than muting every resident.
- Automatic speech requires an on-screen, visible, outdoor unit. Selected and nearby groups have separate active-dialogue limits and start spacing. Excess requests are dropped without a replay queue.
- Character Studio preview uses the selected channel. Edit, Pause and Stop retain their audio controls.

## Validation

The final native build passed **24 audio tests, 14 visibility/rendering tests and 48 engine tests: 86 targeted tests**. This is not a claim that every game test passed. [Test results](../artifacts/performance-vision-audio/tests.json).

The C++26/Emscripten build ran in an isolated muted Chromium browser using real WebGL 2 on an NVIDIA RTX 3060 Ti. The inspected workload had 100 assigned residents, all 100 working. Explicit speech requests produced two nearby voices with no selection, three voices with one selected resident, and one selected voice when every resident was selected. Deselection left two nearby voices. A burst of 100 identical effects admitted one and dropped 99; after 1.8 seconds the active count was zero with no additional admissions. There were no JavaScript exceptions. [Browser workload and audio results](../artifacts/performance-vision-audio/browser-100.json).

The browser editor check passed property edits, Save/Load, time scaling, Step, Play/Pause/Stop restoration and the standalone Lua scene. Edit scene metadata remained identical. A strict screenshot comparison detected 11 edge pixels with RGB differences of at most 2/255; the final WebGL comparison therefore permits at most 32 pixels at that precision while also requiring exactly unchanged scene properties. This tolerance does not apply to the CPU fog comparison, which remained byte-identical. Stop produced zero peak and energy across 43 real audio callbacks. [Editor results](../artifacts/performance-vision-audio/editor-web.json), [pixel diagnostics](../artifacts/performance-vision-audio/editor-pixel-diagnostics.json).

Nine late browser audio callbacks were still observed during the wheel capture. Voice admission prevents overlapping crowds and backlogs; it does not eliminate scheduling delays when browser rendering and audio share the main thread.

## Reproduction

```sh
meson compile -C build-perf Hearthold-road-profile Hearthold-gameplay-profile Hearthold-residents-profile
SDL_AUDIODRIVER=dummy build-perf/src/game/Hearthold-road-profile \
  --workers 100 --roads 32 --frames 600 --snapshot /tmp/fog.ppm
SDL_AUDIODRIVER=dummy SDL_VIDEODRIVER=offscreen \
  build-perf/src/game/Hearthold-gameplay-profile --workers 100 --roads 32 --frames 120 --audio
```

After explicitly building and packaging the optional web `Hearthold-residents-profile` target, run `HEARTHOLD_PROFILE_WORKERS=100 node tools/profile_browser_gameplay.mjs WEB_DIR OUTPUT.json Hearthold-residents-profile.html` to inspect worker counts and voice budgets. This profiler is not installed with the default applications. MSVC was not executed on this Linux machine; the changes use standard C++ and existing ThorVG APIs.
