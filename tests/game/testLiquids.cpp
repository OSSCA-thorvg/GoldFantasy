#include <test/test.h>
#include <test/graphics.h>
#include "common/ground_light.h"
#include <game/terrain_painter.h>
#include <game/town.h>
#include <game/traffic.h>
#include <game/world_renderer.h>
#include <game/ymir_statue.h>
#include <algorithm>
#include <iterator>
#include <memory>
#include <vector>

namespace
{
using namespace hearthold;
using hearthold::test::groundLight;

// Every shape under `paint` that draws a line rather than filling an area.
int strokedShapes(const tvg::Paint* paint)
{
    if (paint->type() == tvg::Type::Shape) return static_cast<const tvg::Shape*>(paint)->strokeWidth() > 0;
    int count = 0;
    if (paint->type() == tvg::Type::Scene)
        for (auto* child : static_cast<const tvg::Scene*>(paint)->paints()) count += strokedShapes(child);
    return count;
}
}  // namespace

TEST(game_ash_snow_and_liquids_carry_no_wave_marks)
{
    // No little wave strokes on the ash, the snow or the lava, nor on lakes, rivers and the sea: the ground and
    // the water show themselves by colour and light alone.
    te::test::Graphics graphics(false);
    auto map = WorldMap::generate(5);
    std::unique_ptr<tvg::Scene> ground(tvg::Scene::gen());
    paintGround(ground.get(), map);
    CHECK_EQ(strokedShapes(ground.get()), 0);
    // Nor rings on the sea round Ymir's dais: standing in it adds no lines to him.
    std::unique_ptr<tvg::Scene> dry(tvg::Scene::gen()), wet(tvg::Scene::gen());
    paintYmir(dry.get(), {0, 0}, Climate{}, false);
    paintYmir(wet.get(), {0, 0}, Climate{}, true);
    CHECK_EQ(strokedShapes(wet.get()), strokedShapes(dry.get()));

    Town town(WorldMap::generate(5), false);
    town.scout(town.map().width() / 2.f, town.map().height() / 2.f, 200);
    Traffic traffic(5);
    traffic.update(town, 0);
    WorldRenderer renderer;
    constexpr int width = 320, height = 240;
    std::vector<uint32_t> pixels(width * height);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen());
    CHECK(canvas->target(pixels.data(), width, width, height, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
    CHECK(canvas->add(renderer.scene()) == tvg::Result::Success);
    for (auto view : {town.map().hvergelmir(), town.map().camp(), town.map().fireMountain()}) {
        auto at = project(view.x, view.y);
        for (double seconds : {0., 1.5}) {
            CHECK(canvas->sync() == tvg::Result::Success);
            renderer.update(town, traffic, {at.x, at.y, .6f}, width, height, seconds, {});
            CHECK(canvas->update() == tvg::Result::Success);
            CHECK(canvas->draw(true) == tvg::Result::Success);
            CHECK(canvas->sync() == tvg::Result::Success);
        }
        auto* world = *std::next(renderer.scene()->paints().begin());
        auto layers = static_cast<tvg::Scene*>(world)->paints();
        CHECK_EQ(strokedShapes(*std::next(layers.begin(), 2)), 0);  // The ornaments, over the ground and the fields.
    }
}

TEST(game_the_sea_lakes_and_river_deepen_away_from_their_shores)
{
    // Water shows its depth instead: the sea is lightest in the sunlit shallows under the shore and darkens out
    // to the open sea, a lake is lighter round its edge than in its middle, and the river darker down its bed.
    te::test::Graphics graphics(false);
    auto map = WorldMap::generate(5);
    constexpr float drop = 22.f / (2 * tileHalfHeight);  // The sea lies a cliff's height below the land.
    auto land = [&](Point p) { return map.value(Layer::Land, p); };
    struct Band
    {
        float shallow, deep, light = 0;
        int count = 0;
    };
    Band bands[] = {{-.004f, -.02f}, {-.08f, -.11f}, {-.2f, -.26f}};
    for (float y = .5f; y < map.height(); y += 1.5f)
        for (float x = .5f; x < map.width(); x += 1.5f) {
            Point p{x, y};
            // Where the sea shows from under the land's cliffs, as deep as the shore it lies under.
            if (map.terrainAt(p) != Terrain::Sea || land(p) > -.004f || land(p - Point{drop * .5f, drop * .5f}) > -.004f) continue;
            float depth = land(p - Point{drop, drop});
            for (auto& band : bands)
                if (depth <= band.shallow && depth >= band.deep && band.count < 12) { band.light += groundLight(map, p); ++band.count; }
        }
    for (auto& band : bands) {
        CHECK(band.count >= 6);
        band.light /= float(std::max(1, band.count));
    }
    CHECK(bands[0].light > bands[1].light + 3);
    CHECK(bands[1].light > bands[2].light + 3);

    float edge = 0, middle = 0;
    int edges = 0, middles = 0;
    for (float y = .5f; y < map.height(); y += 1.f)
        for (float x = .5f; x < map.width(); x += 1.f) {
            Point p{x, y};
            float lake = std::min(land(p) - .12f, .3f - map.value(Layer::Elevation, p));
            if (map.terrainAt(p) != Terrain::Water || lake <= 0) continue;
            if (lake < .015f && edges < 12) { edge += groundLight(map, p); ++edges; }
            if (lake > .1f && middles < 12) { middle += groundLight(map, p); ++middles; }
        }
    CHECK(edges >= 6);
    CHECK(middles >= 6);
    CHECK(edge / float(std::max(1, edges)) > middle / float(std::max(1, middles)) + 3);

    const auto& river = map.river();
    float bed = 0, bank = 0;
    int beds = 0;
    for (size_t i = 1; i + 1 < river.path.size() && beds < 12; i += 9) {
        auto along = normalized(river.path[i + 1] - river.path[i - 1]);
        Point side = Point{-along.y, along.x} * (river.width[i] / 2 - .25f), p = river.path[i];
        if (river.width[i] < 1.5f || map.terrainAt(p) != Terrain::Water || map.terrainAt(p + side) != Terrain::Water) continue;
        bed += groundLight(map, p);
        bank += groundLight(map, p + side);
        ++beds;
    }
    CHECK(beds >= 6);
    CHECK(bank > bed + 3 * float(beds));
}
