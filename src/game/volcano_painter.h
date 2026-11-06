#pragma once

#include "climate.h"
#include "iso_projection.h"

namespace hearthold
{
// How far the volcano's crater rises above its footprint's centre at zoom 1, its smoke not counted: a head
// taller than Ymir on his throne.
inline constexpr float volcanoHeight = 560;
// Its smoke climbs this much higher again.
inline constexpr float volcanoSmoke = 260;

// Where the volcano's fire shows at night: its crater and the lava running down its face.
struct VolcanoLight
{
    Point crater;
    Point flows[3];
};

// A cone of dark basalt with concave flanks, lit from the west, its crater holding a lake of lava that spills right
// down its face in three streams and out over the ground into the map's lava runs, and smoke rising from it. `base`
// is its footprint's centre projected to the ground at zoom 1; `seed` winds the streams the same way the map lays
// its runs. Nothing in it changes, so the renderer keeps it between rebuilds.
VolcanoLight paintVolcano(tvg::Scene* objects, Point base, uint32_t seed);
// The glow over its crater, laid in the lights each time they are rebuilt.
void lightVolcano(tvg::Scene* lights, const VolcanoLight&);
// Steam boiling up off the sea where lava pours into it, from `at` on the water at zoom 1; `salt` varies its puffs.
void paintSteam(tvg::Scene* objects, Point at, uint32_t salt);
}  // namespace hearthold
