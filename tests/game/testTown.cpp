#include "common/hud_text.h"
#include <test/test.h>
#include <test/graphics.h>
#include <game/game_app.h>
#include <game/music_score.h>
#include <game/person_look.h>
#include <game/character_assets.h>
#include <game/person_portrait.h>
#include <game/rise_animation.h>
#include <game/road_graph.h>
#include <game/map_document.h>
#include <game/town.h>
#include <game/traffic.h>
#include <game/world_renderer.h>
#include <algorithm>
#include <cmath>
#include <memory>

namespace
{
using namespace hearthold;

constexpr uint32_t seed = 5;
constexpr double day = Town::secondsPerDay;
constexpr float pi = 3.14159265f;

RoadPath straight(Point a, Point b) { return {RoadAnchor::sharp(a), RoadAnchor::sharp(b)}; }

// Founds the camp where the settlers landed and finishes it at once.
void found(Town& town)
{
    town.scout(town.map().camp().x, town.map().camp().y, 10);  // The settlers look around first.
    for (const auto& site : town.map().dungeons()) {
        town.scout(site.origin.x + 1.f, site.origin.y + 1.f, 3);
        break;  // And the home dungeon.
    }
    CHECK(town.place(Structure::Camp, town.map().camp(), 0));
    town.completeConstruction();
}

// The founded camp, and a straight road leading east from it with lots facing it on the north side.
struct Street
{
    Town town{seed};
    Point camp = town.map().camp();
    Street()
    {
        town.recruit(Role::Resident, Calling::Settler, 3);
        found(town);
        CHECK(town.buildRoad(straight(at(1, 0), at(7, 0))));
    }
    Point at(float x, float y) const { return {camp.x + x, camp.y + y}; }
    Placement lot(int i, Structure kind = Structure::Tent) const { return town.fit(kind, at(2.2f + i * 1.15f, -1), 0); }
    // Places and finishes a building.
    bool build(Structure kind, int i)
    {
        auto spot = lot(i, kind);
        if (!town.place(kind, spot.center, spot.angle)) return false;
        town.completeConstruction();
        return true;
    }
    const Building& built(int i) const { return *town.building(town.buildingAt(lot(i).center)); }
    Placement south(int i, Structure kind) const { return town.fit(kind, at(2.6f + i * 2.2f, 1.2f), 0); }
};

struct RoadDrawing
{
    GameApp game{seed};
    Point camp = game.state().map().camp();
    RoadDrawing()
    {
        found(game.state());
        game.selectPeople({});
        // Drawn close over the camp, whatever the opening view.
        auto focus = project(camp.x, camp.y);
        game.view() = {focus.x, focus.y, 1.4f};
        game.render(1280, 800, 0);
        game.selectTool(Tool::Road);
    }
    Point at(float x, float y) const { return camp + Point{x, y}; }
    Point screen(Point world) { return game.view().toScreen(project(world.x, world.y), 1280, 800); }
    void down(Point world, PointerButton button = PointerButton::Primary) { auto p = screen(world); game.pointerDown(p.x, p.y, button); }
    void move(Point world) { auto p = screen(world); game.pointerMove(p.x, p.y); }
    void up(Point world, PointerButton button = PointerButton::Primary) { auto p = screen(world); game.pointerUp(p.x, p.y, button); }
};
}  // namespace

TEST(game_curved_roads_measure_length)
{
    // A quarter circle drawn with the usual 0.552 handle ratio.
    RoadPath arc{{{0, 0}, {0, 0}, {2.21f, 0}}, {{4, 4}, {4, 1.79f}, {4, 4}}};
    CHECK(std::abs(pathLength(arc) - 2 * pi) < .05f);
    CHECK(std::abs(pathLength(straight({0, 0}, {3, 4})) - 5) < 1e-3f);
}

TEST(game_road_graph_routes_across_crossings_and_t_junctions)
{
    // A cross, plus a branch whose end stops beside the horizontal road.
    auto graph = RoadGraph::build({{{0, 5}, {10, 5}}, {{5, 0}, {5, 10}}, {{8.f, 5.4f}, {8, 9}}});
    auto path = graph.route({.5f, 5}, {8, 9});
    CHECK(path.size() >= 4);
    CHECK(std::hypot(path.back().x - 8, path.back().y - 9) < 1e-3f);
    float total = 0;
    for (size_t i = 1; i < path.size(); ++i) total += distance(path[i - 1], path[i]);
    CHECK(total < 12.5f);  // Along the road, not around the cross.
    CHECK(graph.route({0, 0}, {5, 5}).size() >= 2);
    CHECK(RoadGraph::build({}).route({0, 0}, {1, 1}).empty());
    // A curve flattens into many segments; only its real ends count as junction candidates.
    RoadNetwork network;
    network.add({{{0, 0}, {0, 0}, {2, -2}}, {{6, 0}, {4, -2}, {6, 0}}});
    network.add({{{8, 0}, {8, 0}, {8, 0}}, {{6.3f, 0}, {6.3f, 0}, {6.3f, 0}}});  // Stops just short of the curve's end.
    auto curve = RoadGraph::build(network.segments());
    size_t ends = 0, junctions = 0;
    for (size_t n = 0; n < curve.nodes().size(); ++n) {
        ends += curve.degree(n) == 1;
        junctions += curve.degree(n) > 2;
    }
    CHECK_EQ(ends, size_t(2));  // The curve's start and the stub's far end.
    CHECK_EQ(junctions, size_t(0));
}

TEST(game_settlers_land_on_dry_land_within_reach_of_a_known_dungeon)
{
    Town town(seed);
    auto landing = town.map().camp();
    for (float dy = -2; dy <= 2; dy += .5f)
        for (float dx = -2; dx <= 2; dx += .5f) {
            CHECK(town.map().revealed({landing.x + dx, landing.y + dy}));
            CHECK(!isWater(town.map().terrainAt({landing.x + dx, landing.y + dy})));
        }
    CHECK_EQ(town.population(), 2);
    CHECK_EQ(town.people().size(), size_t(2));
    CHECK(!town.camp());
    const auto& sites = town.map().dungeons();
    CHECK(sites.size() >= 6);
    // The home dungeon is the reason to settle here: close and already known.
    auto start = town.map().start();
    float home = std::hypot(float(sites[0].origin.x - start.x), float(sites[0].origin.y - start.y));
    CHECK(home >= 7 && home <= 12);
    CHECK(sites[0].discovered);
    for (size_t i = 1; i < sites.size(); ++i) {
        CHECK(!sites[i].discovered);
        CHECK(std::hypot(float(sites[i].origin.x - start.x), float(sites[i].origin.y - start.y)) >= 18);
    }
    for (const auto& site : sites) CHECK_EQ(int(town.map().at(site.origin.x + 1, site.origin.y + 1).dungeon), int(&site - &sites[0]));
}

TEST(game_the_camp_is_founded_near_the_dungeon_and_built_by_the_settlers)
{
    Town town(seed);
    auto landing = town.map().camp();
    CHECK_EQ(town.canPlace(Structure::Tent, landing, 0).reason, std::string("Found the camp first"));
    CHECK_EQ(town.canBuildRoad(straight(landing, {landing.x + 3, landing.y})).reason, std::string("Found the camp first"));
    const auto& lair = town.map().dungeons()[0].origin;
    Point far = landing + normalized(landing - Point{lair.x + 1.f, lair.y + 1.f}) * 6;
    if (town.map().revealed(far) && !isWater(town.map().terrainAt(far)))
        CHECK_EQ(town.canPlace(Structure::Camp, far, 0).reason, std::string("Must be within 12 paces of a dungeon"));
    CHECK(town.place(Structure::Camp, landing, 0));
    CHECK_EQ(town.canPlace(Structure::Camp, {landing.x + 2, landing.y}, 0).reason, std::string("The camp already stands"));
    CHECK(!town.camp()->built());
    // The settlers walk over and raise it within the working day.
    town.advance(day * .4);
    CHECK(town.camp()->built());
    bool finished = false;
    for (auto notice = town.takeNotice(); !notice.empty(); notice = town.takeNotice()) finished |= notice == "Camp is finished";
    CHECK(finished);
    CHECK_EQ(town.housing(), structureSpec(Structure::Camp).residents);
}

TEST(game_map_is_an_island_of_continuous_terrain_ringed_by_sea)
{
    for (uint32_t island : {seed, 3u, 12u}) {
        auto map = WorldMap::generate(island);
        int land = 0;
        for (int i = 0; i < map.width(); ++i)
            for (int edge : {0, map.height() - 1}) {
                CHECK(map.at(i, edge).terrain == Terrain::Sea);
                CHECK(map.at(edge, i).terrain == Terrain::Sea);
            }
        for (int y = 0; y < map.height(); ++y)
            for (int x = 0; x < map.width(); ++x) {
                land += map.at(x, y).terrain != Terrain::Sea;
                CHECK(map.at(x, y).terrain == map.terrainAt({x + .5f, y + .5f}));
            }
        CHECK(land > map.width() * map.height() / 4);  // A continent, with the world-sea round it.
        auto c = map.start();
        CHECK(map.value(Layer::Land, map.camp()) > 0);
        CHECK(map.coast(-1, -1) < 0);
        // On the shore of Ymir's bay, but on dry ground with land on most sides.
        int dry = 0;
        for (int y = c.y - 9; y <= c.y + 9; ++y)
            for (int x = c.x - 9; x <= c.x + 9; ++x) {
                dry += map.at(x, y).terrain != Terrain::Sea;
                if (std::abs(x - c.x) <= 3 && std::abs(y - c.y) <= 3) CHECK(map.at(x, y).terrain != Terrain::Sea);
            }
        CHECK(dry * 2 > 19 * 19);
        // The river is water wherever it crosses land.
        int wet = 0, crossings = 0;
        for (auto p : map.river().path)
            if (map.value(Layer::Land, p) > .02f) {
                ++crossings;
                wet += isWater(map.terrainAt(p));
            }
        CHECK(crossings > 0);
        CHECK_EQ(wet, crossings);
    }
}

TEST(game_scouting_a_dungeon_discovers_it_but_its_monsters_stay_inside)
{
    Town town(seed);
    found(town);
    const auto& site = town.map().dungeons()[1];
    town.scout(site.origin.x + 1.f, site.origin.y + 1.f, 3);
    CHECK(town.map().dungeons()[1].discovered);
    bool told = false;
    for (auto notice = town.takeNotice(); !notice.empty(); notice = town.takeNotice()) told |= notice == "Discovered " + site.name + ", a way to " + worldName(town.map().destination(site));
    CHECK(told);
    CHECK_EQ(town.canPlace(Structure::Tent, {site.origin.x + 1.f, site.origin.y + 1.f}, 0).reason, std::string("A dungeon entrance"));
    town.advance(.2);
    CHECK(town.monsters().empty());  // What lives in a dungeon comes out only as a raid.
}

