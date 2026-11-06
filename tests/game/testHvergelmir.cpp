#include <test/test.h>
#include <test/graphics.h>
#include <game/hvergelmir_painter.h>
#include <game/town.h>
#include <game/traffic.h>
#include <game/world_map.h>
#include <game/world_renderer.h>
#include <algorithm>
#include <cmath>
#include <iterator>
#include <memory>
#include <vector>

namespace
{
using namespace hearthold;

constexpr uint32_t worlds[] = {3, 5, 11, 42};

int red(uint32_t pixel) { return int(pixel >> 16 & 255); }
int green(uint32_t pixel) { return int(pixel >> 8 & 255); }
int blue(uint32_t pixel) { return int(pixel & 255); }
float light(uint32_t pixel) { return .3f * float(red(pixel)) + .59f * float(green(pixel)) + .11f * float(blue(pixel)); }

// How far the spring's water reaches from its middle along a bearing, in tiles.
float reach(const WorldMap& map, float bearing)
{
    auto c = map.hvergelmir();
    Point along{std::cos(bearing), std::sin(bearing)};
    float r = 0;
    while (r < 20 && std::min(map.value(Layer::Land, c + along * (r + .1f)) - .12f, .3f - map.value(Layer::Elevation, c + along * (r + .1f))) > 0) r += .1f;
    return r;
}
}  // namespace

TEST(game_hvergelmir_opens_as_a_long_ragged_chasm_in_the_ice)
{
    // No longer a round pond: a great rift drawn out east to west across the screen, along the icy stroke.
    for (uint32_t seed : worlds) {
        auto map = WorldMap::generate(seed);
        float wide = 0, deep = 0, longest = 0;
        for (float turn = -.3f; turn <= .3f; turn += .1f) {
            wide += reach(map, -.7854f + turn) + reach(map, 2.3562f + turn);  // Screen left and right.
            deep += reach(map, .7854f + turn) + reach(map, 3.927f + turn);    // Screen down and up.
        }
        for (float bearing = 0; bearing < 6.283f; bearing += .05f) longest = std::max(longest, reach(map, bearing));
        CHECK(wide > deep * 1.3f);
        CHECK(longest > 5.5f);
    }
}

TEST(game_hvergelmir_is_drawn_sunk_deep_into_the_ice)
{
    // Frost whitens its lip; just inside the far lip its walls show as pale icy ledges, and they darken step by
    // step down into the blue-black deep where the water lies.
    te::test::Graphics graphics(false);
    auto map = WorldMap::generate(5);
    constexpr int width = 900, height = 600;
    std::vector<uint32_t> pixels(width * height);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen());
    CHECK(canvas->target(pixels.data(), width, width, height, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
    auto c = map.hvergelmir();
    auto middle = project(c.x, c.y);
    auto scene = tvg::Scene::gen();
    paintHvergelmir(scene, map);
    scene->translate(width / 2.f - middle.x, height / 2.f - middle.y);
    CHECK(canvas->add(scene) == tvg::Result::Success);
    CHECK(canvas->draw(true) == tvg::Result::Success);
    CHECK(canvas->sync() == tvg::Result::Success);
    auto at = [&](Point world) {
        auto p = project(world.x, world.y);
        int x = int(p.x - middle.x + width / 2.f), y = int(p.y - middle.y + height / 2.f);
        return pixels[size_t(std::clamp(y, 0, height - 1) * width + std::clamp(x, 0, width - 1))];
    };
    // Its far lip lies up the screen from its middle, towards -x -y.
    float back = reach(map, 3.927f);
    Point up{-.7071f, -.7071f};
    auto frost = at(c + up * (back + .35f)), ledge = at(c + up * (back - .5f)), deep = at(c + up * (back * .1f));
    CHECK(light(frost) > 190);
    CHECK(light(ledge) > 110);
    CHECK(blue(ledge) > red(ledge) + 25);
    CHECK(light(ledge) > light(deep) + 60);
    CHECK(light(deep) < 70);
    CHECK(blue(deep) > red(deep));
}

TEST(game_hvergelmir_shows_as_soon_as_it_is_found)
{
    // Found in the middle of a season, its chasm is drawn straight away, not when the season next turns.
    te::test::Graphics graphics(false);
    Town town(WorldMap::generate(5), false);
    Traffic traffic(5);
    traffic.update(town, 0);
    WorldRenderer renderer;
    constexpr int width = 320, height = 240;
    std::vector<uint32_t> pixels(width * height);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen());
    CHECK(canvas->target(pixels.data(), width, width, height, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
    CHECK(canvas->add(renderer.scene()) == tvg::Result::Success);
    auto spring = town.map().hvergelmir();
    auto at = project(spring.x, spring.y);
    auto frame = [&](double seconds) {
        CHECK(canvas->sync() == tvg::Result::Success);
        renderer.update(town, traffic, {at.x, at.y, .8f}, width, height, seconds, {});
        CHECK(canvas->update() == tvg::Result::Success);
        CHECK(canvas->draw(true) == tvg::Result::Success);
        CHECK(canvas->sync() == tvg::Result::Success);
    };
    auto ornaments = [&] {
        auto* world = static_cast<tvg::Scene*>(*std::next(renderer.scene()->paints().begin()));
        return static_cast<tvg::Scene*>(*std::next(world->paints().begin(), 2))->paints().size();
    };
    frame(0);
    CHECK(!town.map().revealed(spring));
    auto unfound = ornaments();
    town.scout(spring.x, spring.y, 10);
    frame(.5);
    CHECK(ornaments() > unfound);
}
