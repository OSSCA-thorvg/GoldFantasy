#include <test/test.h>
#include <game/visibility_map.h>
#include <algorithm>
#include <cmath>
#include <limits>

namespace
{
using namespace hearthold;

bool sameCoverage(const VisibilityMap& a, const VisibilityMap& b)
{
    return std::ranges::equal(a.coverage(), b.coverage());
}
}

TEST(game_visibility_map_bounds_memory_and_keeps_grid_aligned)
{
    VisibilityMap current, explored;
    current.reset(256, 128);
    explored.reset(256, 128);
    CHECK_EQ(current.columns(), 512u);
    CHECK(current.rows() <= 512u);
    CHECK_EQ(current.coverage().size(), size_t(current.columns()) * current.rows());
    CHECK(current.coverage().size() <= 512u * 512u);
    CHECK_EQ(current.bounds().x, -16.f);
    CHECK_EQ(current.bounds().y, -16.f);
    CHECK_EQ(current.bounds().w, 288.f);
    CHECK_EQ(current.bounds().h, 160.f);
    CHECK_EQ(current.columns(), explored.columns());
    CHECK_EQ(current.rows(), explored.rows());
    CHECK(sameCoverage(current, explored));
    current.reset(100000, 100000, 16, 1024);
    CHECK_EQ(current.coverage().size(), 1024u * 1024u);
    current.reset(64, 64, 0, 65535);
    CHECK_EQ(current.coverage().size(), 1024u * 1024u);
    current.reset(64, 64, std::numeric_limits<float>::max());
    CHECK(current.coverage().empty());
    current.reset(0, 128);
    CHECK(current.coverage().empty());
    CHECK_EQ(current.sample({0, 0}), 0);
}

TEST(game_visibility_map_retains_soft_sight_profile_and_transparent_exterior)
{
    VisibilityMap map;
    map.reset(64, 64, 0, 1024);
    CHECK(map.stamp({{32, 32}, 10}));
    CHECK_EQ(map.sample({32, 32}), 255);
    CHECK_EQ(map.sample({38, 32}), 255);
    CHECK(std::abs(int(map.sample({40.6f, 32})) - 110) <= 2);
    CHECK_EQ(map.sample({42.2f, 32}), 0);
    CHECK_EQ(map.sample({-1, 32}), 0);
    CHECK_EQ(map.sample({64, 32}), 0);
}

TEST(game_visibility_map_union_is_idempotent_and_order_independent)
{
    VisibilityMap a, b, first, second;
    for (auto* map : {&a, &b, &first, &second}) map->reset(64, 64);
    Sight left{{24, 32}, 10}, right{{36, 32}, 10};
    CHECK(a.stamp(left));
    auto revision = a.revision();
    CHECK(!a.stamp(left));
    CHECK_EQ(a.revision(), revision);
    CHECK(a.stamp(right));
    b.stamp(right); b.stamp(left);
    CHECK(sameCoverage(a, b));
    first.stamp(left); second.stamp(right);
    for (size_t i = 0; i < a.coverage().size(); ++i)
        CHECK_EQ(a.coverage()[i], std::max(first.coverage()[i], second.coverage()[i]));
}

TEST(game_visibility_map_current_sight_moves_without_growth_or_trailing_delay)
{
    VisibilityMap current, explored;
    current.reset(64, 64); explored.reset(64, 64);
    std::vector<Sight> sight{{{12, 12}, 8.5f}};
    current.assign(sight); explored.append(sight);
    CHECK_EQ(current.sample({17, 12}), 255);
    sight[0].center = {40, 40};
    CHECK(current.assign(sight));
    explored.append(sight);
    CHECK_EQ(current.sample({12, 12}), 0);
    CHECK_EQ(current.sample({45, 40}), 255);
    CHECK_EQ(explored.sample({12, 12}), 255);
    CHECK_EQ(explored.sample({40, 40}), 255);
    CHECK(current.assign({}));
    CHECK_EQ(current.sample({40, 40}), 0);
}