TEST(game_vector_roads_grow_from_the_settlement_and_cost_gold_by_length)
{
    Town town(seed);
    found(town);
    auto c = town.map().camp();
    auto at = [&](float x, float y) { return Point{c.x + x, c.y + y}; };
    CHECK_EQ(town.canBuildRoad(straight(at(4, 4), at(6, 4))).reason, std::string("Must connect to the settlement"));
    CHECK_EQ(town.canBuildRoad({RoadAnchor::sharp(at(1, 0))}).reason, std::string("Hold and draw a road"));
    auto check = town.canBuildRoad(straight(at(1, 0), at(6, 0)));
    CHECK(check.ok);
    CHECK_EQ(check.cost.gold, 5);
    CHECK(town.buildRoad(straight(at(1, 0), at(6, 0))));
    // A curved branch from the middle of the road: longer than its chord, so it costs more.
    RoadPath curve{{at(3, 0), at(3, 0), at(3, 2)}, {at(5, 4), at(3, 4), at(5, 4)}};
    auto bend = town.canBuildRoad(curve);
    CHECK(bend.ok);
    CHECK(bend.cost.gold > int(distance(at(3, 0), at(5, 4))));
    CHECK(town.buildRoad(curve));
    CHECK_EQ(town.roads().roads().size(), size_t(2));
    CHECK(town.roads().distance(cubic(at(3, 0), at(3, 2), at(3, 4), at(5, 4), .5f)) < .02f);
    // Reshaping pays only for added length.
    auto id = town.roads().roads()[0].id;
    auto shorter = straight(at(1, 0), at(5.5f, 0));
    CHECK_EQ(town.canReshapeRoad(id, shorter).cost.gold, 0);
    CHECK(town.reshapeRoad(id, shorter));
    CHECK_EQ(town.canReshapeRoad(id, straight(at(1, 0), at(8.5f, 0))).cost.gold, 3);
    CHECK_EQ(town.canBuildRoad(straight(at(1, 0), at(1 + Town::maxRoadLength + 1, 0))).reason, std::string("Too long"));
}

TEST(game_buildings_go_anywhere_turned_freely_beside_a_road)
{
    Street street;
    auto& town = street.town;
    CHECK_EQ(town.canPlace(Structure::Tent, street.at(3, -3), 0).reason, std::string("Needs a road beside it"));
    CHECK_EQ(town.canPlace(Structure::Tent, street.at(3, 0), 0).reason, std::string("On the road"));
    // Near a road the building snaps beside it, its front (+y) wall toward the road.
    auto spot = street.lot(0);
    CHECK(spot.snapped);
    CHECK(std::abs(spot.center.y - street.at(0, -.9f).y) < .05f);
    auto front = rotated({0, 1}, spot.angle);
    CHECK(front.y > .99f);
    auto south = town.fit(Structure::Tent, street.at(3, .8f), 0);
    CHECK(rotated({0, 1}, south.angle).y < -.99f);
    // Away from roads it keeps the angle the player turned it to.
    auto free = town.fit(Structure::Tent, street.at(3, -4), .7f);
    CHECK(!free.snapped);
    CHECK_EQ(free.angle, .7f);
    auto stock = town.stock();
    CHECK(street.build(Structure::Tent, 0));
    CHECK_EQ(town.wood(), stock.wood - structureSpec(Structure::Tent).cost.wood);
    CHECK_EQ(town.canPlace(Structure::Tent, spot.center + Point{.4f, 0}, .3f).reason, std::string("Occupied"));
    // A turned tent fits at any angle beside its neighbour.
    auto next = street.lot(1);
    Point back = next.center + Point{0, -.15f};
    CHECK(town.place(Structure::Tent, back, next.angle + .2f));
    CHECK_EQ(town.building(town.buildingAt(back))->angle, next.angle + .2f);
    CHECK_EQ(town.canPlace(Structure::Portal, street.south(0, Structure::Portal).center, 0).reason, std::string("Needs 8 people"));
    CHECK(!structureSpec(Structure::Cottage).buildable);
    CHECK_EQ(town.canPlace(Structure::Cottage, street.lot(2).center, 0).reason, std::string("Grows from an earlier stage"));
}

TEST(game_fields_are_freeform_outlines_tended_from_a_nearby_farmhouse)
{
    Street street;
    auto& town = street.town;
    Outline plot{street.at(2, 1.2f), street.at(5, 1), street.at(5.4f, 3.6f), street.at(2.4f, 3.2f)};
    CHECK_EQ(town.canPlantField(plot).reason, std::string("Needs a farmhouse within 6 paces"));
    CHECK_EQ(town.canPlantField({plot[0], plot[2], plot[1], plot[3]}).reason, std::string("The outline crosses itself"));
    CHECK(street.build(Structure::Farm, 0));
    CHECK(town.plantField(plot));
    CHECK_EQ(town.fieldAcres(), int(std::lround(area(plot))));
    CHECK(town.fieldAt(centroid(plot)) >= 0);
    CHECK_EQ(town.canBuildRoad(straight(street.at(3, 0), street.at(3.6f, 4))).reason, std::string("Fields in the way"));
    CHECK_EQ(town.canPlantField({street.at(4.5f, -.4f), street.at(6.5f, -.4f), street.at(6.5f, .4f), street.at(4.5f, .4f)}).reason, std::string("Road in the way"));
    CHECK_EQ(street.built(0).workers, 3);
    CHECK_EQ(town.tendedFieldAcres(), town.fieldAcres());
    CHECK(town.demolish(centroid(plot)));
    CHECK_EQ(town.fieldAcres(), 0);
}

TEST(game_seasons_turn_and_the_autumn_harvest_fills_the_granary)
{
    Street street;
    auto& town = street.town;
    CHECK(street.build(Structure::Farm, 0));
    CHECK(town.plantField({street.at(2, 1.2f), street.at(5, 1.2f), street.at(5, 3.6f), street.at(2, 3.6f)}));
    town.reward({0, 0, 0, 400, 0, 2000});  // A full granary and cistern, so only the harvest is measured.
    for (int i = 0; i < 2; ++i) {  // And room to keep it.
        auto spot = town.fit(Structure::Storehouse, street.at(4.2f + i * 2.4f, -1.4f), 0);  // North of the road; the field is south.
        town.reward(structureSpec(Structure::Storehouse).cost);
        CHECK_EQ(town.canPlace(Structure::Storehouse, spot.center, spot.angle).reason, std::string());
        CHECK(town.place(Structure::Storehouse, spot.center, spot.angle));
    }
    town.completeConstruction();
    town.recruit(Role::Resident, Calling::Warrior, 3);
    CHECK_EQ(seasonName(town.calendar().season), std::string("Spring"));
    town.advance(day * Town::daysPerMonth * 3);
    CHECK_EQ(seasonName(town.calendar().season), std::string("Summer"));
    // Up to the eve of the harvest, then across it.
    double harvestDay = Town::daysPerMonth * 9;
    town.advance(day * harvestDay - town.clock() - day * .2);
    // The night raids may have torn the storehouses down by now: raise room for the harvest again.
    town.reward({100, 200, 100, 0, 0});
    for (int i = 0; i < 2; ++i) {
        auto spot = town.fit(Structure::Storehouse, street.at(4.2f + i * 2.4f, -1.4f), 0);
        if (town.buildingAt(spot.center) >= 0) continue;  // Still standing.
        CHECK_EQ(town.canPlace(Structure::Storehouse, spot.center, spot.angle).reason, std::string());
        CHECK(town.place(Structure::Storehouse, spot.center, spot.angle));
    }
    town.completeConstruction();
    while (!town.takeNotice().empty()) {}
    int before = town.stock().food;
    CHECK(town.capacity().food - before > 60);  // Room for the whole harvest.
    town.advance(day * .4);
    CHECK_EQ(seasonName(town.calendar().season), std::string("Winter"));
    int harvested = 0;
    for (auto notice = town.takeNotice(); !notice.empty(); notice = town.takeNotice())
        if (notice.rfind("Harvest: +", 0) == 0) harvested = std::stoi(notice.substr(10));
    CHECK(harvested > 20);
    CHECK(town.stock().food >= before + harvested - 6);  // Into the granary, less a night's meals.
}

TEST(game_idle_settlers_staff_jobs_up_to_the_players_cap)
{
    Street street;
    auto& town = street.town;
    CHECK(street.build(Structure::Farm, 0));
    int id = street.built(0).id;
    CHECK_EQ(town.idle(), 2);  // Three of the five residents take the farm's jobs.
    town.setWorkers(id, 0);
    CHECK_EQ(town.idle(), 5);
    town.advance(day * 2);
    CHECK_EQ(town.building(id)->workers, 0);  // The cap holds across days.
    town.setWorkers(id, 9);
    CHECK_EQ(town.building(id)->workers, 3);
}

TEST(game_homes_grow_once_full_in_a_big_enough_town)
{
    Street street;
    auto& town = street.town;
    CHECK(street.build(Structure::Tent, 0));
    // Two settlers: the tent is home to both, but the town is too small.
    auto status = town.growthStatus(street.built(0));
    CHECK(status.grows && !status.ready);
    CHECK_EQ(status.next, std::string("Cottage"));
    CHECK(status.reason.find("in a town of 6") != std::string::npos);
    town.recruit(Role::Resident, Calling::Settler, 4);
    town.reward({0, 50, 0, 200, 0});
    town.advance(day * (structureSpec(Structure::Tent).growthDays + 1));
    const auto& grown = street.built(0);
    CHECK(grown.kind == Structure::Cottage);
    CHECK_EQ(grown.version, uint32_t(1));
    CHECK_EQ(grown.replaced.size(), size_t(1));
    CHECK(grown.replaced[0].kind == Structure::Tent);
    // Residents live in their homes, not all at the camp; the camp shelters at most five.
    CHECK_EQ(structureSpec(Structure::Camp).residents, 5);
    int atTent = int(std::count_if(town.people().begin(), town.people().end(), [&](const Person& p) { return p.home == grown.id; }));
    CHECK(atTent >= 2);
}

TEST(game_four_huddled_mature_townhouses_merge_into_a_manor)
{
    Street street;
    auto& town = street.town;
    // A second street behind the first, so two rows of homes stand back to back.
    CHECK(town.buildRoad(straight(street.at(1, 0), street.at(1, -3))));
    CHECK(town.buildRoad(straight(street.at(1, -3), street.at(7, -3))));
    std::vector<Point> homes;
    for (float row : {-1.f, -2.f})
        for (int i : {1, 2}) {
            auto spot = town.fit(Structure::Tent, street.at(2.2f + i * 1.15f, row), 0);
            CHECK(town.place(Structure::Tent, spot.center, spot.angle));
            homes.push_back(spot.center);
        }
    town.recruit(Role::Resident, Calling::Settler, 22);  // Manors need a town of twenty-four.
    auto market = street.south(0, Structure::MarketStalls);
    CHECK(town.place(Structure::MarketStalls, market.center, market.angle));
    town.completeConstruction();
    town.reward({500, 500, 500, 900, 0, 3000});
    town.advance(day * 30);
    const auto* manor = town.building(town.buildingAt(homes[0]));
    CHECK(manor && manor->kind == Structure::Manor);
    if (!manor) return;
    CHECK_EQ(manor->replaced.size(), size_t(4));
    CHECK(manor->replaced[3].kind == Structure::Townhouse);
    for (auto home : homes) CHECK_EQ(town.buildingAt(home), manor->id);
    CHECK(town.housing() >= structureSpec(Structure::Camp).residents + structureSpec(Structure::Manor).residents);
}

TEST(game_rise_animations_load_for_every_structure_upgrade_and_angle)
{
    te::test::Graphics runtime(false);
    for (int i = 0; i < int(Structure::Count); ++i) {
        auto kind = Structure(i);
        for (float angle : {0.f, .5f, 2.4f, -1.3f})
            for (auto replaced : {std::vector<Stage>{}, std::vector<Stage>{{Structure::Tent, 2, 0, 0}}}) {
                auto rise = riseAnimation(kind, 4, replaced, angle);
                std::unique_ptr<tvg::Animation> animation(tvg::Animation::gen());
                CHECK(animation->picture()->load(rise.json.data(), uint32_t(rise.json.size()), "lottie+json", nullptr, true) == tvg::Result::Success);
                CHECK_EQ(animation->totalFrame(), rise.frames);
                CHECK(rise.originX > 0 && rise.originY > 0 && rise.originX < rise.width && rise.originY < rise.height);
            }
    }
    int turns = 0;
    float rest = 0;
    splitAngle(2.4f, turns, rest);
    CHECK_EQ(turns, 2);
    CHECK(std::abs(rest - (2.4f - pi)) < 1e-4f);
    splitAngle(-1.3f, turns, rest);
    CHECK_EQ(turns, 3);
    CHECK(std::abs(rest) <= pi / 4 + 1e-4f);
}

