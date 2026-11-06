#include "common/ground_light.h"
#include <test/test.h>
#include <test/graphics.h>
#include <game/world_map.h>

namespace
{
using namespace hearthold;
using hearthold::test::groundLight;
}  // namespace

TEST(game_slopes_facing_the_western_light_are_lit_and_the_far_sides_shaded)
{
    // The land rises and falls; the ground should show it, lighter where a slope faces the light from the
    // west and darker where it turns away, so hills and ranges read as hills and ranges.
    te::test::Graphics graphics(false);
    auto map = WorldMap::generate(5);
    // How steeply the ground across a tile falls towards the light: positive on slopes facing it.
    auto facing = [&](Point p) {
        auto height = [&](float dx, float dy) { return map.value(Layer::Elevation, {p.x + dx, p.y + dy}); };
        return height(.5f, 0) - height(-.5f, 0) + .35f * (height(0, .5f) - height(0, -.5f));
    };
    float lit = 0, shaded = 0;
    int litCount = 0, shadedCount = 0;
    for (float y = 20; y < map.height() - 20 && (litCount < 12 || shadedCount < 12); y += 1.37f)
        for (float x = 20; x < map.width() - 20; x += 1.53f) {
            Point at{x, y};
            if (map.terrainAt(at) != Terrain::Grass) continue;
            float slope = facing(at);
            if (slope > .03f && litCount < 12) { lit += groundLight(map, at); ++litCount; }
            if (slope < -.03f && shadedCount < 12) { shaded += groundLight(map, at); ++shadedCount; }
        }
    CHECK_EQ(litCount, 12);
    CHECK_EQ(shadedCount, 12);
    CHECK(lit / 12 > shaded / 12 + 8);
}

TEST(game_ranges_rise_in_every_region)
{
    // Not only the frozen north: Midgard and the burning south have their ranges too, as a continent does.
    for (uint32_t seed : {3u, 5u, 11u, 42u}) {
        auto map = WorldMap::generate(seed);
        int land[3] = {}, ranges[3] = {};
        for (int y = 0; y < map.height(); ++y)
            for (int x = 0; x < map.width(); ++x) {
                Point at{x + .5f, y + .5f};
                auto terrain = map.at(x, y).terrain;
                if (terrain == Terrain::Sea || (map.giant() && map.giant()->covers(at)) || (map.volcano() && map.volcano()->covers(at))) continue;
                auto region = size_t(map.regionAt(at));
                ++land[region];
                ranges[region] += terrain == Terrain::Mountain;
            }
        for (size_t region = 0; region < 3; ++region) CHECK(ranges[region] * 40 > land[region]);  // Over a fortieth of each.
    }
}
