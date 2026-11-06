**Map editor, shared terrain and visibility performance verification — 2026-11-07**

The tests used maps up to 256×256, a radius-12 brush, the whole-map view with large zoom changes, full in-game exploration and about 3,940 exploration history entries. The browser used a separate muted headless Chromium profile and NVIDIA RTX 3060 Ti ANGLE/OpenGL. All verification windows were hidden.

The shared preview is also updated by other work, so the final comparison was done in separate frozen folders. The pre-improvement source is `/tmp/tellin-map-baseline-source`, its web build is `/tmp/tellin-map-web-frozen-before/web`, and the post-improvement web copy is `/tmp/tellin-map-web-final-bundle`. Each browser result records the SHA-256 of the four files actually served and checks whether they changed during the run. Intermediate results obtained from concurrent compiles and the shared preview are in the `discarded-*` folders and were excluded from the final comparison.

Browser results at 1280×767. Units are ms, and each cell is **mean / p95**. Compiles and other verification were paused, and the before and after runs were executed sequentially.

| Workload | Before | After | After, recheck |
|---|---:|---:|---:|
| Whole-map view | 26.5 / 33.6 | 24.1 / 40.3 | 20.2 / 24.8 |
| Zoom in/out | 25.5 / 32.4 | 20.2 / 26.3 | 20.4 / 25.5 |
| Continuous radius-12 drag | 239.0 / 355.1 | 76.0 / 110.6 | 75.4 / 105.5 |
| Map view after painting a wide area | 59.7 / 77.8 | 18.6 / 23.0 | 19.0 / 23.2 |

Continuous painting p95 fell about 69%, and map view after painting p95 fell about 70%. For the initial whole-map view, the first measurement's p95 rose while its mean fell, and the recheck p95 was 24.8ms. While a very large brush is dragged continuously, a p95 of about 106–111ms and late audio callbacks still remain. Late audio callbacks in the map view after painting dropped from 21 to 0. Verification was muted, so this does not claim that audible stutter is fully resolved.

In the current roadwork demo, browser frame p95 was 13.9ms when still and 15.5ms with wheel input. The wheel segment had 0 long tasks and 3 late audio callbacks. The wheel p95 through the GameEngine launch path was 12.5ms. Both paths had 0 browser exceptions.

These are p95 values over 64 frames each, with native hidden OpenGL at 1280×800. game-open has all fog cleared, and game-fog has accumulated 3,940 exploration history entries. Each test changes zoom and camera substantially and includes the real canvas draw/sync. The large one-off costs of initial terrain generation and of caching new sections are kept separately under initial/max in the raw results.

| Workload | Before ms | After ms |
|---|---:|---:|
| editor-fit | 25.80 | 17.30 |
| editor-wheel | 53.51 | 35.04 |
| editor-paint | 37.86 | 30.95 |
| editor-drag | 87.52 | 64.50 |
| game-open | 39.12 | 41.22 |
| game-fog | 53.89 | 33.57 |

This table shows no improvement for the fully revealed in-game case (game-open). The cost of static objects such as trees and rocks across the whole map remains. Individual terrain tests improved, but this should not be read as an improvement of the same ratio for every scene.

Changes applied:

- Removed the internal edges of terrain marching-squares cells and connected only outlines and holes. The largest map's vertex count dropped from 583,898 to 166,094. Standalone GL terrain zoom p95 went 18.09→7.54ms. Region boundaries were compared against a reference image of independent cells.
- A single whole-map overview is kept, and only small edited sections are drawn over it. When a wide stroke ends, 32 or more accumulated patches are merged into the full overview, removing repeated compositing costs. Regenerating the full terrain can cause a one-off delay.
- The preview Town is kept, and only changed sections are copied. The preview also skips path grid generation. Undo stores only modified 16-tile blocks, which cut history memory for 24 radius-3 strokes from 187.25MB to 2.58MB. Map replacement uses a full snapshot.
- Fast mouse movement is handled as one capsule segment instead of hundreds of stamps. The same 25% smoothstep edge is used, but the overlap weight is computed once per input. CPU p95 for a radius-12 diagonal input across the whole map went 82.9→13.3ms.
- WorldMap sample access was made inline and noexcept, reducing Wasm detours through JS exception handling. invoke_fiiii sites in the terrain code went 98→6, and actual sample function calls 142→0. In a minimal reproduction, the median time to generate the largest map went 160.57→92.37ms, with identical computed checksums and vertex counts.
- Explored area and current sight are merged into a fixed 512² coverage map by max union, and the final fog and memory are drawn as a single RGBA image. Historical sight accumulates only new records, and current sight skips recomputation for the same input. Overlapping units do not widen sight beyond its edge. The existing radial profile is kept.
- Removed the easing that grew new sight over several seconds; sight at the new position takes effect in the same frame. Current sight also accumulates into the exploration field, which prevents the black border from clearing late because of the 4-tile spacing of logical exploration records. Existing gameplay exploration/dungeon discovery rules are kept. Visibility queries are also answered by sampling the field.

In a minimal sight reproduction, the mean draw time was 23.08ms for 4,096 circular masks and 0.073ms for the single image. At 512², updating 32 moving current sights took about 0.072ms, and 512 took about 0.752ms. These results measure sight alone and are not full game frame figures. GPU compositing is fixed at a single image, but CPU stamping work scales with the number and area of moving sights. CPU storage for coverage/scratch and RGBA is about 2MiB and does not grow without bound with map size or unit count.

Full native suite: **352 tests, 0 failed**. New checks cover the first frame of moving sight and previously explored areas, radius stability of overlapping sight, map replacement, terrain outlines, holes and chunk boundaries, brush direction, river removal, Undo/Redo and cancel, partial preview updates, and patch cleanup after a stroke ends. The existing AA differences that cliff batching produces between full and partial terrain are tolerated separately for a very small number of pixels; all other terrain is compared strictly.

Reproduction:

```sh
meson setup /tmp/tellin-map-check -Dtargets=game,engine -Dprofile=witheditor -Dtests=enabled --buildtype=debugoptimized
meson compile -C /tmp/tellin-map-check Hearthold-map-profile
SDL_AUDIODRIVER=dummy /tmp/tellin-map-check/src/game/Hearthold-map-profile editor-drag 64 256
SDL_AUDIODRIVER=dummy /tmp/tellin-map-check/src/game/Hearthold-map-profile game-fog 64 256
meson test -C /tmp/tellin-map-check --print-errorlogs
node tools/profile_browser_map.mjs WEB_DIR OUTPUT.json
node tools/profile_browser_gameplay.mjs WEB_DIR OUTPUT.json
```

Measurement data is kept in `artifacts/performance-map/`. Test browsers, games and servers are shut down, while the user's own 8080 server is preserved. Building assets were outside the scope of these performance changes.
