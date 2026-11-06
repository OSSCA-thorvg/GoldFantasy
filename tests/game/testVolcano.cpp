#include <test/test.h>
#include <test/graphics.h>
#include <game/mountain_peaks.h>
#include <game/town.h>
#include <game/traffic.h>
#include <game/volcano_painter.h>
#include <game/world_renderer.h>
#include <game/ymir_statue.h>
#include <algorithm>
#include <memory>
#include <vector>

namespace
{
using namespace hearthold;

constexpr uint32_t worlds[] = {3, 5, 11, 42};

int red(uint32_t pixel) { return int(pixel >> 16 & 255); }
int green(uint32_t pixel) { return int(pixel >> 8 & 255); }
int blue(uint32_t pixel) { return int(pixel & 255); }

// What one peak looks like drawn alone: its orange, white and drawn pixels.
struct PeakLook
{
    int painted = 0, orange = 0, white = 0;
};

PeakLook look(bool volcanic, float rise)
{
    constexpr int width = 200, height = 200;
    std::vector<uint32_t> pixels(width * height);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen());
    CHECK(canvas->target(pixels.data(), width, width, height, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
    PeakBatch batch(Climate{});
    batch.add({{0, 0}, rise, volcanic, 0});
    auto scene = tvg::Scene::gen();
    for (auto* shape : batch.finish(0)) scene->add(shape);
    scene->translate(width / 2.f, height - 30.f);
    CHECK(canvas->add(scene) == tvg::Result::Success);
    CHECK(canvas->draw(true) == tvg::Result::Success);
    CHECK(canvas->sync() == tvg::Result::Success);
    PeakLook look;
    for (auto pixel : pixels) {
        if (!(pixel >> 24)) continue;
        ++look.painted;
        look.orange += red(pixel) > 180 && red(pixel) > green(pixel) + 50 && green(pixel) > blue(pixel);
        look.white += red(pixel) > 185 && green(pixel) > 185 && blue(pixel) > 185;
    }
    return look;
}
}  // namespace

TEST(game_a_volcano_greater_than_ymir_burns_in_the_blade)
{
    CHECK(Volcano::size > Giant::size);
    CHECK(volcanoHeight > ymirHeight);
    for (uint32_t seed : worlds) {
        auto map = WorldMap::generate(seed);
        CHECK(map.volcano().has_value());
        if (!map.volcano()) continue;
        auto fire = *map.volcano();
        CHECK(map.regionAt(fire.center()) == Region::South);
        for (int y = fire.origin.y; y < fire.origin.y + Volcano::size; ++y)
            for (int x = fire.origin.x; x < fire.origin.x + Volcano::size; ++x) CHECK(map.at(x, y).terrain == Terrain::Mountain);
        // Lava has run down every side of it: about its foot the ground is lava, with only islands of older rock.
        int lava = 0, ash = 0, land = 0;
        for (int y = int(fire.center().y) - 14; y <= int(fire.center().y) + 14; ++y)
            for (int x = int(fire.center().x) - 14; x <= int(fire.center().x) + 14; ++x) {
                float gap = distance({x + .5f, y + .5f}, fire.center());
                if (!map.inside(x, y) || gap < 8 || gap > 14 || map.at(x, y).terrain == Terrain::Sea) continue;
                ++land;
                lava += map.at(x, y).terrain == Terrain::Lava;
                ash += map.at(x, y).terrain == Terrain::Ash;
            }
        CHECK(lava * 10 > land * 6);
        CHECK(ash * 4 < lava);
    }
}

TEST(game_whoever_finds_the_volcano_sees_all_of_it)
{
    auto map = WorldMap::generate(5);
    if (!map.volcano()) { CHECK(map.volcano().has_value()); return; }
    auto fire = map.volcano()->center();
    CHECK(!map.revealed({fire.x - 20, fire.y - 20}));
    map.reveal(fire.x + 6, fire.y + 6, 9);  // Someone glimpses its foot from the south...
    CHECK(map.revealed({fire.x - 20, fire.y - 20}));  // ...and sees it tower over the land behind it.
}

TEST(game_the_volcano_towers_over_the_lava_country)
{
    te::test::Graphics graphics(false);
    Town town(WorldMap::generate(5));
    if (!town.map().volcano() || town.people().empty()) { CHECK(town.map().volcano().has_value()); return; }
    auto fire = town.map().volcano()->center();
    town.scout(fire.x, fire.y, 20);
    CHECK(town.editPerson(town.people().front().id, town.walking().nearestWalkable({fire.x + 8, fire.y + 8}), 1));  // Someone at its foot.
    Traffic traffic(5);
    traffic.update(town, 0);
    WorldRenderer renderer;
    constexpr int width = 480, height = 600;
    constexpr float zoom = .8f;
    std::vector<uint32_t> pixels(width * height);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen());
    CHECK(canvas->target(pixels.data(), width, width, height, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
    CHECK(canvas->add(renderer.scene()) == tvg::Result::Success);
    auto base = project(fire.x, fire.y);
    Camera camera{base.x, base.y - volcanoHeight / 2, zoom};
    for (double seconds : {0., 1.}) {
        CHECK(canvas->sync() == tvg::Result::Success);
        renderer.update(town, traffic, camera, width, height, seconds, {});
        CHECK(canvas->update() == tvg::Result::Success);
        CHECK(canvas->draw(true) == tvg::Result::Success);
        CHECK(canvas->sync() == tvg::Result::Success);
    }
    auto at = [&](Point offset) {
        int x = int(width / 2.f + offset.x * zoom), y = int(height / 2.f + (offset.y + volcanoHeight / 2) * zoom);
        return pixels[size_t(std::clamp(y, 0, height - 1) * width + std::clamp(x, 0, width - 1))];
    };
    auto light = [](uint32_t pixel) { return .3f * float(red(pixel)) + .59f * float(green(pixel)) + .11f * float(blue(pixel)); };
    // Lava glows in the lake down in its crater, below a far inner wall lit dull red by it, darker than any lava
    // or ash about it...
    auto crater = at({4, -volcanoHeight + 43}), throat = at({-50, -volcanoHeight - 10});
    CHECK(red(crater) > 200);
    CHECK(red(crater) > blue(crater) + 60);
    CHECK(light(throat) < 130);
    CHECK(red(throat) > blue(throat) + 50);
    // ...over a cone of brown-grey basalt, not lava, high above where Ymir's crown would reach.
    auto flank = at({-90, -ymirHeight});
    CHECK(std::abs(red(flank) - green(flank)) < 40);
    CHECK(red(flank) - blue(flank) < 70);
}

TEST(game_only_the_volcano_pours_lava)
{
    // The south's other mountains are bare basalt: away from the volcano no lava runs beside any of them.
    int peaks = 0, burning = 0;
    for (uint32_t seed : worlds) {
        auto map = WorldMap::generate(seed);
        if (!map.volcano()) { CHECK(map.volcano().has_value()); continue; }
        auto fire = map.volcano()->center();
        for (int y = 0; y < map.height(); ++y)
            for (int x = 0; x < map.width(); ++x) {
                Point foot{x + .5f, y + .5f};
                if (map.at(x, y).terrain != Terrain::Mountain || map.regionAt(foot) != Region::South || distance(foot, fire) < 30 || (map.giant() && map.giant()->covers(foot))) continue;
                ++peaks;
                bool lava = false;
                for (int dy = -2; dy <= 2; ++dy)
                    for (int dx = -2; dx <= 2; ++dx) lava = lava || (map.inside(x + dx, y + dy) && map.at(x + dx, y + dy).terrain == Terrain::Lava);
                burning += lava;
            }
    }
    CHECK(peaks > 40);
    CHECK_EQ(burning, 0);
}

TEST(game_the_volcanos_lava_runs_on_down_to_the_sea)
{
    // Its flows run on from the foot of the cone over the land until they pour over the shore into the sea; only
    // they burn hot enough to reach it.
    for (uint32_t seed : worlds) {
        auto map = WorldMap::generate(seed);
        if (!map.volcano()) { CHECK(map.volcano().has_value()); continue; }
        auto fire = map.volcano()->center();
        int falls = 0;
        for (int y = 1; y + 1 < map.height(); ++y)
            for (int x = 1; x + 1 < map.width(); ++x) {
                if (map.at(x, y).terrain != Terrain::Lava || distance({x + .5f, y + .5f}, fire) < volcanoFoot + 4 || map.value(Layer::Heat, {x + .5f, y + .5f}) < 1.5f) continue;
                bool sea = false;
                for (auto [dx, dy] : {std::pair{1, 0}, std::pair{-1, 0}, std::pair{0, 1}, std::pair{0, -1}}) sea = sea || map.at(x + dx, y + dy).terrain == Terrain::Sea;
                falls += sea;
            }
        CHECK(falls >= 2);
    }
}

TEST(game_the_lava_runs_never_cut_the_land_apart)
{
    // A run of lava is no wall: where it crosses open ground it runs under a crust for a stretch, or has cooled
    // over the whole way where it is short, so whatever ground lies beyond it can still be reached on foot.
    for (uint32_t seed : worlds) {
        auto map = WorldMap::generate(seed);
        int width = map.width();
        auto ground = [&](int x, int y) { return !isWater(map.at(x, y).terrain) && !impassable(map.at(x, y).terrain); };
        auto run = [&](int x, int y) { return map.at(x, y).terrain == Terrain::Lava && map.value(Layer::Heat, {x + .5f, y + .5f}) >= 1.5f; };
        // The ground reached from the camp on foot, and again as if the runs could be waded.
        auto reached = [&](bool wading) {
            std::vector<uint8_t> seen(size_t(width) * size_t(map.height()));
            std::vector<TileCoord> open{{int(map.camp().x), int(map.camp().y)}};
            seen[size_t(open[0].y) * size_t(width) + size_t(open[0].x)] = 1;
            int count = 0;
            while (!open.empty()) {
                auto at = open.back();
                open.pop_back();
                count += ground(at.x, at.y);
                for (auto [dx, dy] : {std::pair{1, 0}, std::pair{-1, 0}, std::pair{0, 1}, std::pair{0, -1}}) {
                    int x = at.x + dx, y = at.y + dy;
                    if (!map.inside(x, y) || seen[size_t(y) * size_t(width) + size_t(x)] || !(ground(x, y) || (wading && run(x, y)))) continue;
                    seen[size_t(y) * size_t(width) + size_t(x)] = 1;
                    open.push_back({x, y});
                }
            }
            return count;
        };
        CHECK(reached(true) - reached(false) <= 8);
    }
}

TEST(game_the_volcanos_lava_runs_all_the_way_down_its_cone)
{
    // Each stream pours from the crater's lip right down to the foot of the cone and on out over the ground,
    // where the flow it feeds runs away from the mountain.
    te::test::Graphics graphics(false);
    constexpr int width = 1400, height = 1000;
    std::vector<uint32_t> pixels(width * height);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen());
    CHECK(canvas->target(pixels.data(), width, width, height, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
    auto scene = tvg::Scene::gen();
    Point base{width / 2.f, 700};
    paintVolcano(scene, base, 5);
    CHECK(canvas->add(scene) == tvg::Result::Success);
    CHECK(canvas->draw(true) == tvg::Result::Success);
    CHECK(canvas->sync() == tvg::Result::Success);
    float foot = volcanoFoot * tileHalfWidth * 1.4142f;  // Its foot on screen at zoom 1.
    for (int k = 0; k < 3; ++k) {
        float turn = lavaBearing(5, k) + .7854f;  // The flow's bearing, turned into the cone's own angle about its axis.
        for (float reach : {.985f, 1.06f}) {  // On the cone's last slope, then out on the ground beyond it.
            int x = int(base.x + std::cos(turn) * foot * reach), y = int(base.y + std::sin(turn) * foot * reach * .5f);
            auto pixel = pixels[size_t(std::clamp(y, 0, height - 1) * width + std::clamp(x, 0, width - 1))];
            CHECK(red(pixel) > 170);
            CHECK(red(pixel) > blue(pixel) + 80);
        }
    }
}

TEST(game_basalt_peaks_stay_dark_where_snowy_peaks_wear_white)
{
    // Only the great volcano burns: the south's other peaks are bare dark rock, with no crater glow or lava
    // down their faces, while the north's and Midgard's wear white heads.
    te::test::Graphics graphics(false);
    auto basalt = look(true, .8f), snowy = look(false, .8f);
    CHECK(basalt.painted > 400);
    CHECK_EQ(basalt.orange, 0);
    CHECK_EQ(basalt.white, 0);
    CHECK(snowy.white > 40);
    CHECK_EQ(snowy.orange, 0);
}
