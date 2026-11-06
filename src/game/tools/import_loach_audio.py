"""Import Hearthold's sounds from a Loach checkout's generated packs as small Ogg Vorbis files.

usage: import_loach_audio.py --loach <loach checkout> [--out src/game/assets/audio]

One-shots (UI, effects, voices, weather, wildlife) become mono 22.05 kHz clips named `<cue>_NN.ogg`, so the
game finds a cue's variants by its prefix. Music becomes stereo 44.1 kHz tracks under `music/<moment>/`,
levelled to one loudness. The script also writes the Meson list of every file it made, and `captions.tsv`: the
words of each voice clip, from the take it was cut from (a take reads its phrases in order, split by "...").
Needs ffmpeg with libvorbis.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path

NORSE = "output/norse"
NATURE = "output/norse-nature"

ONE_SHOTS = {
    "ui/click": [f"{NORSE}/ui/ui_click.wav"],
    "ui/confirm": [f"{NORSE}/ui/ui_confirm.wav"],
    "ui/cancel": [f"{NORSE}/ui/ui_cancel.wav"],
    "ui/error": [f"{NORSE}/ui/ui_error.wav"],
    "ui/notify": [f"{NORSE}/ui/ui_notify.wav"],
    "ui/rune": [f"{NORSE}/ui/ui_rune_select.wav"],
    "ui/complete": [f"{NORSE}/ui/ui_quest_complete.wav"],
    "ui/growth": [f"{NORSE}/ui/ui_level_up.wav"],
    "sfx/clash": [f"{NORSE}/sfx/sfx_sword_clash.wav"],
    "sfx/block": [f"{NORSE}/sfx/sfx_shield_block.wav"],
    "sfx/swing": [f"{NORSE}/sfx/sfx_weapon_swing.wav"],
    "sfx/chop": [f"{NORSE}/sfx/sfx_axe_chop.wav"],
    "sfx/hammer": [f"{NORSE}/sfx/sfx_hammer_build.wav"],
    "sfx/coins": [f"{NORSE}/sfx/sfx_coin_pickup.wav", f"{NORSE}/sfx/sfx_coin_pickup_2.wav", f"{NORSE}/sfx/sfx_coin_pickup_3.wav"],
    "sfx/chest": [f"{NORSE}/sfx/sfx_chest_open.wav", f"{NORSE}/sfx/sfx_chest_open_2.wav"],
    "sfx/horn": [f"{NORSE}/sfx/sfx_war_horn.wav"],
    "sfx/stone_door": [f"{NORSE}/sfx/sfx_stone_door.wav"],
    "sfx/rune_wake": [f"{NORSE}/sfx/sfx_rune_activate.wav"],
    "sfx/torch": [f"{NORSE}/sfx/sfx_torch_ignite.wav"],
    "sfx/tree_fall": [f"{NATURE}/weather/wx_tree_crack.wav"],
    "sfx/collapse": [f"{NATURE}/sfx/sfx_timber_collapse.wav"],
    "weather/crack": [f"{NATURE}/lightning/ltn_crack_{n}.wav" for n in (1, 2, 3)],
    "weather/strike": [f"{NATURE}/lightning/ltn_strike_{n}.wav" for n in (1, 2, 3)],
    "weather/clap": [f"{NATURE}/lightning/ltn_clap_{n}.wav" for n in (1, 2, 3)],
    "weather/rumble": [f"{NATURE}/lightning/ltn_rumble_{n}.wav" for n in (1, 2, 3)],
    "wildlife/raven": [f"{NATURE}/wildlife/bird_raven.wav", f"{NORSE}/creature/creature_raven_caw.wav"],
}
# No chief voice, and no clip that calls anyone chief: the user asked for both gone.
VOICES = ["young", "berserker", "maiden", "huntress", "veteran"]
LINES = ["select", "ack", "work", "hum", "mumble", "yawn", "sleep", "sigh", "happy", "complain", "thanks", "alarm", "attack", "hurt", "death"]
MUSIC = {
    "dawn": ["saga_day/day_workers_morning", "saga_classic/classic_morning_mood_low", "saga/saga_groeney_song", "saga/saga_world_tree"],
    "dusk": ["saga_night/night_quiet_night", "saga_night/night_moonlit_fjord", "saga_night/night_starlit_watch", "saga/saga_dusk_wood"],
    "battle": ["saga_raid/raid_night_raid", "saga_raid/raid_last_stand", "saga/saga_shieldwall", "saga_raid/raid_village_aflame"],
    "build": ["saga_day/day_hammer_harvest", "saga/saga_to_the_hall", "saga_day/day_market_day", "saga/saga_still_sanctuary"],
}
MUSIC_RMS = -20.0  # dBFS every track is levelled to, keeping its peak under -1 dBFS.
REPRODUCIBLE = ["-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact"]


def encode(source: Path, target: Path, *, stereo: bool, rate: int, quality: int, gain_db: float = 0.0) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    filters = ["-af", f"volume={gain_db:.2f}dB"] if gain_db else []
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(source), "-ac", "2" if stereo else "1", "-ar", str(rate), *filters,
                    "-c:a", "libvorbis", "-q:a", str(quality), *REPRODUCIBLE, str(target)], check=True)


def level(source: Path) -> float:
    """The gain that brings a track to MUSIC_RMS without lifting its peak over -1 dBFS."""
    analysis = json.loads(Path(f"{source}.loach.json").read_text())["analysis"]
    return min(MUSIC_RMS - analysis["rms_dbfs"], -1.0 - analysis["sample_peak_dbfs"])


def take_of(clip: Path) -> str:
    takes = json.loads(Path(f"{clip}.loach.json").read_text())["request"].get("takes", [])
    return takes[0] if takes else ""


def caption(clips: list[Path], index: int) -> str:
    """The words a voice clip says. Clips cut from one take say its phrases in order, so each says the phrase of
    its place, when there are as many phrases as clips; clips from separate takes each say the whole script."""
    takes = [take_of(clip) for clip in clips]
    script = Path(f"{takes[index]}.json")
    if not takes[index] or not script.exists():
        return ""
    text = " ".join(json.loads(script.read_text()).get("text", "").split())
    if len(set(takes)) > 1:
        return text
    phrases = [phrase.strip() for phrase in text.split("...") if phrase.strip()]
    return phrases[index] if len(phrases) == len(clips) else ""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--loach", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "assets" / "audio")
    args = parser.parse_args()
    if shutil.which("ffmpeg") is None:
        raise SystemExit("ffmpeg with libvorbis is required")
    jobs: list[tuple[Path, Path, dict]] = []
    captions: dict[str, str] = {}
    for cue, sources in ONE_SHOTS.items():
        jobs += [(args.loach / src, args.out / f"{cue}_{n:02}.ogg", {}) for n, src in enumerate(sources, 1)]
    for voice in VOICES:
        for line in LINES:
            takes = sorted((args.loach / NORSE / "voice" / voice).glob(f"vo_{voice}_{line}_[0-9][0-9].wav"))
            if not takes:
                raise SystemExit(f"missing voice takes: {voice} {line}")
            kept = [(take, caption(takes, n)) for n, take in enumerate(takes)]
            kept = [(take, words) for take, words in kept if "chief" not in words.lower()]
            for n, (take, words) in enumerate(kept, 1):
                jobs.append((take, args.out / "voice" / voice / f"{line}_{n:02}.ogg", {}))
                if words:
                    captions[f"voice/{voice}/{line}_{n:02}"] = words
    for moment, tracks in MUSIC.items():
        jobs += [(args.loach / NATURE / f"{track}.wav", args.out / "music" / moment / f"{Path(track).name}.ogg", {"music": True}) for track in tracks]

    if args.out.exists():
        for old in args.out.rglob("*.ogg"):
            old.unlink()
    for source, target, options in jobs:
        if not source.exists():
            raise SystemExit(f"missing source: {source}")
        if options.get("music"):
            encode(source, target, stereo=True, rate=44100, quality=0, gain_db=level(source))
        else:
            encode(source, target, stereo=False, rate=22050, quality=3)
    names = sorted(str(target.relative_to(args.out)) for _, target, _ in jobs)
    listing = ["# Generated by src/game/tools/import_loach_audio.py: every embedded sound, by its path under assets/audio.",
               "game_audio_files = files("]
    listing += [f"  '{name}'," for name in names]
    listing.append(")")
    (args.out / "meson.build").write_text("\n".join(listing) + "\n", encoding="utf-8")
    (args.out / "captions.tsv").write_text("".join(f"{name}\t{words}\n" for name, words in sorted(captions.items())), encoding="utf-8")
    total = sum((args.out / name).stat().st_size for name in names)
    print(f"{len(names)} files, {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