TEST(game_workers_carry_their_goods_to_the_store)
{
    Street street;
    auto& town = street.town;
    CHECK(street.build(Structure::Farm, 3));
    bool carried = false;
    for (int step = 0; step < 200 && !carried; ++step) {
        town.advance(1);
        for (const auto& p : town.people()) carried |= p.activity == Activity::Hauling;
    }
    CHECK(carried);
}

TEST(game_merchants_travel_to_markets_and_leave_on_arrival)
{
    Street street;
    auto& town = street.town;
    auto market = street.south(0, Structure::MarketStalls);
    CHECK(town.place(Structure::MarketStalls, market.center, market.angle));
    town.completeConstruction();
    Traffic traffic(seed);
    traffic.update(town, 6);
    CHECK_EQ(traffic.agents().size(), size_t(1));
    if (traffic.agents().empty()) return;
    auto merchant = traffic.agents().front();
    CHECK(merchant.kind == AgentKind::Merchant);
    CHECK(merchant.length() > 0);
    CHECK(merchant.speed > 0);

    traffic.update(town, .25);
    CHECK(!traffic.agents().empty());
    if (traffic.agents().empty()) return;
    CHECK_EQ(traffic.agents().front().id, merchant.id);
    CHECK(distance(traffic.agents().front().position(), merchant.position()) > 0);

    traffic.update(town, merchant.length() / merchant.speed + 1);
    CHECK(std::none_of(traffic.agents().begin(), traffic.agents().end(), [&](const Agent& a) { return a.id == merchant.id; }));
}

TEST(game_renderer_animates_new_buildings_and_upgrades)
{
    te::test::Graphics runtime(false);
    Street street;
    Traffic traffic(seed);
    WorldRenderer renderer;
    Camera camera;
    renderer.update(street.town, traffic, camera, 800, 600, 0, {});
    CHECK(renderer.animating());  // The camp tent rises first.
    renderer.update(street.town, traffic, camera, 800, 600, 10, {});
    CHECK(!renderer.animating());
    // A construction site holds its rise at the progress made, then plays out once finished.
    auto spot = street.lot(0);
    CHECK(street.town.place(Structure::Tent, spot.center, spot.angle));
    renderer.update(street.town, traffic, camera, 800, 600, 11, {});
    renderer.update(street.town, traffic, camera, 800, 600, 30, {});
    CHECK(renderer.animating());
    street.town.completeConstruction();
    renderer.update(street.town, traffic, camera, 800, 600, 31, {});
    renderer.update(street.town, traffic, camera, 800, 600, 40, {});
    CHECK(!renderer.animating());
    street.town.advance(day * structureSpec(Structure::Tent).growthDays);
    renderer.update(street.town, traffic, camera, 800, 600, 21, {});
    CHECK(renderer.animating());  // The tent morphs into a cottage.
}

TEST(game_freehand_roads_follow_one_curved_stroke_and_commit_only_on_release)
{
    te::test::Graphics runtime;
    RoadDrawing drawing;
    auto& game = drawing.game;
    int gold = game.state().gold();
    drawing.down(drawing.at(1, 0));
    for (auto point : {drawing.at(2, .4f), drawing.at(3, 1.2f), drawing.at(4, 1.3f), drawing.at(5, .6f)}) drawing.move(point);
    CHECK(game.state().roads().empty());
    game.finish();
    CHECK(game.state().roads().empty());
    auto end = drawing.at(6, 0);
    drawing.up(end);
    const auto& roads = game.state().roads().roads();
    CHECK_EQ(roads.size(), size_t(1));
    if (roads.empty()) return;
    CHECK(distance(roads[0].path.front().point, drawing.at(1, 0)) < .001f);
    CHECK(distance(roads[0].path.back().point, end) < .001f);
    CHECK(roads[0].length() > distance(drawing.at(1, 0), end) + .3f);
    float furthest = 0;
    for (auto point : roads[0].line) furthest = std::max(furthest, point.y - drawing.camp.y);
    CHECK(furthest > 1.1f);
    CHECK_EQ(gold - game.state().gold(), int(std::ceil(roads[0].length())));
    drawing.move(drawing.at(7, 2));
    drawing.up(drawing.at(7, 2));
    CHECK_EQ(game.state().roads().roads().size(), size_t(1));
    CHECK(distance(game.state().roads().roads()[0].path.back().point, end) < .001f);
    drawing.down(end);
    drawing.up(drawing.at(7, 2));
    CHECK_EQ(game.state().roads().roads().size(), size_t(1));
}

TEST(game_freehand_stationary_clicks_and_idle_hover_never_build_or_charge)
{
    te::test::Graphics runtime;
    RoadDrawing drawing;
    int gold = drawing.game.state().gold();
    auto start = drawing.at(1, 0);
    drawing.down(start); drawing.up(start);
    auto screen = drawing.screen(start);
    drawing.game.pointerDown(screen.x, screen.y, PointerButton::Primary);
    drawing.game.pointerMove(screen.x + 2, screen.y + 1);
    drawing.game.pointerUp(screen.x + 2, screen.y + 1, PointerButton::Primary);
    drawing.move(drawing.at(7, 0));
    drawing.game.finish();
    drawing.up(drawing.at(7, 0));
    CHECK(drawing.game.state().roads().empty());
    CHECK_EQ(drawing.game.state().gold(), gold);
}

TEST(game_freehand_small_screen_jitter_becomes_a_straight_road_at_each_zoom)
{
    te::test::Graphics runtime;
    for (float zoom : {.7f, 1.4f, 3.f}) {
        RoadDrawing drawing;
        drawing.game.view().zoom = zoom;
        auto start = drawing.at(1, 0), end = drawing.at(4, 0);
        auto a = drawing.screen(start), b = drawing.screen(end);
        auto direction = normalized(b - a);
        Point normal{-direction.y, direction.x};
        int steps = std::max(4, int(distance(a, b) / 8));
        drawing.down(start);
        drawing.game.pointerMove(a.x - direction.x * 3, a.y - direction.y * 3);
        for (int i = 1; i < steps; ++i) {
            auto point = lerp(a, b, float(i) / steps) + normal * (i % 2 ? 2.2f : -2.2f);
            drawing.game.pointerMove(point.x, point.y);
        }
        drawing.up(end);
        const auto& roads = drawing.game.state().roads().roads();
        CHECK_EQ(roads.size(), size_t(1));
        if (roads.empty()) continue;
        CHECK_EQ(roads.front().path.size(), size_t(2));
        CHECK(std::abs(roads.front().length() - distance(start, end)) < .01f);
        CHECK(distance(roads.front().path.front().point, start) < .001f);
        CHECK(distance(roads.front().path.back().point, end) < .001f);
    }
}

TEST(game_freehand_snapped_endpoints_do_not_add_a_backtracking_hook)
{
    te::test::Graphics runtime;
    for (bool reverse : {false, true}) {
        RoadDrawing drawing;
        auto& town = drawing.game.state();
        CHECK(town.buildRoad(straight(drawing.at(1, 0), drawing.at(7, 0))));
        std::vector<Point> stroke;
        for (int i = 0; i <= 40; ++i) stroke.push_back(drawing.at(3, -.45f + i * .09f));
        if (reverse) std::reverse(stroke.begin(), stroke.end());
        drawing.down(stroke.front());
        drawing.move(stroke.front());
        for (auto point : stroke) drawing.move(point);
        drawing.up(stroke.back());
        CHECK_EQ(town.roads().roads().size(), size_t(2));
        if (town.roads().roads().size() < 2) continue;
        const auto& road = town.roads().roads().back();
        auto snapped = reverse ? road.path.back().point : road.path.front().point;
        CHECK(distance(snapped, drawing.at(3, 0)) < .001f);
        auto line = flatten(road.path, .01f);
        CHECK_EQ(std::count_if(line.begin(), line.end(), [&](Point p) { return p.y < drawing.camp.y - .001f; }), 0);
        int backwards = 0;
        for (size_t i = 1; i < line.size(); ++i)
            backwards += (reverse ? -1 : 1) * (line[i].y - line[i - 1].y) < -.001f;
        CHECK_EQ(backwards, 0);
    }
}

TEST(game_freehand_magnet_only_moves_endpoints_close_to_the_existing_road)
{
    te::test::Graphics runtime;
    for (float gap : {.5f, .7f}) {
        RoadDrawing drawing;
        auto& town = drawing.game.state();
        CHECK(town.buildRoad(straight(drawing.at(1, 0), drawing.at(7, 0))));
        drawing.down(drawing.at(3, gap));
        drawing.up(drawing.at(3, 3));
        CHECK_EQ(town.roads().roads().size(), size_t(2));
        if (town.roads().roads().size() < 2) continue;
        auto start = town.roads().roads().back().path.front().point;
        CHECK(distance(start, drawing.at(3, gap < .6f ? 0 : gap)) < .001f);
    }
}

TEST(game_freehand_release_preserves_an_endpoint_below_the_sampling_spacing)
{
    te::test::Graphics runtime;
    for (float zoom : {.7f, 1.4f, 3.f}) {
        RoadDrawing drawing;
        drawing.game.view().zoom = zoom;
        drawing.down(drawing.at(1, 0));
        drawing.move(drawing.at(5, 0));
        auto end = drawing.at(5.01f, .005f);
        drawing.up(end);
        const auto& roads = drawing.game.state().roads().roads();
        CHECK_EQ(roads.size(), size_t(1));
        if (!roads.empty()) CHECK(distance(roads[0].path.back().point, end) < .001f);
    }
}

TEST(game_freehand_cancellation_and_tool_changes_cannot_commit_on_a_later_release)
{
    te::test::Graphics runtime;
    RoadDrawing drawing;
    auto& game = drawing.game;
    int gold = game.state().gold();
    for (int action = 0; action < 5; ++action) {
        game.selectTool(Tool::Road);
        drawing.down(drawing.at(1, 0));
        drawing.move(drawing.at(6, 0));
        if (action == 0) game.cancel();
        else if (action == 1) game.undoPoint();
        else if (action == 2) {
            drawing.down(drawing.at(6, 0), PointerButton::Secondary);
            drawing.up(drawing.at(6, 0), PointerButton::Secondary);
        } else if (action == 3) game.cancelStroke();
        else { game.selectTool(Tool::Select); game.selectTool(Tool::Road); }
        drawing.move(drawing.at(7, 0));
        drawing.up(drawing.at(7, 0));
        CHECK(game.state().roads().empty());
        CHECK_EQ(game.state().gold(), gold);
    }
    auto before = game.view();
    auto screen = drawing.screen(drawing.at(1, 0));
    game.pointerDown(screen.x, screen.y, PointerButton::Secondary);
    game.pointerMove(screen.x + 20, screen.y + 10);
    game.pointerUp(screen.x + 20, screen.y + 10, PointerButton::Secondary);
    CHECK(game.view().x != before.x && game.view().y != before.y);
    CHECK(game.state().roads().empty());
}

