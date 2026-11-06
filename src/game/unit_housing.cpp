#include "town.h"

namespace hearthold
{
int Town::shelterOf(const Person& p) const
{
    if (!p.inside && !p.crossingDoorway()) return -1;
    for (const auto& home : placed)
        if (distance(p.entrance, home.door()) < .03f && distance(p.threshold, home.threshold()) < .03f) return home.id;
    for (const auto& home : placed) if (home.footprint().contains(p.position, .05f)) return home.id;
    return -1;
}

void Town::enforceGuestLodging(Person& p)
{
    if (p.role != Role::Resident) return;
    auto lodging = [&](int id) { const auto* place = id < 0 ? nullptr : building(id); return place && isLodging(place->kind); };
    bool invalidHome = lodging(p.home), staleBed = p.bed >= 0;
    if (invalidHome) p.home = -1;
    p.bed = -1;
    if (invalidHome || staleBed) assignHomes();
    bool invalidOrder = p.task == Activity::Sleeping && lodging(p.taskSite);
    bool invalidVisit = lodging(p.target) && (p.activity == Activity::Sleeping || p.activity == Activity::Eating ||
                        p.activity == Activity::Relaxing || p.activity == Activity::Praying || p.activity == Activity::Shopping);
    if (p.inside && (p.target < 0 || lodging(p.target)) && lodging(shelterOf(p))) {
        bool automatic = p.autoMode;
        orderLeave({p.id});
        p.autoMode = automatic;
        return;
    }
    if (invalidOrder) {
        p.task = Activity::Idle; p.taskSite = -1; p.ordered = p.aggressive = p.approachingOrder = false;
    }
    if (invalidVisit || (invalidOrder && p.activity == Activity::Moving)) {
        p.path.clear(); p.activity = Activity::Idle; p.target = -1; p.until = time;
    }
}

std::vector<int> Town::occupants(int id) const
{
    const auto* home = building(id);
    if (!home) return {};
    std::vector<int> out;
    for (const auto& p : folk) {
        if (p.health <= 0 || p.activity == Activity::Leaving) continue;
        if (isLodging(home->kind) && p.role != Role::Guest) continue;
        bool resting = p.task == Activity::Sleeping && p.taskSite == id;
        if (p.home == id || p.bed == id || resting || shelterOf(p) == id) out.push_back(p.id);
    }
    return out;
}

bool Town::orderRest(const std::vector<int>& ids, int id)
{
    const auto* home = building(id);
    if (!home || !home->built() || !isHome(home->kind)) return false;
    const auto& spec = structureSpec(home->kind);
    int beds = std::max(spec.residents, spec.beds);
    bool any = false;
    for (auto& p : folk) {
        if (p.role != Role::Resident || p.home != id || p.health <= 0 || p.activity == Activity::Leaving || p.activity == Activity::Expedition ||
            std::find(ids.begin(), ids.end(), p.id) == ids.end()) continue;
        int reserved = int(std::count_if(folk.begin(), folk.end(), [&](const Person& other) {
            return other.id != p.id && other.health > 0 && ((other.task == Activity::Sleeping && other.taskSite == id) ||
                   (other.activity == Activity::Sleeping && other.target == id) || shelterOf(other) == id);
        }));
        if (reserved >= beds) continue;
        if (p.inside && p.activity == Activity::Sleeping && p.target == id) {
            setOrder(p, Activity::Sleeping, id); any = true; continue;
        }
        if (!walkTo(p, home->door())) continue;
        setOrder(p, Activity::Sleeping, id); p.activity = Activity::Sleeping;
        if (!p.moving()) arrive(p);
        any = true;
    }
    return any;
}

bool Town::orderLeave(const std::vector<int>& ids)
{
    bool any = false;
    for (auto& p : folk) {
        if (p.role != Role::Resident || p.health <= 0 || p.activity == Activity::Expedition || std::find(ids.begin(), ids.end(), p.id) == ids.end()) continue;
        bool inside = p.inside || p.crossingDoorway();
        const auto* home = p.task == Activity::Sleeping ? building(p.taskSite) : nullptr;
        if (!inside && !home) continue;
        auto outside = inside ? p.entrance : home->door();
        auto direction = normalized(outside - (inside ? p.threshold : home->threshold()));
        auto goal = grid.nearestWalkable(outside + direction * .5f);
        if (!walkTo(p, goal)) continue;
        setOrder(p, Activity::Holding); p.autoMode = false; p.goal = goal; p.activity = Activity::Moving;
        if (!p.moving()) arrive(p);
        any = true;
    }
    return any;
}
}  // namespace hearthold
