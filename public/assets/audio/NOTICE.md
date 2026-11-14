These sounds were rendered with Loach, a local audio engine (generator code GPL-3.0-or-later; the GPL does
not cover its output), and converted to Ogg Vorbis by `src/game/tools/import_loach_audio.py`. The game embeds
the files; it needs neither Loach nor any model, recording or network service.

- `music/`, `weather/`, `sfx/tree_fall_*`, `sfx/collapse_*` and `wildlife/raven_01` come from the
  "Nature of Greoni" pack: calculated from random seeds with no recordings, sample banks, SoundFonts or model
  weights, and dedicated to the public domain under CC0 1.0
  (https://creativecommons.org/publicdomain/zero/1.0/legalcode).
- `ui/`, the other `sfx/` and `wildlife/raven_02` come from the Norse game pack's procedural sounds (modal
  resonance, filtered noise and formant synthesis; no recordings or models).
- `narration/en/` holds the opening saga, told in English by one designed storyteller voice:
  takes generated with Qwen3-TTS (Apache-2.0) through Loach's `tools/voice-qwen`, then given a hall echo and
  levelled with ffmpeg.
- `sfx/saga/giant_fall` is the giant's fall in the opening saga: Loach's `acc_troll_grumble`, `nif_frost_giant`,
  `wx_thunder_rolling` and `wx_rockfall` (procedural, no recordings), slowed, layered and
  given a long echo with ffmpeg.
- `voice/<kind>/` holds the Norse pack's villager and combat voice banks, one folder per voice: takes
  generated with Qwen3-TTS (Apache-2.0), trimmed and levelled by Loach.

Sounds not dedicated to CC0 above (the Norse pack's procedural sounds, the generated voices and narration, and
the mixed `sfx/saga/` and `sfx/combat/` cues) are original works made for this project with Loach and are
distributed under the project license.

Every source WAV has a `.loach.json` sidecar in the Loach checkout with its seed, request and hashes. To
regenerate, run `import_loach_audio.py --loach <loach checkout>` with ffmpeg (libvorbis) installed.

Middle-region wildlife uses Loach's `beast_cow`, `beast_boar`, `bird_hens`, `bird_rooster`,
`beast_wolves`, `creature_wolf_howl` and `beast_dog` calls. The cat call is newly calculated by
`src/game/tools/render_cat_call.py` through Loach's offline export API; no cat recording exists in
the local pack. This newly generated call is also dedicated to CC0. Its raw WAV and Loach
provenance sidecar are reproducibly written under `.temp/wildlife-audio-source/`.

`sfx/combat/` (weapon blows, calling skills, swarm deaths, dens, the brood, raid waves and the pack bed) is built by
`scripts/audio/combat_audio.py`: Loach recipe layers (`loach synth --recipe`, procedural, no recordings or models)
mixed with slices of the Norse packs above (`sfx_weapon_swing`, `sfx_shield_block`, `sfx_war_horn`, `wx_rockfall`,
`wx_thunder_rolling`, `wx_ice_boom`, `acc_troll_grumble`, `acc_draugr_breath`), then trimmed, levelled and encoded
like the other one-shots. The script writes each recipe beside its WAV in its work directory.

`music/realm/` is the exception to the `music/` line above: one loop for every world beyond a gate and each of its
three floors, composed and rendered by `scripts/audio/realm_music.py` from Loach's procedural folk instruments
(`folk_instruments`: bowed lyre drone and line, solo string, willow flute, gut-string lyre, frame drum, low choir
and humming voice; `norse_foley.horn_tone`; `procedural_dsp.Canvas`; `models.Reverb`), with no recordings,
SoundFonts or models. Like the `sfx/combat/` cues they are original works made for this project with Loach and are
distributed under the project license. Seeds are fixed per world and floor (`Realm.seed * 10 + floor`), so with the
same Loach, NumPy and ffmpeg the script rebuilds every track bit for bit; it writes each track's float WAV and a JSON
of its seed, mode, tempo and score counts to its work directory.
