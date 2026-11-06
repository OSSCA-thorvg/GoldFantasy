#include "geometry.h"
#include <algorithm>
#include <array>
#include <span>
#include <cmath>

namespace gameframework
{
namespace
{
std::array<Point, 4> cornersOf(const Footprint& footprint)
{
    auto center = footprint.center;
    float half = footprint.half, angle = footprint.angle;
    return {center + rotated({-half, -half}, angle), center + rotated({half, -half}, angle),
            center + rotated({half, half}, angle), center + rotated({-half, half}, angle)};
}

bool containsPolygon(std::span<const Point> outline, Point p)
{
    bool inside = false;
    for (size_t i = 0, j = outline.size() - 1; i < outline.size(); j = i++) {
        auto a = outline[i], b = outline[j];
        if ((a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

bool overlapsPolygons(std::span<const Point> a, std::span<const Point> b)
{
    for (auto p : a)
        if (containsPolygon(b, p)) return true;
    for (auto p : b)
        if (containsPolygon(a, p)) return true;
    for (size_t i = 0; i < a.size(); ++i)
        for (size_t j = 0; j < b.size(); ++j)
            if (segmentsCross(a[i], a[(i + 1) % a.size()], b[j], b[(j + 1) % b.size()])) return true;
    return false;
}
}  // namespace

float length(Point p) { return std::hypot(p.x, p.y); }
float distance(Point a, Point b) { return length(a - b); }

Point normalized(Point p)
{
    float l = length(p);
    return l > 1e-6f ? p * (1 / l) : Point{1, 0};
}

Point lerp(Point a, Point b, float t) { return a + (b - a) * t; }

Point rotated(Point p, float angle)
{
    float c = std::cos(angle), s = std::sin(angle);
    return {p.x * c - p.y * s, p.x * s + p.y * c};
}

Point closestOnSegment(Point p, Point a, Point b)
{
    auto d = b - a;
    float l = d.x * d.x + d.y * d.y;
    float t = l > 0 ? std::clamp(((p.x - a.x) * d.x + (p.y - a.y) * d.y) / l, 0.f, 1.f) : 0;
    return lerp(a, b, t);
}

float segmentDistance(Point p, Point a, Point b) { return distance(p, closestOnSegment(p, a, b)); }

bool segmentsCross(Point a, Point b, Point c, Point d)
{
    auto side = [](Point p, Point q, Point r) { return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x); };
    float d1 = side(c, d, a), d2 = side(c, d, b), d3 = side(a, b, c), d4 = side(a, b, d);
    return ((d1 > 0) != (d2 > 0)) && ((d3 > 0) != (d4 > 0)) && d1 != 0 && d2 != 0 && d3 != 0 && d4 != 0;
}

Outline Footprint::corners() const
{
    auto points = cornersOf(*this);
    return {points.begin(), points.end()};
}

bool Footprint::contains(Point p, float margin) const
{
    auto delta = p - center;
    // This loose bound encloses every rotation and avoids trigonometry for distant points.
    float bound = 2 * (half + margin);
    if (std::abs(delta.x) > bound || std::abs(delta.y) > bound) return false;
    auto local = rotated(delta, -angle);
    return std::abs(local.x) <= half + margin && std::abs(local.y) <= half + margin;
}

bool Footprint::overlaps(const Footprint& other) const
{
    return overlapsPolygons(cornersOf(*this), cornersOf(other));
}

float area(const Outline& outline)
{
    float sum = 0;
    for (size_t i = 0; i < outline.size(); ++i) {
        auto a = outline[i], b = outline[(i + 1) % outline.size()];
        sum += a.x * b.y - b.x * a.y;
    }
    return std::abs(sum) / 2;
}

Point centroid(const Outline& outline)
{
    Point sum;
    for (auto p : outline) sum = sum + p;
    return outline.empty() ? sum : sum * (1.f / outline.size());
}

bool contains(const Outline& outline, Point p) { return containsPolygon(outline, p); }

bool selfIntersects(const Outline& outline)
{
    size_t n = outline.size();
    for (size_t i = 0; i < n; ++i)
        for (size_t j = i + 2; j < n; ++j) {
            if (i == 0 && j == n - 1) continue;  // Neighbours through the closing edge.
            if (segmentsCross(outline[i], outline[(i + 1) % n], outline[j], outline[(j + 1) % n])) return true;
        }
    return false;
}

float outlineDistance(const Outline& outline, Point p)
{
    if (contains(outline, p)) return 0;
    float best = 1e9f;
    for (size_t i = 0; i < outline.size(); ++i) best = std::min(best, segmentDistance(p, outline[i], outline[(i + 1) % outline.size()]));
    return best;
}

bool overlaps(const Outline& a, const Outline& b) { return overlapsPolygons(a, b); }

Point cubic(Point p0, Point p1, Point p2, Point p3, float t)
{
    float u = 1 - t;
    return p0 * (u * u * u) + p1 * (3 * u * u * t) + p2 * (3 * u * t * t) + p3 * (t * t * t);
}
}  // namespace gameframework
