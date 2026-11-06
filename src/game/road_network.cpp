#include "road_network.h"
#include <algorithm>
#include <cmath>

namespace hearthold
{
RoadPath freehandRoad(const std::vector<Point>& points, float tolerance)
{
    if (!std::isfinite(tolerance)) return {};
    std::vector<Point> samples;
    samples.reserve(points.size());
    for (auto point : points) {
        if (!std::isfinite(point.x) || !std::isfinite(point.y)) return {};
        if (samples.empty() || !(samples.back() == point)) samples.push_back(point);
    }
    if (samples.size() < 2) return {};

    RoadPath path;
    if (tolerance <= 0) {
        for (auto point : samples) path.push_back(RoadAnchor::sharp(point));
        return path;
    }

    // Reserve half the error for simplification and half for the Bézier control hull.
    float budget = tolerance * .5f;
    std::vector<bool> keep(samples.size(), false);
    keep.front() = keep.back() = true;
    std::vector<std::pair<size_t, size_t>> pending{{0, samples.size() - 1}};
    while (!pending.empty()) {
        auto [first, last] = pending.back();
        pending.pop_back();
        size_t split = first;
        float error = budget;
        for (size_t i = first + 1; i < last; ++i) {
            float deviation = segmentDistance(samples[i], samples[first], samples[last]);
            if (deviation > error) { error = deviation; split = i; }
        }

        // Distance alone would erase a deliberate out-and-back stroke on a straight line.
        auto chord = samples[last] - samples[first];
        float span = length(chord);
        if (span > 0) {
            auto direction = chord * (1 / span);
            float furthest = 0;
            size_t peak = first;
            for (size_t i = first + 1; i < last; ++i) {
                auto relative = samples[i] - samples[first];
                float progress = relative.x * direction.x + relative.y * direction.y;
                if (peak > first && furthest - progress > error) {
                    error = furthest - progress;
                    split = peak;
                }
                if (progress > furthest) { furthest = progress; peak = i; }
            }
        }
        if (split != first) {
            keep[split] = true;
            pending.emplace_back(first, split);
            pending.emplace_back(split, last);
        }
    }
    for (size_t i = 0; i < samples.size(); ++i)
        if (keep[i] && (path.empty() || !(path.back().point == samples[i]))) path.push_back(RoadAnchor::sharp(samples[i]));
    if (path.size() < 2) return {};

    path.front().out = lerp(path.front().point, path[1].point, 1.f / 3);
    path.back().in = lerp(path.back().point, path[path.size() - 2].point, 1.f / 3);
    for (size_t i = 1; i + 1 < path.size(); ++i) {
        auto before = path[i].point - path[i - 1].point;
        auto after = path[i + 1].point - path[i].point;
        float incoming = length(before), outgoing = length(after);
        if (incoming < 1e-6f || outgoing < 1e-6f) continue;
        before = before * (1 / incoming);
        after = after * (1 / outgoing);
        if (before.x * after.x + before.y * after.y <= 0) continue;
        auto tangent = normalized(before + after);
        auto cross = [](Point a, Point b) { return a.x * b.y - a.y * b.x; };
        float bend = std::max(std::abs(cross(tangent, before)), std::abs(cross(tangent, after)));
        float handle = std::min(incoming, outgoing) / 3;
        if (bend > 0) handle = std::min(handle, budget / bend);
        // Short controls preserve forward progress on each chord; reversals remain sharp.
        path[i].in = path[i].point - tangent * handle;
        path[i].out = path[i].point + tangent * handle;
    }
    return path;
}

std::vector<Point> flatten(const RoadPath& path, float step)
{
    std::vector<Point> line;
    if (path.empty()) return line;
    line.push_back(path.front().point);
    for (size_t i = 1; i < path.size(); ++i) {
        auto p0 = path[i - 1].point, p1 = path[i - 1].out, p2 = path[i].in, p3 = path[i].point;
        // The control polygon bounds the curve length.
        float hull = distance(p0, p1) + distance(p1, p2) + distance(p2, p3);
        int pieces = std::max(1, int(std::ceil(hull / step)));
        for (int k = 1; k <= pieces; ++k) line.push_back(cubic(p0, p1, p2, p3, float(k) / pieces));
    }
    return line;
}

float pathLength(const RoadPath& path)
{
    auto line = flatten(path, .1f);
    float total = 0;
    for (size_t i = 1; i < line.size(); ++i) total += distance(line[i - 1], line[i]);
    return total;
}

float Road::length() const
{
    float total = 0;
    for (size_t i = 1; i < line.size(); ++i) total += hearthold::distance(line[i - 1], line[i]);
    return total;
}

Point Road::along(float share) const
{
    float left = std::clamp(share, 0.f, 1.f) * length();
    for (size_t i = 1; i < line.size(); ++i) {
        float leg = hearthold::distance(line[i - 1], line[i]);
        if (left <= leg && leg > 0) return lerp(line[i - 1], line[i], left / leg);
        left -= leg;
    }
    return line.empty() ? Point{} : line.back();
}

int RoadNetwork::add(RoadPath path, float built)
{
    list.push_back({nextId, path, flatten(path), built});
    return nextId++;
}

float Road::laidBegin() const { return std::max(0.f, constructionStart - std::max(0.f, built - (1 - constructionStart))); }
float Road::laidEnd() const { return std::min(1.f, constructionStart + built); }
Point Road::workPoint() const
{
    if (built < 1) return constructionPoint(built);
    return along(paving >= 0 ? paving : .5f);
}

Point Road::constructionPoint(float progress) const
{
    if (constructionStart <= 0) return along(progress);
    return along(progress < 1 - constructionStart ? constructionStart + progress : 1 - progress);
}

std::vector<Point> Road::laidLine() const
{
    if (built <= 0 || line.empty()) return {};
    float total = length(), first = laidBegin() * total, last = laidEnd() * total, walked = 0;
    std::vector<Point> out;
    for (size_t i = 1; i < line.size() && walked < last; ++i) {
        float leg = hearthold::distance(line[i - 1], line[i]);
        if (leg > 0 && walked + leg > first) {
            if (out.empty()) out.push_back(lerp(line[i - 1], line[i], std::max(0.f, first - walked) / leg));
            out.push_back(lerp(line[i - 1], line[i], std::min(leg, last - walked) / leg));
        }
        walked += leg;
    }
    return out;
}

Road* RoadNetwork::road(int id)
{
    for (auto& road : list)
        if (road.id == id) return &road;
    return nullptr;
}

bool RoadNetwork::remove(int id)
{
    auto before = list.size();
    list.erase(std::remove_if(list.begin(), list.end(), [&](const Road& r) { return r.id == id; }), list.end());
    return list.size() != before;
}

bool RoadNetwork::reshape(int id, RoadPath path)
{
    for (auto& road : list)
        if (road.id == id) {
            road.line = flatten(path);
            road.path = std::move(path);
            road.built = 0;  // The new course has to be laid again.
            road.paved = false;
            road.paving = -1;
            return true;
        }
    return false;
}

const Road* RoadNetwork::road(int id) const
{
    for (const auto& road : list)
        if (road.id == id) return &road;
    return nullptr;
}

std::vector<RoadSegment> RoadNetwork::segments() const
{
    std::vector<RoadSegment> out;
    for (const auto& road : list)
        for (size_t i = 1; i < road.line.size(); ++i) out.push_back({road.line[i - 1], road.line[i], road.id});
    return out;
}

std::vector<RoadSegment> RoadNetwork::builtSegments() const
{
    std::vector<RoadSegment> out;
    for (const auto& road : list) {
        auto laid = road.laidLine();
        for (size_t i = 1; i < laid.size(); ++i) out.push_back({laid[i - 1], laid[i], road.id});
    }
    return out;
}

float RoadNetwork::distance(Point p, Point* onRoad, int* id, int ignore, Point* tangent) const
{
    float best = 1e9f;
    for (const auto& road : list)
        for (size_t i = 1; road.id != ignore && i < road.line.size(); ++i) {
            auto q = closestOnSegment(p, road.line[i - 1], road.line[i]);
            float d = hearthold::distance(p, q);
            if (d >= best) continue;
            best = d;
            if (onRoad) *onRoad = q;
            if (id) *id = road.id;
            if (tangent) *tangent = normalized(road.line[i] - road.line[i - 1]);
        }
    return best;
}
}  // namespace hearthold
