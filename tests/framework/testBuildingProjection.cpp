#include <test/test.h>
#include <GameEngine/GameFramework/building_faces.h>
#include <cmath>

namespace
{
using namespace gameframework;
bool near(float a, float b) { return std::abs(a - b) < .0001f; }
}

TEST(framework_building_projection_retains_world_depth_after_rotation_and_stage_offset)
{
    Motion motion;
    motion.offset = {1.25f, -.75f}; motion.pivot = {.5f, .5f};
    motion.projection = {48, 20};
    for (float turn : {-.785398f, -.37f, 0.f, .37f, .785398f}) {
        motion.turn = turn;
        float x = .2f, y = .8f, z = 37;
        float lx = x + motion.offset.x - motion.pivot.x;
        float ly = y + motion.offset.y - motion.pivot.y;
        float worldX = motion.pivot.x + lx * std::cos(turn) - ly * std::sin(turn);
        float worldY = motion.pivot.y + lx * std::sin(turn) + ly * std::cos(turn);
        auto vertex = motion.place(x, y, z);
        auto screen = motion.projection.project(worldX, worldY, z);
        CHECK(near(vertex.x, screen.x)); CHECK(near(vertex.y, screen.y));
        CHECK(near(vertex.depth, worldX + worldY));
        // Screen coordinates and retained depth reconstruct the full transformed point.
        CHECK(near((vertex.depth + vertex.x / motion.projection.halfWidth) / 2, worldX));
        CHECK(near((vertex.depth - vertex.x / motion.projection.halfWidth) / 2, worldY));
        CHECK(near(vertex.depth * motion.projection.halfHeight - vertex.y, z));
    }
}

TEST(framework_building_projection_orders_points_on_the_same_view_ray)
{
    Motion motion;
    for (float halfHeight : {8.f, 16.f, 32.f}) {
        motion.projection.halfHeight = halfHeight;
        auto far = motion.place(.25f, .5f, 10);
        auto near = motion.place(1.25f, 1.5f, 10 + 2 * halfHeight);
        CHECK(std::abs(far.x - near.x) < .0001f);
        CHECK(std::abs(far.y - near.y) < .0001f);
        CHECK(near.depth > far.depth);
        CHECK_EQ(near.depth - far.depth, 2.f);
    }
}

TEST(framework_building_surface_and_billboard_vertices_keep_spatial_depth)
{
    Block block{2, 3, 3, 4, 20, 15, RoofShape::Flat, {90,80,70}, {60,50,40}, {70,60,50}, {40,30,20}};
    block.base = 7; block.windows = 2; block.door = true;
    Motion motion; motion.offset = {.5f, .25f}; motion.pivot = {2.5f, 3.5f}; motion.turn = .37f;
    auto center = motion.place(2.5f, 3.5f, 0);
    for (auto shape : {RoofShape::Flat, RoofShape::GableX, RoofShape::GableY, RoofShape::Pyramid})
        for (auto trim : {Trim::None, Trim::Timber, Trim::Crenels, Trim::Stakes})
            for (auto ornament : {Ornament::None, Ornament::Banner, Ornament::Crystal}) {
                block.shape = shape; block.trim = trim; block.ornament = ornament;
                std::vector<Face> faces;
                buildingFaces({{}, {block}}, motion, faces);
                CHECK(!faces.empty());
                for (float frame : {0.f, 10.f, 20.f, 30.f, 1000.f})
                    for (const auto& face : faces)
                        for (auto vertex : face.shape(frame)) {
                            CHECK(std::isfinite(vertex.x) && std::isfinite(vertex.y) && std::isfinite(vertex.depth));
                            CHECK(std::abs(vertex.depth - center.depth) <= 1.5f);
                        }
                size_t count = ornament == Ornament::Banner ? 2 : ornament == Ornament::Crystal ? 3 : 0;
                for (size_t i = faces.size() - count; i < faces.size(); ++i)
                    for (auto vertex : faces[i].shape(1000)) CHECK(near(vertex.depth, center.depth));
            }
}

TEST(framework_building_door_follows_the_authored_wall_through_quarter_turns)
{
    Block block{.1f, .2f, .7f, .8f, 20, 10, RoofShape::GableY, {90,80,70}, {60,50,40}, {70,60,50}, {40,30,20}};
    block.door = true;
    constexpr float quarter = 1.57079632679f;
    for (int turns = 0; turns < 4; ++turns) {
        for (float residual : {-.37f, 0.f, .37f}) {
            Model model{{}, {block}};
            orientModel(model, turns, 1);
            Motion motion;
            motion.turn = residual; motion.pivot = {.5f, .5f};
            std::vector<Face> faces;
            buildingFaces(model, motion, faces);
            int doors = 0;
            for (const auto& face : faces) {
                if (face.color != Rgb{44, 30, 24} || face.style != Face::Style::Filled) continue;
                ++doors;
                auto polygon = face.shape(1000);
                Motion authored;
                authored.turn = turns * quarter + residual; authored.pivot = motion.pivot;
                auto expected = authored.place(block.x0 + (block.x1 - block.x0) * .28f, block.y1, 0);
                CHECK(near((polygon[0].x + polygon[1].x) / 2, expected.x));
                CHECK(near((polygon[0].y + polygon[1].y) / 2, expected.y));
                CHECK(near((polygon[0].depth + polygon[1].depth) / 2, expected.depth));
            }
            // The opposite two walls are occluded by this closed block.
            CHECK_EQ(doors, turns == 0 || turns == 3 ? 1 : 0);
        }
    }
}
