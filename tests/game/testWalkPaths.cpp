#include <test/test.h>
#include <game/walk_paths.h>
#include <algorithm>
#include <cmath>
#include <thread>
#include <utility>
#include <vector>

namespace
{
using namespace hearthold;

WorldMap clearing(int size = 48)
{
    auto map = WorldMap::generate(5, size, size);
    for (int y = 0; y < map.height(); ++y)
        for (int x = 0; x < map.width(); ++x) {
            auto& tile = map.at(x, y);
            tile.terrain = Terrain::Grass;
            tile.trees = 0;
        }
    return map;
}

RoadPath line(Point a, Point b) { return {RoadAnchor::sharp(a), RoadAnchor::sharp(b)}; }

// Exact segment test against the wall legs must avoid: the footprint less its .08 tolerance.
bool crosses(Point a, Point b, const Footprint& building)
{
    Footprint wall{building.center, building.half - .08f, building.angle};
    if (wall.contains(a) || wall.contains(b)) return true;
    auto side = [](Point p, Point q, Point r) { return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x); };
    auto corners = wall.corners();
    for (size_t i = 0; i < corners.size(); ++i) {
        Point p = corners[i], q = corners[(i + 1) % corners.size()];
        if ((side(a, b, p) > 0) != (side(a, b, q) > 0) && (side(p, q, a) > 0) != (side(p, q, b) > 0)) return true;
    }
    return false;
}

// Rotated buildings on a lattice, close enough that diagonal steps pass their corners.
std::vector<Footprint> lattice(int size)
{
    std::vector<Footprint> buildings;
    for (int i = 0; i < 64; ++i) {
        Point center{6.f + float(i % 8) * 5.3f + float(i % 3) * .4f, 6.f + float(i / 8) * 5.3f + float(i % 5) * .3f};
        if (center.x > float(size) - 4 || center.y > float(size) - 4) continue;
        buildings.push_back({center, 1.f + float(i % 4) * .2f, float(i) * .37f});
    }
    return buildings;
}

// Fixed requests between walkable points, so failures are reproducible.
std::vector<std::pair<Point, Point>> requests(const WalkGrid& grid, int size, int count)
{
    std::vector<std::pair<Point, Point>> pairs;
    uint32_t state = 12345;
    auto next = [&] { state = state * 1664525u + 1013904223u; return float(state >> 8) / float(1u << 24); };
    while (int(pairs.size()) < count) {
        Point a{1 + next() * float(size - 2), 1 + next() * float(size - 2)}, b{1 + next() * float(size - 2), 1 + next() * float(size - 2)};
        if (grid.walkable(a) && grid.walkable(b)) pairs.push_back({a, b});
    }
    return pairs;
}
}

TEST(game_walk_paths_keep_cheap_road_detours_when_a_shorter_field_route_exists)
{
    auto map = clearing();
    RoadNetwork roads;
    // A laid U-shaped road costs less to walk than the direct route across the field.
    roads.add({RoadAnchor::sharp({8.5f, 8.5f}), RoadAnchor::sharp({8.5f, 12.5f}),
               RoadAnchor::sharp({30.5f, 12.5f}), RoadAnchor::sharp({30.5f, 8.5f})}, 1);
    // Branches must not lure the search away from the connected route.
    roads.add(line({15.5f, 12.5f}, {15.5f, 22.5f}), 1);
    WalkGrid grid;
    grid.rebuild(map, roads);
    auto path = grid.path({8.5f, 8.5f}, {30.5f, 8.5f});
    CHECK(path.size() >= 4);
    CHECK(std::any_of(path.begin(), path.end(), [](Point p) { return p.y >= 12; }));
    CHECK((path.front() == Point{8.5f, 8.5f}));
    CHECK((path.back() == Point{30.5f, 8.5f}));
}

TEST(game_walk_paths_use_only_laid_bridges_and_reject_disconnected_banks)
{
    auto map = clearing();
    for (int y = 0; y < map.height(); ++y) map.at(24, y).terrain = Terrain::Water;
    RoadNetwork roads;
    int bridge = roads.add(line({20.5f, 24.5f}, {28.5f, 24.5f}), 0);
    WalkGrid grid;
    grid.rebuild(map, roads);
    CHECK(grid.path({10.5f, 24.5f}, {36.5f, 24.5f}).empty());
    roads.road(bridge)->built = 1;
    grid.rebuild(map, roads);
    auto path = grid.path({10.5f, 24.5f}, {36.5f, 24.5f});
    CHECK(path.size() >= 2);
    for (size_t i = 1; i < path.size(); ++i)
        for (float t = 0; t <= 1; t += .025f) CHECK(grid.walkable(lerp(path[i - 1], path[i], t)));
}

TEST(game_walk_paths_do_not_connect_diagonally_isolated_cells)
{
    auto map = clearing();
    for (int y = 0; y < map.height(); ++y)
        for (int x = 0; x < map.width(); ++x) map.at(x, y).terrain = Terrain::Water;
    map.at(10, 10).terrain = map.at(11, 11).terrain = Terrain::Grass;
    WalkGrid grid;
    grid.rebuild(map, {});
    CHECK(grid.path({10.5f, 10.5f}, {11.5f, 11.5f}).empty());
}

