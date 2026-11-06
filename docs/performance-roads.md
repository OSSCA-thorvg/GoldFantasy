# Road Construction Performance Analysis — 2026-11-07

Reproduced and reduced the CPU stalls that occur when several workers build and pave branching roads at the same time. The building JSON assets were not modified, and the live-update feature of the building catalog, which was being developed at the same time, was preserved.

## Causes and Changes

1. `RoadGraph::build` exhaustively compared the endpoints, intersections and adjacent roads of every segment, split roughly every 0.3 tiles. `Traffic::update` rebuilt this graph not only on construction progress but on any Town change, such as scouting or recruiting. As the number of roads grew, the cost became close to quadratic.
2. Every time construction or paving progress crossed a 5% boundary, it was handled as a full scene change. Besides the road surface, this rebuilt the building rows, lighting and the night mask, and checked tree state across the whole map.
3. The workers' A* priority computation called `hypot` repeatedly. Terrain grid regeneration was also investigated, but a separate measurement put it at about 66µs, so it was not the main cause of these large stalls.

The road graph now uses a spatial index so that only nearby candidates are compared. It keeps the existing distance test, first-node merging and selection order for equidistant roads, and long segments have an exhaustive-search fallback path that limits memory use.

Town distinguishes full changes, road changes and general scene changes. While roads are in progress, buildings and trees are kept, and if the intersection positions are unchanged, the existing road lighting and night mask are kept as well. If adding or reshaping roads changes trees or visibility, the general scene is still updated. Traffic checks only road changes and reuses the graph when the actually built segments are the same. Paving progress, paving completion and repairs therefore do not need to rebuild the graph.

The A* distance estimate was changed to an 8-direction grid distance that uses the same minimum cost. The rules for paved-road detours, unfinished bridges and corner passing are unchanged. In a separate CPU-time measurement, pathfinding cost dropped by about 9–12%.

## Measurements

Added `tools/profile_roads.cpp`, which runs the real Town/Traffic/WorldRenderer code. With no window, audio or server, it places 32 valid 20-tile roads and 30 workers on a 176×176 map with the same seed and advances it 1,200 times by 1/60 second each. Construction and paving are measured separately. Initial map generation and the first scene build are excluded from the frame statistics.

The values below are medians of the statistics from three alternating runs of identical GCC 16.2/O3 ship builds of the pre-change source copy and the post-change source. `steady_clock` measured the elapsed time of the simulation, Traffic and scene-update sections. GPU drawing, presentation and audio are not included, so these must not be read as overall game FPS figures. Absolute times may vary with other work on the same machine.

| CPU update section | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Construction: overall mean | 0.972ms | 0.250ms | 74% |
| Construction: overall p95 | 8.394ms | 1.742ms | 79% |
| Paving: overall mean | 10.591ms | 0.279ms | 97% |
| Paving: overall p95 | 127.005ms | 2.404ms | 98% |
| Paving: Traffic mean on change frames | 146.661ms | 0.047ms | 99.9% or more |

Separately, graph construction alone was compared for completed road networks at O2. Each road is 20 tiles long, and the figures below are means of 5 runs. This is a different test from the real frame statistics.

| Roads / segments | Before | After |
| --- | ---: | ---: |
| 8 / 536 | 7.037ms | 0.534ms |
| 32 / 2,144 | 95.026ms | 2.427ms |
| 128 / 8,576 | 1,264.922ms | 13.248ms |

The existing packaged executable was sampled with `--hidden --demo --frames 300`. The demo, which has only completed roads, could not reproduce the construction stalls, so the dedicated reproduction tool above was used. Sampling the pre-change paving reproduction with gprofng showed about 94% of inclusive CPU samples concentrated in `RoadGraph::build` and the distance calculations beneath it. These are short CPU samples, so time comparisons are based on the repeated benchmarks.

The raw per-run results are in `artifacts/performance-roads/results.json`, and the function profiles are in `baseline-functions.txt` and `after-functions.txt` in the same folder.

## Reproduction Commands

```sh
meson setup /tmp/hearthold-perf . -Dtargets=game -Dprofile=ship -Dtests=enabled
meson compile -C /tmp/hearthold-perf Hearthold-road-profile Hearthold-tests
SDL_AUDIODRIVER=dummy /tmp/hearthold-perf/src/game/Hearthold-road-profile --graph-only
SDL_AUDIODRIVER=dummy /tmp/hearthold-perf/src/game/Hearthold-road-profile --roads 32 --workers 30 --frames 1200
SDL_AUDIODRIVER=dummy /tmp/hearthold-perf/src/game/Hearthold-road-profile --roads 32 --workers 30 --frames 1200 --pave
SDL_AUDIODRIVER=dummy SDL_VIDEODRIVER=dummy meson test -C /tmp/hearthold-perf --no-rebuild --print-errorlogs
```

The profiling executable is built only when explicitly requested and is not installed into the default game package. To compare before and after the change, build both source copies with the same commands.

## Regression Verification

- On 200 random road networks, node order, connection degree and 2,000 paths matched the previous implementation exactly.
- 12 new regression tests: they check merging across spatial cell boundaries, connection choice at equal distance, negative coordinates, long intersecting segments, branch connections, detours via low-cost roads, bridge opening, disconnected terrain, scene retention during construction and paving, graph retention during scouting, recruiting and paving, and graph updates after reshaping, completion and demolition.
- The render regression tests also check software-canvas drawing and reuse after full-map invalidation.
- Ran the hidden OpenGL demo for a finite number of frames. The verification game and profiler were shut down after running, leaving no preview or server behind.

The full regression suite of **242 tests passed with no failures or skips**. After building together with the building-animation changes that came in afterward, 13 road, path and cache tests (including 1 existing road test) and the hidden OpenGL demo were additionally checked. The full test results are in the verification build at `/tmp/tellin-road-profile/meson-logs/testlog.txt`. The verification executable is `/tmp/tellin-road-profile/src/game/Hearthold`, and the existing distribution artifacts package was not overwritten.

## Remaining Investigation Candidates

The normal game view keeps the tree scene for the entire map. Culling off-camera scenes can be considered after separately measuring the conditions under which GPU load actually grows. Structural changes that spread path requests across multiple frames or make them asynchronous were not included, because this measurement did not show that they are needed.
