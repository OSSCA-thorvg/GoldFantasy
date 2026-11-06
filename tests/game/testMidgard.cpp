#include "common/hud_text.h"
#include "common/legacy_map.h"
#include <test/test.h>
#include <test/directory.h>
#include <test/graphics.h>
#include <game/game_app.h>
#include <game/map_document.h>
#include <game/terrain_painter.h>
#include <game/town.h>
#include <game/ymir_born.h>
#include <algorithm>
#include <cmath>
#include <fstream>
#include <iterator>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace
{
using namespace hearthold;

// A grassy start with a cave beside it, as the map editor tests build one, well clear of Ymir.
MapDocument startingIsland()
{
    MapDocument doc(WorldMap::generate(5, 96, 96));
    while (!doc.map().dungeons().empty()) {
        auto at = doc.map().dungeons().front().origin;
        doc.removeDungeon({at.x + .5f, at.y + .5f});
    }
    doc.paint({32.5f, 32.5f}, 14, Terrain::Grass);
    CHECK(doc.setStart({32.5f, 32.5f}));
    CHECK(doc.addDungeon({40.5f, 32.5f}, DungeonKind::Cave));
    CHECK(doc.validation().empty());
    return doc;
}

std::string readText(const std::filesystem::path& path)
{
    std::ifstream in(path);
    return {std::istreambuf_iterator<char>(in), {}};
}

// Saves a map, then rewrites it as an older version: the second line loses its last `fields` numbers.
void saveAsVersion(MapDocument& doc, const std::filesystem::path& path, int version, int fields)
{
    std::string error;
    CHECK(doc.save(path, error));
    auto text = readText(path);
    CHECK(text.rfind("hearthold-map 4\n", 0) == 0);
    test::removeStoneColumn(text);
    auto second = text.find('\n') + 1, end = text.find('\n', second);
    for (int i = 0; i < fields; ++i) {
        auto field = text.rfind(' ', end);  // Version 3 closes the second line with the regions flag and Ymir's place.
        text.erase(field, end - field);
        end = field;
    }
    text.replace(0, std::string("hearthold-map 3").size(), "hearthold-map " + std::to_string(version));
    std::ofstream(path, std::ios::trunc) << text;
}

// A map file from before the regions: version 1, without the regions flag or Ymir.
void saveAsOldMap(MapDocument& doc, const std::filesystem::path& path) { saveAsVersion(doc, path, 1, 3); }

bool arable(Terrain ground) { return !isWater(ground) && !isStone(ground) && !impassable(ground) && ground != Terrain::Ash && ground != Terrain::Frost; }

// A point in the world's upright frame: u runs east and v south, and the map's diamond is |u| + |v| <= 1.
Point upright(const WorldMap& map, float u, float v) { return {map.width() * (u + v + 1) / 2, map.height() * (v - u + 1) / 2}; }

constexpr uint32_t worlds[] = {3, 5, 11, 42};

// Where, as v along the meridian u, Niflheim gives way to the gap (north) or the gap to Muspelheim.
float regionEdge(const WorldMap& map, float u, bool north)
{
    for (float v = north ? -.95f : .95f; north ? v < 0 : v > 0; v += north ? .002f : -.002f)
        if (map.regionAt(upright(map, u, v)) == Region::Middle) return v;
    return 0;
}

// Where each dungeon leads (design §7): wolf dens to Jotunheim, or Svartalfheim's forges in the fiery south;
// howes down to Helheim; rifts to Niflheim in the icy north, else Alfheim or Vanaheim; fallen halls to
// Muspelheim in the south, else Asgard.
bool leadsRightly(DungeonKind kind, Region region, World world)
{
    switch (kind) {
    case DungeonKind::Cave: return world == (region == Region::South ? World::Svartalfheim : World::Jotunheim);
    case DungeonKind::Crypt: return world == World::Helheim;
    case DungeonKind::Portal: return region == Region::North ? world == World::Niflheim : world == World::Alfheim || world == World::Vanaheim;
    case DungeonKind::Ruin: return world == (region == Region::South ? World::Muspelheim : World::Asgard);
    }
    return false;
}

// Separate runs of river water: a point of zero width splits the path.
std::vector<std::pair<size_t, size_t>> riverPieces(const River& river)
{
    std::vector<std::pair<size_t, size_t>> pieces;
    for (size_t first = 0; first < river.path.size();) {
        while (first < river.path.size() && river.width[first] <= 0) ++first;
        size_t end = first;
        while (end < river.path.size() && river.width[end] > 0) ++end;
        if (end - first >= 2) pieces.push_back({first, end - 1});
        first = end;
    }
    return pieces;
}
}  // namespace

TEST(game_ice_and_lava_stop_feet_and_buildings_ash_and_frost_stop_crops)
{
    for (auto [kind, reason] : {std::pair{Terrain::Ice, "Ice"}, std::pair{Terrain::Lava, "Lava"}}) {
        auto doc = startingIsland();
        Point at{36.5f, 32.5f};
        CHECK(doc.paint(at, 1.5f, kind));
        CHECK(doc.map().terrainAt(at) == kind);
        Town town(doc.gameMap());
        CHECK(!town.walking().walkable(at));
        CHECK_EQ(town.canPlace(Structure::Camp, at, 0).reason, std::string(reason));
    }
    for (auto [kind, reason] : {std::pair{Terrain::Ash, "Too dry for crops"}, std::pair{Terrain::Frost, "Too cold for crops"}}) {
        auto doc = startingIsland();
        Point at{36.5f, 32.5f};
        CHECK(doc.paint(at, 3, kind));
        CHECK(doc.map().terrainAt(at) == kind);
        Town town(doc.gameMap());
        CHECK(town.walking().walkable(at));
        Outline square{{at.x - 1, at.y - 1}, {at.x + 1, at.y - 1}, {at.x + 1, at.y + 1}, {at.x - 1, at.y + 1}};
        CHECK_EQ(town.canPlantField(square).reason, std::string(reason));
    }
}