TEST(game_freehand_branches_snap_endpoints_without_reshaping_existing_roads)
{
    te::test::Graphics runtime;
    RoadDrawing drawing;
    auto& town = drawing.game.state();
    CHECK(town.buildRoad(straight(drawing.at(1, 0), drawing.at(7, 0))));
    auto original = town.roads().roads()[0].path;
    drawing.down(drawing.at(3, .2f));
    drawing.move(drawing.at(3.2f, 1.4f));
    drawing.up(drawing.at(3.5f, 3));
    CHECK_EQ(town.roads().roads().size(), size_t(2));
    CHECK(town.roads().roads()[0].path == original);
    if (town.roads().roads().size() < 2) return;
    CHECK(distance(town.roads().roads()[1].path.front().point, drawing.at(3, 0)) < .001f);
    drawing.game.selectTool(Tool::Road);
    drawing.down(drawing.at(5, 1.5f));
    drawing.move(drawing.at(5, 0));
    CHECK_EQ(town.roads().roads().size(), size_t(2));
    drawing.move(drawing.at(5, -1));
    drawing.up(drawing.at(5, -2));
    CHECK_EQ(town.roads().roads().size(), size_t(3));
    CHECK(town.roads().roads()[0].path == original);
    if (town.roads().roads().size() == 3) CHECK(distance(town.roads().roads()[2].path.back().point, drawing.at(5, -2)) < .001f);
}

TEST(game_freehand_invalid_release_is_discarded_and_next_stroke_can_succeed)
{
    te::test::Graphics runtime;
    RoadDrawing drawing;
    int gold = drawing.game.state().gold();
    drawing.down(drawing.at(4, 4));
    drawing.move(drawing.at(5, 4));
    drawing.up(drawing.at(6, 4));
    CHECK(drawing.game.state().roads().empty());
    CHECK_EQ(drawing.game.state().gold(), gold);
    drawing.move(drawing.at(1, 0));
    drawing.up(drawing.at(1, 0));
    CHECK(drawing.game.state().roads().empty());
    drawing.down(drawing.at(1, 0));
    drawing.up(drawing.at(6, 0));
    CHECK_EQ(drawing.game.state().roads().roads().size(), size_t(1));
}

TEST(game_freehand_escape_cancels_before_leaving_the_build_card_and_keeps_road_crew)
{
    te::test::Graphics runtime;
    RoadDrawing drawing;
    auto& game = drawing.game;
    int builder = game.state().people()[0].id;
    game.selectPeople({builder});
    game.render(1280, 800, 0);
    game.render(1280, 800, .3);
    double uiTime = .3;
    auto click = [&](const char* label) {
        auto matches = test::textBounds(game.hudScene(), label); CHECK(!matches.empty());
        if (matches.empty()) return;
        auto r = *std::min_element(matches.begin(), matches.end(), [](auto a, auto b) { return a.y < b.y; });
        float x = r.x + r.w / 2, y = r.y + r.h / 2;
        game.pointerDown(x, y, PointerButton::Primary);
        game.pointerUp(x, y, PointerButton::Primary);
        game.render(1280, 800, uiTime);
        game.render(1280, 800, uiTime += .25);
    };
    click("Build"); click("Roads"); click("Road");
    drawing.down(drawing.at(1, 0)); drawing.move(drawing.at(6, 0));
    game.cancel(); drawing.up(drawing.at(6, 0));
    CHECK(game.state().roads().empty());
    drawing.down(drawing.at(1, 0)); drawing.up(drawing.at(6, 0));
    CHECK_EQ(game.state().roads().roads().size(), size_t(1));
    if (game.state().roads().empty()) return;
    CHECK(game.state().person(builder)->activity == Activity::Roadwork);
    game.render(1280, 800, uiTime);
    game.render(1280, 800, uiTime += .25);
    click("Build"); click("Roads"); click("Road");
    drawing.down(drawing.at(3, .1f)); drawing.up(drawing.at(3, 2));
    CHECK_EQ(game.state().roads().roads().size(), size_t(2));
    CHECK_EQ(game.state().person(builder)->taskSite, game.state().roads().roads().back().id);
    CHECK_EQ(game.state().person(builder)->target, game.state().roads().roads().front().id);
}

TEST(game_freehand_excessive_samples_cancel_the_entire_stroke_without_charging)
{
    te::test::Graphics runtime;
    RoadDrawing drawing;
    drawing.game.view().zoom = 6;
    int gold = drawing.game.state().gold();
    drawing.down(drawing.at(1, 0));
    for (int i = 0; i < 4096; ++i) drawing.move(drawing.at(i % 2 == 0 ? 1.05f : 1.f, 0));
    drawing.move(drawing.at(6, 0));
    drawing.up(drawing.at(6, 0));
    CHECK(drawing.game.state().roads().empty());
    CHECK_EQ(drawing.game.state().gold(), gold);
    drawing.down(drawing.at(1, 0)); drawing.up(drawing.at(5, 0));
    CHECK_EQ(drawing.game.state().roads().roads().size(), size_t(1));
}

TEST(game_pointer_cancel_discards_fields_and_pan_without_affecting_next_gesture)
{
    te::test::Graphics runtime;
    RoadDrawing drawing;
    auto& game = drawing.game;
    auto& town = game.state();
    CHECK(town.buildRoad(straight(drawing.at(1, 0), drawing.at(7, 0))));
    auto farm = town.fit(Structure::Farm, drawing.at(4.5f, -.8f), 0);
    CHECK(town.place(Structure::Farm, farm.center, farm.angle));
    game.selectTool(Tool::Field);
    drawing.down(drawing.at(3.8f, 1)); drawing.move(drawing.at(6, 3));
    game.cancelPointer(); drawing.up(drawing.at(6, 3));
    CHECK_EQ(town.fieldAcres(), 0);
    drawing.down(drawing.at(3.8f, 1)); drawing.move(drawing.at(6, 3));
    game.selectTool(Tool::Road); drawing.up(drawing.at(6, 3));
    CHECK_EQ(town.fieldAcres(), 0);
    CHECK_EQ(town.roads().roads().size(), size_t(1));
    game.selectTool(Tool::Field);
    drawing.down(drawing.at(3.8f, 1)); drawing.up(drawing.at(6, 3));
    CHECK(town.fieldAcres() >= 3);
    auto point = drawing.screen(drawing.at(1, 0));
    game.pointerDown(point.x, point.y, PointerButton::Secondary);
    game.pointerMove(point.x + 20, point.y + 10);
    game.cancelPointer();
    auto camera = game.view();
    game.pointerMove(point.x + 100, point.y + 100);
    game.pointerUp(point.x + 100, point.y + 100, PointerButton::Secondary);
    CHECK_EQ(game.view().x, camera.x);
    CHECK_EQ(game.view().y, camera.y);
}

TEST(game_freehand_editor_transitions_discard_an_active_stroke)
{
#if HEARTHOLD_WITH_EDITOR
    te::test::Graphics runtime;
    RoadDrawing drawing;
    auto& game = drawing.game;
    drawing.down(drawing.at(1, 0)); drawing.move(drawing.at(6, 0));
    game.openCharacterEditor(); game.closeCharacterEditor(false); game.render(1280, 800, .1);
    drawing.up(drawing.at(6, 0));
    CHECK(game.state().roads().empty());
    game.selectTool(Tool::Road);
    drawing.down(drawing.at(1, 0)); drawing.move(drawing.at(6, 0));
    game.openMapEditor(); game.closeMapEditor(false); game.render(1280, 800, .2);
    drawing.up(drawing.at(6, 0));
    CHECK(game.state().roads().empty());
#endif
}

TEST(game_fields_keep_drag_rectangles_and_clicked_outlines)
{
    te::test::Graphics runtime;
    GameApp game(seed);
    found(game.state());
    game.selectPeople({});  // No unit card over the clicks below.
    float width = 1280, height = 800;
    game.render(width, height, 0);
    auto c = game.state().map().camp();
    auto screen = [&](float x, float y) { return game.view().toScreen(project(c.x + x, c.y + y), width, height); };
    auto click = [&](Point p, PointerButton button = PointerButton::Primary) {
        game.pointerDown(p.x, p.y, button);
        game.pointerUp(p.x, p.y, button);
    };
    auto dragTo = [&](Point a, Point b) {
        game.pointerDown(a.x, a.y, PointerButton::Primary);
        game.pointerMove(b.x, b.y);
        game.pointerUp(b.x, b.y, PointerButton::Primary);
    };
    CHECK(game.state().buildRoad(straight({c.x + 1, c.y}, {c.x + 7, c.y})));

    game.selectTool(Tool::Farm);
    click(screen(4.5f, -.8f));
    int farm = game.state().buildingAt({c.x + 4.5f, c.y - .9f});
    CHECK(farm >= 0);
    CHECK_EQ(game.selectedBuilding(), farm);

    // A drag lays a rectangle of farmland; clicked corners outline any shape.
    game.selectTool(Tool::Field);
    dragTo(screen(3.8f, 1), screen(6, 3));
    int rectangle = game.state().fieldAcres();
    CHECK(rectangle >= 3);
    game.selectTool(Tool::Field);
    for (auto corner : {screen(3.8f, 3.6f), screen(5.8f, 3.8f), screen(5.4f, 5.6f), screen(3.9f, 5.4f)}) click(corner);
    click(screen(3.8f, 3.6f));  // Back on the first corner closes the outline.
    CHECK(game.state().fieldAcres() > rectangle);

    game.selectTool(Tool::Select);
    click(screen(4.5f, -.9f));
    CHECK_EQ(game.selectedBuilding(), farm);
    game.render(width, height, .2);
}

TEST(game_people_are_selected_and_ordered_around_like_units)
{
    te::test::Graphics runtime;
    GameApp game(seed);
    float width = 1280, height = 800;
    game.render(width, height, 0);
    CHECK_EQ(game.selectedPeople().size(), size_t(2));  // The founding pair starts selected.
    auto& town = game.state();
    auto screenOf = [&](Point p) { return game.view().toScreen(project(p.x, p.y), width, height); };
    // Clicking one settler selects just them; a box around the party selects them all.
    auto first = town.people()[0];
    auto feet = screenOf(first.position);
    game.pointerDown(feet.x, feet.y - 9, PointerButton::Primary);
    game.pointerUp(feet.x, feet.y - 9, PointerButton::Primary);
    CHECK_EQ(game.selectedPeople().size(), size_t(1));
    CHECK_EQ(game.selectedPeople()[0], first.id);
    auto a = screenOf(town.map().camp() + Point{-3, -3}), b = screenOf(town.map().camp() + Point{3, 3});
    float left = std::min(a.x, b.x) - 200, right = std::max(a.x, b.x) + 200;
    game.pointerDown(left, a.y, PointerButton::Primary);
    game.pointerMove(right, b.y);
    game.pointerUp(right, b.y, PointerButton::Primary);
    CHECK_EQ(game.selectedPeople().size(), size_t(2));
    for (const auto& person : town.people()) town.setAuto(person.id, false);
    // Right-click walks manual units there and holds them at the destination.
    Point goal = town.walking().nearestWalkable(town.map().camp() + Point{3, 2});
    auto spot = screenOf(goal);
    game.pointerDown(spot.x, spot.y, PointerButton::Secondary);
    game.pointerUp(spot.x, spot.y, PointerButton::Secondary);
    town.advance(6);
    for (const auto& person : town.people()) CHECK(distance(person.position, goal) < 1.2f);
    CHECK(town.people()[0].activity == Activity::Holding);
}

TEST(game_the_wheel_zooms_in_close_enough_to_read_faces_and_stops_there)
{
    te::test::Graphics runtime;
    GameApp game(seed);
    game.render(1280, 800, 0);
    for (int i = 0; i < 60; ++i) game.wheel(640, 400, 1);
    CHECK_EQ(game.view().zoom, GameApp::maxZoom);
    CHECK(GameApp::maxZoom >= 6);
    for (int i = 0; i < 120; ++i) game.wheel(640, 400, -1);
    CHECK_EQ(game.view().zoom, .1f);
}

