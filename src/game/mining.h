#pragma once

#include "world_map.h"

namespace hearthold::mining
{
inline constexpr double workSeconds = 6, collectSeconds = .65;
inline constexpr int stonePerRock = 3;
inline Point position(int x, int y) { return {x + .5f, y + .55f}; }
inline float size(const WorldMap& map, int x, int y) { return 6 + hash01(map.seed(), x, y, 61) * 7; }
inline bool deposit(const WorldMap& map, int x, int y)
{
    return map.inside(x, y) && map.at(x, y).terrain == Terrain::Rock && !map.at(x, y).quarried && hash01(map.seed(), x, y, 60) < .55f;
}
}  // namespace hearthold::mining