TEST(game_saved_ash_reloads_as_ash)
{
    auto doc = startingIsland();
    CHECK(doc.paint({36.5f, 32.5f}, 2, Terrain::Ash));
    te::test::Directory directory;
    auto path = directory.file("ash.hearthmap");
    std::string error;
    CHECK(doc.save(path, error));
    WorldMap loaded;
    CHECK(MapDocument::read(path, loaded, error));
    CHECK(loaded.terrainAt({36.5f, 32.5f}) == Terrain::Ash);
}

TEST(game_midgard_is_drawn_on_the_thorvg_bolt)
{
    CHECK_EQ(int(Region::Count), 3);
    for (uint32_t seed : worlds) {
        auto map = WorldMap::generate(seed);
        int land = 0;
        for (int y = 0; y < map.height(); ++y)
            for (int x = 0; x < map.width(); ++x) land += map.at(x, y).terrain != Terrain::Sea;
        float share = float(land) / float(map.width() * map.height());
        CHECK(share > .28f);  // A continent of broad strokes...
        CHECK(share < .5f);   // ...in a wide world-sea.
        // Three strokes stepping down to the south-west as the bolt does: the top one icy and reaching
        // furthest east, the middle one mild, the blade burning down to its tip.
        CHECK(map.regionAt(upright(map, .06f, -.38f)) == Region::North);
        CHECK(map.regionAt(upright(map, .06f, .05f)) == Region::Middle);
        CHECK(map.regionAt(upright(map, .02f, .57f)) == Region::South);
        for (auto [u, v] : {std::pair{.06f, -.38f}, std::pair{.31f, -.48f}, std::pair{.06f, .05f}, std::pair{.02f, .57f}, std::pair{-.07f, .75f}})
            CHECK(map.terrainAt(upright(map, u, v)) != Terrain::Sea);
        // The crescent bay cuts in from the east under the top stroke's curve; sea either side of the blade.
        for (auto [u, v] : {std::pair{.27f, -.24f}, std::pair{-.28f, .57f}, std::pair{.32f, .57f}})
            CHECK(map.terrainAt(upright(map, u, v)) == Terrain::Sea);
        for (auto [u, v] : {std::pair{0.f, -.9f}, std::pair{0.f, .9f}, std::pair{-.9f, 0.f}, std::pair{.9f, 0.f}})
            CHECK(map.terrainAt(upright(map, u, v)) == Terrain::Sea);
    }
}

TEST(game_ymir_stands_in_stone_in_the_open_sea)
{
    for (auto [seed, size] : {std::pair{5u, 176}, std::pair{42u, 176}, std::pair{5u, 64}, std::pair{74u, 48}}) {
        auto map = WorldMap::generate(seed, size, size);
        CHECK(map.giant().has_value());
        if (!map.giant()) continue;
        auto giant = *map.giant();
        for (int y = giant.origin.y; y < giant.origin.y + Giant::size; ++y)
            for (int x = giant.origin.x; x < giant.origin.x + Giant::size; ++x) {
                CHECK(map.at(x, y).terrain == Terrain::Mountain);
                CHECK_EQ(int(map.at(x, y).trees), 0);
            }
        CHECK(map.terrainAt({giant.origin.x + .02f, giant.origin.y + .02f}) == Terrain::Mountain);
        CHECK(map.terrainAt({giant.origin.x + 5.98f, giant.origin.y + 5.98f}) == Terrain::Mountain);
        // No dungeon mouth in his stone or under his dais.
        for (const auto& site : map.dungeons())
            CHECK(site.origin.x + 5 <= giant.origin.x || site.origin.x - 3 >= giant.origin.x + Giant::size ||
                  site.origin.y + 5 <= giant.origin.y || site.origin.y - 3 >= giant.origin.y + Giant::size);
        // Sea all round his stone, so no one walks up to him.
        for (int y = giant.origin.y - 1; y < giant.origin.y + Giant::size + 1; ++y)
            for (int x = giant.origin.x - 1; x < giant.origin.x + Giant::size + 1; ++x)
                if (!giant.covers({x + .5f, y + .5f})) CHECK(map.at(x, y).terrain == Terrain::Sea);
        // The open sea of the crescent bay, not a lake: it runs out to the world-sea at the map's edge.
        std::vector<char> seen(size_t(size) * size, 0);
        std::vector<TileCoord> open{{giant.origin.x - 1, giant.origin.y - 1}};
        bool ocean = false;
        while (!open.empty() && !ocean) {
            auto at = open.back();
            open.pop_back();
            if (!map.inside(at.x, at.y) || seen[size_t(at.y) * size + at.x] || map.at(at.x, at.y).terrain != Terrain::Sea) continue;
            seen[size_t(at.y) * size + at.x] = 1;
            ocean = at.x == 0 || at.y == 0 || at.x == size - 1 || at.y == size - 1;
            for (TileCoord step : {TileCoord{1, 0}, TileCoord{-1, 0}, TileCoord{0, 1}, TileCoord{0, -1}}) open.push_back({at.x + step.x, at.y + step.y});
        }
        CHECK(ocean);
        for (int y = giant.origin.y - 3; y < giant.origin.y + Giant::size + 3; ++y)
            for (int x = giant.origin.x - 3; x < giant.origin.x + Giant::size + 3; ++x) CHECK_EQ(int(map.at(x, y).trees), 0);
    }
}

