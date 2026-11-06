#pragma once

#include "road_network.h"
#include "world_map.h"
#include <cstdint>
#include <vector>

namespace hearthold
{
// Where people can walk: A* over the terrain cells, cheap along roads, slow through forest,
// blocked by water and rock. Paths are smoothed into straight legs.
class WalkGrid
{
public:
    // Buildings and construction sites are obstacles: nobody walks through their walls.
    void rebuild(const WorldMap&, const RoadNetwork&, const std::vector<Footprint>& buildings = {});
    // Keeps the exact destination; empty if it is blocked or no way exists. A blocked start
    // retains its position and an escape leg, so a newly placed building cannot teleport it.
    std::vector<Point> path(Point from, Point to) const;
    bool walkable(Point) const;
    // Units per second on foot: fastest on paving, then laid roads, then open ground.
    float speedAt(Point) const;
    // The walkable point nearest to p within a few cells, or p.
    Point nearestWalkable(Point) const;

private:
    float cost(int x, int y) const { return costs[size_t(y) * columns + x]; }
    bool clear(Point a, Point b, float limit) const;

    int columns = 0, rows = 0;
    std::vector<float> costs;  // 0 = blocked.
    std::vector<Footprint> obstacles;
    std::vector<int> regions;            // Ground joined by walking moves; -1 where blocked.
    std::vector<uint8_t> nearObstacle;   // Cells where a step may touch a building.
    std::vector<uint64_t> blocked, labeled;  // Blocked-cell bits: this rebuild, and those regions describe.
    bool blockedBy(Point) const;
    bool blockedBy(Point, Point) const;
};
}  // namespace hearthold
