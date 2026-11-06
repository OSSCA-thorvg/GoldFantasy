#include <test/test.h>
#include <game/road_graph.h>
#include <algorithm>

namespace
{
using namespace hearthold;

size_t nodeAt(const RoadGraph& graph, Point p)
{
    auto found = std::find(graph.nodes().begin(), graph.nodes().end(), p);
    return size_t(found - graph.nodes().begin());
}
}  // namespace

TEST(game_road_graph_preserves_first_node_merge_across_spatial_buckets)
{
    // The third road's start is within merge range of both previous starts. Keep the first
    // node even though the second is in the bucket visited first. Same-road pieces do not join.
    auto graph = RoadGraph::build({{{.05f, 0}, {2, 2}, 4}, {{-.05f, 0}, {-2, 2}, 4}, {{0, 0}, {0, -2}, 4}});
    auto first = nodeAt(graph, {.05f, 0}), second = nodeAt(graph, {-.05f, 0});
    CHECK(first < graph.nodes().size());
    CHECK(second < graph.nodes().size());
    if (first < graph.nodes().size() && second < graph.nodes().size()) {
        CHECK_EQ(graph.degree(first), size_t(2));
        CHECK_EQ(graph.degree(second), size_t(1));
    }
}

TEST(game_road_graph_preserves_nearest_join_ties_and_negative_coordinates)
{
    // Both ends of the middle stub are equally close to the parallel roads. Original segment
    // order resolves equal gaps in favor of the later road, across negative bucket boundaries.
    auto graph = RoadGraph::build({{{-4, -2.5f}, {4, -2.5f}, 0}, {{-4, -1.5f}, {4, -1.5f}, 1}, {{-1, -2}, {0, -2}, 2}});
    CHECK(!graph.route({-3, -1.5f}, {-.5f, -2}).empty());
    CHECK(graph.route({-3, -2.5f}, {-.5f, -2}).empty());
}

TEST(game_road_graph_handles_long_crossings_without_unbounded_spatial_buckets)
{
    auto graph = RoadGraph::build({{{-1000, -1000}, {1000, 1000}, 0}, {{-1000, 1000}, {1000, -1000}, 1}});
    CHECK_EQ(graph.nodes().size(), size_t(5));
    auto crossing = nodeAt(graph, {0, 0});
    CHECK(crossing < graph.nodes().size());
    if (crossing < graph.nodes().size()) CHECK_EQ(graph.degree(crossing), size_t(4));
    CHECK(!graph.route({-900, -900}, {900, -900}).empty());
}

TEST(game_road_graph_keeps_flattened_branch_network_connected)
{
    RoadNetwork network;
    auto straight = [&](Point a, Point b) {
        network.add({{a, a, lerp(a, b, 1.f / 3)}, {b, lerp(a, b, 2.f / 3), b}}, 1);
    };
    straight({-16, -2}, {16, -2});
    for (int x = -14; x <= 14; x += 2) straight({float(x), -1.5f}, {float(x), 18});
    auto graph = RoadGraph::build(network.builtSegments());
    for (int x = -14; x <= 14; x += 2) {
        auto path = graph.route({-16, -2}, {float(x), 18});
        CHECK(!path.empty());
        if (!path.empty()) CHECK(path.back() == (Point{float(x), 18}));
    }
}
