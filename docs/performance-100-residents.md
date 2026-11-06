# 100-resident workload and audio control — 2026-11-08

This records the initial investigation and its selected-only voice policy. The subsequent [visibility optimization and audio verification](performance-vision-audio.md) changes that policy to two nearby voices plus one selected voice and measures the visibility changes.

100 residents were assigned to real road work and measured. The largest cost right now is not resident AI but the sight and fog updates and the renderer's draw/sync path. Separately, automatic voices and work sounds from unselected residents are now blocked, and EffectManager limits how many sound effects and voices play at once.

## Workload check

`Town::recruit` adds 95 people to the 5 existing residents, and the official `orderRoadwork` command spreads them across 32 roads. The test checks the head count and that every order succeeded. The natural-arrival rule `Town::maxPeople = 30` is unchanged.

The CPU test builds an accessible flat work site on the seed-5 176×176 map and measures 600 frames at 1/60s intervals, that is, 10 seconds of game time. All 100 kept their work order every frame; on average 79.835 were doing road work and 20.165 were walking to the work site. Windows, audio and GPU drawing are excluded. 30 and 100 people ran from the same executable, a C++26, GCC 16.2, O2/debugoptimized build.

| CPU stage mean | 30 people | 100 people |
| --- | ---: | ---: |
| Simulation | 0.047ms | 0.100ms |
| Scene update in frames with no road change | 1.491ms | 1.701ms |
| CPU total | 1.676ms | 1.943ms |
| CPU total p95 | 2.778ms | 3.141ms |

Giving the initial orders to 100 people took 0.261ms in total. There is also an intermittent cost: on frames where a road changes, the Traffic path update averages 0.668ms. [Raw results](../artifacts/performance-100-residents/initial-cpu.json).

## Rendering cost in the real game

The same executable ran the real GameApp with ThorVG OpenGL, a hidden 1280×800 window and offline audio. 32 roads were placed on natural terrain, and each condition was measured for 300 frames. The values below are an initial diagnostic run and the baseline before the audio changes. Other map and character work was in progress at the same time, so they are not compared directly with later builds as improvement rates.

| Condition | GameApp update mean | draw/sync mean | Total mean | Total p95 |
| --- | ---: | ---: | ---: | ---: |
| 30 people, fixed view | 1.874ms | 4.585ms | 6.575ms | 9.051ms |
| 30 people, wheel input | 2.244ms | 7.462ms | 9.807ms | 14.332ms |
| 100 people, fixed view | 2.471ms | 7.959ms | 10.551ms | 14.083ms |
| 100 people, wheel input | 2.893ms | 11.119ms | 14.119ms | 19.662ms |

The p95 for 100 people with wheel input exceeds the 16.67ms budget of 60fps. draw/sync includes the CPU's renderer preparation and the wait for the GPU to finish, so it must not be read as pure GPU execution time. Offline audio mixing in this condition averaged 0.093ms. [Raw results](../artifacts/performance-100-residents/initial-game.json).

## Per-function bottlenecks

Callgrind recorded only the CPU test loop for 100 people and 300 frames, excluding setup. Of about 5.597 billion instructions in total, `WorldRenderer::update` accounted for 93.57% inclusive, and `updateVision` within it for 88.60%. These values are **shares of executed instructions**, not shares of CPU time, and shares of nested functions must not be added together. [Per-function record](../artifacts/performance-100-residents/callgrind-functions.txt).

The current sight code re-rasterizes the sight circles of moving residents, stamps the exploration mask, and then walks up to 512×512 sight and exploration values to update the fog image. The next optimization priorities are therefore a sight mask that updates only changed areas, fog pixel conversion and upload, and renderer path preparation while zooming. Exact sight boundaries and exploration state must be preserved, so this investigation did not lower the update rate or resolution.

## Selection-based audio and EffectManager

