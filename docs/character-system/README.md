# Reference character heads and independent facial controls

The original artwork is active again. The selectable library contains 18
original hairstyles, bald and the flat-lid elf. Tousled crop is retired. All 30 skull/face templates are
bilaterally symmetric, including during interpolation. Hair keeps its authored
asymmetry. Upper skull, lower jaw, whole hairstyles, ears, eyes and eyebrows have
independent inputs. Profiles are static.

## Sources and vectorization

The editable production package is
[`character-pool.json`](../../src/game/assets/characters/character-pool.json),
compiled into `character-pool.inc` for native and WebAssembly builds. It has 150
archived reference entries including bald: 19 original hairstyles, bald, 19 construction
studies, 10 dot-eye studies, one flat-lid elf and 100 earlier colour studies.
Twenty references are enabled; 129 studies remain archived because their
automatic segmentation or registration is not ready for assembly, and Tousled
crop is explicitly retired. They are
excluded from the editor and random selection. Old saved selections resolve to
curated original equivalents while preserving the face controls and outfit.
Old Tousled crop hair selections resolve to Light crop. Its independent,
symmetric face template remains available as anatomical source data.
Thirty face/ear templates include the original 19 faces and 11 new reference
contours. Twenty eye/brow recipes share one aperture topology.

The actual sibling logperch vectorizer is used:
`../logperch/aurum/tools/vectorize/vectorize.py`. The game does no image tracing.
[`references/pool/manifest.json`](references/pool/manifest.json) records crops,
source palette annotations, anatomical registration and manual occlusion cuts.
Original source images are retained unchanged. Earlier original, modular and
colour reference archives remain in their existing directories.

`import_character_pool.py` extracts source pixels, removes clothing/skin from
hair crops, and runs logperch. `refine_character_traces.py` compares actual resvg
renders against recorded input alpha, retries low-fidelity curves at higher
detail, and keeps only measured improvements. Settings, input hashes and
per-trace fidelity are recorded in `references/pool/vectorization.json`.
Silhouette agreement measures tracing, not artistic similarity or segmentation.

`clean_character_vectors.py` retraces the enabled sources with the same actual
logperch vectorizer. It flattens hair colour masses, removes small fragments and
extracts interior lines separately. Filled scan-edge ribbons are discarded; a
single uniform outer stroke replaces them. Seventy-six clean source traces and
their hashes/settings are recorded in `references/pool/clean/manifest.json`.
`character_vector_finish.py` fits one face half and mirrors the actual Bezier
handles, anchors and ear glyphs. This avoids fitting two nearly symmetric halves.
High bun's cap and tied shape are separated from the source's grey regions and
ink boundary before tracing. Their shared source registration is retained;
the cap follows the scalp and the bun uses a rigid root behind it.
Long waves, Long centre part, Braids, Long locks and flat-lid elf also have
separately traced, solid rear curtains. These retain the original outer locks
and registration, while filling the obsolete face opening behind the head.

## Controls

| Element | Controls |
| --- | --- |
| Upper skull | Source, target, interpolation, width, crown height, forehead, temples |
| Lower face | Source, target, interpolation, jaw width, chin length, cheeks |
| Whole face width | Restored legacy width control; also adjusts the scalp |
| Hair | Whole hairstyle, length, side clearance; no component swapping |
| Ears | Independent source, size, height, angle |
| Eyes | Dots (default) or open eyes; round, almond, half lid or source recipe; size, width, height, openness, shape blend, spacing, height, tilt |
| Eye lines/pupils | Optional full outline, separate upper lid, line weight; pupil size, height and vertical position |
| Eyebrows | Independent visibility, source recipe, width, spacing, height, angle, curvature, weight |
| Mouth/nose | Static mouth width, curvature, weight; nose size |
| Outfit | One of 13 unchanged, copied whole costume/body sets |

Eye size and openness never transform the eyebrow paths. Open eyes have a
clipped pupil whose default height/position touches the lid, avoiding a uniform
four-white-eye expression. Choosing a source eye recipe selects that recipe's
shape; it does not silently leave the Round override active.
When a cranium narrows, open eyes shrink with the same frame used for their
placement, keeping the default eyes from crossing. Eye size/width/height remain
independent multipliers. Dot eyes retain their small size across skull shapes.
Both eye kinds now also fit inside the actual rendered upper/lower face
contours. The solver reserves a central gap and space for the full outline or
upper-lid stroke, adjusts placement and uniformly reduces the aperture when
necessary. Width, height, size and tilt remain independent requested controls;
the fitted result is bounded even after changing the skull or jaw. Pupils use
the same fitted aperture. Eyebrows remain independent.

