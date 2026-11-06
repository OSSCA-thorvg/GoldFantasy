# Static face construction card

Source: all 19 rows of `reference_manifest.json`, prioritized over the earlier
coloured character sheets. Target: front-facing game profile and editor preview.

| Part | Origin / local geometry | Rendering and allowed edits |
| --- | --- | --- |
| Skull | Centre of crown/chin bounds; crown −3.2, chin +3.2 | Traced fill and outline; face width, cheeks, jaw, chin, shape blend |
| Eye aperture | Normalized left eye; x extrema −1/+1 | Four cubics / 13 compatible points; reference, roundness and openness |
| Pupil | Distance peak inside traced ink envelope | Near-black ellipse clipped to aperture; size control |
| Brow | Median centre line of source brow pixels | One cubic; line weight control |
| Nose | Reference-derived centre line | Tiny static stroke; no nostril/shading detail |
| Mouth | Measured source y and width | One small cubic; width and curvature control |
| Wig | Separate completed back and source front | Positive scalp/side-lock weights; original y/length retained |
| Ears | Separate original left/right parts | Uniform size, independent source and height; skull-shaped overlap mask |

The aperture is fitted to the convex envelope of the separated upper lid,
lower lid and pupil. Fitting only a thin open ink ribbon incorrectly follows
both sides of the line and creates crossed curves; the envelope avoids that.
Reference aperture aspect ratios range from 0.394 to 0.898. Pupil radius is
bounded to 0.45–0.75 of aperture half-width to survive small profile sizes.

The ink colour is near black `(25,28,27)`, sclera is warm white `(253,252,248)`.
Eye outlines use 0.06 local units and the upper lid 0.09, multiplied by the eye
stroke control. Brow and mouth use 0.065 local units, with their own weight.
Scanned greys are not used as shading on the face. Skin and hair are colour
tokens. An entirely black source wig is recolourable as one silhouette with a
thin dark edge; lighter source outlines retain a separate ink colour.

Feature placement comes from its selected reference recipe and is independent
of the skull selector. Horizontal spacing and size follow skull width. Mouth
and nose keep the same recipe's placement; eye/mouth sliders remain independent.
The blank skull is not fitted to the skin opening in an assembled hair drawing.

Layer order: completed back hair, copied costume and neck overlap, complete
skull/features, front bangs/side locks, then independent visible ears outside
the skull silhouette. Source ears are removed from Wind swept and Twin loops
hair. Ears neither pull the wig nor stretch with the jaw. Soft bob and Braids
cover their ears as in the source. Hidden skull attachment and back interiors
are conservative inferred geometry, not claimed additional reference views.

The wig has positive scalp and lateral lock weights. Upper-cranium widths
control cap fit; y stays fixed, and ends outside the scalp only translate.
Jaw/chin/cheeks do not deform hair. Source curves receive no baked nonlinear
warp. Front/back overlap ends below the chin, never across the face. Clothing
keeps all original compound paths and palette values.

Both cameras keep their placement when a wig changes. The whole-body camera
uses the outfit bounds and fixed headroom. The portrait camera has fixed framing.
The existing neck overlap is an attachment joint, separate from the copied
costume geometry.

Allowed state: `static_authored`. Parameters describe authored expressions,
not a timeline. Blink, viseme, jaw, gesture, hair sway and head-turn states are
deliberately absent under the user's static-first scope. Front/side corrections
and anatomical body controls are not inferred from these source sheets.
