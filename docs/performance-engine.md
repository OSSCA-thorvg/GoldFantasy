# Shared engine performance analysis — 2026-11-07

Beyond game-specific rules, this analysis measured UI scene submission, the Lua UI bindings, input fields and shared geometry calculations. Five shared paths were improved; public functions, class layouts, game rules and building JSON assets were not changed. Concurrent in-progress changes to the engine Inspector and the building editor were kept.

## Changes applied

### UI scene submission

`Context::add` linearly searched all earlier paints to check whether a paint had already been submitted in the same frame. Submitting n paints took close to n² comparisons in total. `finishLayer` rebuilt a separate set every frame.

Each layer now uses a hash map that records each paint and its frame generation number. The existing vector still keeps the order. Hash nodes of live paints are reused in the next frame, and records of paints missing from the current frame are erased when the frame finishes. Duplicate checks and the finish step therefore grow linearly, and a paint that is no longer used is not kept alive by its record alone. The map is cleared when the generation number overflows. Layer moves, scene reference lifetimes and partial redraws keep their existing behavior.

### Draw cache keys

`paintKey` repeatedly grew the string capacity while appending each argument's bytes. It now reserves the full byte length, known at compile time, once. An isolated measurement of rectangle key creation showed 2→1 allocations and about 19→11ns. Key bytes and cache decisions are unchanged.

### Input fields

`textField` measured the width of the text before the cursor in every field. That value is used only for horizontal scrolling and cursor display in the focused field. It is now computed only when the field has focus. Text display and clipping in inactive fields, and Home/End, typing and scrolling in the active field, behave as before. The change adds no font width cache, so font updates cause no invalidation problems.

### Lua UI colors

`colorField` built a new `std::map` of 10 fixed theme names every time it read a color. The mapping between names and Theme members now lives in a `constexpr` array, and the current frame's actual theme values are read. Theme changes still take effect, and hex colors, defaults and error handling are unchanged. For 1,000 colored shapes, this change alone removes 10,000 map node allocations.

### Shared geometry calculations

`Footprint::overlaps` built two temporary vectors for the corners and grew the capacity of each three times. With fixed-size stack arrays and an internal span-based test function, **heap allocations per check dropped 6→0**. The public `corners()` keeps its return type; only its allocations dropped 3→1.

`contains()` first rejects distant points using conservative outer bounds that are wider than the actual rectangle at any rotation. Nearby points still go through the existing rotation and margin test. Corner order and polygon boundary tests are also unchanged.

## Before/after measurements on the same build

`tools/profile_engine.cpp` was added. Using GCC 16.2, C++23, O2/debugoptimized and ThorVG 1.2, the source before and after the changes was run alternately, three times each. Each item runs 5 warm-up iterations and then 200 iterations; the figures below are the median over 3 runs of the mean process CPU time. The Inspector source was made identical on both sides so that another agent's layout changes would not mix into the comparison.

**Windows, GPU drawing, presentation and audio are not included.** These are shared CPU processing costs before rendering, not a whole-game FPS improvement rate. The tool prints both CPU time and wall-clock elapsed time, but the comparison table uses CPU time to reduce the influence of scheduling waits.

| Task / work per iteration | Before | After | CPU reduction |
| --- | ---: | ---: | ---: |
| Submit 100 UI rectangles | 9.13µs | 5.74µs | 37% |
| Submit 2,000 UI rectangles | 0.680ms | 0.127ms | 81% |
| Submit 5,000 UI rectangles | 3.750ms | 0.316ms | 92% |
| 128 inactive input fields | 1.418ms | 0.030ms | 98% |
| 128 input fields, one active | 1.443ms | 0.036ms | 97% |
| 1,000 colored Lua shapes | 1.322ms | 0.606ms | 54% |
| 4,096 Footprint collision checks | 0.829ms | 0.576ms | 31% |
| 4,096 corner array returns | 0.268ms | 0.151ms | 44% |
| Real engine Inspector, 128 properties | 4.707ms | 3.917ms | 17% |

The 54% in the Lua measurement combines the shared submission, cache key and color improvements. A comparison that changed only color handling showed a reduction of about 28–29%. The real Inspector still carries the cost of text elision, so it does not drop as much as the shape-submission-only tests.

Ordinary C++ `operator new/new[]` calls were counted as well. The counts do not represent every Lua or ThorVG malloc, or GPU memory.

| Task | C++ allocations per iteration, before → after |
| --- | ---: |
| 5,000 UI rectangles | 20,009 → 10,000 |
| 1,000 colored Lua shapes | 14,009 → 2,000 |
| 128 inactive input fields | 1,925 → 1,024 |
| 4,096 collision checks | 24,576 → 0 |

Raw results are in `artifacts/performance-engine/results.json`. UI function samples are in `ui-before-functions.txt` and `ui-after-functions.txt` in the same folder. The sample counts are small, so they were not used to compare function shares precisely; the repeated timing measurements served as the basis instead.

## Verification and reproduction

- **135** standalone engine build tests and **250** game build tests passed with no failures or skips. The shared tests are counted in both builds.
- 8 new regression tests: they check paint order, duplicates, removal, layer moves and reference lifetimes; input focus and Home/End; all theme tokens plus theme changes and error handling; geometry boundaries and negative margins; and more.
- The existing partial redraw tests compare pixel results against a full redraw.
- Geometry tests were compared against the pre-change code on 200,000 random pairs and boundary combinations, with identical results.
- Hidden OpenGL runs of GameEngine and the game were each verified for 120 frames. No window was shown and desktop focus did not change; both exited after the run.
- The 4 changed shared source files also passed an Emscripten C++23 syntax-only compile. Full browser runtime performance is not included in these figures.

```sh
meson setup /tmp/hearthold-engine-perf . -Dtargets=engine \
  -Dengine_mode=standalone -Dtests=enabled --buildtype=debugoptimized
meson compile -C /tmp/hearthold-engine-perf Hearthold-engine-profile Hearthold-tests GameEngine
SDL_AUDIODRIVER=dummy /tmp/hearthold-engine-perf/src/Hearthold-engine-profile all
SDL_AUDIODRIVER=dummy SDL_VIDEODRIVER=dummy \
  meson test -C /tmp/hearthold-engine-perf --no-rebuild --print-errorlogs
```

Individual items can be selected with `ui`, `fields`, `lua`, `geometry` or `inspector`. The profiling executable is built only when explicitly requested and is not installed in the default package. The verification build is in `/tmp/tellin-engine-perf`, and the game verification build is in `/tmp/tellin-road-profile`.

## Remaining large candidates

The text elision routine `elideText` repeatedly computes glyph paths and Bézier bounds while getting `Text::bounds` for several candidate strings. The 128-label test stayed around 5ms both before and after, and this path also showed up in the post-change function samples. To reduce the Inspector's remaining CPU cost, this measurement path comes first.

A prototype per-frame text width cache helped elision with many common prefixes, but made plain measurement of distinct strings about 18% slower. A cache that spans frames would also have to handle invalidation when external fonts are re-registered, so it was not adopted. Later, a dedicated width measurement that exactly matches rendering, or a bounded cache with an explicit font generation number, could be validated separately.

Redundant sync and title setting in the shared GPU glue code cost less than the large costs found here, so they were left unchanged. Making CPU partial redraw the default was not included, because it gives GPU-based games no direct benefit and would also affect the existing buffer usage contract.
