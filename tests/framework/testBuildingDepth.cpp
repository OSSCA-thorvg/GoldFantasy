#include <test/test.h>
#include <GameEngine/GameFramework/building_depth.h>
#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace
{
using namespace gameframework;
Face face(Polygon polygon, Face::Style style = Face::Style::Filled)
{
    return {[polygon](float) { return polygon; }, {100, 120, 140}, style, 1.2f, {}};
}
bool contains(const DepthFragment& fragment, float x, float y)
{
    const auto& points = fragment.polygon;
    if (fragment.line) {
        auto a = points.front(), b = points.back();
        float dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
        float t = length ? ((x - a.x) * dx + (y - a.y) * dy) / length : 0;
        return t >= 0 && t <= 1 && std::hypot(a.x + t * dx - x, a.y + t * dy - y) < .0001f;
    }
    bool positive = false, negative = false;
    for (size_t i = 0; i < points.size(); ++i) {
        auto a = points[i], b = points[(i + 1) % points.size()];
        float cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
        positive |= cross > .0001f; negative |= cross < -.0001f;
    }
    return !(positive && negative);
}
size_t visible(const std::vector<DepthFragment>& fragments, float x, float y)
{
    size_t source = size_t(-1);
    for (const auto& fragment : fragments) if (contains(fragment, x, y)) source = fragment.source;
    return source;
}
Polygon rectangle(float depth) { return {{0,0,depth},{4,0,depth},{4,4,depth},{0,4,depth}}; }
}

TEST(framework_building_depth_splits_crossing_roof_and_chimney_surfaces)
{
    auto roof = face({{0,0,4},{4,0,0},{4,4,0},{0,4,4}});
    auto chimney = face({{1,1,2},{3,1,2},{3,3,2},{1,3,2}});
    for (bool reverse : {false, true}) {
        std::vector<Face> faces = reverse ? std::vector<Face>{chimney, roof} : std::vector<Face>{roof, chimney};
        auto result = depthOrder(faces, 1000);
        CHECK_EQ(visible(result, 1.5f, 2.f), reverse ? size_t(1) : size_t(0));
        CHECK_EQ(visible(result, 2.5f, 2.f), reverse ? size_t(0) : size_t(1));
        CHECK(result.size() > faces.size());
    }
}

TEST(framework_building_depth_preserves_original_outlines_without_cut_seams)
{
    auto result = depthOrder({face({{0,0,4},{4,0,0},{4,4,0},{0,4,4}}, Face::Style::Outlined),
                              face({{1,1,2},{3,1,2},{3,3,2},{1,3,2}})}, 1000);
    size_t edges = 0;
    for (const auto& fragment : result) if (fragment.line && fragment.source == 0) {
        ++edges;
        auto a = fragment.polygon.front(), b = fragment.polygon.back();
        CHECK((a.x == 0 && b.x == 0) || (a.x == 4 && b.x == 4) || (a.y == 0 && b.y == 0) || (a.y == 4 && b.y == 4));
    }
    CHECK(edges >= 4);
}

TEST(framework_building_depth_splits_lines_against_surfaces)
{
    auto result = depthOrder({face(rectangle(2)), face({{0,2,0},{4,2,4}}, Face::Style::Line)}, 1000);
    CHECK_EQ(visible(result, 1.5f, 2.f), size_t(0));
    CHECK_EQ(visible(result, 2.5f, 2.f), size_t(1));
    for (const auto& fragment : result) if (fragment.line) {
        // The buried half must be absent, even if raster AA leaves gaps between roof fragments.
        for (auto point : fragment.polygon) CHECK(point.x >= 2.f - .0001f);
    }
}

TEST(framework_building_depth_keeps_lines_behind_translucent_surfaces)
{
    auto glass = face(rectangle(2)); glass.opacity = {{0,50}};
    auto result = depthOrder({glass, face({{0,2,0},{4,2,4}}, Face::Style::Line)}, 1000);
    CHECK(std::any_of(result.begin(), result.end(), [](const auto& fragment) { return fragment.line && fragment.polygon.front().x < 1; }));
}

TEST(framework_building_depth_retains_coplanar_decals_and_transparent_layers)
{
    auto wall = face(rectangle(2)), window = face({{1,1,2},{3,1,2},{3,3,2},{1,3,2}});
    auto result = depthOrder({wall, window}, 1000);
    CHECK_EQ(visible(result, 2, 2), size_t(1));
    auto glass = face(rectangle(3)); glass.opacity = {{0,0},{10,50}};
    result = depthOrder({glass, wall}, 0);
    CHECK_EQ(result.size(), size_t(1)); CHECK_EQ(result[0].source, size_t(1));
    result = depthOrder({glass, wall}, 10);
    CHECK_EQ(result.size(), size_t(2));
    CHECK_EQ(result.front().source, size_t(1)); CHECK_EQ(result.back().source, size_t(0));
}

TEST(framework_building_depth_triangulates_concave_banners_without_filling_notches)
{
    auto result = depthOrder({face(rectangle(0)), face({{0,0,1},{4,1,1},{2,2,1},{4,3,1},{0,4,1}})}, 1000);
    CHECK_EQ(visible(result, 1, 2), size_t(1));
    CHECK_EQ(visible(result, 3.5f, 2), size_t(0));
}

TEST(framework_building_depth_rejects_excessive_fragment_work_explicitly)
{
    std::vector<Face> many(65537, face({{0,0,0},{1,1,0}}, Face::Style::Line));
    bool rejected = false;
    try { (void)depthOrder(many, 0); } catch (const std::length_error&) { rejected = true; }
    CHECK(rejected);
}