TEST(game_settlers_raise_sites_and_attend_their_jobs)
{
    Street street;
    auto& town = street.town;
    auto spot = street.lot(0);
    CHECK(town.place(Structure::Tent, spot.center, spot.angle));
    const auto* tent = town.building(town.buildingAt(spot.center));
    CHECK(!tent->built());
    CHECK_EQ(town.housing(), structureSpec(Structure::Camp).residents);  // A site shelters nobody.
    town.advance(day * .3);
    CHECK(town.building(town.buildingAt(spot.center))->built());
    CHECK(street.build(Structure::Farm, 2));
    const auto* farm = town.building(town.buildingAt(street.lot(2).center));
    CHECK_EQ(farm->workers, 3);
    town.advance(day * 2);
    farm = town.building(town.buildingAt(street.lot(2).center));
    CHECK(farm->attendance > .4f);  // They actually walked there and worked a full day.
}

TEST(game_needs_drive_people_and_hunger_breeds_stress)
{
    Street street;
    auto& town = street.town;
    town.reward({0, 0, 0, -town.stock().food, 0});
    float calm = town.people()[0].stress;
    town.advance(day * 1.5);
    const auto& hungry = town.people()[0];
    CHECK(hungry.food < .3f);
    CHECK(hungry.stress > calm);
    auto thoughts = town.thoughts(hungry);
    CHECK(std::find(thoughts.begin(), thoughts.end(), "Hungry") != thoughts.end() || std::find(thoughts.begin(), thoughts.end(), "Starving") != thoughts.end());
    // With food in store they go and eat at the camp.
    town.reward({0, 0, 0, 20, 0});
    town.advance(day * .5);
    for (const auto& person : town.people()) CHECK(person.food > .5f);
    CHECK(town.stock().food < 20);
}

TEST(game_a_guild_opens_the_dungeon_and_draws_guests_who_may_settle)
{
    Town town(seed);
    found(town);
    const auto& site = town.map().dungeons()[0];
    Point lair{site.origin.x + 1.f, site.origin.y + 1.f}, camp = town.map().camp();
    auto toward = normalized(lair - camp);
    Point end = lair - toward * 4.5f;
    CHECK(town.buildRoad(straight(camp + toward * 1.2f, end)));
    auto spot = town.fit(Structure::Guild, end - toward * 1.4f + Point{-toward.y, toward.x} * 1.4f, 0);
    CHECK(town.place(Structure::Guild, spot.center, spot.angle));
    town.completeConstruction();
    CHECK(town.opened(0));
    bool arrived = false, delved = false;
    for (int step = 0; step < 40 && !(arrived && delved); ++step) {
        town.advance(day * .1);
        for (const auto& person : town.people()) {
            arrived |= person.role == Role::Guest;
            delved |= person.activity == Activity::Exploring;
        }
    }
    CHECK(arrived);
    CHECK(delved);
    CHECK(town.guests() <= town.guestBeds() + 2);
    int guest = -1;
    for (const auto& person : town.people())
        if (person.role == Role::Guest) guest = person.id;
    CHECK(guest >= 0);
    bool room = town.population() < town.housing();
    CHECK_EQ(town.settle(guest), room);  // Settling needs a free home.
    if (room) CHECK(town.person(guest)->role == Role::Resident);
}

TEST(game_guests_pay_a_toll_and_travellers_who_settle_become_settlers)
{
    Street street;
    auto& town = street.town;
    CHECK(street.build(Structure::Hostel, 0));
    CHECK(street.build(Structure::Tent, 3));
    int before = town.gold(), arrivals = 0;
    for (int step = 0; step < 40 && !arrivals; ++step) {
        town.advance(day * .1);
        arrivals = town.guests();
    }
    CHECK(arrivals > 0);
    CHECK(town.ledger().guests + town.gold() > before);  // The gate toll at least.
    town.recruit(Role::Guest, Calling::Traveller, 1);
    int traveller = town.people().back().id, purse = town.person(traveller)->purse;
    int gold = town.gold();
    CHECK(town.settle(traveller));
    CHECK(town.person(traveller)->calling == Calling::Settler);
    CHECK_EQ(town.gold(), gold + std::min(purse, 10));  // A settling fee out of what they brought.
}

TEST(game_a_portal_brings_guests_of_every_people_through_it)
{
    Street street;
    auto& town = street.town;
    town.reward({200, 200, 200, 200, 100, 200});
    town.recruit(Role::Resident, Calling::Settler, 6);
    CHECK(street.build(Structure::Hostel, 0));
    auto spot = street.south(1, Structure::Portal);
    CHECK(town.place(Structure::Portal, spot.center, spot.angle));
    town.completeConstruction();
    bool through = false;
    for (int step = 0; step < 60 && !through; ++step) {
        town.advance(day * .1);
        for (auto notice = town.takeNotice(); !notice.empty(); notice = town.takeNotice()) through |= notice.find("through the portal") != std::string::npos;
    }
    CHECK(through);
}

TEST(game_people_walk_faster_all_along_a_road)
{
    Street street;
    auto& town = street.town;
    town.completeConstruction();
    town.advance(.1);
    // Mid-way along the straight, not only at its ends.
    for (float x = 1.5f; x < 6.5f; x += .5f) CHECK(town.walking().speedAt(street.at(x, 0)) > 2);
    CHECK(town.walking().speedAt(street.at(4, 4)) < 1.5f);
}

TEST(game_wandering_monsters_wreck_buildings_and_roads_and_builders_mend_them)
{
    Street street;
    auto& town = street.town;
    CHECK(street.build(Structure::Tent, 2));
    int tent = town.buildingAt(street.lot(2).center);
    // Everyone away down the road, out of the monster's reach.
    std::vector<int> all;
    for (const auto& p : town.people()) all.push_back(p.id);
    town.orderMove(all, town.walking().nearestWalkable(street.camp + Point{-12, 12}));
    town.advance(20);
    town.releaseMonster(town.building(tent)->door());
    bool damaged = false, torn = false;
    for (int step = 0; step < 60 && !(damaged && torn); ++step) {
        town.advance(.5);
        damaged |= !town.building(tent) || town.building(tent)->health < 1;
        for (const auto& road : town.roads().roads()) torn |= road.wear > 0;
    }
    CHECK(damaged);
    CHECK(torn);
    // Once the monster is dealt with, builders put things right.
    for (int step = 0; step < 40 && !town.monsters().empty(); ++step) {
        if (int beast = town.monsterAt(town.monsters().front().position, 1); beast >= 0) town.orderAttack(all, beast);
        town.advance(day * .05);
    }
    CHECK(town.monsters().empty());
    town.advance(day * 1.5);
    if (town.building(tent)) CHECK_EQ(town.building(tent)->health, 1.f);
    for (const auto& road : town.roads().roads()) CHECK_EQ(road.wear, 0.f);
}

TEST(game_raiders_fight_on_past_dawn_and_tear_down_what_they_reach)
{
    Street street;
    auto& town = street.town;
    CHECK(street.build(Structure::Tent, 4));
    town.advance(day * (1.95 - town.dayFraction()));
    // A pack too big for settlers without guards: they bar the doors and the raiders have the streets.
    for (int i = 0; i < 3; ++i) town.summonRaid();
    int buildings = int(town.buildings().size());
    town.advance(day * .4);  // Well past dawn.
    CHECK(town.raiding());   // Still here.
    bool hurt = int(town.buildings().size()) < buildings;
    for (const auto& b : town.buildings()) hurt |= b.health < 1 || !b.built();
    CHECK(hurt);
}

TEST(game_weather_snow_lies_only_where_it_fell_and_seasons_blend)
{
    constexpr double seconds = Town::secondsPerDay;
    Sky winter(3);
    winter.force(Weather::Snow, 1);
    for (int i = 0; i < int(seconds * 10); ++i) winter.advance(.1, seconds, .85f, .5f);  // A day.
    CHECK(winter.now().snow > .4f);
    CHECK(winter.now().temperature < 1);
    Sky thaw = winter;
    thaw.force(Weather::Clear, 0);
    for (int i = 0; i < int(seconds * 40); ++i) thaw.advance(.1, seconds, .3f, .5f);  // Four days.
    CHECK_EQ(thaw.now().snow, 0.f);
    // A clear sky in deep winter keeps no snow it never got.
    Sky dry(5);
    dry.force(Weather::Clear, 0);
    for (int i = 0; i < int(seconds * 3); ++i) dry.advance(.1, seconds, .85f, .5f);
    CHECK_EQ(dry.now().snow, 0.f);
    // Autumn colours arrive over weeks, never in one jump.
    float previous = 0, peak = 0;
    for (float year = .3f; year <= .95f; year += .01f) {
        Sky sky(1);
        sky.advance(.1, seconds, year, .5f);
        CHECK(std::abs(sky.now().autumn - previous) < .2f);
        previous = sky.now().autumn;
        peak = std::max(peak, previous);
    }
    CHECK(peak > .9f);
    Sky noon(1), midnight(1);
    noon.advance(.1, seconds, .3f, .5f);
    midnight.advance(.1, seconds, .3f, 0);
    CHECK_EQ(noon.now().night, 0.f);
    CHECK(midnight.now().night > .9f);
}

TEST(game_roads_are_laid_by_builders_then_paved_with_stone)
{
    Town town(seed);
    found(town);
    auto c = town.map().camp();
    CHECK(town.buildRoad(straight(c + Point{1, 0}, c + Point{6, 0})));
    const auto& road = town.roads().roads()[0];
    CHECK_EQ(road.built, 0.f);  // A plan until someone lays it.
    CHECK(town.roads().builtSegments().empty());
    CHECK_EQ(town.canPave(road.id).reason, std::string("Lay the road first"));
    float before = town.walking().speedAt(c + Point{3.5f, 0});
    town.advance(day * .4);
    CHECK_EQ(town.roads().roads()[0].built, 1.f);
    town.advance(1);
    float laid = town.walking().speedAt(c + Point{3.5f, 0});
    CHECK(laid > before);
    town.reward({0, 0, 50, 0, 0});
    CHECK(town.canPave(road.id).ok);
    CHECK(town.pave(road.id));
    town.advance(day * 1.2);
    CHECK(town.roads().roads()[0].paved);
    town.advance(1);
    CHECK(town.walking().speedAt(c + Point{3.5f, 0}) > laid);
    // Clearing a road gives the ground back: no road speed, and felled woods grow again.
    CHECK(town.demolish(c + Point{3.5f, 0}));
    town.advance(1);
    CHECK(town.walking().speedAt(c + Point{3.5f, 0}) < laid);
}

TEST(game_felled_woods_grow_back_where_nothing_stands)
{
    Town town(seed);
    found(town);
    const auto& map = town.map();
    auto stumps = [&] {
        int count = 0;
        for (int y = 0; y < map.height(); ++y)
            for (int x = 0; x < map.width(); ++x) count += map.at(x, y).wild - map.at(x, y).trees;
        return count;
    };
    // Cut a road into a wood within sight, then pull it up; the trees creep back over the days.
    auto camp = map.camp();
    bool cut = false;
    for (int y = 0; y < map.height() && !cut; ++y)
        for (int x = 0; x < map.width() && !cut; ++x) {
            Point patch{x + .5f, y + .5f};
            if (!map.at(x, y).trees || !map.revealed(patch) || distance(patch, camp) < 4) continue;
            int before = stumps();
            RoadPath path = straight(camp + normalized(patch - camp) * 1.2f, patch);
            if (!town.canBuildRoad(path).ok || !town.buildRoad(path)) continue;
            town.completeConstruction();
            cut = stumps() > before;
            if (!cut) continue;
            CHECK(town.demolish(patch - normalized(patch - camp) * .3f));
            CHECK(town.roads().roads().empty());
        }
    CHECK(cut);
    int felled = stumps();
    town.advance(day * 30);
    CHECK(stumps() < felled);
}

