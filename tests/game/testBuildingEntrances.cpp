#include <test/test.h>
#include <game/building_assets.h>
#include <game/town.h>
#include <GameEngine/GameFramework/building_faces.h>
#include <algorithm>
#include <cmath>

namespace
{
using namespace hearthold;

WorldMap clearing()
{
    auto map = WorldMap::generate(5, 48, 48);
    for (int y = 0; y < map.height(); ++y)
        for (int x = 0; x < map.width(); ++x) {
            map.at(x, y).terrain = Terrain::Grass;
            map.at(x, y).trees = 0;
        }
    return map;
}
}

TEST(game_building_entrance_approach_lines_up_with_the_visible_cottage_door)
{
    // The authored doorway remains attached to the same wall when the house turns.
    Building cottage{1, Structure::Cottage, {20.3f, 20.4f}, 0, 0};
    CHECK(std::abs(cottage.door().x - (cottage.center.x - .1864f)) < 1e-4f);
    cottage.angle = 1.5707963f;
    CHECK(std::abs(cottage.door().y - (cottage.center.y - .1864f)) < 1e-4f);
}

TEST(game_walk_paths_reject_blocked_destination_instead_of_arriving_elsewhere)
{
    auto map = clearing();
    WalkGrid grid;
    grid.rebuild(map, {}, {{{20.5f, 20.5f}, 1.f, 0}});
    CHECK(grid.path({15.5f, 20.5f}, {20.5f, 20.5f}).empty());
}

TEST(game_walk_paths_choose_the_closest_accessible_point)
{
    auto map = clearing();
    map.at(20, 20).terrain = Terrain::Water;
    WalkGrid grid;
    grid.rebuild(map, {});
    auto point = grid.nearestWalkable({20.95f, 20.5f});
    CHECK((point == Point{21.5f, 20.5f}));
}

TEST(game_building_entrances_follow_rendered_ground_level_doors_at_arbitrary_angles)
{
    auto map = clearing();
    for (int kind = 0; kind < int(Structure::Count); ++kind) {
        const auto& asset = buildingAsset(Structure(kind));
        for (uint32_t variant = 0; variant < asset.variants.size(); ++variant)
            for (float angle : {0.f, .6457718f, 1.5707963f, 3.1415927f, 4.712389f, -.4f}) {
                Building building{1, Structure(kind), {20.3f, 20.4f}, angle, variant};
                auto model = asset.variants[variant];
                int quarter = 0;
                float residual = 0;
                splitAngle(angle, quarter, residual);
                orientModel(model, quarter, asset.footprint);
                gameframework::Motion still;
                still.turn = residual;
                still.pivot = {asset.footprint / 2, asset.footprint / 2};
                std::vector<gameframework::Face> faces;
                gameframework::buildingFaces(model, still, faces);
                bool hasGroundDoor = std::any_of(model.blocks.begin(), model.blocks.end(), [](const auto& block) {
                    return block.door && std::abs(block.base) < 1e-4f;
                });
                if (hasGroundDoor) {
                    const Block* front = nullptr;
                    for (const auto& block : asset.variants[variant].blocks)
                        if (block.door && std::abs(block.base) < 1e-4f && (!front || block.y1 > front->y1)) front = &block;
                    Point authored{front->x0 + (front->x1 - front->x0) * .28f - asset.footprint / 2, front->y1 - asset.footprint / 2};
                    Point expected{building.center.x + authored.x * std::cos(angle) - authored.y * std::sin(angle),
                                   building.center.y + authored.x * std::sin(angle) + authored.y * std::cos(angle)};
                    CHECK(distance(building.threshold(), expected) < 1e-4f);
                    // Read the actual rendered opening's bottom edge, independent of the
                    // navigation helper's rectangle/doorway calculations.
                    bool matchesOpening = false;
                    for (const auto& face : faces) {
                        if (!(face.color == Rgb{44, 30, 24})) continue;
                        auto polygon = face.shape(1000);
                        if (polygon.size() != 4) continue;
                        auto bottom = lerp(polygon[0], polygon[1], .5f);
                        auto opening = unproject(bottom.x, bottom.y) - still.pivot + building.center;
                        if (distance(building.threshold(), opening) < 1e-4f) matchesOpening = true;
                    }
                    if (quarter == 0 || quarter == 3) CHECK(matchesOpening);
                    auto corridor = rotated(building.door() - building.threshold(), -angle);
                    CHECK(std::abs(corridor.x) < 1e-4f);
                    CHECK(corridor.y >= .25f - 1e-4f);
                }
                WalkGrid grid;
                grid.rebuild(map, {}, {building.footprint()});
                CHECK(grid.walkable(building.door()));
                CHECK(!building.footprint().contains(building.door()));
                auto path = grid.path({12.5f, 12.5f}, building.door());
                CHECK(!path.empty());
                if (!path.empty()) CHECK(path.back() == building.door());
                for (size_t leg = 1; leg < path.size(); ++leg)
                    for (int sample = 0; sample <= 20; ++sample)
                        CHECK(!building.footprint().contains(lerp(path[leg - 1], path[leg], sample / 20.f), -.08f));
            }
    }
}

TEST(game_walk_paths_keep_a_blocked_start_as_a_walked_escape_leg)
{
    auto map = clearing();
    WalkGrid grid;
    grid.rebuild(map, {}, {{{20.5f, 20.5f}, 1.f, 0}});
    Point origin{20.5f, 20.5f}, destination{15.5f, 20.5f};
    auto path = grid.path(origin, destination);
    CHECK(path.size() >= 3);
    if (path.size() < 3) return;
    CHECK(path.front() == origin);
    CHECK(grid.walkable(path[1]));
    CHECK(path.back() == destination);
}

TEST(game_walk_paths_do_not_cut_a_rotated_wall_inside_a_single_navigation_cell)
{
    auto map = clearing();
    WalkGrid grid;
    grid.rebuild(map, {}, {{{19.9f, 20.5f}, 1.f, .78539816f}});
    Point from{21.15f, 20.05f}, to{21.15f, 20.95f};
    CHECK(grid.walkable(from));
    CHECK(grid.walkable(to));
    CHECK(grid.path(from, to).empty());
}
