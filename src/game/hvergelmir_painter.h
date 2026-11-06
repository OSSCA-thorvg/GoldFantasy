#pragma once

#include "world_map.h"
#include <thorvg.h>

namespace hearthold
{
// Hvergelmir, the roaring spring at the root of the world, sunk at the bottom of a chasm in the ice: frost rims its
// lip, icicles hang from it, its far walls step down in icy ledges into the dark where the water wells up, lit
// faintly from below, and mist climbs out of it. Laid flat among the ground's ornaments at zoom 1, under everything
// standing; it follows the lake the map holds there, and draws nothing where none is left.
void paintHvergelmir(tvg::Scene* ornaments, const WorldMap&);
}  // namespace hearthold
