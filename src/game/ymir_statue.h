#pragma once

#include "climate.h"
#include "iso_projection.h"

namespace hearthold
{
// Where the statue's own cold light gathers at night: his eyes and the dais.
struct YmirLight
{
    Point eyes[2];
    Point dais;
    tvg::Paint* glints[2] = {};  // Blank stone by day; the renderer lets them glow as night falls.
};

// How far the statue rises above its footprint's centre at zoom 1, the top of his throne included.
inline constexpr float ymirHeight = 450;

// Ymir sits enthroned in granite on a two-tiered dais, facing the viewer with his hands on his knees, a
// braided beard on his chest and a crown of ice; lit from the west. `base` is his footprint's centre
// projected to the ground, at zoom 1.
// `inWater` when the sea laps at the dais, to draw its waterline and ripples. Nothing in it moves but the
// glints, so the renderer keeps it between rebuilds.
YmirLight paintYmir(tvg::Scene* objects, Point base, const Climate&, bool inWater);
// The faint cold light about him, laid in the lights each time they are rebuilt.
void lightYmir(tvg::Scene* lights, Point base);
}  // namespace hearthold
