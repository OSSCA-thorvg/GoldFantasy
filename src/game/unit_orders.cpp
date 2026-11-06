#include "town.h"
#include <limits>

namespace hearthold
{
void Town::setOrder(Person& p, Activity task, int site)
{
    p.approachingOrder = false;
    p.task = task; p.taskSite = site; p.ordered = true;
    p.until = 0;
    p.foe = -1; p.tree = -1; p.aggressive = true; p.target = site;
}

void Town::orderStop(const std::vector<int>& ids)
{
    for (auto& p : folk) {
        if (p.role != Role::Resident || p.activity == Activity::Expedition || std::find(ids.begin(), ids.end(), p.id) == ids.end()) continue;
        p.approachingOrder = false; p.autoMode = false; p.ordered = false; p.task = Activity::Idle; p.taskSite = -1;
        p.job = -1;
        p.path.clear(); p.tree = p.foe = p.target = -1; p.aggressive = false;
        p.activity = Activity::Holding; p.until = std::numeric_limits<double>::infinity();
    }
    recount(); ++changes;
}

void Town::setAuto(int id, bool enabled)
{
    for (auto& p : folk) {
        if (p.id != id || p.role != Role::Resident || p.activity == Activity::Expedition) continue;
        p.autoMode = enabled;
        if (enabled || !p.ordered) {
            if (!enabled) p.job = -1;
            p.path.clear(); p.tree = p.foe = p.target = -1; p.aggressive = false;
            p.approachingOrder = false; p.ordered = false; p.task = Activity::Idle; p.taskSite = -1;
            p.activity = enabled ? Activity::Idle : Activity::Holding;
            p.until = enabled ? time : std::numeric_limits<double>::infinity();
        }
    }
    recount(); staff(); ++changes;
}

void Town::moveOrder(const std::vector<int>& ids, Point to, bool attack)
{
    int k = 0;
    for (auto& p : folk) {
        if (p.role != Role::Resident || p.activity == Activity::Expedition || std::find(ids.begin(), ids.end(), p.id) == ids.end()) continue;
        Point spot = k ? to + rotated({.6f + .25f * (k / 6), 0}, k * 1.047f) : to;
        ++k;
        if (!walkTo(p, grid.nearestWalkable(spot))) continue;
        setOrder(p, Activity::Moving);
        p.aggressive = attack;
        p.goal = p.path.empty() ? p.position : p.path.back();
        p.activity = Activity::Moving;
        if (!p.moving()) arrive(p);
    }
}

void Town::approachOrder(const std::vector<int>& ids, Point to)
{
    for (auto& p : folk) {
        if (!p.ordered || p.task == Activity::Idle || p.task == Activity::Moving ||
            std::find(ids.begin(), ids.end(), p.id) == ids.end()) continue;
        if (!walkTo(p, grid.nearestWalkable(to))) continue;
        p.approachingOrder = true;
        p.activity = Activity::Moving;
        p.foe = -1;
        if (!p.moving()) arrive(p);
    }
}

void Town::orderMove(const std::vector<int>& ids, Point to) { moveOrder(ids, to, false); }
void Town::orderAttackMove(const std::vector<int>& ids, Point to) { moveOrder(ids, to, true); }

bool Town::orderAttack(const std::vector<int>& ids, int monster)
{
    if (std::none_of(beasts.begin(), beasts.end(), [&](const Monster& m) { return m.id == monster && m.health > 0; })) return false;
    bool any = false;
    for (auto& p : folk) {
        if (p.activity == Activity::Expedition || std::find(ids.begin(), ids.end(), p.id) == ids.end()) continue;
        setOrder(p, Activity::Fighting, monster); p.foe = monster;
        p.activity = Activity::Fighting; p.path.clear(); any = true;
    }
    return any;
}

bool Town::orderChop(const std::vector<int>& ids, int cell) { return orderHarvest(ids, cell, Product::Wood); }
bool Town::orderMine(const std::vector<int>& ids, int cell) { return orderHarvest(ids, cell, Product::Stone); }

bool Town::orderHarvest(const std::vector<int>& ids, int cell, Product kind)
{
    if (cell < 0 || cell >= world.width() * world.height()) return false;
    int x = cell % world.width(), y = cell / world.width(); bool stone = kind == Product::Stone;
    if (stone ? !mining::deposit(world, x, y) : !world.at(x, y).trees) return false;
    auto foot = stone ? mining::position(x, y) : treePosition(world, x, y, world.at(x, y).trees - 1);
    if (!world.revealed(foot) || !cargoStorage(foot)) return false;
    bool any = false;
    for (auto& p : folk) {
        if (p.role != Role::Resident || p.activity == Activity::Expedition || std::find(ids.begin(), ids.end(), p.id) == ids.end()) continue;
        if (!walkTo(p, grid.nearestWalkable(foot + Point{-.18f, .18f}))) continue;
        setOrder(p, stone ? Activity::Mining : Activity::Felling, cell); p.goal = foot; p.path.clear();
        resumeOrder(p); any = true;
    }
    return any;
}

bool Town::orderBuild(const std::vector<int>& ids, int id)
{
    const auto* place = building(id);
    if (!place || (place->built() && place->health >= 1)) return false;
    const auto* road = network.road(constructionRoad(id));  // Laid before the site is started.
    bool any = false;
    for (auto& p : folk) {
        if (p.role != Role::Resident || p.activity == Activity::Expedition || std::find(ids.begin(), ids.end(), p.id) == ids.end()) continue;
        bool roadFirst = road && walkTo(p, road->workPoint());
        if (!roadFirst && !walkTo(p, place->door())) continue;
        setOrder(p, Activity::Building, id); any = true;
        p.activity = roadFirst ? Activity::Roadwork : Activity::Building;
        if (roadFirst) p.target = road->id;
    }
    return any;
}

bool Town::assignJob(const std::vector<int>& ids, int id)
{
    auto* place = site(id);
    if (!place || !place->built() || structureSpec(place->kind).jobs == 0) return false;
    bool any = false;
    for (auto& p : folk) {
        if (p.role != Role::Resident || p.activity == Activity::Expedition || p.health <= 0 ||
            std::find(ids.begin(), ids.end(), p.id) == ids.end()) continue;
        recount();
        if (p.job != id && place->workers >= structureSpec(place->kind).jobs) break;
        p.job = id; setOrder(p, Activity::Working, id); p.path.clear();
        p.activity = Activity::Idle; p.until = time; any = true;
    }
    recount(); if (any) ++changes; return any;
}

bool Town::orderRoadwork(const std::vector<int>& ids, int id)
{
    const auto* wanted = network.road(id);
    const auto* road = network.road(roadWorkTarget(id));
    if (!wanted || !road || (wanted->built >= 1 && wanted->paving < 0 && wanted->wear <= 0)) return false;
    bool any = false;
    for (auto& p : folk) {
        if (p.role != Role::Resident || p.activity == Activity::Expedition || std::find(ids.begin(), ids.end(), p.id) == ids.end()) continue;
        if (!walkTo(p, road->workPoint())) continue;
        setOrder(p, Activity::Roadwork, id); p.activity = Activity::Roadwork; p.target = road->id; any = true;
    }
    return any;
}

bool Town::orderWorkNear(const std::vector<int>& ids, Point at)
{
    constexpr float reach = 4;
    const Building* site = nullptr;
    for (const auto& item : placed)
        if ((!item.built() || item.health < 1) && item.footprint().contains(at, reach) &&
            (!site || distance(item.center, at) < distance(site->center, at))) site = &item;
    if (site && orderBuild(ids, site->id)) return true;
    const Road* lane = nullptr;
    float laneGap = reach;
    for (const auto& road : network.roads()) {
        if (road.built >= 1 && road.paving < 0 && road.wear <= 0) continue;
        for (size_t i = 1; i < road.line.size(); ++i)
            if (float gap = segmentDistance(at, road.line[i - 1], road.line[i]); gap < laneGap) { laneGap = gap; lane = &road; }
    }
    if (lane && orderRoadwork(ids, lane->id)) return true;
    int cell = -1;
    bool stone = false;
    float nearest = reach;
    for (int y = std::max(0, int(at.y - reach)); y <= std::min(world.height() - 1, int(at.y + reach)); ++y)
        for (int x = std::max(0, int(at.x - reach)); x <= std::min(world.width() - 1, int(at.x + reach)); ++x) {
            if (world.at(x, y).trees) {
                auto foot = treePosition(world, x, y, world.at(x, y).trees - 1);
                if (float gap = distance(foot, at); gap < nearest && world.revealed(foot)) { nearest = gap; cell = y * world.width() + x; stone = false; }
            }
            if (mining::deposit(world, x, y)) {
                auto foot = mining::position(x, y);
                if (float gap = distance(foot, at); gap < nearest && world.revealed(foot)) { nearest = gap; cell = y * world.width() + x; stone = true; }
            }
        }
    return cell >= 0 && (stone ? orderMine(ids, cell) : orderChop(ids, cell));
}

bool Town::orderRelax(const std::vector<int>& ids, int id)
{
    const auto* place = building(id);
    if (!place || !place->built() || place->kind != Structure::Tavern) return false;
    bool any = false;
    for (auto& p : folk) {
        if (p.role != Role::Resident || std::find(ids.begin(), ids.end(), p.id) == ids.end()) continue;
        if (!walkTo(p, place->door())) continue;
        setOrder(p, Activity::Idle, id); p.activity = Activity::Relaxing; any = true;
    }
    return any;
}

bool Town::resumeOrder(Person& p)
{
    if (p.task == Activity::Idle) return false;
    auto wait = [&] { p.activity = Activity::Holding; p.path.clear(); p.until = time + 1; };
    if (p.task == Activity::Moving || p.task == Activity::Holding) {
        if (distance(p.position, p.goal) > .2f) {
            if (!walkTo(p, p.goal)) wait();
            else { p.activity = Activity::Moving; p.target = -1; if (!p.moving()) arrive(p); }
        } else {
            p.task = Activity::Idle; p.taskSite = -1; p.ordered = false; p.aggressive = false;
            wait(); p.until = time + 2;
        }
        return true;
    }
    if (p.task == Activity::Fighting && std::any_of(beasts.begin(), beasts.end(), [&](const Monster& m) { return m.id == p.taskSite && m.health > 0; })) {
        p.foe = p.taskSite; p.activity = Activity::Fighting; return true;
    }
    if (p.carrying > 0) {
        bool nowhere = p.carriedProduct == Product::Wood && (treasury.wood >= capacity().wood || !cargoStorage(p.position));
        if (storageFoundation(p) && nowhere) {
            // Clear the first store before there is anywhere to unload.
        } else if (nowhere && (p.task == Activity::Building || p.task == Activity::Roadwork)) {
            p.carrying = 0;  // Nowhere to store them: a builder leaves the logs by the work rather than stop.
        } else { if (!haulCargo(p)) wait(); return true; }
    }
    auto start = [&](Activity activity, int target, Point at) {
        if (!walkTo(p, at)) { wait(); return; }
        p.activity = activity; p.target = target;
        if (!p.moving()) arrive(p);
    };
    switch (p.task) {
    case Activity::Sleeping:
        if (auto* home = building(p.taskSite); home && home->built() && isHome(home->kind) && p.home == home->id) {
            start(Activity::Sleeping, home->id, home->door()); return true;
        }
        break;
    case Activity::Felling:
    case Activity::Mining: {
        bool stone = p.task == Activity::Mining; auto product = stone ? Product::Stone : Product::Wood;
        int x = p.taskSite % world.width(), y = p.taskSite / world.width();
        bool exists = p.taskSite >= 0 && world.inside(x, y) && (stone ? mining::deposit(world, x, y) : world.at(x, y).trees > 0);
        if (exists && harvest(p, p.taskSite, product)) return true;
        if (startHarvest(p, p.goal, 3.5f, product)) return true;
        if (resourceNearby(p.goal, 3.5f, product)) { wait(); return true; }
        break;
    }
    case Activity::Building:
        if (auto* place = site(p.taskSite); place && (!place->built() || place->health < 1)) {
            if (layRoadFirst(p, place->id)) return true;
            if (int tree = constructionTree(p, Activity::Building, place->id); tree >= 0) {
                if (!fellTree(p, tree)) wait();
                return true;
            }
            start(Activity::Building, place->id, place->door()); return true;
        }
        break;
    case Activity::Roadwork:
        if (auto* wanted = network.road(p.taskSite); wanted && (wanted->built < 1 || wanted->paving >= 0 || wanted->wear > 0)) {
            if (auto* road = network.road(roadWorkTarget(p.taskSite))) {
                if (int tree = constructionTree(p, Activity::Roadwork, road->id); tree >= 0) {
                    if (!fellTree(p, tree)) wait();
                } else start(Activity::Roadwork, road->id, road->workPoint());
            } else wait();
            return true;
        }
        break;
    case Activity::Working:
        if (auto* place = site(p.taskSite); place && place->built() && p.job == place->id) {
            start(Activity::Working, place->id, place->door()); return true;
        }
        break;
    case Activity::Fighting:
        if (std::any_of(beasts.begin(), beasts.end(), [&](const Monster& m) { return m.id == p.taskSite && m.health > 0; })) {
            p.foe = p.taskSite; p.activity = Activity::Fighting; return true;
        }
        break;
    default: break;
    }
    p.task = Activity::Idle; p.taskSite = -1; p.ordered = false; p.aggressive = false;
    wait(); return true;
}
}  // namespace hearthold