TEST(game_night_raids_meet_auto_defenders_and_resident_militia)
{
    Street street;
    auto& town = street.town;
    town.recruit(Role::Resident, Calling::Warrior, 2);
    // Into the night, then the monsters come.
    town.advance(day * (1.9 - town.dayFraction()));
    town.summonRaid();
    CHECK(town.raiding());
    int raiders = int(std::count_if(town.monsters().begin(), town.monsters().end(), [](const Monster& m) { return m.raider; }));
    CHECK(raiders >= 2);
    bool fought = false;
    for (int step = 0; step < 300 && town.raiding(); ++step) {
        town.advance(1);
        for (const auto& p : town.people()) fought |= p.activity == Activity::Fighting;
    }
    CHECK(fought);
    CHECK(!town.raiding());  // Raiders never turn back: every one was slain.
    int militia = 0;
    for (const auto& p : town.people()) militia += p.calling == Calling::Settler && p.activity != Activity::Leaving;
    CHECK(militia > 0);  // Ordinary residents turned out too, and lived.
}

TEST(game_monsters_come_every_night_from_the_first)
{
    Street street;
    auto& town = street.town;
    town.recruit(Role::Resident, Calling::Warrior, 3);
    town.advance(day * (.6 - town.dayFraction()));
    CHECK_EQ(town.raids(), 0);  // Not by day.
    town.advance(day * .35);
    CHECK_EQ(town.raids(), 1);  // The very first nightfall.
    for (int night = 2; night <= 4; ++night) {
        town.advance(day);
        CHECK_EQ(town.raids(), night);  // And every one after, without fail.
    }
    // However many packs are called, no more than the cap prowl at once.
    for (int i = 0; i < 12; ++i) town.summonRaid();
    int raiders = int(std::count_if(town.monsters().begin(), town.monsters().end(), [](const Monster& m) { return m.raider; }));
    CHECK(raiders > 0);
    CHECK(raiders <= Town::maxRaiders);
}

TEST(game_expeditions_delve_a_dungeon_and_come_back_changed)
{
    Street street;
    auto& town = street.town;
    town.recruit(Role::Resident, Calling::Warrior, 3);
    std::vector<int> party;
    for (const auto& p : town.people())
        if (p.calling == Calling::Warrior) party.push_back(p.id);
    CHECK_EQ(town.canSendExpedition({}, 0).reason, std::string("Select residents to send"));
    int gold = town.gold();
    CHECK(town.sendExpedition(party, 0));
    CHECK_EQ(town.expeditions().size(), size_t(1));
    bool inside = false;
    for (int step = 0; step < 400 && !town.expeditions().empty(); ++step) {
        town.advance(1);
        inside |= town.person(party[0]) && town.person(party[0])->inside;
    }
    CHECK(inside);
    CHECK(town.expeditions().empty());
    bool told = false;
    for (auto notice = town.takeNotice(); !notice.empty(); notice = town.takeNotice()) told |= notice.find("expedition") != std::string::npos;
    CHECK(told);
    CHECK(town.gold() != gold || town.person(party[0]) == nullptr || town.person(party[0])->health < 1);
}

TEST(game_lodgings_grow_by_their_takings_and_the_guild_by_its_rolls)
{
    // The hostel and the guild face each other across the street, clear of each other's doors.
    Street street;
    auto& town = street.town;
    town.reward({400, 400, 400, 400, 0});
    auto hostelSpot = street.lot(0, Structure::Hostel);
    CHECK(town.place(Structure::Hostel, hostelSpot.center, hostelSpot.angle));
    // The first lot along the street, across it or beside the hostel, within the guild's reach of the home dungeon.
    Placement guildSpot{};
    bool guildPlaced = false;
    for (int i = 0; i < 6 && !guildPlaced; ++i) {
        guildSpot = i < 2 ? street.lot(i + 2, Structure::Guild) : street.south(i - 2, Structure::Guild);
        guildPlaced = town.place(Structure::Guild, guildSpot.center, guildSpot.angle);
    }
    CHECK(guildPlaced);
    town.completeConstruction();
    CHECK(town.opened(0));  // The home dungeon lies within the guild's reach.
    int hostel = town.buildingAt(hostelSpot.center), guild = town.buildingAt(guildSpot.center);
    CHECK(hostel >= 0 && guild >= 0);
    if (hostel < 0 || guild < 0) return;
    CHECK(town.walking().walkable(town.building(hostel)->door()));
    CHECK_EQ(town.guestBeds(), 3);
    auto status = town.growthStatus(*town.building(hostel));
    CHECK(!status.ready);
    CHECK(status.reason.find("40 gold from guests") != std::string::npos);
    // Guests pay for beds and meals; adventurers sign the guild's rolls as they arrive.
    for (int step = 0; step < 30 && town.building(hostel) && town.building(hostel)->kind == Structure::Hostel; ++step) town.advance(day * .5);
    CHECK(town.building(hostel) && town.building(hostel)->kind == Structure::Inn);
    if (!town.building(hostel) || !town.building(guild)) return;
    CHECK_EQ(town.guestBeds(), 6);
    CHECK(town.building(guild)->registered > 0);
}

TEST(game_a_chapel_changes_faith_without_selecting_a_character_species)
{
    Street street;
    auto& town = street.town;
    town.reward({100, 100, 100, 0, 0});
    auto spot = town.fit(Structure::Chapel, street.at(3, 1.4f), 0);
    CHECK(town.place(Structure::Chapel, spot.center, spot.angle));
    town.completeConstruction();
    int id = town.buildingAt(spot.center);
    CHECK(town.building(id)->faith == Faith::Dawn);
    CHECK(town.setFaith(id, Faith::Forge));
    CHECK(town.building(id)->faith == Faith::Forge);
    CHECK_EQ(town.building(id)->version, uint32_t(1));  // The chapel is redressed in its new colours.
    town.recruit(Role::Resident, Calling::Settler, 40);
    CHECK(std::all_of(town.people().begin(),town.people().end(),[](const Person& p){return int(p.race)<raceCount;}));
    CHECK(std::count_if(town.people().begin(),town.people().end(),[](const Person& p){return p.race==Race::Human;})>20);
}

TEST(game_people_have_independent_human_or_god_species)
{
    Town town(seed);found(town);town.recruit(Role::Resident,Calling::Settler,120);
    bool seen[raceCount]={};
    for(const auto& p:town.people()){CHECK(int(p.race)<raceCount);seen[int(p.race)]=true;CHECK(!p.name.empty());}
    CHECK(seen[0]&&seen[1]);CHECK_EQ(raceName(Race::God),std::string("God"));
}

TEST(game_mountain_ranges_rise_from_ridges_and_block_the_way)
{
    auto map = WorldMap::generate(seed);
    int peaks = 0;
    Point peak{};
    for (int y = 0; y < map.height(); ++y)
        for (int x = 0; x < map.width(); ++x)
            if (map.at(x, y).terrain == Terrain::Mountain) {
                ++peaks;
                peak = {x + .5f, y + .5f};
            }
    CHECK(peaks > 100);  // Ranges, not single rocks.
    CHECK(isStone(map.terrainAt(peak)));
    WalkGrid grid;
    grid.rebuild(map, RoadNetwork{});
    CHECK(!grid.walkable(peak));
}

TEST(game_roads_bridge_rivers_and_lakes_but_not_the_sea)
{
    // A stream across the camp's south side, a short walk from it.
    MapDocument doc(WorldMap::generate(6));
    auto start = doc.map().camp();
    CHECK(doc.paintSegment({start.x - 4, start.y + 6}, {start.x + 10, start.y + 6}, 1.2f, Terrain::Water));
    Town town(doc.gameMap());
    found(town);
    town.reward({200, 200, 200, 0, 0});
    auto camp = town.map().camp();
    // Look around the camp for a short road that has to cross water.
    RoadPath bridge;
    for (int turn = 0; turn < 36 && bridge.empty(); ++turn)
        for (float reach = 4; reach < 20 && bridge.empty(); reach += 1) {
            auto toward = rotated({1, 0}, turn * .1745f);
            RoadPath path = straight(camp + toward * 1.3f, camp + toward * reach);
            auto check = town.canBuildRoad(path);
            if (check.ok && check.cost.wood > 0) bridge = path;
        }
    CHECK(!bridge.empty());
    auto cost = town.canBuildRoad(bridge).cost;
    CHECK(cost.wood > 0 && cost.stone > 0);  // Timber and stone for the span.
    CHECK(town.buildRoad(bridge));
    town.completeConstruction();
    town.advance(.2);
    // Somewhere along it the water is now walkable.
    const auto& road = town.roads().roads().back();
    bool crossed = false;
    for (float s = 0; s <= 1; s += .02f) {
        auto p = road.along(s);
        if (town.map().terrainAt(p) == Terrain::Water) crossed |= town.walking().walkable(p);
    }
    CHECK(crossed);
    // A road may not end in the water.
    for (float s = .1f; s < 1; s += .05f) {
        auto p = road.along(s);
        if (town.map().terrainAt(p) != Terrain::Water) continue;
        CHECK_EQ(town.canBuildRoad(straight(road.along(0), p)).reason, std::string("A bridge needs dry banks"));
        break;
    }
}

TEST(game_residents_earn_wages_pay_rent_and_may_buy_their_homes)
{
    Street street;
    auto& town = street.town;
    CHECK(street.build(Structure::Tent, 0));
    CHECK(street.build(Structure::Farm, 2));
    town.reward({0, 0, 0, 200, 0});
    const auto& tent = *town.building(town.buildingAt(street.lot(0).center));
    for (int i = 0; i < structureSpec(Structure::Tent).residents; ++i)
        const_cast<Person&>(town.people()[size_t(i)]).home = tent.id;
    int purse = 0;
    for (const auto& p : town.people()) purse += p.purse;
    int gold = town.gold();
    town.advance(day * 1.2);
    // Farm hands drew wages from the treasury; tent dwellers paid their rent; the first night's
    // raiders fetched their bounty.
    CHECK(town.ledger().wages > 0);
    CHECK(town.ledger().rent > 0);
    CHECK_EQ(town.gold() - gold, town.ledger().rent - town.ledger().wages + town.ledger().guests + town.ledger().sales + town.ledger().bounty);
    // A resident who has saved enough buys the tent, and its rent stops.
    for (const auto& p : town.people())
        if (p.home == tent.id) town.bestow(p.id, 100);
    town.advance(day);
    const auto* bought = town.building(town.buildingAt(street.lot(0).center));
    CHECK(bought->owner >= 0);
    CHECK_EQ(town.ledger().sales, priceOf(Structure::Tent));
    town.advance(day);
    CHECK_EQ(town.ledger().sales, 0);
    (void)purse;
}

TEST(game_guests_come_only_to_a_lodging_or_an_open_dungeon)
{
    Street street;
    auto& town = street.town;
    town.advance(day * 6);
    CHECK_EQ(town.guests(), 0);  // Nowhere to stay, nothing to delve.
    auto spot = town.fit(Structure::Hostel, street.at(3, 1.4f), 0);
    CHECK(town.place(Structure::Hostel, spot.center, spot.angle));
    town.completeConstruction();
    bool came = false;
    for (int step = 0; step < 12 && !came; ++step) {
        town.advance(day * .5);
        came = town.guests() > 0;
    }
    CHECK(came);
    for (const auto& p : town.people())
        if (p.role == Role::Guest) CHECK(p.purse >= 0);
}

