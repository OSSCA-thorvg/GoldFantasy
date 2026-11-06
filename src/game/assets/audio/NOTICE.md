These sounds were rendered with Loach, a local audio engine (generator code GPL-3.0-or-later; the GPL does
not cover its output), and converted to Ogg Vorbis by `src/game/tools/import_loach_audio.py`. The game embeds
the files; it needs neither Loach nor any model, recording or network service.

- `music/`, `weather/`, `sfx/tree_fall_*`, `sfx/collapse_*` and `wildlife/raven_01` come from the
  "Nature of Greoni" pack: calculated from random seeds with no recordings, sample banks, SoundFonts or model
  weights, and dedicated to the public domain under CC0 1.0
  (https://creativecommons.org/publicdomain/zero/1.0/legalcode).
- `ui/`, the other `sfx/` and `wildlife/raven_02` come from the Norse game pack's procedural sounds (modal
  resonance, filtered noise and formant synthesis; no recordings or models).
- `voice/<kind>/` holds the Norse pack's villager and combat voice banks, one folder per voice: takes
  generated with Qwen3-TTS (Apache-2.0), trimmed and levelled by Loach.

Every source WAV has a `.loach.json` sidecar in the Loach checkout with its seed, request and hashes. To
regenerate, run `import_loach_audio.py --loach <loach checkout>` with ffmpeg (libvorbis) installed.
