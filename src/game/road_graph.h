#pragma once

#include "road_network.h"
#include <vector>

namespace hearthold
{
// Walkable graph of the vector roads: segments split at crossings, and road ends that stop on
// another road joined to it.
class RoadGraph
{
public:
    static RoadGraph build(const std::vector<RoadSegment>&);

    bool empty() const { return points.empty(); }
    const std::vector<Point>& nodes() const { return points; }
    size_t degree(size_t node) const { return links[node].size(); }
    // Polyline from `from` to `to` via the closest road points; empty when unconnected.
    std::vector<Point> route(Point from, Point to) const;
    // Closest point on any edge.
    Point nearest(Point) const;

private:
    struct Link
    {
        size_t to;
        float length;
    };
    struct Snap
    {
        size_t a, b;
        Point point;
        float distance;
    };
    void connect(size_t a, size_t b);
    Snap snap(Point) const;

    std::vector<Point> points;
    std::vector<std::vector<Link>> links;
};
}  // namespace hearthold
