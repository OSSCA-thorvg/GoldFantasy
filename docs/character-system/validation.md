# Reference pool and facial parameter validation

Target: static ThorVG portraits and Character Studio, native Linux and
WebAssembly, `witheditor`. The archive has 150 reference entries; **20 are
enabled** (18 original looks, bald and flat-lid elf). The 129 unreviewed studies
and retired Tousled crop are excluded from selection/random output and old hair IDs resolve to ready
equivalents. All 30 face contours and ear pairs are symmetric. Twenty eye/brow
recipes and 13 selectable copied outfit sets retain their independent controls.
The 14 source copies keep stable IDs; Small shoulder cape (10) is retired and
old selections load/apply/save as Traveller tunic (0).

| Check | Result |
| --- | --- |
| Focused character/editor/background/world/rig/speech suite | **71 passed**, 0 failed |
| Bilateral geometry | 30 mirrored face contours/anchor sets and 30 mirrored ear pairs; actual face RGBA checked at rest and for Natural/Oval/Round/Angular shapes during skull/jaw interpolation |
| Complete production fitting audit, including archive frames | 150 hairs × 30 upper bases × 3 bounded corrections; **13,500 variants**, **13,837,500 samples**, minimum Jacobian **0.328915**, 0 inversions |
| Native OpenGL / WebGPU | Hidden Character Studio, dummy audio, 60 frames per renderer, both exit 0 |
| Browser WebGL / WebGPU | Isolated muted Chromium, 19 original hairstyle selections, all 13 remaining outfit selections and 24 checks per renderer, including saved IDs and Reference look roundtrip; see recorded results |
| Clean source traces | **76** input/source hashes verified, including two source-segmented High bun parts and five completed rear curtains; actual logperch colour-mass/interior-line retracing, uniform outer stroke 0.075 and interior stroke 0.055 local units |
| Ready pool | 6,000 random draws use only enabled assets; all 150 legacy hair IDs resolve to enabled equivalents without changing the outfit; legacy component mixtures are cleared/ignored |
| Compact world heads | Portrait paths and face/length parameters no longer enter the walking rig; no hair below the waist in long-style regression cases; gait, held items and speech placement pass |
| Reference defaults | Switching from edited/flat-lid looks restores the chosen neutral head; colours, gender and copied outfit are retained |
| High bun | Source cap and bun traced separately; rendered bun dimensions remain stable on long/wide/box heads and rear fill cannot duplicate the top bun |
| Loose rear curtains | Long waves, Long centre part, Braids, Long locks and flat-lid elf: 15 chin/neck cases retain solid main-colour rear coverage; 20 short-chin/native/long/wide/box combinations keep side locks behind the lower face |
| Eye containment | 720 extreme combinations across 30 face templates, both dot/open kinds and all four forms: visible eye pixels stay inside the actual face and clear the centre gap, including full outlines and upper lids |
| Copied costumes | All 14 preserve source paths, compound subpaths, fill rules, colours and uniform registration |
| Removed costume | Small shoulder cape is absent from the 13-entry selector; old ID 10 resolves to Traveller tunic, while IDs 11–13 retain their previous outfit |
| Build | Native and Meson WebAssembly editor builds succeeded |

The previous 211 raw archive traces and their silhouette fidelity report remain
available. Those scores measure coverage against preprocessed raster input;
they do not prove correct segmentation, registration or artistic quality. They
are not a release criterion for the enabled pool. The clean pass removes scan
edge ribbons and small fragments, retains colour masses and useful interior
lines, and gives filled masses one real outline. Face curves are fitted once
and mirrored, rather than tracing two uneven source halves independently.

The regressions check dot eyes without sclera; separate eye/brow geometry;
eye kind, size, shape, pupil and outline controls; independent brow placement,
width, curvature and angle; upper-skull/jaw interpolation; jaw-only invariance
of hair/ears; deterministic gender-biased selection; component overrides;
source-preserving rest fitting; static pixels through time/speech; fixed copied
body/feet; terrain/snow/night backgrounds; and preset versions 1–9, including
version 8 construction-ID migration and rejection of future IDs. Component swapping
has been removed from the editor and renderer. Rear coverage
also checks five solid rear curtains at the nape and through the neck. Their
front coverage ends at the temples; old face-opening edges cannot cover the
lower face or neck. Garment paths and original source-head exclusion masks
are unchanged. Eye containment uses actual deformed upper/lower face coverage,
including mixed source contours. The extreme cases request size 2.5, width and
height 1.8, openness 1.4 and line weight 2, with spacing, vertical placement and
tilt extending beyond the editor's normal range. The fit reserves stroke
clearance and a central gap, shifts centres and reduces both radii uniformly
when necessary. Saved parameters and independent eyebrows are retained.

Browser checks verify actual pixel changes for skull, jaw, ears, dot/open eyes,
eye size, full outline and eyebrows. Species, copied feet and independent
outfit replacement are also checked. WebGPU reads wait for changed head/body pixels
because presentation can lag the CPU frame counter. Saved-file checks likewise
wait for the requested selection instead of assuming a presentation counter
means the save callback has run. The head crop includes the
full jaw and ends before the copied collar. The responsive unit-card regression
samples the actual settled dock bounds with a monotonic UI clock. Browser instances, tabs,
servers and hidden native validation instances are closed after verification.

## Review artifacts

- [All thirty symmetric skulls/ears](references/pool/derived/review-skulls.png)
- [All twenty enabled reference heads](references/pool/derived/review-references.png)
- [Reported cases across native, long, wide and box heads](references/pool/derived/review-cases.png)
- [Long hair/neck under short and long chins and a wide skull](references/pool/derived/review-neck.png)
- [Extreme eye bounds and central gaps](references/pool/derived/review-eye-limits.png)
- [Compact playable world figures](references/pool/derived/review-world.png)
- [Dot/open eye shapes, sizes and outlines](references/pool/derived/review-eyes.png)
- [Independent eyebrow controls](references/pool/derived/review-brows.png)
- [Skull and jaw interpolation](references/pool/derived/review-headmorph.png)
- [Copied outfit/head composition](references/pool/derived/review-heads.png)
- [Internal hair layers](references/pool/derived/review-layers.png)
- [Thirteen selectable copied outfits](references/pool/derived/review-outfits.png)
- [Fitting audit](references/pool/derived/clean-fitcheck.json)
- [Source/symmetry/readiness audit](references/pool/derived/finish-audit.json)
- [Raw archive trace fidelity](references/pool/derived/vector-fidelity.json)
- [Focused test output](references/pool/derived/review-focused-tests.log)
- [Browser results](references/pool/derived/review-browser-validation.json)
- [Delivered build hashes](references/pool/derived/review-build-validation.json)

Full browser captures and logs are retained in
`artifacts/character-outfit-removal-validation/`. The verified local web package is in
`artifacts/web-witheditor/`. The native editor executable is
`/tmp/tellin-engine-witheditor/src/game/Hearthold`; the existing shipping native
package is not replaced by an editor executable.

The entire project test suite was not run. Fitting is bounded and frontal;
positive sampled Jacobians do not guarantee every artistic combination is
optimal. Original artwork, independent fitting and the parameter controls are
preserved; arbitrary proportions, head turns and animation remain outside this
static pass.
