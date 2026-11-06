#include "town.h"

namespace hearthold
{
bool Town::eat(Person& p)
{
    auto visit = [&](const Building& place) {
        if (!walkTo(p, place.door())) return false;
        p.activity = Activity::Eating; p.target = place.id; p.tree = -1;
        if (!p.moving()) arrive(p);
        return true;
    };
    auto eatery = [&](Structure kind) { return isHome(kind) || kind == Structure::Tavern || (p.role == Role::Guest && isLodging(kind)); };
    const auto* own = building(p.home);
    if (own && own->built() && eatery(own->kind) && visit(*own)) return true;
    std::vector<const Building*> eateries;
    for (const auto& place : placed)
        if (place.built() && eatery(place.kind) && !isHome(place.kind) && &place != own) eateries.push_back(&place);
    std::sort(eateries.begin(), eateries.end(), [&](const Building* a, const Building* b) {
        return distance(p.position, a->door()) < distance(p.position, b->door());
    });
    for (const auto* place : eateries) if (visit(*place)) return true;
    const auto* shelter = camp();
    return shelter && shelter->built() && visit(*shelter);
}

bool Town::takeBreak(Person& p)
{
    if (!p.autoMode) return false;
    if (p.food < .25f && treasury.food > 0 && eat(p)) return true;
    if (p.rest < .12f) {
        const auto* bed = building(p.role == Role::Resident ? p.home : p.bed);
        auto sleep = [&](const Building* place) {
            if (!place || !place->built() || (p.role != Role::Guest && isLodging(place->kind)) || !walkTo(p, place->door())) return false;
            p.activity = Activity::Sleeping; p.target = place->id; p.tree = -1;
            if (!p.moving()) arrive(p);
            return true;
        };
        if (sleep(bed) || sleep(camp())) return true;
        p.activity = Activity::Sleeping; p.path.clear(); p.tree = -1; p.target = -1;
        p.inside = false; p.sleptOutside = true;
        return true;
    }
    if (p.stress < .85f) return false;
    const auto* tavern = nearest(p.position, [](const Building& b) { return b.built() && b.kind == Structure::Tavern; });
    if (tavern && walkTo(p, tavern->door())) {
        p.activity = Activity::Relaxing; p.target = tavern->id;
        if (!p.moving()) arrive(p);
    } else {
        p.activity = Activity::Brooding; p.path.clear(); p.target = -1;
        walkTo(p, grid.nearestWalkable(p.position + Point{roll() * 4 - 2, roll() * 4 - 2}));
        p.until = time + 8;
    }
    p.tree = -1;
    return true;
}
}  // namespace hearthold
