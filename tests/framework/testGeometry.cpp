#include <test/test.h>
#include <GameEngine/GameFramework/geometry.h>
#include <cmath>

using namespace gameframework;
namespace { constexpr float pi = 3.14159265358979323846f; }

TEST(framework_geometry_turns_footprints_and_measures_outlines)
{
    Footprint square{{5, 5}, .5f, pi / 4};
    CHECK(square.contains({5, 5.65f}));       // A diamond reaches further along the axes.
    CHECK(!square.contains({5.45f, 5.45f}));  // ...and less along the diagonals.
    CHECK(square.overlaps({{5.9f, 5}, .5f, 0}));
    CHECK(!square.overlaps({{6.3f, 5}, .5f, 0}));
    Outline field{{0, 0}, {4, 0}, {4, 3}, {0, 3}};
    CHECK(std::abs(area(field) - 12) < 1e-4f);
    CHECK(!selfIntersects(field));
    CHECK(selfIntersects({{0, 0}, {4, 3}, {4, 0}, {0, 3}}));
}

TEST(framework_camera_preserves_world_coordinates_through_zoom_and_pan)
{
    Camera camera{37, -19, 2.5f};
    Point origin{camera.x, camera.y};
    CHECK(camera.toScreen(origin, 1280, 720) == (Point{640, 360}));
    Point world{-15, 24};
    auto screen = camera.toScreen(world, 1280, 720);
    CHECK(distance(camera.toWorld(screen, 1280, 720), world) < 1e-5f);
}

TEST(framework_footprint_corners_keep_the_polygon_order_for_all_rotations)
{
    for (float angle : {0.f, pi / 7, pi / 4, pi / 2, -pi / 3, pi * 2}) {
        Footprint footprint{{3.25f, -7.5f}, 2.5f, angle};
        auto corners = footprint.corners();
        CHECK_EQ(corners.size(), 4u);
        Outline expected;
        for (Point local : {Point{-2.5f, -2.5f}, Point{2.5f, -2.5f}, Point{2.5f, 2.5f}, Point{-2.5f, 2.5f}})
            expected.push_back(footprint.center + rotated(local, angle));
        CHECK(corners == expected);
    }
}

TEST(framework_footprint_overlap_keeps_polygon_boundary_and_rotation_rules)
{
    for (float angle : {0.f, pi / 7, pi / 4, pi / 2, -pi / 3})
        for (float half : {0.f, .5f, 1.f, 3.f})
            for (float x : {-4.f, -2.f, -1.f, 0.f, 1.f, 2.f, 4.f})
                for (float y : {-4.f, -2.f, -1.f, 0.f, 1.f, 2.f, 4.f}) {
                    Footprint a{{0, 0}, half, angle}, b{{x, y}, half, -angle};
                    CHECK(a.overlaps(b) == overlaps(a.corners(), b.corners()));
                    CHECK(b.overlaps(a) == overlaps(b.corners(), a.corners()));
                }
    unsigned state = 324823;
    auto roll = [&] {
        state ^= state << 13; state ^= state >> 17; state ^= state << 5;
        return float(state >> 8) / float(1u << 24);
    };
    for (int i = 0; i < 3000; ++i) {
        Footprint a{{roll() * 200 - 100, roll() * 200 - 100}, roll() * 10, roll() * 6.3f};
        Footprint b{a.center + Point{roll() * 20 - 10, roll() * 20 - 10}, roll() * 10, roll() * 6.3f};
        CHECK(a.overlaps(b) == overlaps(a.corners(), b.corners()));
    }
}

TEST(framework_footprint_contains_keeps_local_space_rules_with_margins)
{
    for (float angle : {0.f, pi / 7, pi / 4, pi / 2, -pi / 3})
        for (float half : {0.f, .5f, 1.f, 3.f})
            for (float margin : {-2.f, -.08f, 0.f, .5f})
                for (float x : {-20.f, -4.f, -2.f, -1.f, 0.f, 1.f, 2.f, 4.f, 20.f})
                    for (float y : {-20.f, -4.f, -2.f, -1.f, 0.f, 1.f, 2.f, 4.f, 20.f}) {
                        Footprint footprint{{-3.5f, 7.25f}, half, angle};
                        Point p = footprint.center + Point{x, y};
                        auto local = rotated(p - footprint.center, -angle);
                        bool expected = std::abs(local.x) <= half + margin && std::abs(local.y) <= half + margin;
                        CHECK(footprint.contains(p, margin) == expected);
                    }
}
