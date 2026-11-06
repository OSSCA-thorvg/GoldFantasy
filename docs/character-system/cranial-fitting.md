# Upper skull, jaw and component fitting

The original anatomical widths remain the source of the character's shape. The earlier
rewrite collapsed 19 faces into four generic bases and fixed eye size/placement;
this revision restores the original data while retaining independent fitting.

All 30 production face contours are exactly bilateral. Paired source widths are
averaged, one half is fitted with logperch's curve fitter, and the resulting
Bezier handles are mirrored. Crown and chin tangents meet horizontally. Ear
roots and glyphs are mirrored as a pair. This contract applies before upper/jaw
interpolation; asymmetric hair silhouettes are retained.

```text
Appearance
  scalpAsset + scalpTarget + scalpBlend
  scalpWidth/Height + foreheadShift + templeWidth + whole faceWidth
    -> upper contour and crown/forehead/temple frame
       -> eight positive local hair profile weights
       -> cap / fringe / back / tied domains
       -> independent ear roots and eye centres
  faceAsset + jawTarget + jawBlend + jawWidth + chinLength + cheeks
    -> lower contour, normalized to the same temple seam
  eye kind/form/recipe + size/placement/outline/pupil controls
    -> one 13-point aperture, independent clipped pupil
  brow recipe + width/height/angle/curvature/weight
    -> independent cubic eyebrow glyphs
  outfitAsset
    -> unchanged copied body paths
```

Jaw edits never drive hair or ears. The restored whole-face width control changes
both scalp and lower face; jaw width is the lower-only control. A target contour
interpolates normalized widths using a smooth monotone profile. Jaw length is
separate from upper-skull height. Original native hair registration is identity
at rest against its symmetrized anatomical frame. All visible hair layers use
the selected whole hairstyle's native scalp frame.

Inside the scalp attachment band, positive local profile weights correct width
and height. Below it, side-lock widths translate at their roots rather than
stretching every lower curl. Tips above the crown receive vertical translation.
Authored paired construction fringes use one similarity frame per side. Tied
accents use a shared rigid root, including buns crossing the centre line. Length
extends the first five local units of shaft and translates the terminal shape.

Legacy whole-source artwork is partitioned by cap/fringe/back coverage. A small overlap avoids separate antialiased
clips leaving a seam. Hidden scalp completion is restricted to the upper head;
it does not extend a synthetic dark jaw behind a shortened chin. For archived
earlier colour sheets, a separate traced back mass closes the source
side-strand interior. Hanging braids/tails and cap-only crops use distinct rear
policies; source clothing ink cannot bridge the face opening. Back hair and
ears remain separate. Ears attach by temple position and retain their own glyph
shape; an inverse skull mask hides their inner overlap.

Loose-curtain rear mode 4 is used by Long waves, Long centre part, Braids,
Long locks and flat-lid elf. Its solid source-derived silhouette is traced in
the same registration as the original front. No old face-opening edge or
additional skull-shaped plate is drawn into it. Original strand strokes can
be drawn over this rear fill. Parted front coverage ends at the temple seam;
everything below it stays behind the lower face, neck and copied outfit.
This avoids both the face-shaped scoop and front hair covering the neck.

Eye containment samples the same deformed Bezier coverage paths used by the
two rendered face halves. A conservative horizontal width table bounds the
rotated aperture, including stroke radius and a safety margin. A shared fit
reserves a 0.24-unit gap between the mirrored eyes, shifts their centres into
the valid interval and uniformly reduces requested radii only when needed.
The full outline, upper lid and clipped pupil share that result. This bounds
dot/open eyes for all forms and for subsequent skull/jaw edits without
changing the saved eye parameters or eyebrow controls.

Only 18 original looks, bald and flat-lid elf are currently selectable.
Unreviewed construction/colour studies stay in the archive. Loading their IDs
uses curated ready equivalents for hair only, without resetting head, eye,
outfit or identity parameters. This prevents detached scan fragments entering
normal editor/random output while retaining the source data for later repair.
Tousled crop is explicitly retired; old hair ID 10 resolves to Light crop.

Component swapping has been removed. Legacy override fields are ignored during
rendering and cleared when an old preset is loaded into the editor. Internal
cap/fringe/back/tied layers stay together as one registered hairstyle. Rear
shadows start below the cap boundary so that a rigid bun cannot acquire a second,
stretched silhouette behind it. Hair never controls the outfit, figure scale or feet.
A longer chin may translate the copied body as one group for neck clearance.

Cranium width/height are bounded to 0.88–1.12, temples to 0.94–1.06 and forehead
shift to ±0.2 local units. Extreme source pairings can still need an authored
corrective drawing. This implementation supports frontal, static characters;
it is not an unrestricted mesh solver or an animation rig.

World sprites use their own fixed round head and compact hair-family silhouettes.
They do not use these portrait deformation paths, component geometry or length
parameters. Their longest hair ends near the shoulders and their speech anchor
uses the compact head's crown.