TEST(game_ymir_stands_far_out_from_what_he_hides_and_near_the_founders_shore)
{
    for (uint32_t seed : worlds) {
        auto map = WorldMap::generate(seed);
        if (!map.giant()) { CHECK(map.giant().has_value()); continue; }
        auto heart = map.giant()->center();
        auto along = [&](float tiles) { return map.terrainAt({heart.x + tiles * .7071f, heart.y + tiles * .7071f}); };
        // Behind him, where his body hides the land from view, the sea runs eleven tiles back...
        for (float back = 5; back <= 11; back += 1) CHECK(isWater(along(-back)));
        // ...but before him only a moat's width, the shore close enough to stand and look at him.
        CHECK(isWater(along(5)));
        bool shore = false;
        for (float ahead = 6; ahead <= 11; ahead += .5f) shore |= !isWater(along(ahead));
        CHECK(shore);
    }
}

namespace
{
// Solidity: the main land mass's area over its convex hull's. A disc is near 1; bays and peninsulas lower it.
float solidity(const WorldMap& map)
{
    int width = map.width(), height = map.height(), best = -1, most = 0, next = 0;
    std::vector<int> mass(size_t(width) * height, -1);
    for (int y = 0; y < height; ++y)
        for (int x = 0; x < width; ++x) {
            if (mass[size_t(y) * width + x] >= 0 || map.at(x, y).terrain == Terrain::Sea) continue;
            std::vector<TileCoord> open{{x, y}};
            mass[size_t(y) * width + x] = next;
            int count = 0;
            while (!open.empty()) {
                auto at = open.back();
                open.pop_back();
                ++count;
                for (TileCoord step : {TileCoord{1, 0}, TileCoord{-1, 0}, TileCoord{0, 1}, TileCoord{0, -1}}) {
                    TileCoord n{at.x + step.x, at.y + step.y};
                    if (!map.inside(n.x, n.y) || mass[size_t(n.y) * width + n.x] >= 0 || map.at(n.x, n.y).terrain == Terrain::Sea) continue;
                    mass[size_t(n.y) * width + n.x] = next;
                    open.push_back(n);
                }
            }
            if (count > most) { most = count; best = next; }
            ++next;
        }
    std::vector<Point> corners;
    for (int y = 0; y < height; ++y)
        for (int x = 0; x < width; ++x)
            if (mass[size_t(y) * width + x] == best)
                for (Point c : {Point{float(x), float(y)}, Point{x + 1.f, float(y)}, Point{float(x), y + 1.f}, Point{x + 1.f, y + 1.f}}) corners.push_back(c);
    std::sort(corners.begin(), corners.end(), [](Point a, Point b) { return a.x < b.x || (a.x == b.x && a.y < b.y); });
    auto turn = [](Point o, Point a, Point b) { return double(a.x - o.x) * (b.y - o.y) - double(a.y - o.y) * (b.x - o.x); };
    std::vector<Point> hull(2 * corners.size());
    size_t k = 0;
    for (size_t i = 0; i < corners.size(); ++i) {
        while (k >= 2 && turn(hull[k - 2], hull[k - 1], corners[i]) <= 0) --k;
        hull[k++] = corners[i];
    }
    for (size_t i = corners.size() - 1, lower = k + 1; i-- > 0;) {
        while (k >= lower && turn(hull[k - 2], hull[k - 1], corners[i]) <= 0) --k;
        hull[k++] = corners[i];
    }
    hull.resize(k - 1);
    double area = 0;
    for (size_t i = 0; i < hull.size(); ++i) area += double(hull[i].x) * hull[(i + 1) % hull.size()].y - double(hull[(i + 1) % hull.size()].x) * hull[i].y;
    return float(most / (std::abs(area) / 2));
}
}  // namespace

TEST(game_the_continent_has_bays_and_headlands_not_a_round_rim)
{
    for (uint32_t seed : worlds) {
        auto map = WorldMap::generate(seed);
        CHECK(solidity(map) < .88f);
        // How far the land reaches from the centre swings by bearing, as a continent's coast does.
        float centre = map.width() / 2.f, sum = 0, squares = 0;
        for (int ray = 0; ray < 72; ++ray) {
            float angle = ray * 6.2831853f / 72, reach = 0;
            for (float t = 0; t < centre; t += .5f) {
                Point at{centre + std::cos(angle) * t, centre + std::sin(angle) * t};
                if (map.inside(at) && map.terrainAt(at) != Terrain::Sea) reach = t;
            }
            sum += reach;
            squares += reach * reach;
        }
        float mean = sum / 72, spread = std::sqrt(std::max(0.f, squares / 72 - mean * mean));
        CHECK(spread > mean * .09f);
    }
}

TEST(game_founders_start_at_ymirs_feet)
{
    std::vector<std::pair<uint32_t, int>> cases{{5, 64}, {55, 64}, {74, 64}, {74, 128}, {5, 48}, {9, 32}};
    for (uint32_t seed : worlds) cases.push_back({seed, 176});
    for (auto [seed, size] : cases) {
        auto map = WorldMap::generate(seed, size, size);
        if (!map.giant()) { CHECK(map.giant().has_value()); continue; }
        auto heart = map.giant()->center();
        CHECK(distance(map.camp(), heart) <= 15);  // On the shore of his mere...
        CHECK(map.camp().x + map.camp().y > heart.x + heart.y);  // ...in front of him, facing the viewer.
        CHECK(map.regionAt(map.camp()) == Region::Middle);
        CHECK(arable(map.terrainAt(map.camp())));
    }
}