Selecting **Reference look** restores that reference's neutral skull, jaw,
ears, eye/brow settings, mouth and hair adjustments. Previous edits cannot leak
into the selected reference. Original looks use dot eyes; flat-lid elf uses its
own open-eye recipe. Colours, gender, species, calling and copied outfit are
preserved. The **Whole hairstyle** control changes hair while retaining the
current face parameters.

Hair depends on the upper skull only. Eight positive profile weights follow the
source scalp contour. Below the attachment band, locks translate at their roots;
above the crown, tips translate vertically. Authored paired construction fringes
use similarity fitting and detached accents use rigid roots. Small overlaps
between clipped source layers prevent antialiased seams. Hidden upper scalp is
filled. Closed rear masses are traced separately by filling between the source
side-strand extremes on each row. Braids/tails keep their separate hanging
shapes; cap-only styles exclude detached clothing/prop fragments. Visible outer
contours come from source artwork. No ear glyph is baked into
these layers. This is a bounded frontal fit, not a general head-turn rig.
The five loose-curtain styles render their filled rear mass behind the neck
and outfit. Their parted front coverage ends at the temples; the lower face
stays in front of side locks even with a shorter chin. Original interior strand
strokes are retained behind the face, without reintroducing the old face-hole
outline. Other rear fills are clipped below the cap/fringe boundary so they
cannot duplicate a rigid bun or top accent.

Outfit paths, arms, props, colours and footwear are copied as a single set.
Garment paths and their source-head exclusion masks are unchanged.
Small shoulder cape is removed from selection and rendering. Its legacy outfit
ID 10 resolves to Traveller tunic (0) on load/apply/save. The other outfit IDs
retain their original meaning; all 14 original copies remain in the source archive.
Hair edits do not choose body scale or camera framing. Longer chins translate
the complete outfit for neck clearance. Species (Human/God), gameplay calling,
gender and reference selection remain independent.

Small playable world figures use a separate compact head and short hair-family
silhouette. Only the selected hair's family and colours carry over. Portrait
paths, long locks and face parameters never enter the walking rig; long styles
end near the shoulders. Speech anchors follow this world head. Walking bodies,
feet, arms and held equipment retain their existing gameplay rig.

## Asset pools and presets

Each reference has a curated Masculine, Feminine or Unisex tag. Random selection
first respects the chosen gender, then uses weights 8 for a matching tag, 4 for
unisex and 1 for the other tag; it never excludes the other pool. Original art
also receives a family preference. Unreviewed references have zero random
weight. The Hair tab can explicitly filter the tags. Gender does not infer body
scale from hair.

Preset version 9 saves every eye/brow and skull/jaw control. Versions 6/7 retain
their original face IDs. Version 8's four generic bases and construction IDs map
to their archived equivalents. Save/load/undo retain the whole outfit and
independent identity metadata. Portrait backgrounds still follow terrain,
snow and lighting. No blink, breathing, speech mouth or jaw animation runs.
Legacy component fields remain decodable, but the editor clears them and the
renderer ignores them. Front/back/tied separation is internal to one hairstyle.

## Reproduce and inspect

```sh
uv run --script tools/import_character_pool.py
uv run --script tools/clean_character_vectors.py
uv run --script tools/build_character_assets.py
uv run --script tools/build_character_pool.py
python3 tools/verify_character_assets.py
python3 tools/verify_character_finish.py
ninja -C /tmp/tellin-engine-witheditor src/game/Hearthold-character-library
SDL_AUDIODRIVER=dummy /tmp/tellin-engine-witheditor/src/game/Hearthold-character-library /tmp/heads.ppm heads
```

The production review tool supports `heads`, `references`, `cases`, `world`, `skulls`, `reported`, `pool`, `eyes`, `brows`, `headmorph`,
`layers`, `crossfits`, `outfits`, `readability`, `fitcheck` and `preset`.
See [validation.md](validation.md) for measured results and review images, and
[cranial-fitting.md](cranial-fitting.md) for the fitting contract.
