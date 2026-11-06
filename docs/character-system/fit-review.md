# Hair layers and deformation review

This review supersedes the previous whole-wig thin plate spline implementation.
The previous no-fold sample did not prove correct decomposition or a reference
match. The source illustrations were still being composited incorrectly.

## Confirmed failures

- `characterHair(..., false)` returned an empty scene. The entire U-shaped wig
  was painted in front of the face; the missing back interior was never built.
- Wind swept and Twin loops contain drawn-in ear notches. Their curves were
  treated as hair, then source-face rectangular ear regions were overpainted.
- The blank skull was nonlinearly fitted to the assembled figure's visible skin
  opening. This changed the skull to accommodate a particular wig.
- A second baked forehead warp and a jaw/cheek-driven TPS changed the wig's
  proportions. Correctly interpolating sparse anchors did not preserve locks.
- An attempted uniform height response to face width exposed the crown when
  transferring a wig to a narrower skull. Cranial coverage must account for
  the full upper contour, not one temple width.
- A front clipping plane across the cheeks introduced straight visible cuts.

The empty back, hair-dependent face coverage and jaw-driven wig motion were
reproduced before replacement. The first two hair regressions failed on the
old implementation. Source images are unchanged.

## Replacement

The local splitter calls the real sibling logperch vectorizer. Each of the 19
references has a skull, skull mask, left/right ears, repaired hair and completed
back trace. The visible skull derives from the blank face. Only the concealed
ear attachment is smoothly interpolated between its exposed cranium and jaw;
reading ear-interior ink as a skull edge would carve stripes into the ear.
Wind swept and Twin loops ear drawings are healed in source space. Those
inferred repairs are recorded separately from the immutable source crops.

Back mass includes the original silhouette plus opaque scalp/interior coverage.
Loose long hair has a complete curtain; twin tails/buns remain separated below
the skull. The back sits behind the complete face and copied outfit. The front
contains bangs and side locks down to an overlap below the current chin.
Independent ears attach to the skull, retain their source shape under uniform
size changes, and have a small hairstyle-dependent height adjustment. A real
skull silhouette masks their hidden overlap. Covered-ear styles keep that
occlusion. Neither hair nor ear paths are embedded in the face contour.

The rest wig receives a uniform placement only. At runtime, eight upper-scalp
samples on each side plus temple width determine cap fit. Positive skin weights
blend cap width into left/right root translation below the scalp. Y remains
unchanged. Beyond the scalp, lower locks preserve width, length and local
angles. Ears, cheeks, jaws and chins do not control the hair field. Fifteen
editor guides are field samples, not forced TPS constraints.

For ratio r > 0, the horizontal derivative stays between min(1,r) and max(1,r).
The vertical map is identity, so the Jacobian stays positive. Curves are still
adaptively sampled at 0.008-unit tolerance; transforming only cubic handles
would not reproduce the weighted field between them.

Feature recipes retain their placement when the independent skull selector
changes. Selecting a different skull no longer substitutes the assembled
figure's eye/nose/mouth layout. All head controls preserve the copied outfit.
Both cameras retain the existing fixed body scale and feet placement.

## Review files

- [Back / ears / face / front / assembled](references/derived/layers.png)
- [Source / previous / revised](references/derived/layer-review-before-after.png)
- [Different face contours](references/derived/crossfits.png)
- [Width and chin controls](references/derived/fits.png)
- [Editable layered SVGs](references/derived/layered-heads/09-head.svg)
- `layers/vectorization.json`: actual tool settings and layer file hashes.
- `hair-source-check.json`: 19 rest wigs retain traced path topology and proportions.
- `outfit-copy-check.json`: 14 costumes retain original paths, fills and compound holes.
- `wig-fold-check.json`: production field sampled over 1,083 face/width/wig
  combinations and 1,110,075 points, with no inversions (minimum Jacobian about 0.706).

The profile remains static. There are no head turns, speech shapes, jaw motion
or portrait animation. Hidden back coverage is inferred overlap, not a claim
that an unseen rear view exists in the supplied references.