TEST(game_north_freezes_and_south_burns)
{
    for (uint32_t seed : worlds) {
        auto map = WorldMap::generate(seed);
        // Cold enough for frost, hot enough for ash, and mild between: the terrain thresholds themselves.
        CHECK(map.value(Layer::Heat, map.regionCenter(Region::North)) < .25f);
        CHECK(map.value(Layer::Heat, map.regionCenter(Region::South)) > .62f);
        float mild = map.value(Layer::Heat, map.regionCenter(Region::Middle));
        CHECK(mild > .3f);
        CHECK(mild < .6f);
        int ice = 0, frost = 0, lava = 0, ash = 0, gap = 0, gapAsh = 0, gapHarsh = 0;
        for (int y = 0; y < map.height(); ++y)
            for (int x = 0; x < map.width(); ++x) {
                auto terrain = map.at(x, y).terrain;
                auto region = map.regionAt({x + .5f, y + .5f});
                ice += terrain == Terrain::Ice && region == Region::North;
                frost += terrain == Terrain::Frost && region == Region::North;
                lava += terrain == Terrain::Lava && region == Region::South;
                ash += terrain == Terrain::Ash && region == Region::South;
                if (region != Region::Middle || terrain == Terrain::Sea) continue;
                ++gap;
                gapAsh += terrain == Terrain::Ash;
                gapHarsh += terrain == Terrain::Frost || terrain == Terrain::Ice || terrain == Terrain::Lava;
            }
        CHECK(ice > 0);
        CHECK(frost > 0);
        CHECK(lava > 0);
        CHECK(ash > 0);
        CHECK_EQ(gapHarsh, 0);
        CHECK(gapAsh * 20 < gap);  // At most a fringe of ash where the gap meets the fire.
    }
}

TEST(game_hvergelmir_never_freezes)
{
    for (uint32_t seed : worlds) {
        auto map = WorldMap::generate(seed);
        auto spring = map.hvergelmir();
        CHECK(map.regionAt(spring) == Region::North);
        CHECK(map.terrainAt(spring) == Terrain::Water);
        int cold = 0;
        for (int y = int(spring.y) - 8; y <= int(spring.y) + 8; ++y)
            for (int x = int(spring.x) - 8; x <= int(spring.x) + 8; ++x)
                if (map.inside(x, y) && distance({x + .5f, y + .5f}, spring) <= 8) cold += map.at(x, y).terrain == Terrain::Frost || map.at(x, y).terrain == Terrain::Ice;
        CHECK(cold > 20);
    }
}

TEST(game_elivagar_run_from_hvergelmir_to_the_sea)
{
    for (uint32_t seed : worlds) {
        auto map = WorldMap::generate(seed);
        const auto& river = map.river();
        auto pieces = riverPieces(river);
        CHECK_EQ(pieces.size(), size_t(2));
        for (float width : river.width) CHECK(width <= Town::maxBridgeSpan);
        int west = 0, east = 0;
        for (auto [first, last] : pieces) {
            CHECK(distance(river.path[first], map.hvergelmir()) <= 3);
            CHECK(map.terrainAt(river.path[first]) == Terrain::Water);
            CHECK(map.terrainAt(river.path[last]) == Terrain::Sea);
            float u = river.path[last].x / map.width() - river.path[last].y / map.height();
            west += u < -.3f;
            east += u > .3f;
        }
        CHECK_EQ(west, 1);
        CHECK_EQ(east, 1);
        for (auto p : river.path)
            if (map.terrainAt(p) == Terrain::Water) CHECK(map.regionAt(p) != Region::South);
    }
}

TEST(game_camp_reaches_every_region_on_foot)
{
    for (uint32_t seed : worlds) {
        Town town(seed);
        const auto& map = town.map();
        std::vector<uint8_t> seen(size_t(map.width()) * map.height(), 0);
        std::vector<TileCoord> open{map.start()};
        seen[size_t(map.start().y) * map.width() + map.start().x] = 1;
        bool reached[size_t(Region::Count)] = {};
        while (!open.empty()) {
            auto at = open.back();
            open.pop_back();
            reached[size_t(map.regionAt({at.x + .5f, at.y + .5f}))] = true;
            for (TileCoord step : {TileCoord{1, 0}, TileCoord{-1, 0}, TileCoord{0, 1}, TileCoord{0, -1}}) {
                TileCoord next{at.x + step.x, at.y + step.y};
                if (!map.inside(next.x, next.y) || seen[size_t(next.y) * map.width() + next.x]) continue;
                if (!town.walking().walkable({next.x + .5f, next.y + .5f})) continue;
                seen[size_t(next.y) * map.width() + next.x] = 1;
                open.push_back(next);
            }
        }
        for (size_t region = 0; region < size_t(Region::Count); ++region) CHECK(reached[region]);
    }
}

TEST(game_region_borders_are_ragged_on_any_size)
{
    for (int size : {64, 176})
        for (uint32_t seed : {5u, 11u, 42u}) {
            auto map = WorldMap::generate(seed, size, size);
            for (bool north : {true, false}) {
                float low = 1, high = -1;
                for (float u = -.4f; u <= .4f; u += .02f) {
                    float v = regionEdge(map, u, north);
                    low = std::min(low, v);
                    high = std::max(high, v);
                }
                CHECK(high - low > .03f);  // Not a ruled line.
            }
        }
}

