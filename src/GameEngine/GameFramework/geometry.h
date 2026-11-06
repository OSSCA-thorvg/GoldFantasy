#pragma once

#include <vector>

namespace gameframework
{
struct Point
{
    float x = 0, y = 0;
    bool operator==(const Point& other) const { return x == other.x && y == other.y; }
};

struct Camera
{
    float x = 0, y = 0, zoom = 1;  // x/y: unscaled screen point at the viewport center.

    Point toScreen(Point world, float width, float height) const { return {(world.x - x) * zoom + width / 2, (world.y - y) * zoom + height / 2}; }
    Point toWorld(Point screen, float width, float height) const { return {(screen.x - width / 2) / zoom + x, (screen.y - height / 2) / zoom + y}; }
};

using Outline = std::vector<Point>;

inline Point operator+(Point a, Point b) { return {a.x + b.x, a.y + b.y}; }
inline Point operator-(Point a, Point b) { return {a.x - b.x, a.y - b.y}; }
inline Point operator*(Point a, float k) { return {a.x * k, a.y * k}; }
float length(Point);
float distance(Point, Point);
Point normalized(Point);
Point lerp(Point a, Point b, float t);
Point rotated(Point, float angle);
// Distance from p to the segment ab.
float segmentDistance(Point p, Point a, Point b);
// Closest point on ab to p.
Point closestOnSegment(Point p, Point a, Point b);
bool segmentsCross(Point a, Point b, Point c, Point d);

// A square footprint turned freely about its centre.
struct Footprint
{
    Point center;
    float half = .5f;
    float angle = 0;

    Outline corners() const;
    bool contains(Point, float margin = 0) const;
    bool overlaps(const Footprint&) const;
    bool operator==(const Footprint& other) const { return center == other.center && half == other.half && angle == other.angle; }
};

float area(const Outline&);
Point centroid(const Outline&);
bool contains(const Outline&, Point);
bool selfIntersects(const Outline&);
float outlineDistance(const Outline&, Point);
// True when two closed outlines share any area or edge.
bool overlaps(const Outline&, const Outline&);

// Cubic Bézier through p0..p3 at t.
Point cubic(Point p0, Point p1, Point p2, Point p3, float t);
}  // namespace gameframework
