#include "town.h"
#include "woodcutting.h"
#include <algorithm>
#include <vector>

namespace hearthold
{
const Building* Town::cargoStorage(Point from) const
{
    std::vector<const Building*> depots;
    for (const auto& b : placed)
        if (b.built() && (isSeat(b.kind) || b.kind == Structure::Storehouse || isMarket(b.kind))) depots.push_back(&b);
    std::sort(depots.begin(), depots.end(), [&](const Building* a, const Building* b) { return distance(from, a->door()) < distance(from, b->door()); });
    for (const auto* depot : depots) if (!grid.path(from, depot->door()).empty()) return depot;
    return nullptr;
}

bool Town::haulCargo(Person& p)
{
    if (p.carrying > 0 && (p.carriedProduct == Product::Stone ? capacity().stone <= treasury.stone : capacity().wood <= treasury.wood)) return false;
    const auto* depot = cargoStorage(p.position);
    if (!depot || !walkTo(p, depot->door())) return false;
    p.activity = Activity::Hauling;
    p.target = depot->id;
    p.until = time;
    if (!p.moving()) arrive(p);
    return true;
}

bool Town::startFelling(Person& p, Point around, float reach) { return startHarvest(p, around, reach, Product::Wood); }
bool Town::startMining(Person& p, Point around, float reach) { return startHarvest(p, around, reach, Product::Stone); }
bool Town::fellTree(Person& p, int cell) { return harvest(p, cell, Product::Wood); }

bool Town::resourceNearby(Point around, float reach, Product kind) const
{
    for (int y = std::max(0, int(around.y - reach)); y <= std::min(world.height() - 1, int(around.y + reach)); ++y)
        for (int x = std::max(0, int(around.x - reach)); x <= std::min(world.width() - 1, int(around.x + reach)); ++x) {
            bool exists = kind == Product::Stone ? mining::deposit(world, x, y) : world.at(x, y).trees > 0;
            if (!exists) continue;
            auto foot = kind == Product::Stone ? mining::position(x, y) : treePosition(world, x, y, world.at(x, y).trees - 1);
            if (distance(around, foot) <= reach && world.revealed(foot)) return true;
        }
    return false;
}

bool Town::startHarvest(Person& p, Point around, float reach, Product kind)
{
    if (p.carrying) return false;
    struct Candidate { float gap; int cell; Product product; };
    std::vector<Candidate> candidates;
    int x0 = std::max(0, int(std::floor(around.x - reach))), x1 = std::min(world.width() - 1, int(std::ceil(around.x + reach)));
    int y0 = std::max(0, int(std::floor(around.y - reach))), y1 = std::min(world.height() - 1, int(std::ceil(around.y + reach)));
    auto room = capacity();
    for (int y = y0; y <= y1; ++y) for (int x = x0; x <= x1; ++x) {
        int cell = y * world.width() + x;
        bool claimed = std::any_of(folk.begin(), folk.end(), [&](const Person& other) {
            return other.id != p.id && (other.activity == Activity::Felling || other.activity == Activity::Mining) && other.tree == cell;
        });
        if (claimed) continue;
        for (auto product : {Product::Wood, Product::Stone}) {
            if (kind != Product::None && kind != product) continue;
            bool stone = product == Product::Stone;
            if ((stone ? room.stone - treasury.stone : room.wood - treasury.wood) < 3) continue;
            if (stone ? !mining::deposit(world, x, y) : !world.at(x, y).trees) continue;
            auto foot = stone ? mining::position(x, y) : treePosition(world, x, y, world.at(x, y).trees - 1);
            if (distance(foot, around) <= reach && world.revealed(foot)) candidates.push_back({distance(p.position, foot), cell, product});
        }
    }
    std::sort(candidates.begin(), candidates.end(), [](auto a, auto b) { return a.gap < b.gap; });
    for (const auto& candidate : candidates) if (harvest(p, candidate.cell, candidate.product)) return true;
    return false;
}

bool Town::harvest(Person& p, int cell, Product kind)
{
    bool stone = kind == Product::Stone;
    bool foundation = !stone && storageFoundation(p);
    // A tree in a building's or road's way comes down whether or not its logs can be stored.
    bool clearing = !stone && (p.task == Activity::Building || p.task == Activity::Roadwork);
    bool stockpile = foundation && (!p.carrying || p.carriedProduct == Product::Wood) && (!cargoStorage(p.position) || treasury.wood >= capacity().wood);
    auto room = capacity();
    bool full = stone ? treasury.stone >= room.stone : treasury.wood >= room.wood;
    if (cell < 0 || cell >= world.width() * world.height() || (p.carrying && !stockpile) || (!foundation && !clearing && full)) return false;
    int x = cell % world.width(), y = cell / world.width();
    if ((stone ? !mining::deposit(world, x, y) : !world.at(x, y).trees) || std::any_of(folk.begin(), folk.end(), [&](const Person& other) {
            return other.id != p.id && (other.activity == Activity::Felling || other.activity == Activity::Mining) && other.tree == cell;
        })) return false;
    auto foot = stone ? mining::position(x, y) : treePosition(world, x, y, world.at(x, y).trees - 1);
    if (!world.revealed(foot) || (!foundation && !clearing && !cargoStorage(p.position))) return false;
    auto approach = grid.nearestWalkable(foot + Point{-.18f, .18f});
    if (distance(approach, foot) > .8f || !walkTo(p, approach)) return false;
    p.activity = stone ? Activity::Mining : Activity::Felling; p.tree = cell;
    const auto* job = building(p.job);
    p.target = job && (p.task == Activity::Working || !p.ordered) && job->kind == (stone ? Structure::Quarry : Structure::Lumberyard) ? p.job : -1;
    p.until = time + 1e9;
    if (!p.moving()) arrive(p);
    return true;
}
}  // namespace hearthold