TEST(game_raiders_go_round_ymir)
{
    // A lair against his west face and someone just past his east face: the raiders' straight line runs through him.
    MapDocument doc(WorldMap::generate(5));
    while (!doc.map().dungeons().empty()) {
        auto at = doc.map().dungeons().front().origin;
        doc.removeDungeon({at.x + .5f, at.y + .5f});
    }
    if (!doc.map().giant()) { CHECK(doc.map().giant().has_value()); return; }
    auto giant = *doc.map().giant();
    auto o = giant.origin;
    CHECK(doc.paint(giant.center(), 10, Terrain::Grass));  // His mere drained, so a lair can sit against him.
    CHECK(doc.setStart({o.x + 8.5f, o.y + 4.5f}));
    CHECK(doc.addDungeon({o.x - 2.5f, o.y + 2.5f}, DungeonKind::Cave));
    Town town(doc.gameMap());
    town.scout(giant.center().x, giant.center().y, 16);
    CHECK(town.place(Structure::Camp, town.map().camp(), 0));
    town.completeConstruction();
    CHECK(town.editPerson(town.people().front().id, {o.x + 6.8f, o.y + 3.2f}, 1));
    town.summonRaid();
    CHECK(town.raiding());
    int inside = 0;
    for (int tick = 0; tick < 200; ++tick) {
        town.advance(.05);
        for (const auto& beast : town.monsters()) inside += giant.covers(beast.position);
    }
    CHECK_EQ(inside, 0);
}

TEST(game_small_worlds_start_where_crops_can_grow)
{
    for (auto [seed, size] : {std::pair{5u, 64}, std::pair{55u, 64}, std::pair{74u, 64}, std::pair{74u, 128}, std::pair{5u, 48}}) {
        auto map = WorldMap::generate(seed, size, size);
        CHECK(arable(map.terrainAt(map.camp())));
        int land = 0, fields = 0;
        for (int y = map.start().y - 8; y <= map.start().y + 8; ++y)
            for (int x = map.start().x - 8; x <= map.start().x + 8; ++x) {
                if (!map.inside(x, y) || map.at(x, y).terrain == Terrain::Sea) continue;
                ++land;
                fields += arable(map.at(x, y).terrain);
            }
        CHECK(fields >= 60);       // Room for several fields...
        CHECK(fields * 3 >= land);  // ...and a fair share of the land.
    }
}

TEST(game_each_of_the_other_worlds_has_one_gate)
{
    for (uint32_t seed : worlds) {
        auto map = WorldMap::generate(seed);
        std::set<World> gates;
        for (const auto& site : map.dungeons()) CHECK(gates.insert(map.destination(site)).second);
        CHECK_EQ(gates.size(), size_t(World::Count));  // All eight on a full-size Midgard.
        if (!map.dungeons().empty()) CHECK(map.destination(map.dungeons().front()) == World::Jotunheim);  // The founders' wolves' den.
    }
}
TEST(game_every_dungeon_can_be_reached_from_the_start)
{
    // On foot, or over a river by bridge: none walled in by lava, ice or a lake.
    for (uint32_t seed : {3u, 5u, 11u, 42u}) {
        Town town(seed);
        const auto& map = town.map();
        const auto& river = map.river();
        auto bridged = [&](TileCoord at) {
            if (map.at(at.x, at.y).terrain != Terrain::Water) return false;
            for (size_t i = 1; i < river.path.size(); ++i)
                if (river.width[i] > 0 && segmentDistance({at.x + .5f, at.y + .5f}, river.path[i - 1], river.path[i]) < river.width[i] / 2 + .7f) return true;
            return false;
        };
        std::vector<uint8_t> seen(size_t(map.width()) * map.height(), 0);
        std::vector<TileCoord> open{map.start()};
        seen[size_t(map.start().y) * map.width() + map.start().x] = 1;
        while (!open.empty()) {
            auto at = open.back();
            open.pop_back();
            for (TileCoord step : {TileCoord{1, 0}, TileCoord{-1, 0}, TileCoord{0, 1}, TileCoord{0, -1}}) {
                TileCoord next{at.x + step.x, at.y + step.y};
                if (!map.inside(next.x, next.y) || seen[size_t(next.y) * map.width() + next.x]) continue;
                if (!town.walking().walkable({next.x + .5f, next.y + .5f}) && !bridged(next)) continue;
                seen[size_t(next.y) * map.width() + next.x] = 1;
                open.push_back(next);
            }
        }
        for (const auto& site : map.dungeons()) CHECK(seen[size_t(site.origin.y + 2) * map.width() + site.origin.x + 1]);
    }
}

TEST(game_every_dungeon_has_a_doorstep_people_can_reach)
{
    // Delvers and expeditions walk to the doorstep just south of the entrance.
    for (uint32_t seed : {3u, 5u, 6u, 9u, 11u, 12u, 42u}) {
        auto map = WorldMap::generate(seed);
        for (const auto& site : map.dungeons()) {
            auto ground = map.terrainAt({site.origin.x + 1.5f, site.origin.y + 2.5f});
            CHECK(!isWater(ground));
            CHECK(!impassable(ground));
        }
    }
}

TEST(game_newcomers_walk_in_from_ground_the_camp_can_reach)
{
    for (uint32_t seed : {5u, 9u, 14u, 19u, 28u, 32u, 33u}) {
        Town town(seed);
        CHECK(!town.walking().path(town.map().camp(), town.gateway()).empty());
        town.scout(town.map().camp().x, town.map().camp().y, 10);
        CHECK(town.place(Structure::Camp, town.map().camp(), 0));
        town.completeConstruction();
        CHECK(!town.walking().path(town.camp()->door(), town.gateway()).empty());
    }
}

