# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "opencv-python-headless", "Pillow"]
# ///
"""Crop the supplied construction sheets and run logperch's real vectorizer.

Source images are immutable. Crops and traces retain sheet/row/part provenance;
the runtime asset generator consumes these SVGs rather than tracing at runtime.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import subprocess
from xml.sax.saxutils import escape
import numpy as np
import cv2
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VECTORIZER = ROOT.parent / "logperch/aurum/tools/vectorize/vectorize.py"
PARTS = {"hair": (.02, .31), "eyes": (.31, .485), "face": (.50, .72), "figure": (.74, .97)}
LABELS = ["Side part", "Long waves", "Side fringe", "Wind swept", "Curly crown", "Flipped bob", "Long centre part", "Spiky crop",
          "Soft bob", "Twin loops", "Tousled crop", "Braids", "Long locks", "Short centre part", "Wild tuft", "Short twin tails",
          "High bun", "Light crop", "Twin buns"]


def describe_trace(svg: Path) -> None:
    """Add standalone asset metadata without changing any vector geometry."""
    text = svg.read_text()
    if 'role="img"' not in text:
        text = text.replace("<svg ", '<svg role="img" ', 1)
    if "<title>" not in text:
        at = text.index(">", text.index("<svg")) + 1
        text = text[:at] + f"\n<title>{escape(svg.stem)} reference trace</title>\n<desc>User-supplied construction crop, traced with logperch; editable flat fills and strokes.</desc>" + text[at:]
    root_id = "CHAR_" + svg.stem.replace("-", "_") + "_root"
    if f'id="{root_id}"' not in text:
        at = text.index("<g ")
        text = text[:at] + f'<g id="{root_id}">\n' + text[at:]
        text = text.replace("</svg>", "</g>\n</svg>")
    svg.write_text(text)


def row_bands(mask: np.ndarray, count: int) -> list[tuple[int, int]]:
    occupied = np.flatnonzero(mask.any(axis=1))
    bands: list[list[int]] = []
    for y in occupied:
        if not bands or y > bands[-1][1] + 1:
            bands.append([int(y), int(y)])
        else:
            bands[-1][1] = int(y)
    # Separate brow/eye marks and stray locks are grouped by the actual white gaps.
    while len(bands) > count:
        i = min(range(len(bands) - 1), key=lambda i: bands[i + 1][0] - bands[i][1])
        bands[i:i + 2] = [[bands[i][0], bands[i + 1][1]]]
    if len(bands) != count:
        raise ValueError(f"Expected {count} independent rows, found {bands}")
    return [(a, b + 1) for a, b in bands]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vectorizer", type=Path, default=DEFAULT_VECTORIZER.resolve())
    parser.add_argument("--jobs", type=int, default=3)
    parser.add_argument("--crops-only", action="store_true")
    parser.add_argument("--only", nargs="+", help="Retrace named crop stems, e.g. 17-hair; preserve other trace records")
    parser.add_argument("--flat", action="store_true", help="Collapse scan noise into the reference's flat fill/ink palette before tracing")
    args = parser.parse_args()
    directory = ROOT / "docs/character-system/references"
    crops = directory / "crops"
    traces = directory / "vectors"
    if args.flat:
        traces = directory / "flat-vectors"
    crops.mkdir(parents=True, exist_ok=True)
    traces.mkdir(parents=True, exist_ok=True)
    manifest: list[dict] = []
    work: list[tuple[Path, Path]] = []
    offset = 0
    for sheet in range(1, 6):
        source = directory / "source" / f"sheet-{sheet:02}.png"
        image = Image.open(source).convert("RGB")
        gray = np.asarray(image.convert("L"))
        width, height = image.size
        rows = 3 if sheet == 5 else 4
        parts: dict[str, list[dict]] = {}
        for part, (left, right) in PARTS.items():
            x0, x1 = int(width * left), int(width * right)
            mask = gray[:, x0:x1] < 210
            entries = []
            for row, (y0, y1) in enumerate(row_bands(mask, rows)):
                ys, xs = np.nonzero(mask[y0:y1])
                box = [max(0, x0 + int(xs.min()) - 6), max(0, y0 - 6),
                       min(width, x0 + int(xs.max()) + 7), min(height, y1 + 6)]
                name = f"{offset + row:02}-{part}"
                crop, svg = crops / f"{name}.png", traces / f"{name}.svg"
                image.crop(box).save(crop)
                if args.flat:
                    flat_dir = directory / "flat-crops"
                    flat_dir.mkdir(exist_ok=True)
                    pixels = np.asarray(Image.open(crop).convert("L"))
                    if part == "hair":
                        candidates = (pixels >= 225).astype(np.uint8)
                        padded = np.pad(candidates, 1, constant_values=1)
                        cv2.floodFill(padded, None, (0, 0), 2)
                        background = padded[1:-1, 1:-1] == 2
                        inside = pixels[~background]
                        median = float(np.median(inside)) if inside.size else 112
                        # Pale hair has grey ink on a nearly white fill. A fixed black
                        # threshold drops that outline and leaves anti-alias fragments.
                        ink_threshold = median * .65 if median > 200 else 55
                        clean = np.where(background, 255, np.where(pixels < ink_threshold, 20, 112)).astype(np.uint8)
                    elif part in ("face", "eyes"):
                        clean = np.where(pixels < 180, 20, 255).astype(np.uint8)
                    else:
                        palette = np.array([20, 70, 115, 170, 255])
                        clean = palette[np.abs(pixels[:, :, None].astype(int) - palette).argmin(axis=2)].astype(np.uint8)
                    crop = flat_dir / crop.name
                    Image.fromarray(clean).convert("RGB").save(crop)
                entries.append({"box": box, "crop": crop.relative_to(ROOT).as_posix(), "svg": svg.relative_to(ROOT).as_posix()})
                work.append((crop, svg))
            parts[part] = entries
        for row in range(rows):
            manifest.append({"index": offset + row, "id": f"sheet-{sheet:02}-row-{row + 1}", "name": LABELS[offset + row],
                             "sheet": sheet, "row": row, "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                             "parts": {part: entries[row] for part, entries in parts.items()}})
        offset += rows
    (directory / ("flat-crops.json" if args.flat else "crops.json")).write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Extracted {len(work)} component crops from {len(manifest)} reference rows.", flush=True)
    if args.crops_only:
        return
    if not args.vectorizer.is_file():
        raise SystemExit(f"Missing logperch vectorizer: {args.vectorizer}")
    if args.only:
        work = [(crop, svg) for crop, svg in work if crop.stem in args.only]
        if len(work) != len(set(args.only)):
            raise SystemExit("Unknown crop stem in --only")

    def trace(task: tuple[Path, Path]) -> dict:
        crop, svg = task
        colors = "5" if "figure" in crop.stem else "3" if "hair" in crop.stem else "2"
        copied_figure = args.flat and crop.stem.endswith('-figure')
        line_mode = "fill" if copied_figure else "stroke"
        command = ["uv", "run", "--script", str(args.vectorizer), str(crop), "-o", str(svg),
                   "--colors", colors if args.flat else "4", "--detail", ".8" if copied_figure else ".45" if args.flat else ".8", "--smooth", ".35" if copied_figure else ".65" if args.flat else ".55", "--background", "auto", "--lines", line_mode, "--progress"]
        result = subprocess.run(command, capture_output=True, text=True, check=True)
        summary = json.loads(result.stdout.splitlines()[-1])
        if args.flat:
            describe_trace(svg)
        summary.update(crop=crop.relative_to(ROOT).as_posix(), svg=svg.relative_to(ROOT).as_posix(), line_mode=line_mode, warnings=result.stderr.strip())
        print(f"Traced {crop.stem}: {summary['paths']} paths, {summary['anchors']} anchors", flush=True)
        return summary

    with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        results = list(pool.map(trace, work))
    record = directory / ("flat-vectorization.json" if args.flat else "vectorization.json")
    if args.only and record.is_file():
        merged = {entry["svg"]: entry for entry in json.loads(record.read_text())["results"]}
        merged.update({entry["svg"]: entry for entry in results})
        results = [merged[key] for key in sorted(merged)]
    record.write_text(json.dumps({"tool": str(args.vectorizer), "flat_palette": args.flat, "results": results}, indent=2) + "\n")


if __name__ == "__main__":
    main()
