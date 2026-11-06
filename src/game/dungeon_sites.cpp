#include "world_map.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <iterator>
#include <vector>

namespace hearthold
{
namespace
{
// Each dungeon is named for the world it leads to, in World order.
constexpr std::array<const char*, 4> titles[] = {
    {"Tower of Ravens", "The Broken Hall", "Bifrost's Foot", "Valgrind"},                // Asgard.
    {"The Green Door", "The Vanir Well", "The Golden Glade", "Njord's Gate"},            // Vanaheim.
    {"The Bright Gate", "Freyr's Glade", "The Elfhame Door", "Glimmering Rift"},         // Alfheim.
    {"Ironwood Den", "Wargmaw", "The Howling Cleft", "Greyfang Hollow"},                 // Jotunheim, by its Ironwood.
    {"Dvalin's Door", "The Deep Delving", "Brokk's Stair", "The Forge Below"},           // Svartalfheim.
    {"The Mist Gate", "Rime Rift", "The Frozen Throat", "The Weeping Gate"},             // Niflheim.
    {"Surt's Door", "The Burning Hall", "The Ember Gate", "The Cinder Rift"},            // Muspelheim.
    {"Barrow of Kings", "The Drowned Howe", "Draugmound", "Gjallar Crossing"},           // Helheim, below the howes.
};
static_assert(std::size(titles) == size_t(World::Count));

bool fits(const WorldMap& map, int x, int y, DungeonKind kind, bool home)
{
    // Ymir's stone is no cave mouth, and his dais needs room: entrances keep three tiles clear of him.
    if (const auto& giant = map.giant(); giant && x + 5 > giant->origin.x && x - 3 < giant->origin.x + Giant::size && y + 5 > giant->origin.y && y - 3 < giant->origin.y + Giant::size)
        return false;
    bool rockNear = false;
    for (int dy = -1; dy <= 2; ++dy)
        for (int dx = -1; dx <= 2; ++dx) {
            if (!map.inside(x + dx, y + dy)) return false;
            const auto& tile = map.at(x + dx, y + dy);
            bool footprint = dx >= 0 && dx <= 1 && dy >= 0 && dy <= 1;
            if (footprint && (isWater(tile.terrain) || impassable(tile.terrain) || tile.dungeon >= 0)) return false;
            // Delvers walk up to the doorstep just south of the entrance.
            bool doorstep = dx == 1 && dy == 2;
            if (doorstep && (isWater(tile.terrain) || impassable(tile.terrain))) return false;
            rockNear |= isStone(tile.terrain);
        }
    // Caves open in rock, but the founders' first dungeon is always the wolves' den: Ymir's ground is open grass.
    return kind != DungeonKind::Cave || rockNear || home;
}

}  // namespace

// Ground the founders can reach from the start: on foot, or over a river by bridge.
std::vector<uint8_t> reachable(const WorldMap& map, TileCoord start)
{
    int width = map.width(), height = map.height();
    std::vector<uint8_t> river(size_t(width) * height, 0), seen(size_t(width) * height, 0);
    const auto& stream = map.river();
    for (size_t i = 1; i < stream.path.size(); ++i) {
        if (stream.width[i - 1] <= 0 || stream.width[i] <= 0) continue;
        auto a = stream.path[i - 1], b = stream.path[i];
        float reach = stream.width[i] / 2 + .7f;
        for (int y = int(std::floor(std::min(a.y, b.y) - reach)); y <= int(std::ceil(std::max(a.y, b.y) + reach)); ++y)
            for (int x = int(std::floor(std::min(a.x, b.x) - reach)); x <= int(std::ceil(std::max(a.x, b.x) + reach)); ++x)
                if (map.inside(x, y) && segmentDistance({x + .5f, y + .5f}, a, b) <= reach) river[size_t(y) * width + x] = 1;
    }
    auto open = [&](int x, int y) {
        auto terrain = map.at(x, y).terrain;
        return !impassable(terrain) && (!isWater(terrain) || (terrain == Terrain::Water && river[size_t(y) * width + x]));
    };
    std::vector<TileCoord> stack{start};
    seen[size_t(start.y) * width + start.x] = 1;
    while (!stack.empty()) {
        auto at = stack.back();
        stack.pop_back();
        for (TileCoord step : {TileCoord{1, 0}, TileCoord{-1, 0}, TileCoord{0, 1}, TileCoord{0, -1}}) {
            int x = at.x + step.x, y = at.y + step.y;
            if (!map.inside(x, y) || seen[size_t(y) * width + x] || !open(x, y)) continue;
            seen[size_t(y) * width + x] = 1;
            stack.push_back({x, y});
        }
    }
    return seen;
}

// Called by WorldMap::generate once the start is known: one dungeon near the founders, the rest far out in the
// wilds, each with a doorstep the founders can reach.
void placeDungeons(WorldMap& map, std::vector<Dungeon>& sites, TileCoord start)
{
    auto reach = reachable(map, start);
    // A gate to each of the other worlds, as WorldMap::destination reads them: the home first, the wolves'
    // den to Jotunheim a short walk from the founders; the nearer four next, the farther four last.
    constexpr std::pair<World, DungeonKind> gates[] = {
        {World::Jotunheim, DungeonKind::Cave}, {World::Helheim, DungeonKind::Crypt}, {World::Niflheim, DungeonKind::Portal},
        {World::Muspelheim, DungeonKind::Ruin}, {World::Asgard, DungeonKind::Ruin}, {World::Alfheim, DungeonKind::Portal},
        {World::Vanaheim, DungeonKind::Portal}, {World::Svartalfheim, DungeonKind::Cave},
    };
    for (int k = 0; k < int(std::size(gates)); ++k) {
        auto [world, kind] = gates[k];
        bool home = k == 0;
        TileCoord best{-1, -1};
        float bestScore = -1;
        for (int y = 2; y < map.height() - 3; ++y)
            for (int x = 2; x < map.width() - 3; ++x) {
                float distance = std::hypot(float(x - start.x), float(y - start.y));
                // The first lies a short walk from the start: the reason anyone settles here. Measured
                // centre to centre as the camp measures its reach, with room to spare at the edge.
                if (home) distance = std::hypot(x + 1.f - (start.x + .5f), y + 1.f - (start.y + .5f));
                if ((home ? distance < 7 || distance > 11.5f : distance < 18) || !fits(map, x, y, kind, home) || !reach[size_t(y + 2) * map.width() + x + 1]) continue;
                if (map.destination({{}, kind, {x, y}}) != world) continue;  // Its region decides where it leads.
                bool crowded = std::any_of(sites.begin(), sites.end(), [&](const Dungeon& d) { return std::hypot(float(d.origin.x - x), float(d.origin.y - y)) < 14; });
                if (crowded) continue;
                // The far ones lie beyond the ground known round Ymir, so only the home dungeon is known at first.
                if (const auto& giant = map.giant(); !home && giant) {
                    auto sights = giant->sights();
                    if (std::any_of(sights.begin(), sights.end(), [&](const Sight& s) { return std::hypot(s.center.x - x - 1.f, s.center.y - y - 1.f) <= s.radius + 1.5f; })) continue;
                }
                float score = hash01(map.seed(), x, y, 90 + k) - std::abs(distance - (home ? 9 : 24 + k / 4 * 30.f)) * .02f;
                // The wolves' den lies inland, further from Ymir than the camp, not on the shore beside it.
                if (const auto& giant = map.giant(); home && giant) score += (x + 1 - giant->center().x + y + 1 - giant->center().y) * .7071f * .03f;
                if (score > bestScore) { bestScore = score; best = {x, y}; }
            }
        if (best.x < 0) continue;
        auto& names = titles[size_t(world)];
        sites.push_back({names[size_t(hash01(map.seed(), int(world), 3, 95) * names.size()) % names.size()], kind, best});
        // A trampled clearing around the entrance keeps the lair and its monsters in view.
        for (int dy = -2; dy < 4; ++dy)
            for (int dx = -2; dx < 4; ++dx) {
                if (!map.inside(best.x + dx, best.y + dy)) continue;
                auto& tile = map.at(best.x + dx, best.y + dy);
                if (dx >= 0 && dx < 2 && dy >= 0 && dy < 2) tile.dungeon = int8_t(sites.size() - 1);
                tile.trees = tile.wild = 0;
            }
    }
}

std::vector<int> WorldMap::discover()
{
    std::vector<int> found;
    for (size_t i = 0; i < sites.size(); ++i) {
        auto& site = sites[i];
        if (site.discovered) continue;
        for (int dy = 0; dy < 2 && !site.discovered; ++dy)
            for (int dx = 0; dx < 2; ++dx)
                if (at(site.origin.x + dx, site.origin.y + dy).revealed) { site.discovered = true; break; }
        if (site.discovered) found.push_back(int(i));
    }
    return found;
}
}  // namespace hearthold