TEST(game_every_start_can_found_its_camp)
{
    for (uint32_t seed : {5u, 15u, 19u, 37u, 40u, 96u}) {
        Town town(seed);
        town.scout(town.map().camp().x, town.map().camp().y, 10);
        CHECK_EQ(town.canPlace(Structure::Camp, town.map().camp(), 0).reason, std::string());
    }
}

TEST(game_ymir_stone_refuses_feet_and_buildings)
{
    Town town(5);
    if (!town.map().giant()) { CHECK(town.map().giant().has_value()); return; }
    auto heart = town.map().giant()->center();
    town.scout(heart.x, heart.y, 12);
    CHECK(town.place(Structure::Camp, town.map().camp(), 0));
    town.completeConstruction();
    CHECK(!town.walking().walkable(heart));
    CHECK_EQ(town.canPlace(Structure::Tent, heart, 0).reason, std::string("Ymir's stone"));
}

TEST(game_painting_cannot_wear_ymir_away)
{
    MapDocument doc(WorldMap::generate(5, 64, 64));
    if (!doc.map().giant()) { CHECK(doc.map().giant().has_value()); return; }
    auto heart = doc.map().giant()->center();
    CHECK(doc.paint(heart, 5, Terrain::Grass));
    CHECK(doc.map().terrainAt(heart) == Terrain::Mountain);
    CHECK(doc.map().cell(heart)->terrain == Terrain::Mountain);
    CHECK(!doc.setStart(heart));
    CHECK(!doc.addDungeon({heart.x - 1, heart.y - 1}, DungeonKind::Ruin));
}

TEST(game_maps_saved_before_the_realms_keep_their_ground)
{
    // An island saved before the realms: its heat was plain noise, hot only where the desert lay.
    auto doc = startingIsland();
    Point hot{36.5f, 30.5f}, scorched{30.5f, 40.5f}, chill{26.5f, 30.5f};
    CHECK(doc.paint(hot, 2, Terrain::Ash));
    CHECK(doc.paint(scorched, 2, Terrain::Lava));
    CHECK(doc.paint(chill, 2, Terrain::Frost));
    te::test::Directory directory;
    auto path = directory.file("old.hearthmap");
    std::string error;
    saveAsOldMap(doc, path);
    WorldMap old;
    CHECK(MapDocument::read(path, old, error));
    CHECK(old.terrainAt(hot) == Terrain::Ash);  // The old desert.
    CHECK(old.terrainAt(scorched) != Terrain::Lava);
    CHECK(old.terrainAt(chill) != Terrain::Frost);
    for (int y = 0; y < old.height(); ++y)
        for (int x = 0; x < old.width(); ++x) {
            auto ground = old.at(x, y).terrain;
            CHECK(ground != Terrain::Lava && ground != Terrain::Frost && ground != Terrain::Ice);
        }
    CHECK(!old.hasRegions());
    CHECK(!old.nameLabel());
    CHECK(WorldMap::generate(5).hasRegions());
}

TEST(game_map_files_keep_ymir)
{
    MapDocument doc(WorldMap::generate(5, 64, 64));
    te::test::Directory directory;
    auto path = directory.file("ymir.hearthmap");
    std::string error;
    CHECK(doc.save(path, error));
    CHECK(readText(path).rfind("hearthold-map 4\n", 0) == 0);
    WorldMap loaded;
    CHECK(MapDocument::read(path, loaded, error));
    CHECK(loaded.hasRegions());
    CHECK(loaded.giant().has_value());
    if (loaded.giant() && doc.map().giant()) CHECK((loaded.giant()->origin == doc.map().giant()->origin));
    for (int y = 0; y < loaded.height(); ++y)
        for (int x = 0; x < loaded.width(); ++x) CHECK(loaded.at(x, y).terrain == doc.map().at(x, y).terrain);
    // A giant reaching off the map is refused.
    auto text = readText(path);
    auto second = text.find('\n') + 1, end = text.find('\n', second);
    auto y = text.rfind(' ', end), x = text.rfind(' ', y - 1);
    text.replace(x, end - x, " 60 2");
    std::ofstream(path, std::ios::trunc) << text;
    CHECK(!MapDocument::read(path, loaded, error));
}

TEST(game_nine_realm_maps_load_without_realms_or_ymir)
{
    // Version 2 laid its land out for nine realms that are gone: its ground stays, its realms and giant do not.
    auto doc = startingIsland();
    te::test::Directory directory;
    auto path = directory.file("nine.hearthmap");
    saveAsVersion(doc, path, 2, 2);
    WorldMap old;
    std::string error;
    CHECK(MapDocument::read(path, old, error));
    CHECK(!old.hasRegions());
    CHECK(!old.giant());
    CHECK(old.terrainAt({36.5f, 32.5f}) == doc.map().terrainAt({36.5f, 32.5f}));
}

TEST(game_midgard_is_lettered_over_the_land_when_zoomed_out)
{
    te::test::Graphics graphics;
    GameApp game(5);
    game.view().zoom = .3f;
    game.render(1280, 800, 0);
    CHECK(!test::textBounds(game.worldScene(), "MIDGARD").empty());
    // Its three regions go unnamed, even once explored.
    auto north = game.state().map().regionCenter(Region::North);
    game.state().scout(north.x, north.y, 30);
    game.render(1280, 800, .1);
    for (const char* region : {"NIFLHEIM", "GINNUNGAGAP", "MUSPELHEIM"}) CHECK(test::textBounds(game.worldScene(), region).empty());
}