TEST(game_visibility_map_incremental_history_matches_full_union)
{
    VisibilityMap incremental, rebuilt;
    incremental.reset(256, 256); rebuilt.reset(256, 256);
    std::vector<Sight> history;
    for (int y = 0; y < 64; ++y)
        for (int x = 0; x < 64; ++x)
            history.push_back({{2.f + x * 4, 2.f + y * 4}, 8.5f});
    for (size_t start = 0; start < history.size(); start += 32)
        incremental.append(std::span(history).subspan(start, 32));
    rebuilt.assign(history);
    CHECK(sameCoverage(incremental, rebuilt));
    auto* data = incremental.coverage().data();
    auto revision = incremental.revision();
    CHECK(!incremental.append(history));
    CHECK_EQ(incremental.coverage().data(), data);
    CHECK_EQ(incremental.revision(), revision);
}

TEST(game_visibility_map_reuses_unchanged_current_mask_and_clears_invalid_sources)
{
    VisibilityMap map;
    map.reset(64, 64);
    std::vector<Sight> sources{{{12, 12}, 8}, {{32, 32}, 10}};
    map.assign(sources);
    auto revision = map.revision();
    auto* data = map.coverage().data();
    for (int i = 0; i < 100; ++i) CHECK(!map.assign(sources));
    CHECK_EQ(map.revision(), revision);
    CHECK_EQ(map.coverage().data(), data);
    const float nan = std::numeric_limits<float>::quiet_NaN();
    const float inf = std::numeric_limits<float>::infinity();
    sources = {{{nan, 2}, 8}, {{2, 2}, inf}, {{2, 2}, -1}, {{inf, 2}, 8}};
    CHECK(map.assign(sources));
    CHECK(std::ranges::all_of(map.coverage(), [](uint8_t alpha) { return alpha == 0; }));
    CHECK_EQ(map.sample({nan, 2}), 0);
    CHECK_EQ(map.sample({inf, 2}), 0);
    CHECK(!map.stamp({{1e30f, 1e30f}, 1}));
    CHECK(map.stamp({{32, 32}, 1e30f}));
    CHECK(std::ranges::all_of(map.coverage(), [](uint8_t alpha) { return alpha == 255; }));
    CHECK(map.clear());
    CHECK(!map.clear());
}

TEST(game_visibility_map_moving_sources_match_a_fresh_full_union)
{
    VisibilityMap current;
    current.reset(128, 96, 16, 128);
    std::vector<Sight> sources;
    for (int i = 0; i < 100; ++i) sources.push_back({{float(i * 17 % 128), float(i * 31 % 96)}, 2.f + i % 12});
    for (int frame = 0; frame < 64; ++frame) {
        for (size_t i = 0; i < sources.size(); i += 7) {
            sources[i].center.x += .37f;
            sources[i].center.y -= .23f;
        }
        if (frame % 11 == 0) sources.pop_back();
        if (frame % 13 == 0) sources.push_back({{-8.f + frame, 100.f}, 12});
        if (frame == 24) std::reverse(sources.begin(), sources.end());
        if (frame == 40) current.stamp({{64, 48}, 20});
        if (frame == 48) current.clear();
        current.assign(sources);
        VisibilityMap reference;
        reference.reset(128, 96, 16, 128);
        reference.append(sources);
        CHECK(sameCoverage(current, reference));
    }
    CHECK(current.assign({}));
    CHECK(std::ranges::all_of(current.coverage(), [](uint8_t alpha) { return alpha == 0; }));
}

TEST(game_visibility_map_reports_only_the_region_affected_by_a_moving_source)
{
    VisibilityMap map;
    map.reset(128, 96, 0, 128);
    std::vector<Sight> sources{{{16, 24}, 8}, {{112, 72}, 8}};
    map.assign(sources);
    std::vector<uint8_t> before(map.coverage().begin(), map.coverage().end());
    sources.front().center.x += 1;
    VisibilityMap::Region changed;
    CHECK(map.assign(sources, changed));
    CHECK(!changed.empty());
    CHECK(changed.right < 32 && changed.bottom < 40);
    for (unsigned y = 0; y < map.rows(); ++y)
        for (unsigned x = 0; x < map.columns(); ++x)
            if (before[size_t(y) * map.columns() + x] != map.coverage()[size_t(y) * map.columns() + x])
                CHECK(x >= changed.left && x < changed.right && y >= changed.top && y < changed.bottom);
    changed = {};
    CHECK(!map.assign(sources, changed)); CHECK(changed.empty());
    CHECK(!map.stamp(sources.front(), changed)); CHECK(changed.empty());
    CHECK(map.stamp({{64, 48}, 4}, changed));
    CHECK(changed.left >= 59 && changed.right <= 70);
}
