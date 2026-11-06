#include <test/test.h>
#include <test/graphics.h>
#include <game/terrain_painter.h>
#include <algorithm>
#include <cmath>
#include <memory>

namespace
{
using namespace hearthold;
std::vector<Sight> legacyPatches(const std::vector<Sight>& seen)
{
    std::vector<Sight> result;
    for (size_t i = 0; i < seen.size(); ++i) {
        bool covered = false;
        for (size_t j = 0; j < seen.size() && !covered; ++j)
            covered = j != i && distance(seen[i].center, seen[j].center) + seen[i].radius <= seen[j].radius &&
                      (seen[j].radius > seen[i].radius || j < i);
        if (!covered) result.push_back({seen[i].center, seen[i].radius + 1});
    }
    return result;
}
void verifyFog(WorldMap& map, const std::vector<Sight>& seen)
{
    // A controlled history exercises duplicates and radius order that ordinary reveal rejects.
    const_cast<std::vector<Sight>&>(map.sights()) = seen;
    auto scene = tvg::Scene::gen(); scene->ref();
    std::vector<FogPatch> patches;
    auto veils = paintFog(scene, map, &patches);
    auto expected = legacyPatches(seen);
    CHECK_EQ(veils.size(), 1u);
    CHECK_EQ(patches.size(), expected.size());
    if (patches.size() == expected.size()) {
        const tvg::Paint* mask = nullptr;
        CHECK(veils.front()->mask(&mask) == tvg::MaskMethod::InvAlpha);
        CHECK(mask && mask->type() == tvg::Type::Scene);
        if (mask && mask->type() == tvg::Type::Scene)
            CHECK_EQ(static_cast<const tvg::Scene*>(mask)->paints().size(), expected.size());
        for (size_t i = 0; i < expected.size(); ++i) {
            CHECK(patches[i].sight.center == expected[i].center);
            CHECK_EQ(patches[i].sight.radius, expected[i].radius);
            auto at = patches[i].disc->transform();
            CHECK_EQ(at.e13, expected[i].center.x);
            CHECK_EQ(at.e23, expected[i].center.y);
        }
    }
    scene->unref();
}
}

TEST(game_explored_fog_keeps_legacy_containment_order_across_spatial_cells)
{
    te::test::Graphics graphics(false);
    auto map = WorldMap::generate(5, 48, 48);
    verifyFog(map, {});
    verifyFog(map, {{{8, 8}, 4}, {{8, 8}, 4}, {{8, 8}, 8}, {{16, 8}, 1}, {{-8, -8}, 3},
                    {{-8, -8}, 3}, {{7.99f, -8.01f}, 5}, {{8.01f, -7.99f}, 4.99f}, {{0, 0}, 0}});
    // The large-query fallback and exact touching boundary retain the same patches.
    verifyFog(map, {{{0, 0}, 100000}, {{99998, 0}, 2}, {{100001, 0}, 2}, {{-100001, 0}, 2}});
}

TEST(game_explored_fog_matches_legacy_patches_for_long_mixed_histories)
{
    te::test::Graphics graphics(false);
    auto map = WorldMap::generate(5, 48, 48);
    unsigned state = 72931;
    auto random = [&] { state ^= state << 13; state ^= state >> 17; state ^= state << 5; return float(state >> 8) / float(1u << 24); };
    for (int run = 0; run < 8; ++run) {
        std::vector<Sight> seen;
        for (int i = 0; i < 256; ++i) {
            seen.push_back({{random() * 200 - 100, random() * 200 - 100}, i % 3 ? 7.5f : random() * 12});
            if (i % 11 == 0) seen.push_back(seen.back());
        }
        verifyFog(map, seen);
    }
}

TEST(game_explored_fog_metadata_preserves_the_rendered_soft_mask)
{
    te::test::Graphics graphics(false);
    auto map = WorldMap::generate(5, 48, 48);
    const std::vector<Sight> seen{{{12, 12}, 7.5f}, {{16, 16}, 7.5f}, {{12, 12}, 4}, {{32, 14}, 6}, {{30, 30}, 10}};
    const_cast<std::vector<Sight>&>(map.sights()) = seen;
    auto actual = tvg::Scene::gen(); actual->ref();
    auto expected = tvg::Scene::gen(); expected->ref();
    std::vector<FogPatch> patches;
    paintFog(actual, map, &patches);
    auto veil = tvg::Shape::gen(); veil->appendRect(-2, -2, map.width() + 4.f, map.height() + 4.f); veil->fill(0, 0, 0);
    auto mask = tvg::Scene::gen();
    for (const auto& patch : legacyPatches(seen)) {
        auto disc = sightDisc(patch.radius); disc->translate(patch.center.x, patch.center.y); mask->add(disc);
    }
    veil->mask(mask, tvg::MaskMethod::InvAlpha); expected->add(veil);
    auto render = [](tvg::Scene* scene) {
        std::vector<uint32_t> pixels(64 * 64);
        std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen());
        CHECK(canvas->target(pixels.data(), 64, 64, 64, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
        CHECK(canvas->add(scene) == tvg::Result::Success);
        CHECK(canvas->draw(true) == tvg::Result::Success); CHECK(canvas->sync() == tvg::Result::Success);
        return pixels;
    };
    CHECK(render(actual) == render(expected));
    actual->unref(); expected->unref();
}
