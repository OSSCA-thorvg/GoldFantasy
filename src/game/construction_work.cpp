#include "town.h"
#include <limits>

namespace hearthold
{
bool Town::storageFoundation(const Person& p) const
{
    const auto* place = p.task == Activity::Building ? building(p.taskSite) : nullptr;
    return place && !place->built() && (isSeat(place->kind) || place->kind == Structure::Storehouse || isMarket(place->kind));
}

bool Town::layRoadFirst(Person& p, int site)
{
    const auto* road = network.road(constructionRoad(site));
    if (!road || !walkTo(p, road->workPoint())) return false;
    if (p.task == Activity::Idle) { p.task = Activity::Building; p.taskSite = site; }
    p.activity = Activity::Roadwork; p.target = road->id;
    return true;
}

int Town::constructionTree(const Person& p, Activity activity, int target) const
{
    const auto* place = activity == Activity::Building ? building(target) : nullptr;
    const auto* road = activity == Activity::Roadwork ? network.road(target) : nullptr;
    if (!place && (!road || road->built >= 1)) return -1;
    Point from = place ? place->center : road->workPoint();
    Point to = place ? from : road->constructionPoint(std::min(1.f, road->built + .5f / std::max(.1f, road->length())));
    float reach = place ? structureSpec(place->kind).size : 1.4f;
    int found = -1, claimed = -1;
    float best = std::numeric_limits<float>::infinity();
    for (int y = std::max(0, int(from.y - reach)); y <= std::min(world.height() - 1, int(from.y + reach)); ++y)
        for (int x = std::max(0, int(from.x - reach)); x <= std::min(world.width() - 1, int(from.x + reach)); ++x) {
            bool blocking = false;
            for (int index = 0; index < world.at(x, y).trees; ++index) {
                auto foot = treePosition(world, x, y, index);
                blocking |= place ? place->footprint().contains(foot, .15f) : segmentDistance(foot, from, to) <= roadHalfWidth + .3f;
            }
            if (!blocking) continue;
            int cell = y * world.width() + x;
            if (std::any_of(folk.begin(), folk.end(), [&](const Person& other) { return other.id != p.id && other.activity == Activity::Felling && other.tree == cell; })) {
                claimed = cell; continue;
            }
            float gap = distance(p.position, treePosition(world, x, y, world.at(x, y).trees - 1));
            if (gap < best) { best = gap; found = cell; }
        }
    return found >= 0 ? found : claimed;
}
}  // namespace hearthold