TEST(game_a_tavern_draws_a_bard_and_the_music_plays_while_they_stay)
{
    Street street;
    auto& town = street.town;
    auto bard = [&]() -> const Person* {
        for (const auto& p : town.people())
            if (p.calling == Calling::Bard) return &p;
        return nullptr;
    };
    town.advance(day * .5);
    CHECK(!bard());  // No tavern, no songs.
    CHECK(!town.bardPlaying());
    CHECK(street.build(Structure::Tavern, 0));
    for (int step = 0; step < 20 && !bard(); ++step) town.advance(day * .05);
    CHECK(bard() != nullptr);
    if (!bard()) return;
    // A guest who needs no bed for hire, signs no guild's rolls and keeps out of fights.
    CHECK(bard()->role == Role::Guest);
    CHECK(!adventurer(*bard()));
    CHECK(town.bardPlaying());
    CHECK_EQ(callingName(Calling::Bard), std::string("Bard"));
    town.advance(day * 2);
    int bards = int(std::count_if(town.people().begin(), town.people().end(), [](const Person& p) { return p.calling == Calling::Bard; }));
    CHECK_EQ(bards, 1);  // One is enough for a tavern.
    // The window hears it: music only while a bard is in town.
    GameApp game(seed);
    CHECK_EQ(game.ambience().music, 0.f);
    game.state().recruit(Role::Guest, Calling::Bard, 1);
    CHECK_EQ(game.ambience().music, 1.f);
}

TEST(game_people_keep_to_the_roads)
{
    Street street;
    auto& town = street.town;
    town.completeConstruction();
    town.advance(.2);
    // From one end of the street to the other, starting and ending just off it.
    auto path = town.walking().path(street.at(1.2f, .7f), street.at(6.8f, .7f));
    CHECK(path.size() >= 2);
    float worst = 0;
    for (size_t i = 1; i + 1 < path.size(); ++i) worst = std::max(worst, town.roads().distance(path[i]));
    CHECK(worst < .8f);  // The middle of the walk is on the road.
    // A diagonal walk that would cut a corner past the road's end still follows it while beside it.
    for (size_t i = 1; i < path.size(); ++i)
        for (float t = 0; t <= 1; t += .1f) CHECK(town.walking().walkable(lerp(path[i - 1], path[i], t)));
}

TEST(game_units_obey_move_orders_immediately_and_accept_new_attack_targets)
{
    Street street;
    auto& town = street.town;
    town.recruit(Role::Resident, Calling::Warrior, 1);
    int warrior = town.people().back().id;
    town.advance(day * (1.9 - town.dayFraction()));
    town.summonRaid();
    // A direct move takes priority over the fight already in progress.
    for (int step = 0; step < 200 && town.person(warrior) && town.person(warrior)->activity != Activity::Fighting; ++step) town.advance(.5);
    if (town.person(warrior) && town.raiding()) {
        Point away = town.walking().nearestWalkable(town.map().camp() + Point{-6, -6});
        town.orderMove({warrior}, away);
        town.advance(1);
        CHECK(town.person(warrior)->activity == Activity::Moving);
        // Now send them at one particular raider.
        int target = -1;
        for (const auto& m : town.monsters())
            if (m.raider) target = m.id;
        if (target >= 0) {
            CHECK(town.orderAttack({warrior}, target));
            CHECK_EQ(town.person(warrior)->foe, target);
            town.advance(.5);
            CHECK(town.person(warrior)->activity == Activity::Fighting);
        }
    }
    CHECK_EQ(town.monsterAt({-100, -100}, 1), -1);
}

TEST(game_units_build_what_is_picked_from_their_command_card)
{
    te::test::Graphics runtime;
    GameApp game(seed);
    auto& town = game.state();
    found(town);
    town.reward({200, 200, 200, 200, 0});
    auto c = town.map().camp();
    CHECK(town.buildRoad(straight(c + Point{1, 0}, c + Point{7, 0})));
    town.completeConstruction();
    int builder = town.people()[0].id;
    game.selectPeople({builder});
    auto focus = project(c.x, c.y);
    game.view() = {focus.x, focus.y, 1.4f};  // Over the camp, its ground clear of the command card.
    float width = 1280, height = 800;
    double clock = 0;
    auto frame = [&] { game.render(width, height, clock += .05); };
    auto click = [&](Point p) {
        game.pointerDown(p.x, p.y, PointerButton::Primary);
        game.pointerUp(p.x, p.y, PointerButton::Primary);
        frame(); game.render(width, height, clock += .25);
    };
    frame();
    auto button = [&](const char* label) {
        auto matches = test::textBounds(game.hudScene(), label); CHECK(!matches.empty());
        if (matches.empty()) return;
        auto r = *std::min_element(matches.begin(), matches.end(), [](auto a, auto b) { return a.y < b.y; });
        click({r.x + r.w / 2, r.y + r.h / 2});
    };
    button("Build"); button("Housing"); button("Tent");
    auto spot = town.fit(Structure::Tent, c + Point{3.5f, -1}, 0);
    auto screen = game.view().toScreen(project(spot.center.x, spot.center.y), width, height);
    click(screen);
    int site = town.buildingAt(spot.center);
    CHECK(site >= 0);
    CHECK(!town.building(site)->built());
    const auto* person = town.person(builder);
    CHECK(person->activity == Activity::Building);
    CHECK_EQ(person->target, site);
    // Roads work the same way through orders.
    CHECK(town.buildRoad(straight(c + Point{1, 0}, c + Point{1, -4})));
    CHECK(town.orderRoadwork({builder}, town.roads().roads().back().id));
    CHECK(town.person(builder)->activity == Activity::Roadwork);
}

TEST(game_clear_on_the_command_card_demolishes_what_is_clicked)
{
    te::test::Graphics runtime;
    GameApp game(seed);
    auto& town = game.state();
    found(town);
    town.reward({200, 200, 200, 200, 0});
    auto c = town.map().camp();
    CHECK(town.buildRoad(straight(c + Point{1, 0}, c + Point{7, 0})));
    town.completeConstruction();
    game.selectPeople({town.people()[0].id});
    float width = 1280, height = 800;
    double clock = 0;
    auto click = [&](Point p) {
        game.pointerDown(p.x, p.y, PointerButton::Primary);
        game.pointerUp(p.x, p.y, PointerButton::Primary);
        game.render(width, height, clock += .05);
    };
    auto focus = project(c.x, c.y);
    game.view() = {focus.x, focus.y, 1.4f};  // Over the camp, the road clear of the card.
    game.render(width, height, clock += .05);
    auto clear = test::textBounds(game.hudScene(), "Clear  X"); CHECK_EQ(clear.size(), size_t(1));
    if (clear.empty()) return;
    click({clear[0].x + clear[0].w / 2, clear[0].y + clear[0].h / 2});
    game.render(width, height, clock += .05);  // The hint line now describes demolition.
    click(game.view().toScreen(project(c.x + 4, c.y), width, height));
    CHECK(town.roads().roads().empty());
}

TEST(game_blows_are_recorded_with_their_damage_for_the_effects)
{
    Street street;
    auto& town = street.town;
    town.recruit(Role::Resident, Calling::Warrior, 2);
    town.advance(day * (1.9 - town.dayFraction()));
    town.summonRaid();
    bool struck = false, bitten = false;
    for (int step = 0; step < 400 && !(struck && bitten); ++step) {
        town.advance(.25);
        for (const auto& hit : town.hits()) {
            CHECK(hit.damage > 0);
            struck |= !hit.onPerson;
            bitten |= hit.onPerson;
        }
    }
    CHECK(struck);
    // Old blows fade from the record after a moment.
    town.advance(3);
    for (const auto& hit : town.hits()) CHECK(town.clock() - hit.at <= 2.1);
}

TEST(game_move_and_attack_move_orders_from_the_keyboard)
{
    te::test::Graphics runtime;
    GameApp game(seed);
    found(game.state());
    auto focus = project(game.state().map().camp().x, game.state().map().camp().y);
    game.view() = {focus.x, focus.y, 1.4f};  // Over the camp, its ground clear of the command card.
    float width = 1280, height = 800;
    game.render(width, height, 0);
    auto& town = game.state();
    std::vector<int> ids;
    for (const auto& p : town.people()) ids.push_back(p.id);
    game.selectPeople(ids);
    game.render(width, height, .05);
    auto goal = town.walking().nearestWalkable(town.map().camp() + Point{4, -2});
    auto at = game.view().toScreen(project(goal.x, goal.y), width, height);
    game.prepare(GameApp::Order::Move);
    CHECK(game.pendingOrder() == GameApp::Order::Move);
    game.pointerDown(at.x, at.y, PointerButton::Secondary);
    game.pointerUp(at.x, at.y, PointerButton::Secondary);
    CHECK(game.pendingOrder() == GameApp::Order::None);
    for (const auto& p : town.people()) {
        CHECK(p.activity == Activity::Moving);
        CHECK(!p.aggressive);
    }
    game.prepare(GameApp::Order::Attack);
    game.pointerDown(at.x, at.y, PointerButton::Secondary);
    game.pointerUp(at.x, at.y, PointerButton::Secondary);
    for (const auto& p : town.people()) CHECK(p.aggressive);
    // Without anyone selected there is nothing to order.
    game.selectPeople({});
    game.prepare(GameApp::Order::Move);
    CHECK(game.pendingOrder() == GameApp::Order::None);
}

TEST(game_snow_falls_only_in_winter_and_rain_mostly_in_summer)
{
    constexpr double seconds = Town::secondsPerDay;
    int snowOutside = 0, rainSummer = 0, rainSpring = 0;
    for (uint32_t s = 1; s <= 6; ++s) {
        Sky sky(s);
        for (float year = 0; year < 1; year += .002f) {
            sky.advance(seconds * .1, seconds, year, .5f);
            const auto& now = sky.now();
            bool wet = now.weather == Weather::Rain || now.weather == Weather::Storm;
            if (now.weather == Weather::Snow && year < .75f) ++snowOutside;
            if (wet && year >= .25f && year < .5f) ++rainSummer;
            if (wet && year < .25f) ++rainSpring;
        }
    }
    CHECK_EQ(snowOutside, 0);
    CHECK(rainSummer > rainSpring);
}

TEST(game_woodcutters_fell_real_trees_and_carry_the_logs_in)
{
    Town town(seed);
    found(town);
    town.reward({100, 0, 100, 200, 0, 200});  // Wood stays under the store's limit so the logs have room.
    const auto& map = town.map();
    // Find a stand of trees in sight, lay a road toward it and put a lumberyard beside the road.
    auto camp = map.camp();
    bool built = false;
    for (int y = 0; y < map.height() && !built; ++y)
        for (int x = 0; x < map.width() && !built; ++x) {
            Point wood{x + .5f, y + .5f};
            if (map.at(x, y).trees < 2 || !map.revealed(wood) || distance(wood, camp) < 4 || distance(wood, camp) > 9) continue;
            auto end = camp + normalized(wood - camp) * (distance(wood, camp) - 2.5f);
            if (!town.buildRoad(straight(camp + normalized(wood - camp) * 1.2f, end))) continue;
            auto spot = town.fit(Structure::Lumberyard, end + normalized(wood - camp) * .9f, 0);
            built = town.place(Structure::Lumberyard, spot.center, spot.angle);
        }
    CHECK(built);  // This landing has woods within reach.
    town.completeConstruction();
    int trees = 0;
    for (int y = 0; y < map.height(); ++y)
        for (int x = 0; x < map.width(); ++x) trees += map.at(x, y).trees;
    int wood = town.wood();
    bool felling = false;
    for (int step = 0; step < 160; ++step) {
        town.advance(1);
        for (const auto& p : town.people()) felling |= p.activity == Activity::Felling;
    }
    int after = 0;
    for (int y = 0; y < map.height(); ++y)
        for (int x = 0; x < map.width(); ++x) after += map.at(x, y).trees;
    CHECK(felling);
    CHECK(after < trees);        // Trees are really gone from the map.
    CHECK(town.wood() > wood);   // And their wood reached the store.
}

