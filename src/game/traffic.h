#pragma once

#include "road_graph.h"
#include "town.h"
#include <vector>

namespace hearthold
{
enum class AgentKind : uint8_t { Merchant, Monster };

// Someone or something moving through the world along a polyline in world units.
struct Agent
{
    int id;
    AgentKind kind;
    uint32_t look = 0;  // Stable per-agent colour variation.
    std::vector<Point> path;
    float travelled = 0, speed = 1;  // Units and units per second.

    float length() const;
    bool arrived() const { return travelled >= length(); }
    Point position() const;
    Point heading() const;  // Unit direction in world space.
};

// Ambient life around the people: travelling merchants arrive from the far end of the roads.
// Goods are carried by the workers themselves.
class Traffic
{
public:
    explicit Traffic(uint32_t seed) : state(seed * 2654435761u + 1) {}

    void update(const Town&, double elapsed);
    const std::vector<Agent>& agents() const { return list; }
    const RoadGraph& graph() const { return roads; }

private:
    float random();
    template<typename T>
    const T* pick(const std::vector<const T*>&);
    Point door(const Town&, const Building&) const;
    bool travel(Point from, Point to, float speed);
    void spawnMerchant(const Town&);

    RoadGraph roads;
    std::vector<RoadSegment> builtSegments;
    uint64_t revision = 0;
    std::vector<Agent> list;
    double merchantTimer = 6;
    int nextId = 0;
    uint32_t state;
};
}  // namespace hearthold
