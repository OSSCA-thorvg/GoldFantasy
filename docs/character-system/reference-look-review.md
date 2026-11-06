# Reference look, reported cases and compact world heads

The editor now selects one complete hairstyle. Component/component-source
controls are removed, the renderer ignores old component overrides, and loading
an old preset clears those overrides. Internal front/back/tied layers remain
separate so they can fit and occlude correctly without cross-style mixing.

## Findings and changes

| Case | Finding and action |
| --- | --- |
| Reference look after editing another look | Jaw, face width, ears, hair length and eye/brow edits survived selection. Reference selection now restores a neutral head recipe while preserving colours, identity and the copied outfit. Hair-only selection retains current face edits. |
| Soft bob / Twin loops / Braids / Long locks | Reviewed as whole styles at their native proportions and on long, wide and box crania. The former cross-style component combinations can no longer enter their assembly. Source ear healing and filled rear interiors are retained. |
| Tousled crop | Explicitly retired from reference/hair selectors and random generation. Old hair ID 10 maps to Light crop (17). Its symmetric face template remains independent source data. |
| Colour 07-07 / 10-07 / 10-02 | Unverified colour extractions remain archived; legacy IDs resolve to Short twin tails, High bun and Side part respectively. This is a curated replacement, not a claim that those raw extractions have been repaired. |
| High bun on wide crania | Full rear fill contained a second bun, and a horizontal split left portions of the bun in the deforming cap. The source cap and bun are now separated by their original colour/ink regions and retraced with logperch. The cap fits the scalp; the bun stays rigid behind it. Rear fill excludes the cap/top region. |
| Flat-lid elf, Long locks and Long waves rear layers | Whole-wig bands put part of the back hair into the front layer; the original face opening and a second skull completion left a scoop behind the jaw. Five loose styles now have solid rear curtains retraced from their original outer silhouette. They render behind the neck/outfit, without the old face-hole outline. Parted front coverage ends at the temples so shorter/wider faces are not cut by old cheek edges. Original strand strokes are retained in the rear. |
| Large or wide eyes on a narrow cranium | Default frame scaling was insufficient for manual size/width/height/tilt and changed jaws. Both dot and open eyes now use the actual rendered face contours, reserve a central gap and stroke clearance, and adjust position/scale together. Pupils follow the same fit; eyebrows remain independent. |
| Hair longer than playable figures' legs | World sprites directly reused portrait paths. They now use a fixed compact head and short family silhouettes; long styles end near the shoulders. Portrait morph/eye/hair-length parameters do not enter the walking rig. Colours and the broad hair family are retained. |
| Skull / face symmetry | All 30 contours and ear pairs remain mirrored. Tests now compare actual rendered face RGBA at rest and under Natural/Oval/Round/Angular skull/jaw morphs, rather than only the unpainted skull mask. |
| Small shoulder cape | Removed from the outfit selector and rendering. Legacy ID 10 loads/applies/saves as Traveller tunic (0); the other outfit IDs retain their original meaning. Thirteen outfits remain selectable. |

The active pool has 20 entries: 18 original hairstyles, bald and flat-lid elf.
There are 129 unreviewed archived studies and one explicitly retired hairstyle.
All source files are retained. The 14 copied outfit sets, including garment
geometry and source-head exclusion masks, are unchanged.

## Evidence

The original regressions failed in four tests before the changes: reference
history, long world hair, retired-style selection and component controls/legacy
mixtures. The additional bun regression found 4,586–7,835 rear pixels above the
scalp crown, depending on the target head. The narrow-eye regression found 57
pixels crossing the centre gap before frame scaling was added.

Seventy-six clean logperch traces are recorded, including the two semantic High
bun regions and five completed rear curtains. Their derived inputs retain a hash of the original parent source.
The [source/symmetry audit](references/pool/derived/finish-audit.json) verifies
source hashes, bilateral anchors/ears and all legacy fallback destinations.

- [Twenty enabled reference heads](references/pool/derived/review-references.png)
- [Reported cases: native, long, wide, box](references/pool/derived/review-cases.png)
- [Loose styles: short/native/long chin and wide skull, including the neck](references/pool/derived/review-neck.png)
- [Eye size/width/height/openness limits](references/pool/derived/review-eye-limits.png)
- [Compact playable figures](references/pool/derived/review-world.png)
- [Thirty symmetric skulls and ears](references/pool/derived/review-skulls.png)
- [Latest validation](validation.md)

Review renders use the production ThorVG implementation. A positive sampled
fitting Jacobian proves no sampled inversion; it does not guarantee the artistic
quality of every extreme combination. The supported target remains frontal,
static portrait fitting. World arm, foot, equipment and speech rigs are verified
separately from portrait geometry.

The latest regressions reproduced eye pixels outside the face and across the
centre, rear colours inherited from the old face opening, and 16–1,970 front
hair pixels covering the lower face in affected short-chin cases. They now
pass: 720 extreme eye combinations across all 30 face templates and four eye
forms, 15 long-hair/neck cases, and 20 lower-face/side-lock combinations.
