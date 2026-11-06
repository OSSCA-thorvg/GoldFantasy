"""Embed the game's Ogg Vorbis sounds and the words of its voice clips, by name, without runtime file lookups.

usage: embed_audio.py [--hex] --base <assets/audio> <output header> <captions.tsv> <sound.ogg>...

A sound's name is its path under the base, without `.ogg`. Entries are sorted by name, so a cue's variants
(`ui/click_01`, `ui/click_02`, ...) and a moment's tracks (`music/dawn/...`) lie together. `--hex` writes byte
lists for compilers without `#embed`.
"""
from __future__ import annotations

import argparse
from pathlib import Path


def literal(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hex", action="store_true")
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("output", type=Path)
    parser.add_argument("captions", type=Path)
    parser.add_argument("sounds", type=Path, nargs="+")
    args = parser.parse_args()
    base = args.base.resolve()
    sounds = sorted((path.resolve().relative_to(base).with_suffix("").as_posix(), path.resolve()) for path in args.sounds)
    lines = ["#pragma once", "#include <cstddef>", "#include <string_view>", "namespace hearthold::audio_data {"]
    for index, (name, path) in enumerate(sounds):
        lines.append(f"inline constexpr unsigned char sound{index}[] = {{  // {name}")
        if args.hex:
            data = path.read_bytes()
            lines.extend("    " + ",".join(str(byte) for byte in data[at:at + 32]) + "," for at in range(0, len(data), 32))
        else:
            lines.append(f"#embed {literal(path.as_posix())}")
        lines.append("};")
    lines.append("struct Entry { std::string_view name; const unsigned char* bytes; std::size_t size; };")
    lines.append("inline constexpr Entry entries[] = {")
    lines.extend(f"    {{{literal(name)}, sound{index}, sizeof(sound{index})}}," for index, (name, _) in enumerate(sounds))
    lines.append("};")
    captions = sorted(line.split("\t", 1) for line in args.captions.read_text(encoding="utf-8").splitlines() if "\t" in line)
    lines.append("struct Caption { std::string_view name, words; };")
    lines.append("inline constexpr Caption captions[] = {")
    lines.extend(f"    {{{literal(name)}, {literal(words)}}}," for name, words in captions)
    lines.append("};")
    lines.append("}  // namespace hearthold::audio_data")
    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