- Automatic voices are generated only for selected residents. Explicit lines from unselected residents can show as captions but play no voice. Deselecting discards pending voices and cancels ones already playing.
- Hammering and woodcutting work sounds count only selected residents. When the selection goes away, the work sounds fade out quickly. Combat events store resident IDs, so only the sounds of the actual selected attacker or target play.
- EffectManager manages up to 8 sound effects and 1 voice as separate budgets. Repeated requests for the same effect are subject to a cooldown and a per-kind limit. High-priority effects such as alarms can replace lower-priority ones.
- Excess requests are dropped immediately; there is no queue that plays them later. A new line from the same speaker replaces the previous one. Sounds the audio callback is still processing count against the budget as valid tokens and do not come back after Stop.
- Ambience, UI feedback and world alarms are kept. The work sounds of 100 residents are not made into 100 separate streams; the selected residents' work sounds are mixed into one bus. Character Studio's explicit voice preview is kept as well.

## Final verification

**20** audio-related native tests and **48** engine tests, including the C++ game module, passed. They check blocking automatic voices for 100 unselected people, cancelling voices on deselection, the work-sound selection filter, telling apart different combat units at the same position, a single waveform for 100 sound-effect requests, the concurrent-voice limit, the request limit during mixing, silence before Play, and Pause/Stop. [Audio tests](../artifacts/performance-100-residents/audio-tests.json), [engine tests](../artifacts/performance-100-residents/engine-tests.txt). This does not mean the whole game test suite passes.

The final C++26/Emscripten build ran in real Chromium WebGL 2 on an NVIDIA RTX 3060 Ti. At the time of the check all 100 were doing road work. With 0 selected there were 0 voices, with 100 selected there was 1 voice, and after deselecting again there were 0. Of 100 requests for the same sound effect, 1 was allowed and 99 dropped; 1.8 seconds later there were 0 active effects and 1 allowed in total, confirming that nothing played from a queue. There were no JavaScript exceptions either. [100-person browser record](../artifacts/performance-100-residents/browser-100.json).

In this capture the frame callback averaged 10.32ms/p95 16.30ms with a fixed view and 11.29ms/p95 17.90ms with wheel input. This is the frame callback cost, not the full display interval or FPS. A separate [30-person capture](../artifacts/performance-100-residents/browser-30.json) showed large swings, such as a 29.64ms wheel mean. These were short diagnostics that did not separate system load from game progress, so no browser 30↔100 ratio or optimization improvement rate was computed. Audio callback delays were observed 5 times in the 100-person wheel segment as well. This change controls bursts of simultaneous playback; it does not mean the browser main thread's audio scheduling delays are solved.

The GameEngine web check confirmed that Edit scene pixels stay still, property editing with Save/Load, time scale and Step, Play/Pause/Stop with state restored, and standalone Lua scenes. After Stop, output peak and energy were both 0 across 43 real audio callbacks. [Editor browser record](../artifacts/performance-100-residents/editor-web.json). The MSVC run could not be verified in this Linux environment.

## Reproduction

```sh
meson setup build-perf -Dtargets=game,engine -Dprofile=witheditor \
  -Dcpp_std=c++26 -Dtests=enabled --buildtype=debugoptimized
meson compile -C build-perf Hearthold-road-profile Hearthold-gameplay-profile Hearthold-residents-profile
SDL_AUDIODRIVER=dummy build-perf/src/game/Hearthold-road-profile --roads 32 --workers 100 --frames 600
SDL_AUDIODRIVER=dummy SDL_VIDEODRIVER=offscreen \
  build-perf/src/game/Hearthold-gameplay-profile --roads 32 --workers 100 --frames 300 --audio
```

`Hearthold-residents-profile` is an optional target that uses the real game, host and audio. It is not part of the default app build or the package install. It supports `--workers 5..1000`, and native checks run with the default hidden window. On the web, the same target and `tools/profile_browser_gameplay.mjs` check real WebGL and the audio policy.