TEST(game_paths_go_around_buildings_not_through_them)
{
    Street street;
    auto& town = street.town;
    CHECK(street.build(Structure::Farm, 1));
    town.advance(.2);
    const auto& farm = *town.building(town.buildingAt(street.lot(1).center));
    // From behind the farm to in front of it: the walk must skirt the walls.
    Point behind = farm.center + rotated({0, -1.4f}, farm.angle), ahead = farm.center + rotated({0, 1.4f}, farm.angle);
    auto path = town.walking().path(town.walking().nearestWalkable(behind), ahead);
    CHECK(path.size() >= 2);
    for (size_t i = 1; i < path.size(); ++i)
        for (float t = 0; t <= 1; t += .05f) CHECK(!farm.footprint().contains(lerp(path[i - 1], path[i], t), -.1f));
}


TEST(game_water_is_drunk_daily_and_stores_hold_only_so_much)
{
    Street street;
    auto& town = street.town;
    town.reward({0, 0, 0, 0, 0, -town.stock().water + 1});
    CHECK_EQ(town.capacity().wood, 120);
    town.advance(day * 1.2);
    CHECK(town.parched());  // Five water for a settlement that drinks more.
    auto thoughts = town.thoughts(town.people()[0]);
    CHECK(std::find(thoughts.begin(), thoughts.end(), "Thirsty") != thoughts.end());
    // A well draws water; a storehouse makes room.
    CHECK(street.build(Structure::Well, 0));
    town.advance(day * 2);
    CHECK(town.stock().water > 0);
    CHECK(!town.parched());
    auto spot = street.south(0, Structure::Storehouse);
    CHECK(town.place(Structure::Storehouse, spot.center, spot.angle));
    town.completeConstruction();
    CHECK_EQ(town.capacity().wood, 120 + structureSpec(Structure::Storehouse).storage);
}

TEST(game_ash_spreads_where_it_is_hot_and_dry)
{
    int ash = 0, trees = 0;
    for (uint32_t island : {seed, 6u, 9u}) {
        auto map = WorldMap::generate(island);
        for (int y = 0; y < map.height(); ++y)
            for (int x = 0; x < map.width(); ++x)
                if (map.at(x, y).terrain == Terrain::Ash) {
                    ++ash;
                    trees += map.at(x, y).trees;
                    CHECK(map.value(Layer::Heat, {x + .5f, y + .5f}) > .62f);
                }
    }
    CHECK(ash > 50);         // Real stretches of ash across these islands.
    CHECK(trees * 5 < ash);  // Nothing grows there but a dead snag here and there.
}

TEST(game_a_builder_sent_at_night_works_through_it_instead_of_going_to_bed)
{
    Street street;
    auto& town = street.town;
    town.advance(day * (2.02 - town.dayFraction()));  // Past midnight, supper long gone.
    town.reward({200, 200, 200, 200, 0, 200});
    auto spot = street.south(0, Structure::Tavern);
    CHECK(town.place(Structure::Tavern, spot.center, spot.angle));
    int site = town.buildingAt(spot.center);
    int builder = town.people().front().id;
    auto& hungry = const_cast<Person&>(*town.person(builder)); hungry.food = .1f; hungry.rest = .8f; hungry.stress = 0;
    CHECK(town.orderBuild({builder}, site));
    bool ate = false;
    for (int step = 0; step < 480 && !town.building(site)->built(); ++step) {
        town.advance(.25);
        const auto* p = town.person(builder);
        ate |= p->activity == Activity::Eating;
        // A meal when hungry, but no bed while the work stands unfinished and they have strength.
        if (!town.building(site)->built()) CHECK(p->activity != Activity::Sleeping || p->rest < .1f);
    }
    CHECK(town.building(site)->built());
    CHECK(ate);
}

TEST(game_builders_sent_at_night_keep_working_until_done)
{
    Street street;
    auto& town = street.town;
    town.advance(day * (1.9 - town.dayFraction()));  // Late evening.
    auto spot = street.lot(0);
    CHECK(town.place(Structure::Tent, spot.center, spot.angle));
    int site = town.buildingAt(spot.center);
    std::vector<int> crew;
    for (const auto& p : town.people()) crew.push_back(p.id);
    CHECK(town.orderBuild(crew, site));
    town.advance(day * .15);  // Still night.
    CHECK(town.dayFraction() > .85f || town.dayFraction() < .2f);
    CHECK(town.building(site)->progress > 0);
}

TEST(game_more_workers_with_nobody_idle_borrows_from_the_busiest_workplace)
{
    Street street;
    auto& town = street.town;
    int lot = 0;
    for (; lot < 6 && town.idle() > 0; ++lot) CHECK(street.build(Structure::Farm, lot));
    CHECK_EQ(town.idle(), 0);
    CHECK(street.build(Structure::Well, lot));
    int well = town.buildingAt(street.lot(lot).center);
    CHECK_EQ(town.building(well)->workers, 0);
    int employed = town.employed();
    CHECK(town.setWorkers(well, 1));
    CHECK_EQ(town.building(well)->workers, 1);
    CHECK_EQ(town.employed(), employed);  // Moved, not hired.
    bool told = false;
    for (auto notice = town.takeNotice(); !notice.empty(); notice = town.takeNotice()) told |= notice.find("moves from the Farmhouse to the Well") != std::string::npos;
    CHECK(told);
}

TEST(game_slain_monsters_pay_a_bounty)
{
    Street street;
    auto& town = street.town;
    town.releaseMonster(street.at(3, 2));
    std::vector<int> all;
    for (const auto& p : town.people()) all.push_back(p.id);
    bool paid = false;
    for (int step = 0; step < 60 && !paid; ++step) {
        if (!town.monsters().empty()) town.orderAttack(all, town.monsters().front().id);
        town.advance(1);
        for (auto notice = town.takeNotice(); !notice.empty(); notice = town.takeNotice()) paid |= notice.find("A monster is slain (+") != std::string::npos;
    }
    CHECK(paid);
    CHECK(town.monsters().empty());
}

TEST(game_the_forecast_adds_up_wages_rent_and_what_is_made_and_eaten)
{
    Street street;
    auto& town = street.town;
    CHECK(street.build(Structure::Well, 0));
    auto plan = town.forecast();
    int wages = 0, rent = 0;
    for (const auto& p : town.people()) {
        if (p.role != Role::Resident) continue;
        if (p.job >= 0) wages += town.wageOf(p);
        if (const auto* home = town.building(p.home); home && home->owner < 0) rent += rentOf(home->kind);
    }
    CHECK_EQ(plan.wages, wages);
    CHECK_EQ(plan.rent, rent);
    CHECK_EQ(plan.used.water, int(town.people().size()));
    CHECK(plan.made.water > 0);
    CHECK_EQ(plan.net(), plan.rent + plan.guests + plan.bounty + plan.made.gold - plan.wages);
    town.advance(day * 1.05);
    CHECK(town.ledger().drunk > 0);
}

TEST(game_each_person_keeps_one_asset_look_independently_of_species)
{
    auto someone=[](Race race,uint32_t seed){return Person{1,"Rowan",Role::Resident,Calling::Settler,race,seed,{}, {}};};
    std::vector<bool> styles(hairAssetCount),skins(256);int styleCount=0,skinCount=0;
    for(uint32_t seed=0;seed<200;++seed){
        auto human=appearanceOf(someone(Race::Human,seed*7919u));auto god=appearanceOf(someone(Race::God,seed*7919u));
        CHECK_EQ(human.hairAsset,god.hairAsset);CHECK_EQ(human.faceAsset,god.faceAsset);CHECK_EQ(human.skin.r,god.skin.r);
        if(!styles[human.hairAsset]){styles[human.hairAsset]=true;++styleCount;}
        if(!skins[human.skin.r]){skins[human.skin.r]=true;++skinCount;}
    }
    CHECK(styleCount>=15);CHECK(skinCount>=4);
}

TEST(game_a_face_shows_how_its_owner_is_doing)
{
    Person p{1, "", Role::Resident, Calling::Settler, Race::Human, 7, {}, {}};
    p.food = .8f, p.rest = .9f, p.stress = .1f;
    CHECK(moodOf(p) == Mood::Cheerful);
    p.stress = .4f;
    CHECK(moodOf(p) == Mood::Content);
    p.rest = .2f;
    CHECK(moodOf(p) == Mood::Tired);
    p.rest = .05f;
    CHECK(moodOf(p) == Mood::Exhausted);
    p.rest = .9f, p.food = .1f;
    CHECK(moodOf(p) == Mood::Hungry);
    p.food = .8f, p.stress = .8f;
    CHECK(moodOf(p) == Mood::Stressed);
    p.health = .2f;
    CHECK(moodOf(p) == Mood::Hurt);
    p.activity = Activity::Fighting;
    CHECK(moodOf(p) == Mood::Fierce);
    p.activity = Activity::Sleeping;
    CHECK(moodOf(p) == Mood::Asleep);
    // Every mood draws, on every people and calling.
    for (int m = 0; m <= int(Mood::Fierce); ++m)
        for (int kind = 0; kind < raceCount * 7; ++kind) {
            Person q{kind, "", Role::Resident, Calling(kind % 7), Race(kind / 7), uint32_t(kind) * 7919u, {}, {}};
            auto face = personPortrait(q, Mood(m), 120, 126);
            CHECK(face != nullptr);
            tvg::Paint::rel(face);
        }
}

TEST(game_people_can_cross_rocky_ground_slowly_but_not_mountains)
{
    Town town(seed);
    found(town);
    town.advance(.1);
    const auto& map = town.map();
    int rock = 0, mountain = 0;
    for (int y = 0; y < map.height(); ++y)
        for (int x = 0; x < map.width(); ++x) {
            Point middle{x + .5f, y + .5f};
            if (map.at(x, y).terrain == Terrain::Rock && rock < 20) {
                ++rock;
                CHECK(town.walking().walkable(middle));
                CHECK(town.walking().speedAt(middle) < 1);
            }
            if (map.at(x, y).terrain == Terrain::Mountain && mountain < 20) {
                ++mountain;
                CHECK(!town.walking().walkable(middle));
            }
        }
    CHECK(rock > 0);
}

TEST(game_the_score_suits_the_hour_moves_on_and_cuts_to_drums_in_a_raid)
{
    constexpr int rate = 8000;
    auto listen = [&](Score& score, MusicMood mood, double seconds, float& peak) {
        double energy = 0;
        for (int i = 0; i < int(rate * seconds); ++i) {
            float left = 0, right = 0;
            score.render(left, right, mood);
            peak = std::max({peak, std::abs(left), std::abs(right)});
            energy += double(left) * left;
        }
        return energy / (rate * seconds);
    };
    Score day(rate);
    float peak = 0;
    CHECK(listen(day, {0, 0, 0, 0}, 20, peak) > 1e-6);  // Audible...
    CHECK(peak < .9f);                                   // ...and never clipping.
    CHECK(!Score::warlike(day.piece()));
    int first = day.piece();
    // Pieces end and another follows, never the same one twice running.
    bool changed = false;
    for (int minute = 0; minute < 6 && !changed; ++minute) {
        listen(day, {0, 0, 0, 0}, 60, peak);
        changed = day.piece() != first;
    }
    CHECK(changed);
    // A raid brings the drums within a second or two, and they go when it ends.
    listen(day, {0, 0, 0, 1}, 3, peak);
    CHECK(Score::warlike(day.piece()));
    listen(day, {0, 0, 0, 0}, 6, peak);
    CHECK(!Score::warlike(day.piece()));
    CHECK(peak < .9f);
    Score night(rate);
    listen(night, {1, 0, 0, 0}, .1, peak);
    std::string name = Score::pieceName(night.piece());
    CHECK(name == "Nocturne" || name == "Moonlit Watch" || name == "Evening Bells");
}