TEST(game_walk_paths_cross_water_only_through_a_corridor_opened_after_a_rebuild)
{
    auto map = clearing();
    for (int y = 0; y < map.height(); ++y)
        for (int x = 22; x <= 25; ++x) map.at(x, y).terrain = Terrain::Water;
    WalkGrid grid;
    grid.rebuild(map, {});
    CHECK(!grid.path({5.5f, 5.5f}, {15.5f, 40.5f}).empty());
    CHECK(grid.path({5.5f, 5.5f}, {40.5f, 40.5f}).empty());
    CHECK(grid.path({40.5f, 40.5f}, {5.5f, 5.5f}).empty());
    // One cell wide: the only crossing, reachable from both banks once the grid is rebuilt.
    for (int x = 22; x <= 25; ++x) map.at(x, 30).terrain = Terrain::Grass;
    grid.rebuild(map, {});
    CHECK(!grid.path({5.5f, 5.5f}, {40.5f, 40.5f}).empty());
    CHECK(!grid.path({40.5f, 40.5f}, {5.5f, 5.5f}).empty());
    // A building standing in the corridor closes it; once it is gone the banks join again.
    WalkGrid gated;
    gated.rebuild(map, {}, {{{23.5f, 30.5f}, 1.4f, 0}});
    CHECK(gated.path({5.5f, 5.5f}, {40.5f, 40.5f}).empty());
    gated.rebuild(map, {});
    CHECK(!gated.path({5.5f, 5.5f}, {40.5f, 40.5f}).empty());
}

TEST(game_walk_paths_keep_every_leg_out_of_rotated_buildings)
{
    auto map = clearing(64);
    auto buildings = lattice(64);
    WalkGrid grid;
    grid.rebuild(map, {}, buildings);
    int found = 0, grazing = 0;
    for (auto [from, to] : requests(grid, 64, 300)) {
        auto path = grid.path(from, to);
        if (path.empty()) continue;
        ++found;
        CHECK((path.front() == from));
        CHECK((path.back() == to));
        for (size_t i = 1; i < path.size(); ++i)
            for (const auto& building : buildings) {
                CHECK(!crosses(path[i - 1], path[i], building));
                if (distance(path[i], building.center) < building.half * 1.5f + .5f) ++grazing;
            }
    }
    // The requests must actually weave between buildings, not just cross open ground.
    CHECK(found > 200);
    CHECK(grazing > 100);
}

TEST(game_walk_paths_follow_buildings_that_moved_between_rebuilds)
{
    auto map = clearing(96);
    auto before = lattice(64), after = before;
    // Same buildings, moved onto ground that nothing stood near before.
    for (auto& building : after) building.center = building.center + Point{40, 0};
    WalkGrid grid;
    grid.rebuild(map, {}, before);
    grid.rebuild(map, {}, after);
    int found = 0;
    for (auto [from, to] : requests(grid, 96, 400)) {
        auto path = grid.path(from, to);
        if (path.empty()) continue;
        ++found;
        for (size_t i = 1; i < path.size(); ++i)
            for (const auto& building : after) CHECK(!crosses(path[i - 1], path[i], building));
    }
    CHECK(found > 300);
}

TEST(game_walk_paths_repeat_identically_between_requests_on_any_grid)
{
    auto small = clearing();
    for (int y = 4; y < 44; ++y) small.at(24, y).terrain = Terrain::Water;
    auto large = clearing(96);
    for (int x = 10; x < 90; ++x) large.at(x, 48).terrain = Terrain::Mountain;
    WalkGrid a, b;
    a.rebuild(small, {});
    b.rebuild(large, {}, lattice(96));
    auto first = a.path({10.5f, 24.5f}, {38.5f, 24.5f});
    CHECK(first.size() >= 3);
    CHECK(std::any_of(first.begin(), first.end(), [](Point p) { return p.y < 4 || p.y > 44; }));
    // Another search on the same grid, then on a larger one, must leave nothing behind.
    CHECK(!a.path({38.5f, 40.5f}, {10.5f, 2.5f}).empty());
    CHECK((a.path({10.5f, 24.5f}, {38.5f, 24.5f}) == first));
    auto across = b.path({50.5f, 90.5f}, {50.5f, 5.5f});
    CHECK(!across.empty());
    CHECK((a.path({10.5f, 24.5f}, {38.5f, 24.5f}) == first));
    CHECK((b.path({50.5f, 90.5f}, {50.5f, 5.5f}) == across));
}

TEST(game_walk_paths_answer_concurrent_requests_like_serial_ones)
{
    auto map = clearing(64);
    WalkGrid grid;
    grid.rebuild(map, {}, lattice(64));
    auto pairs = requests(grid, 64, 96);
    std::vector<std::vector<Point>> serial, parallel(pairs.size());
    for (auto [from, to] : pairs) serial.push_back(grid.path(from, to));
    std::vector<std::thread> threads;
    for (size_t t = 0; t < 4; ++t)
        threads.emplace_back([&, t] {
            for (size_t i = t; i < pairs.size(); i += 4) parallel[i] = grid.path(pairs[i].first, pairs[i].second);
        });
    for (auto& thread : threads) thread.join();
    CHECK((parallel == serial));
}
