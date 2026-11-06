#include <test/test.h>
#include <game/road_network.h>
#include <algorithm>
#include <cmath>
#include <limits>

namespace
{
using namespace hearthold;

float distanceToStroke(Point point, const std::vector<Point>& stroke)
{
    float nearest = std::numeric_limits<float>::max();
    for (size_t i = 1; i < stroke.size(); ++i)
        nearest = std::min(nearest, segmentDistance(point, stroke[i - 1], stroke[i]));
    return nearest;
}

void followsStroke(const RoadPath& path, const std::vector<Point>& stroke, float tolerance)
{
    CHECK(path.size() >= 2);
    if (path.size() < 2) return;
    CHECK(path.front().point == stroke.front());
    CHECK(path.back().point == stroke.back());
    auto line = flatten(path, .01f);
    for (auto point : line) CHECK(distanceToStroke(point, stroke) <= tolerance + .001f);
    for (auto point : stroke) CHECK(distanceToStroke(point, line) <= tolerance + .001f);
    for (const auto& anchor : path)
        for (auto point : {anchor.point, anchor.in, anchor.out}) CHECK(std::isfinite(point.x) && std::isfinite(point.y));
}
}

TEST(game_freehand_road_compacts_a_straight_stroke_without_moving_endpoints)
{
    std::vector<Point> stroke;
    for (int i = 0; i <= 200; ++i) stroke.push_back({-3 + i * .1f, 4});
    auto path = freehandRoad(stroke, .08f);
    CHECK_EQ(path.size(), 2u);
    followsStroke(path, stroke, .08f);
    CHECK(std::abs(pathLength(path) - 20) < .001f);
}

TEST(game_freehand_road_smooths_a_sampled_curve_with_bounded_deviation)
{
    std::vector<Point> stroke;
    for (int i = 0; i <= 120; ++i) {
        float angle = i * 1.57079632679f / 120;
        stroke.push_back({8 * std::cos(angle), 8 * std::sin(angle)});
    }
    auto path = freehandRoad(stroke, .12f);
    CHECK(path.size() > 2 && path.size() < stroke.size() / 4);
    bool smooth = false;
    for (size_t i = 1; i + 1 < path.size(); ++i)
        smooth |= !(path[i].point == path[i].in) && !(path[i].point == path[i].out);
    CHECK(smooth);
    followsStroke(path, stroke, .12f);
    CHECK(std::abs(pathLength(path) - 4 * 3.14159265359f) < .2f);
}

TEST(game_freehand_road_removes_sampling_noise_and_duplicate_events)
{
    std::vector<Point> stroke;
    for (int i = 0; i <= 200; ++i) {
        Point point{i * .1f, i == 0 || i == 200 ? 0.f : (i % 2 ? .015f : -.015f)};
        stroke.push_back(point);
        stroke.push_back(point);
    }
    auto path = freehandRoad(stroke, .08f);
    CHECK_EQ(path.size(), 2u);
    followsStroke(path, stroke, .08f);
    CHECK(std::abs(pathLength(path) - 20) < .001f);
}

TEST(game_freehand_road_retains_collinear_reversals_without_loops_or_overshoot)
{
    std::vector<Point> stroke{{0, 0}, {1, 0}, {4, 0}, {3, 0}, {5, 0}, {6, 0}};
    auto path = freehandRoad(stroke, .1f);
    followsStroke(path, stroke, .1f);
    CHECK(std::abs(pathLength(path) - 8) < .001f);
    CHECK(std::any_of(path.begin(), path.end(), [](const auto& anchor) { return anchor.point == (Point{4, 0}) && anchor.in == anchor.point && anchor.out == anchor.point; }));
    for (auto point : flatten(path, .01f)) CHECK(point.x >= 0 && point.x <= 6 && std::abs(point.y) < 1e-6f);
}

TEST(game_freehand_road_bounds_smoothing_for_short_uneven_samples_and_hairpins)
{
    std::vector<Point> stroke{{0, 0}, {.00001f, 0}, {.2f, .03f}, {2, .3f}, {2.001f, .31f}, {5, 2}, {5.04f, 2.04f}, {.5f, 2.08f}};
    auto path = freehandRoad(stroke, .025f);
    followsStroke(path, stroke, .025f);
    auto line = flatten(path, .02f);
    for (size_t i = 1; i < line.size(); ++i)
        for (size_t j = i + 2; j < line.size(); ++j)
            CHECK(!segmentsCross(line[i - 1], line[i], line[j - 1], line[j]));
}

TEST(game_freehand_road_handles_stationary_strokes_and_exact_polyline_requests)
{
    CHECK(freehandRoad({}, .1f).empty());
    CHECK(freehandRoad({{2, 3}, {2, 3}, {2, 3}}, .1f).empty());
    CHECK(freehandRoad({{0, 0}, {1, 1}}, std::numeric_limits<float>::infinity()).empty());
    CHECK(freehandRoad({{0, 0}, {std::numeric_limits<float>::quiet_NaN(), 1}}, .1f).empty());
    std::vector<Point> stroke{{0, 0}, {0, 0}, {1, 2}, {3, 4}};
    auto path = freehandRoad(stroke, 0);
    CHECK_EQ(path.size(), 3u);
    for (const auto& anchor : path) CHECK(anchor.in == anchor.point && anchor.out == anchor.point);
    followsStroke(path, stroke, .001f);
}
