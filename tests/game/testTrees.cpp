#include <test/test.h>
#include <test/graphics.h>
#include <game/tree_painter.h>
#include <game/world_map.h>
#include <algorithm>
#include <memory>
#include <vector>

namespace
{
using namespace hearthold;

constexpr uint32_t worlds[] = {3, 5, 11, 42};

struct Stand
{
    int tiles = 0, wooded = 0, trees = 0;
};

Stand standOn(const WorldMap& map, Terrain terrain)
{
    Stand stand;
    for (int y = 0; y < map.height(); ++y)
        for (int x = 0; x < map.width(); ++x) {
            const auto& tile = map.at(x, y);
            if (tile.terrain != terrain) continue;
            ++stand.tiles;
            stand.wooded += tile.trees > 0;
            stand.trees += tile.trees;
            CHECK_EQ(tile.wild, tile.trees);  // The wilds grow back what they first grew.
        }
    return stand;
}

// What one tree looks like drawn alone: how many of its pixels are leafy green or snow and bark white, and
// how tall it stands.
struct Look
{
    int painted = 0, green = 0, white = 0, top = 1 << 20, bottom = -1;
    int height() const { return bottom - top; }
};

Look look(TreeKind kind, float size, const Climate& climate)
{
    constexpr int width = 160, height = 180;
    std::vector<uint32_t> pixels(width * height);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen());
    CHECK(canvas->target(pixels.data(), width, width, height, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
    TreeBatch batch(climate);
    batch.add({kind, {0, 0}, size, 1, 0});
    auto scene = tvg::Scene::gen();
    for (auto* shape : batch.finish(0)) scene->add(shape);
    scene->translate(width / 2.f, height - 20.f);
    CHECK(canvas->add(scene) == tvg::Result::Success);
    CHECK(canvas->draw(true) == tvg::Result::Success);
    CHECK(canvas->sync() == tvg::Result::Success);
    Look look;
    for (int y = 0; y < height; ++y)
        for (int x = 0; x < width; ++x) {
            auto pixel = pixels[size_t(y * width + x)];
            if (!(pixel >> 24)) continue;
            int r = (pixel >> 16) & 255, g = (pixel >> 8) & 255, b = pixel & 255;
            ++look.painted;
            look.green += g > r + 8 && g > b;
            look.white += r > 185 && g > 185 && b > 185;
            look.top = std::min(look.top, y);
            look.bottom = std::max(look.bottom, y);
        }
    return look;
}
}  // namespace

TEST(game_spruce_woods_grow_on_the_moist_frost)
{
    // The north was bare white. Snow-laden spruce should stand in woods where the frost is moist.
    for (uint32_t seed : worlds) {
        auto frost = standOn(WorldMap::generate(seed), Terrain::Frost);
        CHECK(frost.tiles > 300);
        CHECK(frost.wooded * 10 > frost.tiles);  // More than a tenth of it wooded...
        CHECK(frost.wooded * 5 < frost.tiles * 3);  // ...but open country still.
    }
}

TEST(game_dead_trees_stand_here_and_there_on_the_ash)
{
    // Leafless snags dot the scorched country by the lava, far sparser than any wood.
    for (uint32_t seed : worlds) {
        auto ash = standOn(WorldMap::generate(seed), Terrain::Ash);
        CHECK(ash.tiles > 300);
        CHECK(ash.wooded * 50 > ash.tiles);
        CHECK(ash.wooded * 5 < ash.tiles);
        CHECK(ash.trees <= ash.wooded * 2);
    }
}

TEST(game_each_country_grows_its_own_trees)
{
    // Three kinds only: snow-laden spruce on the frost, dead snags on the ash, and in Midgard's mild woods the
    // plain triangle fir and nothing else.
    int mild = 0, wrong = 0;
    for (uint32_t seed : worlds) {
        auto map = WorldMap::generate(seed);
        for (int y = 0; y < map.height(); ++y)
            for (int x = 0; x < map.width(); ++x) {
                const auto& tile = map.at(x, y);
                for (int i = 0; i < tile.trees; ++i) {
                    auto tree = treeAt(map, x, y, i);
                    wrong += tile.terrain == Terrain::Frost && tree.kind != TreeKind::SnowySpruce;
                    wrong += tile.terrain == Terrain::Ash && tree.kind != TreeKind::Snag;
                    float heat = map.value(Layer::Heat, tree.foot);
                    if (tile.terrain != Terrain::Forest || heat < .36f || heat > .5f) continue;
                    ++mild;
                    wrong += tree.kind != TreeKind::Fir;
                }
            }
    }
    CHECK(mild > 1000);
    CHECK_EQ(wrong, 0);
}

TEST(game_trees_grow_from_saplings_to_old_giants)
{
    auto map = WorldMap::generate(5);
    float smallest = 9, largest = 0;
    int total = 0, small = 0, large = 0;
    for (int y = 0; y < map.height(); ++y)
        for (int x = 0; x < map.width(); ++x)
            for (int i = 0; i < map.at(x, y).trees; ++i) {
                float size = treeAt(map, x, y, i).size;
                smallest = std::min(smallest, size);
                largest = std::max(largest, size);
                ++total;
                small += size < .75f;
                large += size > 1.25f;
            }
    CHECK(smallest < .6f);
    CHECK(largest > 1.45f);
    CHECK(small * 6 > total);
    CHECK(large * 12 > total);
}

TEST(game_tree_kinds_look_their_part)
{
    te::test::Graphics graphics(false);
    Climate summer;
    summer.summer = 1;
    Climate winter;
    winter.snow = .9f;
    auto snag = look(TreeKind::Snag, 1, summer);
    CHECK(snag.painted > 40);
    CHECK_EQ(snag.green, 0);  // Leafless.
    auto fir = look(TreeKind::Fir, 1, summer), snowy = look(TreeKind::SnowySpruce, 1, summer);
    CHECK(fir.green > 100);
    CHECK_EQ(fir.white, 0);
    CHECK(look(TreeKind::Fir, 1, winter).white > 3);  // Snow caps the fir in winter.
    CHECK(snowy.white > 20);  // Snow on the spruce's boughs even in summer.
    CHECK(snowy.green > 20);
    auto sapling = look(TreeKind::Fir, .55f, summer), giant = look(TreeKind::Fir, 1.5f, summer);
    CHECK(giant.height() > 2 * sapling.height());
}
