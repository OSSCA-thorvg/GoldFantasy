#pragma once

#include "iso_projection.h"
#include <vector>

namespace hearthold
{
// Internal curve representation: absolute Bézier handles, with sharp corners on the anchor.
struct RoadAnchor
{
    Point point, in, out;
    static RoadAnchor sharp(Point p) { return {p, p, p}; }
    bool operator==(const RoadAnchor& other) const { return point == other.point && in == other.in && out == other.out; }
};
using RoadPath = std::vector<RoadAnchor>;

// Simplify a sampled stroke and smooth within `tolerance` world units, keeping its endpoints.
// Nonpositive tolerance keeps the polyline; invalid or stationary input produces no road.
RoadPath freehandRoad(const std::vector<Point>& points, float tolerance);

// The straight pieces a Bézier road flattens into, for routing and collision.
struct RoadSegment
{
    Point a, b;
    int road = -1;  // Pieces of one road never join each other.
    bool operator==(const RoadSegment&) const = default;
};

// Polyline through the path, with points no more than `step` apart.
std::vector<Point> flatten(const RoadPath&, float step = .3f);
float pathLength(const RoadPath&);

struct Road
{
    int id;
    RoadPath path;
    std::vector<Point> line;  // Flattened path.
    float built = 1;          // Share of the length laid, from the first point on.
    bool paved = false;
    float paving = -1;        // Share already paved while an upgrade is under way, else -1.
    float wear = 0;           // Monster damage; at 1 the road is torn up until builders mend it.
    float constructionStart = 0;
    int parent = -1;
    float parentAt = 0;
    float length() const;
    // Point at a share of the length along the line.
    Point along(float share) const;
    float laidBegin() const;
    float laidEnd() const;
    Point workPoint() const;
    Point constructionPoint(float progress) const;
    std::vector<Point> laidLine() const;
};

class RoadNetwork
{
public:
    // New roads start as plans that builders lay.
    int add(RoadPath path, float built = 0);
    Road* road(int id);
    bool remove(int id);
    bool reshape(int id, RoadPath path);
    const std::vector<Road>& roads() const { return list; }
    const Road* road(int id) const;
    std::vector<RoadSegment> segments() const;
    // Only the laid part, for routing carts.
    std::vector<RoadSegment> builtSegments() const;
    // Distance from p to the nearest road centreline, skipping road `ignore`. `onRoad`, `tangent`
    // and `id` receive the closest point, the road's direction there, and its id.
    float distance(Point p, Point* onRoad = nullptr, int* id = nullptr, int ignore = -1, Point* tangent = nullptr) const;
    bool empty() const { return list.empty(); }

private:
    friend class SaveArchive;
    std::vector<Road> list;
    int nextId = 0;
};
}  // namespace hearthold