TEST(game_midgards_name_stands_on_land)
{
    auto doc = startingIsland();
    auto anchor = doc.map().regionCenter(Region::Middle);
    if (doc.map().inside(anchor)) CHECK(doc.paint(anchor, 3, Terrain::Sea));
    auto label = doc.map().nameLabel();
    CHECK(label.has_value());
    if (!label) return;
    CHECK(doc.map().terrainAt(*label) != Terrain::Sea);
    CHECK(distance(*label, anchor) <= 10.8f);
}

TEST(game_dungeons_are_ways_to_the_other_worlds)
{
    std::set<World> reached;
    for (uint32_t seed : worlds) {
        auto map = WorldMap::generate(seed);
        for (const auto& site : map.dungeons()) {
            auto world = map.destination(site);
            CHECK(leadsRightly(site.kind, map.regionAt({site.origin.x + 1.f, site.origin.y + 1.f}), world));
            reached.insert(world);
        }
    }
    CHECK(reached.size() >= 6);  // Most of the eight other worlds, across a handful of continents.
    CHECK_EQ(std::string(worldName(World::Jotunheim)), std::string("Jotunheim"));
    CHECK_EQ(int(World::Count), 8);
}

TEST(game_finding_a_dungeon_tells_which_world_it_leads_to)
{
    Town town(5);
    while (!town.takeNotice().empty()) {}
    const auto& site = town.map().dungeons()[1];
    town.scout(site.origin.x + 1.f, site.origin.y + 1.f, 3);
    bool told = false;
    for (auto notice = town.takeNotice(); !notice.empty(); notice = town.takeNotice())
        told |= notice == "Discovered " + site.name + ", a way to " + worldName(town.map().destination(site));
    CHECK(told);
}

TEST(game_lava_stays_molten_under_snow_and_frost_takes_no_summer_green)
{
    Climate deepWinter;
    deepWinter.snow = 1;
    CHECK(groundColor(Terrain::Lava, 1, deepWinter) == groundColor(Terrain::Lava, 1, Climate{}));
    CHECK(!(groundColor(Terrain::Grass, 1, deepWinter) == groundColor(Terrain::Grass, 1, Climate{})));  // Snow does settle elsewhere.
    Climate summer;
    summer.summer = 1;
    CHECK(groundColor(Terrain::Frost, 1, summer) == groundColor(Terrain::Frost, 1, Climate{}));
    CHECK(groundColor(Terrain::Ash, 1, summer) == groundColor(Terrain::Ash, 1, Climate{}));
}

TEST(game_roads_do_not_cross_ice_or_lava)
{
    for (auto [kind, reason] : {std::pair{Terrain::Ice, "Ice"}, std::pair{Terrain::Lava, "Lava"}}) {
        auto doc = startingIsland();
        CHECK(doc.paint({36.5f, 32.5f}, 1.5f, kind));
        Town town(doc.gameMap());
        town.scout(32.5f, 32.5f, 12);
        CHECK(town.place(Structure::Camp, town.map().camp(), 0));
        town.completeConstruction();
        RoadPath across{RoadAnchor::sharp({33.5f, 32.5f}), RoadAnchor::sharp({39.f, 32.5f})};
        CHECK_EQ(town.canBuildRoad(across).reason, std::string(reason));
    }
}

TEST(game_editor_starts_keep_off_ice_and_lava)
{
    for (uint32_t seed : {8u, 74u}) {
        MapDocument doc(WorldMap::generate(1, 64, 64));
        CHECK(doc.regenerate(seed, 64));
        CHECK_EQ(doc.validation(), std::string());
        Town town(doc.gameMap());
        CHECK_EQ(town.canPlace(Structure::Camp, town.map().camp(), 0).reason, std::string());
    }
    auto doc = startingIsland();
    CHECK(doc.paint({34.5f, 32.5f}, 1, Terrain::Lava));  // Inside the start's 5 x 5 clearing.
    CHECK(!doc.validation().empty());
    CHECK(!doc.setStart({34.5f, 32.5f}));
}

TEST(game_old_maps_stay_without_realms_after_saving_again)
{
    auto doc = startingIsland();
    CHECK(doc.paint({36.5f, 30.5f}, 2, Terrain::Ash));
    te::test::Directory directory;
    auto path = directory.file("old.hearthmap"), again = directory.file("again.hearthmap");
    saveAsOldMap(doc, path);
    std::string error;
    WorldMap old;
    CHECK(MapDocument::read(path, old, error));
    MapDocument editing(old);
    CHECK(editing.save(again, error));
    WorldMap reread;
    CHECK(MapDocument::read(again, reread, error));
    CHECK(!reread.hasRegions());
    for (int y = 0; y < old.height(); ++y)
        for (int x = 0; x < old.width(); ++x) CHECK(reread.at(x, y).terrain == old.at(x, y).terrain);
}

TEST(game_fights_stop_at_the_edge_of_lava)
{
    auto doc = startingIsland();
    for (float x = 22.5f; x <= 42.5f; x += 2) CHECK(doc.paint({x, 26.5f}, 1.5f, Terrain::Lava));
    Town town(doc.gameMap());
    town.scout(32.5f, 26.5f, 12);
    town.releaseMonster({32.5f, 21.5f});  // A wanderer beyond the lava.
    CHECK(!town.monsters().empty());
    if (town.monsters().empty()) return;
    std::vector<int> fighters;
    for (const auto& p : town.people()) fighters.push_back(p.id);
    CHECK(town.orderAttack(fighters, town.monsters().front().id));
    // Deep in the lava: a barred tile with barred tiles all round. Walkers cutting a corner at the edge do
    // not count; anyone crossing the band passes its middle.
    const auto& map = town.map();
    auto deep = [&](Point p) {
        int x = int(std::floor(p.x)), y = int(std::floor(p.y));
        for (auto [dx, dy] : {std::pair{0, 0}, std::pair{1, 0}, std::pair{-1, 0}, std::pair{0, 1}, std::pair{0, -1}})
            if (!map.inside(x + dx, y + dy) || !impassable(map.at(x + dx, y + dy).terrain)) return false;
        return true;
    };
    int scorched = 0;
    for (int frame = 0; frame < 600; ++frame) {
        town.advance(.1);
        for (const auto& m : town.monsters()) scorched += deep(m.position);
        for (const auto& p : town.people()) scorched += deep(p.position);
    }
    CHECK_EQ(scorched, 0);
}

