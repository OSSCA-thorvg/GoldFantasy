#include "road_graph.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <queue>
#include <unordered_map>

namespace hearthold
{
namespace
{
constexpr float mergeDistance = .08f;
constexpr float joinDistance = .75f;  // A loose road end this close to another road joins it.

struct Cell
{
    int x, y;
    bool operator==(const Cell&) const = default;
};
struct CellHash
{
    size_t operator()(Cell cell) const
    {
        return size_t(uint64_t(uint32_t(cell.x)) * 0x9e3779b1u ^ uint32_t(cell.y));
    }
};
using Buckets = std::unordered_map<Cell, std::vector<size_t>, CellHash>;

// Endpoint and graph-node lookups share the exact distance test with the original scan. A
// neighboring bucket can contain an earlier node, so merging always chooses the lowest ID.
class PointIndex
{
public:
    void add(Point p, size_t id) { buckets[cell(p)].push_back(id); }
    template<typename Visit>
    void nearby(Point p, Visit visit) const
    {
        auto at = cell(p);
        for (int y = at.y - 1; y <= at.y + 1; ++y)
            for (int x = at.x - 1; x <= at.x + 1; ++x) {
                auto found = buckets.find({x, y});
                if (found != buckets.end()) for (auto id : found->second) visit(id);
            }
    }
private:
    static Cell cell(Point p) { return {int(std::floor(double(p.x) / mergeDistance)), int(std::floor(double(p.y) / mergeDistance))}; }
    Buckets buckets;
};

// Flattened roads contain many short pieces. Compare only pieces in overlapping spatial
// buckets, including all possible loose-end joins. Very long input segments use a bounded
// fallback instead of filling an unbounded rectangle of buckets.
class SegmentIndex
{
public:
    explicit SegmentIndex(const std::vector<RoadSegment>& segments) : count(segments.size())
    {
        for (size_t i = 0; i < segments.size(); ++i) {
            auto [low, high] = bounds(segments[i].a, segments[i].b, 0);
            if (large(low, high)) { longSegments.push_back(i); continue; }
            for (int y = low.y; y <= high.y; ++y)
                for (int x = low.x; x <= high.x; ++x) buckets[{x, y}].push_back(i);
        }
    }
    std::vector<size_t> nearby(Point a, Point b, float margin = 0) const
    {
        auto [low, high] = bounds(a, b, margin);
        std::vector<size_t> result;
        if (large(low, high)) {
            result.reserve(count);
            for (size_t i = 0; i < count; ++i) result.push_back(i);
            return result;
        }
        result = longSegments;
        for (int y = low.y; y <= high.y; ++y)
            for (int x = low.x; x <= high.x; ++x) {
                auto found = buckets.find({x, y});
                if (found != buckets.end()) result.insert(result.end(), found->second.begin(), found->second.end());
            }
        std::sort(result.begin(), result.end());
        result.erase(std::unique(result.begin(), result.end()), result.end());
        return result;
    }
private:
    static std::pair<Cell, Cell> bounds(Point a, Point b, float margin)
    {
        constexpr float size = 2;
        return {{int(std::floor((std::min(a.x, b.x) - margin) / size)), int(std::floor((std::min(a.y, b.y) - margin) / size))},
                {int(std::floor((std::max(a.x, b.x) + margin) / size)), int(std::floor((std::max(a.y, b.y) + margin) / size))}};
    }
    static bool large(Cell low, Cell high)
    {
        int64_t width = int64_t(high.x) - low.x + 1, height = int64_t(high.y) - low.y + 1;
        return width > 4096 || height > 4096 || width * height > 4096;
    }
    size_t count;
    Buckets buckets;
    std::vector<size_t> longSegments;
};

// Parameter of the closest point on segment ab.
float project(Point p, Point a, Point b)
{
    float dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    return length > 0 ? std::clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / length, 0.f, 1.f) : 0;
}

bool intersect(const RoadSegment& p, const RoadSegment& q, float& t, float& u)
{
    float rx = p.b.x - p.a.x, ry = p.b.y - p.a.y, sx = q.b.x - q.a.x, sy = q.b.y - q.a.y;
    float cross = rx * sy - ry * sx;
    if (std::abs(cross) < 1e-6f) return false;
    float qx = q.a.x - p.a.x, qy = q.a.y - p.a.y;
    t = (qx * sy - qy * sx) / cross;
    u = (qx * ry - qy * rx) / cross;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
}  // namespace

void RoadGraph::connect(size_t a, size_t b)
{
    if (a == b) return;
    for (const auto& link : links[a])
        if (link.to == b) return;
    float length = distance(points[a], points[b]);
    links[a].push_back({b, length});
    links[b].push_back({a, length});
}

RoadGraph RoadGraph::build(const std::vector<RoadSegment>& segments)
{
    RoadGraph graph;
    std::vector<std::vector<float>> cuts(segments.size(), std::vector<float>{0, 1});
    std::vector<std::pair<Point, Point>> joins;
    PointIndex endpoints, nodes;
    SegmentIndex pieces(segments);
    for (size_t i = 0; i < segments.size(); ++i) {
        endpoints.add(segments[i].a, i * 2);
        endpoints.add(segments[i].b, i * 2 + 1);
    }
    auto node = [&](Point p) {
        size_t best = graph.points.size();
        nodes.nearby(p, [&](size_t i) { if (i < best && distance(graph.points[i], p) < mergeDistance) best = i; });
        if (best < graph.points.size()) return best;
        nodes.add(p, best);
        graph.points.push_back(p);
        graph.links.emplace_back();
        return best;
    };
    // Only a road's loose ends join other roads; points inside a flattened curve are shared.
    auto loose = [&](Point end) {
        int count = 0;
        endpoints.nearby(end, [&](size_t i) {
            const auto& s = segments[i / 2];
            count += distance(i % 2 ? s.b : s.a, end) < mergeDistance;
        });
        return count == 1;
    };
    std::vector<uint8_t> looseA(segments.size()), looseB(segments.size());
    for (size_t i = 0; i < segments.size(); ++i) {
        looseA[i] = loose(segments[i].a);
        looseB[i] = loose(segments[i].b);
    }
    for (size_t i = 0; i < segments.size(); ++i)
        for (size_t j : pieces.nearby(segments[i].a, segments[i].b)) {
            if (j <= i) continue;
            float t = 0, u = 0;
            if (intersect(segments[i], segments[j], t, u)) {
                cuts[i].push_back(t);
                cuts[j].push_back(u);
            }
        }
    // Each loose end joins the single nearest piece of another road.
    for (size_t j = 0; j < segments.size(); ++j)
        for (int side = 0; side < 2; ++side) {
            if (!(side ? looseB[j] : looseA[j])) continue;
            auto end = side ? segments[j].b : segments[j].a;
            size_t best = segments.size();
            float bestT = 0, bestGap = joinDistance;
            for (size_t i : pieces.nearby(end, end, joinDistance)) {
                if (i == j || (segments[i].road >= 0 && segments[i].road == segments[j].road)) continue;
                float t = project(end, segments[i].a, segments[i].b);
                float gap = distance(lerp(segments[i].a, segments[i].b, t), end);
                if (gap <= bestGap) { best = i; bestT = t; bestGap = gap; }
            }
            if (best == segments.size()) continue;
            cuts[best].push_back(bestT);
            auto on = lerp(segments[best].a, segments[best].b, bestT);
            if (bestGap > mergeDistance) joins.push_back({end, on});
        }
    for (size_t i = 0; i < segments.size(); ++i) {
        auto& list = cuts[i];
        std::sort(list.begin(), list.end());
        size_t previous = node(lerp(segments[i].a, segments[i].b, list.front()));
        for (size_t k = 1; k < list.size(); ++k) {
            size_t next = node(lerp(segments[i].a, segments[i].b, list[k]));
            graph.connect(previous, next);
            previous = next;
        }
    }
    for (auto [end, on] : joins) graph.connect(node(end), node(on));
    return graph;
}

RoadGraph::Snap RoadGraph::snap(Point p) const
{
    Snap best{0, 0, p, std::numeric_limits<float>::max()};
    for (size_t a = 0; a < points.size(); ++a) {
        if (links[a].empty() && distance(points[a], p) < best.distance) best = {a, a, points[a], distance(points[a], p)};
        for (const auto& link : links[a]) {
            if (link.to < a) continue;
            auto on = lerp(points[a], points[link.to], project(p, points[a], points[link.to]));
            if (distance(on, p) < best.distance) best = {a, link.to, on, distance(on, p)};
        }
    }
    return best;
}

Point RoadGraph::nearest(Point p) const { return empty() ? p : snap(p).point; }

std::vector<Point> RoadGraph::route(Point from, Point to) const
{
    if (empty()) return {};
    auto start = snap(from), goal = snap(to);
    if ((start.a == goal.a && start.b == goal.b) || (start.a == goal.b && start.b == goal.a)) return {from, start.point, goal.point, to};
    constexpr float infinite = std::numeric_limits<float>::max();
    std::vector<float> cost(points.size(), infinite);
    std::vector<size_t> previous(points.size(), size_t(-1));
    using Entry = std::pair<float, size_t>;
    std::priority_queue<Entry, std::vector<Entry>, std::greater<>> open;
    for (auto n : {start.a, start.b}) {
        float c = distance(start.point, points[n]);
        if (c < cost[n]) { cost[n] = c; open.push({c, n}); }
    }
    while (!open.empty()) {
        auto [c, n] = open.top();
        open.pop();
        if (c > cost[n]) continue;
        for (const auto& link : links[n])
            if (c + link.length < cost[link.to]) {
                cost[link.to] = c + link.length;
                previous[link.to] = n;
                open.push({cost[link.to], link.to});
            }
    }
    float viaA = cost[goal.a] == infinite ? infinite : cost[goal.a] + distance(points[goal.a], goal.point);
    float viaB = cost[goal.b] == infinite ? infinite : cost[goal.b] + distance(points[goal.b], goal.point);
    if (viaA == infinite && viaB == infinite) return {};
    std::vector<Point> path{to, goal.point};
    for (size_t n = viaA <= viaB ? goal.a : goal.b; n != size_t(-1); n = previous[n]) path.push_back(points[n]);
    path.push_back(start.point);
    path.push_back(from);
    std::reverse(path.begin(), path.end());
    return path;
}
}  // namespace hearthold
