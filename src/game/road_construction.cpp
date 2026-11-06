#include "town.h"
#include <limits>

namespace hearthold
{
bool Town::connectRoad(Road& road) const
{
    const auto* fire = camp();
    if (!fire || road.line.size() < 2) return false;
    float best = std::numeric_limits<float>::infinity(), walked = 0, total = road.length();
    for (size_t i = 0; i < road.line.size(); ++i) {
        if (i) walked += distance(road.line[i - 1], road.line[i]);
        float home = distance(road.line[i], fire->center);
        if (home <= 1.31f && home < best) {
            best = home; road.constructionStart = walked / total; road.parent = -1;
        }
    }
    if (std::isfinite(best)) return true;
    walked = 0;
    for (size_t i = 0; i < road.line.size(); ++i) {
        if (i) walked += distance(road.line[i - 1], road.line[i]);
        auto point = road.line[i];
        for (const auto& parent : network.roads()) {
            if (parent.id == road.id) continue;
            int depth = 0;
            const Road* ancestor = &parent;
            while (ancestor && ancestor->parent >= 0 && ancestor->id != road.id && depth <= int(network.roads().size())) {
                ancestor = network.road(ancestor->parent); ++depth;
            }
            if (!ancestor || ancestor->id == road.id || depth > int(network.roads().size())) continue;
            float along = 0, parentLength = parent.length();
            for (size_t j = 1; j < parent.line.size(); ++j) {
                auto on = closestOnSegment(point, parent.line[j - 1], parent.line[j]);
                float gap = distance(point, on), at = (along + distance(parent.line[j - 1], on)) / parentLength;
                bool reached = roadReady(parent.id) && at >= parent.laidBegin() - .0001f && at <= parent.laidEnd() + .0001f;
                float score = (reached ? 0.f : 1000.f) + depth * 10 + gap + distance(on, fire->center) * .0001f;
                if (gap <= joinReach && score < best) {
                    best = score; road.constructionStart = walked / total; road.parent = parent.id; road.parentAt = at;
                }
                along += distance(parent.line[j - 1], parent.line[j]);
            }
        }
    }
    return std::isfinite(best);
}

bool Town::roadReady(int id) const
{
    const Road* road = network.road(id);
    for (size_t depth = 0; road && depth <= network.roads().size(); ++depth) {
        if (road->parent < 0) return camp() && distance(road->along(road->constructionStart), camp()->center) <= 1.31f;
        const auto* parent = network.road(road->parent);
        if (!parent || parent->wear >= 1 || road->parentAt < parent->laidBegin() - .0001f || road->parentAt > parent->laidEnd() + .0001f ||
            distance(road->along(road->constructionStart), parent->along(road->parentAt)) > joinReach) return false;
        road = parent;
    }
    return false;
}

int Town::roadWorkTarget(int id) const
{
    const Road* road = network.road(id);
    for (size_t depth = 0; road && depth <= network.roads().size(); ++depth) {
        if (roadReady(road->id)) return road->id;
        road = network.road(road->parent);
    }
    return -1;
}

std::optional<Point> Town::roadWorkPosition(int id) const
{
    if (const auto* road = network.road(roadWorkTarget(id))) return road->workPoint();
    return {};
}
}  // namespace hearthold