TEST(game_editor_dungeons_need_a_doorstep_delvers_can_reach)
{
    auto doc = startingIsland();
    CHECK(doc.paint({26.5f, 25.5f}, 3, Terrain::Grass));
    CHECK(doc.paint({27.5f, 27.5f}, .6f, Terrain::Lava));  // Tile (27, 27): the doorstep of a dungeon at (26, 25).
    CHECK(doc.map().terrainAt({27.5f, 27.5f}) == Terrain::Lava);
    CHECK(!doc.addDungeon({26.5f, 25.5f}, DungeonKind::Ruin));
    // One placed on good ground, whose doorstep is lost afterwards, fails the check before play.
    CHECK(doc.paint({26.5f, 25.5f}, 3, Terrain::Grass));
    CHECK(doc.addDungeon({26.5f, 25.5f}, DungeonKind::Ruin));
    CHECK(doc.validation().empty());
    CHECK(doc.paint({27.5f, 27.5f}, .6f, Terrain::Lava));
    CHECK(!doc.validation().empty());
}

TEST(game_the_designed_world_is_as_designed)
{
    // Every new game starts here unless a random world is chosen. A change to the generator that moves
    // these is a change to the designed world itself: make it on purpose, then update this record.
    auto map = WorldMap::generate(designedWorldSeed);
    CHECK(distance(map.camp(), {99.5f, 56.5f}) <= 2);
    CHECK(map.regionAt(map.camp()) == Region::Middle);
    CHECK(map.giant().has_value());
    CHECK_EQ(map.dungeons().size(), size_t(8));
    if (map.dungeons().empty()) return;
    const auto& home = map.dungeons().front();
    CHECK_EQ(home.name, std::string("The Howling Cleft"));
    CHECK(home.kind == DungeonKind::Cave);
    CHECK(std::abs(home.origin.x - 105) <= 2 && std::abs(home.origin.y - 64) <= 2);
    int land = 0, ice = 0, lava = 0;
    for (int y = 0; y < map.height(); ++y)
        for (int x = 0; x < map.width(); ++x) {
            auto ground = map.at(x, y).terrain;
            land += ground != Terrain::Sea;
            ice += ground == Terrain::Ice;
            lava += ground == Terrain::Lava;
        }
    CHECK(std::abs(land - 11005) <= 110);
    CHECK(std::abs(ice - 1936) <= 195);
    CHECK(std::abs(lava - 1206) <= 120);
    CHECK(map.volcano().has_value());
}

TEST(game_coasts_wind_with_islets_and_fjords)
{
    // A continent's shore, not a drawn outline: islets off it here and there, and fjords cut into the frozen north.
    for (uint32_t seed : worlds) {
        auto map = WorldMap::generate(seed);
        int width = map.width(), height = map.height();
        std::vector<int> mass(size_t(width) * height, -1);
        std::vector<int> sizes;
        for (int y = 0; y < height; ++y)
            for (int x = 0; x < width; ++x) {
                if (mass[size_t(y) * width + x] >= 0 || map.at(x, y).terrain == Terrain::Sea) continue;
                int id = int(sizes.size()), count = 0;
                std::vector<TileCoord> open{{x, y}};
                mass[size_t(y) * width + x] = id;
                while (!open.empty()) {
                    auto at = open.back();
                    open.pop_back();
                    ++count;
                    for (TileCoord step : {TileCoord{1, 0}, TileCoord{-1, 0}, TileCoord{0, 1}, TileCoord{0, -1}}) {
                        TileCoord n{at.x + step.x, at.y + step.y};
                        if (!map.inside(n.x, n.y) || mass[size_t(n.y) * width + n.x] >= 0 || map.at(n.x, n.y).terrain == Terrain::Sea) continue;
                        mass[size_t(n.y) * width + n.x] = id;
                        open.push_back(n);
                    }
                }
                sizes.push_back(count);
            }
        CHECK(std::count_if(sizes.begin(), sizes.end(), [](int count) { return count <= 60; }) >= 10);  // A few stray rocks without them.
        // Sea a few tiles across with land close on both sides: a fjord, in the north.
        int narrows = 0;
        auto sea = [&](int x, int y) { return !map.inside(x, y) || map.at(x, y).terrain == Terrain::Sea; };
        for (int y = 3; y < height - 3; ++y)
            for (int x = 3; x < width - 3; ++x) {
                if (!sea(x, y) || map.regionAt({x + .5f, y + .5f}) != Region::North) continue;
                bool across = (!sea(x - 1, y) || !sea(x - 2, y)) && (!sea(x + 1, y) || !sea(x + 2, y));
                bool along = (!sea(x, y - 1) || !sea(x, y - 2)) && (!sea(x, y + 1) || !sea(x, y + 2));
                narrows += across || along;
            }
        CHECK(narrows > 45);  // Bays and islets alone give about twenty.
    }
}
