#include "common/ground_light.h"
#include <test/test.h>
#include <test/graphics.h>
#include <game/terrain_painter.h>
#include <game/town.h>
#include <game/traffic.h>
#include <game/world_map.h>
#include <game/world_renderer.h>
#include <algorithm>
#include <memory>
#include <vector>

namespace
{
using namespace hearthold;
using hearthold::test::groundLight;

float lavaAt(const WorldMap& map, Point at) { return lavaLevel(map.value(Layer::Land, at), map.value(Layer::Heat, at), map.value(Layer::Ridge, at)); }

int red(uint32_t pixel) { return int(pixel >> 16 & 255); }
int green(uint32_t pixel) { return int(pixel >> 8 & 255); }
int blue(uint32_t pixel) { return int(pixel & 255); }

// Where one of the volcano's runs pours into the sea from the shore behind it on screen: the lava's tile and the
// sea's, the hottest first (only a run burns hot enough to reach the shore).
struct Pour
{
    TileCoord lava, sea;
};
std::vector<Pour> pours(const WorldMap& map)
{
    std::vector<std::pair<float, Pour>> found;
    for (int y = 1; y + 1 < map.height(); ++y)
        for (int x = 1; x + 1 < map.width(); ++x)
            for (TileCoord lava : {TileCoord{x - 1, y}, TileCoord{x, y - 1}}) {
                if (map.at(x, y).terrain != Terrain::Sea || map.at(lava.x, lava.y).terrain != Terrain::Lava) continue;
                float heat = map.value(Layer::Heat, {lava.x + .5f, lava.y + .5f});
                if (heat >= 1.5f) found.push_back({heat, {lava, {x, y}}});
            }
    std::stable_sort(found.begin(), found.end(), [](const auto& a, const auto& b) { return a.first > b.first; });
    std::vector<Pour> all;
    for (auto [heat, pour] : found) all.push_back(pour);
    return all;
}

// The ground's colour at a point, painted as the game paints it in daylight and seen from close up.
uint32_t groundPixel(const WorldMap& map, Point at)
{
    constexpr int size = 9;
    std::vector<uint32_t> pixels(size * size);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen());
    CHECK(canvas->target(pixels.data(), size, size, size, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
    auto iso = tvg::Scene::gen();
    TileRegion area{int(at.x) - 3, int(at.y) - 3, int(at.x) + 4, int(at.y) + 4};
    tintGround(paintGround(iso, map, &area), Climate{});
    constexpr float zoom = 4;
    auto matrix = isoMatrix();
    auto focus = project(at.x, at.y);
    matrix.e11 *= zoom; matrix.e12 *= zoom; matrix.e21 *= zoom; matrix.e22 *= zoom;
    matrix.e13 = size / 2.f - focus.x * zoom; matrix.e23 = size / 2.f - focus.y * zoom;
    iso->transform(matrix);
    CHECK(canvas->add(iso) == tvg::Result::Success);
    CHECK(canvas->draw(true) == tvg::Result::Success);
    CHECK(canvas->sync() == tvg::Result::Success);
    return pixels[size * size / 2];
}

}  // namespace

TEST(game_lava_is_rimmed_with_cooled_crust_and_brightest_at_its_heart)
{
    // Lava used to be one flat colour cut sharply out of the ash. A dark crust of cooled rock should ring it,
    // and it should glow brighter towards its heart than at its edges.
    te::test::Graphics graphics(false);
    auto map = WorldMap::generate(5);
    struct Kind
    {
        float low, high;
        bool onAsh;
        float light = 0;
        int count = 0;
    };
    // Its heart runs beside the volcanic crest that stands out of it.
    Kind heart{.14f, .16f, false}, edge{.008f, .03f, false}, crust{-.025f, -.008f, true}, ash{-9, -.35f, true};
    for (float y = 100; y < map.height() - 8 && (heart.count < 12 || edge.count < 12 || crust.count < 12 || ash.count < 12); y += .37f)
        for (float x = 8; x < map.width() - 8; x += .41f) {
            Point at{x, y};
            if (map.regionAt(at) != Region::South) continue;
            float level = lavaAt(map, at);
            for (auto* kind : {&heart, &edge, &crust, &ash}) {
                if (kind->count >= 12 || level < kind->low || level > kind->high) continue;
                if (kind->onAsh && map.terrainAt(at) != Terrain::Ash) continue;
                if (kind == &heart && map.terrainAt(at) != Terrain::Lava) continue;
                kind->light += groundLight(map, at);
                ++kind->count;
            }
        }
    for (auto* kind : {&heart, &edge, &crust, &ash}) {
        CHECK_EQ(kind->count, 12);
        kind->light /= float(std::max(1, kind->count));
    }
    CHECK(heart.light > edge.light + 15);
    CHECK(crust.light + 15 < ash.light);
    CHECK(crust.light + 15 < edge.light);
}

TEST(game_lava_pours_off_the_shore_in_a_glowing_fall)
{
    // Where a flow of lava reaches the shore, the cliff below it glows molten instead of showing dark rock.
    te::test::Graphics graphics(false);
    constexpr float drop = 22.f / (2 * tileHalfHeight);  // The cliff's height, as a step towards the viewer.
    for (uint32_t seed : {5u, 11u}) {
        auto map = WorldMap::generate(seed);
        auto falls = pours(map);
        CHECK(!falls.empty());
        if (falls.empty()) continue;
        // Halfway down the face hanging from the shore between the lava and the sea.
        Point lava{falls[0].lava.x + .5f, falls[0].lava.y + .5f}, sea{falls[0].sea.x + .5f, falls[0].sea.y + .5f};
        for (int i = 0; i < 20; ++i) {
            auto middle = lerp(lava, sea, .5f);
            (map.value(Layer::Land, middle) > 0 ? lava : sea) = middle;
        }
        auto pixel = groundPixel(map, lava + Point{drop * .5f, drop * .5f});
        CHECK(red(pixel) > 150);
        CHECK(red(pixel) > blue(pixel) + 80);
    }
}

TEST(game_steam_boils_up_where_lava_meets_the_sea)
{
    te::test::Graphics graphics(false);
    Town town(WorldMap::generate(5));
    auto falls = pours(town.map());
    if (falls.empty() || town.people().empty()) { CHECK(!falls.empty()); return; }
    Point fall{falls[0].sea.x + .5f, falls[0].sea.y + .5f};
    town.scout(fall.x, fall.y, 12);
    CHECK(town.editPerson(town.people().front().id, town.walking().nearestWalkable(fall), 1));  // Someone watching.
    Traffic traffic(5);
    traffic.update(town, 0);
    WorldRenderer renderer;
    constexpr int width = 320, height = 240;
    constexpr float zoom = 1.2f;
    std::vector<uint32_t> pixels(width * height);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen());
    CHECK(canvas->target(pixels.data(), width, width, height, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
    CHECK(canvas->add(renderer.scene()) == tvg::Result::Success);
    auto at = project(fall.x, fall.y);
    for (double seconds : {0., 1.}) {
        CHECK(canvas->sync() == tvg::Result::Success);
        renderer.update(town, traffic, {at.x, at.y, zoom}, width, height, seconds, {});
        CHECK(canvas->update() == tvg::Result::Success);
        CHECK(canvas->draw(true) == tvg::Result::Success);
        CHECK(canvas->sync() == tvg::Result::Success);
    }
    // White puffs over the water just above where it pours in, paler than any ash, sea or lava about it.
    int steam = 0;
    for (int y = height / 2 - 80; y < height / 2; ++y)
        for (int x = width / 2 - 60; x < width / 2 + 60; ++x) {
            auto pixel = pixels[size_t(y) * width + size_t(x)];
            int low = std::min({red(pixel), green(pixel), blue(pixel)}), high = std::max({red(pixel), green(pixel), blue(pixel)});
            steam += low > 190 && high - low < 40;
        }
    CHECK(steam > 30);
}
