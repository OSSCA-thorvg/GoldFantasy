#pragma once

#include "town.h"
#include "vector_paint.h"
#include <functional>
#include <vector>

namespace hearthold
{
// Ground colour under the current climate: summer greens and autumn browns blend in over weeks,
// lying snow whitens the land and frost glazes still water.
Rgb groundColor(Terrain, uint8_t shade, const Climate&);

// A ground paint whose colour follows the climate.
using Tint = std::function<Rgba(const Climate&)>;
struct Tinted
{
    tvg::Shape* shape;
    Tint color;
    bool stroke;
};

// Sea, cliffs and the land's smooth terrain regions, lakes and river, in world units under the iso
// matrix. Built once per map; the returned paints are recoloured by tintGround() as the climate turns.
std::vector<Tinted> paintGround(tvg::Scene* iso, const WorldMap&, const TileRegion* area = nullptr);
void tintGround(const std::vector<Tinted>&, const Climate&);
// Farmland outlines with furrows, coloured by season, tended state and snow; and the staked
// outlines of construction sites.
void paintFields(tvg::Scene* iso, const Town&);
// Black over everything no settler has seen, softened by two steps where sight ends.
struct FogPatch
{
    tvg::Shape* disc;
    Sight sight;  // Actual extent, including the soft edge beyond the revealed radius.
};
std::vector<tvg::Shape*> paintFog(tvg::Scene* iso, const WorldMap&, std::vector<FogPatch>* patches = nullptr);
}  // namespace hearthold
