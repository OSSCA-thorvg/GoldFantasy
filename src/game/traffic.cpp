#include "traffic.h"
#include <algorithm>
#include <cmath>

namespace hearthold
{

float Agent::length() const
{
    float total = 0;
    for (size_t i = 1; i < path.size(); ++i) total += distance(path[i - 1], path[i]);
    return total;
}

Point Agent::position() const
{
    float left = travelled;
    for (size_t i = 1; i < path.size(); ++i) {
        float leg = distance(path[i - 1], path[i]);
        if (left <= leg && leg > 0) {
            float t = left / leg;
            return {path[i - 1].x + (path[i].x - path[i - 1].x) * t, path[i - 1].y + (path[i].y - path[i - 1].y) * t};
        }
        left -= leg;
    }
    return path.empty() ? Point{} : path.back();
}

Point Agent::heading() const
{
    float left = travelled;
    for (size_t i = 1; i < path.size(); ++i) {
        float leg = distance(path[i - 1], path[i]);
        if ((left <= leg || i + 1 == path.size()) && leg > 0) return {(path[i].x - path[i - 1].x) / leg, (path[i].y - path[i - 1].y) / leg};
        left -= leg;
    }
    return {1, 0};
}

float Traffic::random()
{
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return float(state >> 8) / float(1u << 24);
}

template<typename T>
const T* Traffic::pick(const std::vector<const T*>& items)
{
    if (items.empty()) return nullptr;
    return items[std::min(items.size() - 1, size_t(random() * items.size()))];
}

Point Traffic::door(const Town& town, const Building& item) const
{
    // The front step: the footprint edge facing the nearest road.
    float half = structureSpec(item.kind).size / 2.f;
    if (town.roads().empty()) return item.center;
    Point on;
    float gap = town.roads().distance(item.center, &on);
    return lerp(item.center, on, std::min(1.f, (half + .1f) / std::max(gap, 1e-3f)));
}

bool Traffic::travel(Point from, Point to, float speed)
{
    auto path = roads.route(from, to);
    if (path.size() < 2 || distance(from, to) < .5f) return false;
    Agent agent{nextId++, AgentKind::Merchant, uint32_t(random() * 1e6f), std::move(path)};
    agent.speed = speed * (.85f + random() * .3f);
    list.push_back(std::move(agent));
    return true;
}

void Traffic::update(const Town& town, double elapsed)
{
    if (town.roadRevision() != revision) {
        revision = town.roadRevision();
        auto segments = town.roads().builtSegments();
        // Paving and repairs change appearance/speed, but not the cart graph's geometry.
        if (segments != builtSegments) {
            roads = RoadGraph::build(segments);
            builtSegments = std::move(segments);
        }
    }
    for (auto& agent : list) agent.travelled += agent.speed * float(elapsed);
    list.erase(std::remove_if(list.begin(), list.end(), [](const Agent& a) { return a.arrived(); }), list.end());
    if (roads.empty()) return;
    if (list.size() >= size_t(2 + town.population() / 3)) return;  // A few merchants on top of the people.
    merchantTimer -= elapsed;
    if (merchantTimer <= 0) {
        merchantTimer = 8 + random() * 6;
        spawnMerchant(town);
    }
}

void Traffic::spawnMerchant(const Town& town)
{
    std::vector<const Building*> markets;
    const Building* camp = nullptr;
    for (const auto& item : town.buildings()) {
        if (isMarket(item.kind) && item.built()) markets.push_back(&item);
        if (isSeat(item.kind)) camp = &item;
    }
    auto* market = pick(markets);
    if (!market || !camp) return;
    // Merchants come and go by the road end farthest from the camp.
    auto origin = door(town, *camp);
    Point gate = origin;
    for (size_t n = 0; n < roads.nodes().size(); ++n)
        if (roads.degree(n) == 1 && distance(roads.nodes()[n], origin) > distance(gate, origin)) gate = roads.nodes()[n];
    bool arriving = random() < .6f;
    auto stall = door(town, *market);
    travel(arriving ? gate : stall, arriving ? stall : gate, .7f);
}

}  // namespace hearthold
