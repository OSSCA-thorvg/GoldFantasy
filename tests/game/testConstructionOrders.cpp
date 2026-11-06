#include "common/hud_text.h"
#include <test/test.h>
#include <test/graphics.h>
#include <game/game_app.h>
#include <game/map_document.h>
#include <game/town.h>
#include <game/tree_painter.h>

namespace
{
using namespace hearthold;
WorldMap clearing(Point tree = {-1, -1})
{
    MapDocument document(WorldMap::generate(5, 64, 64));
    document.beginStroke(); document.paint(document.map().camp(), 14, Terrain::Grass); document.endStroke();
    auto map = document.gameMap();
    for (int y = 0; y < map.height(); ++y)
        for (int x = 0; x < map.width(); ++x) map.at(x, y).trees = map.at(x, y).wild = 0;
    if (map.inside(int(tree.x), int(tree.y))) map.at(int(tree.x), int(tree.y)).trees = 1;
    return map;
}

// A built camp, a road only planned east from it, and a tent placed at the plan's far end.
struct RoadEnd
{
    Town town{clearing()};
    Point camp = town.map().camp();
    int worker = town.people().front().id, road = -1, site = -1;
    RoadEnd()
    {
        town.scout(camp.x, camp.y, 16);
        CHECK(town.place(Structure::Camp, camp, 0)); town.completeConstruction(); town.advance(.01);
        for (const auto& p : town.people()) town.orderStop({p.id});
        for (const auto& p : town.people()) {
            auto& person = const_cast<Person&>(p); person.food = person.rest = person.health = 1; person.stress = 0;
        }
        RoadPath plan{RoadAnchor::sharp(camp + Point{1.2f, 0}), RoadAnchor::sharp(camp + Point{9, 0})};
        CHECK_EQ(town.canBuildRoad(plan).reason, std::string()); CHECK(town.buildRoad(plan));
        road = town.roads().roads().back().id;
        auto spot = town.fit(Structure::Tent, camp + Point{8, -1.5f}, 0);
        CHECK_EQ(town.canPlace(Structure::Tent, spot.center, spot.angle).reason, std::string());
        CHECK(town.place(Structure::Tent, spot.center, spot.angle));
        site = town.buildingAt(spot.center);
    }
    // The laid part of the road has come up to the site.
    bool reached() const
    {
        auto footprint = town.building(site)->footprint();
        auto laid = town.roads().road(road)->laidLine();
        return std::any_of(laid.begin(), laid.end(), [&](Point p) { return footprint.contains(p, Town::roadHalfWidth + .7f); });
    }
    // Runs until the site is raised; whether anything went up before the road reached it.
    bool raisedBeforeTheRoad()
    {
        bool early = false;
        for (int i = 0; i < 1800 && !town.building(site)->built(); ++i) {
            const_cast<std::vector<Monster>&>(town.monsters()).clear(); town.advance(.1);
            early |= town.building(site)->progress > 0 && !reached();
        }
        return early;
    }
};

struct BuildScene
{
    GameApp game{5};
    Point camp, tree;
    int worker, other;
    double wall = 0;
    BuildScene()
    {
        auto map = clearing();
        camp = map.camp(); tree = camp + Point{3, 3};
        map.at(int(tree.x), int(tree.y)).trees = 1;
        game.state() = Town(std::move(map));
        auto& town = game.state(); town.scout(camp.x, camp.y, 14);
        CHECK(town.place(Structure::Camp, camp, 0)); town.completeConstruction();
        CHECK(town.buildRoad({RoadAnchor::sharp(camp + Point{1.2f, 0}), RoadAnchor::sharp(camp + Point{8, 0})}));
        town.completeConstruction(); town.advance(.01);
        worker = town.people()[0].id; other = town.people()[1].id;
        town.orderStop({worker, other});
        for (const auto& p : town.people()) {
            auto& person = const_cast<Person&>(p); person.food = person.rest = person.health = 1; person.stress = 0;
        }
        auto focus = project(camp.x, camp.y); game.view() = {focus.x, focus.y, 1};
        game.selectPeople({}); game.togglePause(); frame();
    }
    void frame(double seconds = -1) { wall = std::max(wall, seconds); game.render(1280, 800, wall); }
    Point screen(Point p) const { return const_cast<GameApp&>(game).view().toScreen(project(p.x, p.y), 1280, 800); }
    void click(Point p)
    {
        game.pointerDown(p.x, p.y, PointerButton::Primary); game.pointerUp(p.x, p.y, PointerButton::Primary); frame(); frame(wall + .25);
    }
    bool button(const char* label)
    {
        frame(wall + .3);
        auto found = test::textBounds(game.hudScene(), label); CHECK(!found.empty());
        if (found.empty()) return false;
        const auto& r = found.back(); click({r.x + r.w / 2, r.y + r.h / 2}); return true;
    }
    int buildTent()
    {
        game.pointerMove(640, 784); frame(); frame(wall + .3);
        if (!button("Housing") || !button("Tent")) return -1;
        auto spot = game.state().fit(Structure::Tent, camp + Point{4, -1.5f}, 0);
        click(screen(spot.center)); return game.state().buildingAt(spot.center);
    }
    int trees() { return game.state().map().at(int(tree.x), int(tree.y)).trees; }
};
}

TEST(game_ordered_builder_lays_the_sites_road_before_raising_it)
{
    RoadEnd scene;
    CHECK(scene.site >= 0); if (scene.site < 0) return;
    CHECK(!scene.reached());
    CHECK(scene.town.orderBuild({scene.worker}, scene.site));
    const auto& worker = *scene.town.person(scene.worker);
    CHECK(worker.activity == Activity::Roadwork); CHECK(worker.task == Activity::Building); CHECK_EQ(worker.taskSite, scene.site);
    CHECK(!scene.raisedBeforeTheRoad());
    CHECK(scene.reached()); CHECK(scene.town.building(scene.site)->built());
}

TEST(game_auto_builder_beside_an_unlaid_site_lays_its_road_first)
{
    RoadEnd scene;
    CHECK(scene.site >= 0); if (scene.site < 0) return;
    CHECK(scene.town.editPerson(scene.worker, scene.town.building(scene.site)->door(), 1));
    scene.town.setAuto(scene.worker, true);
    CHECK(!scene.raisedBeforeTheRoad());
    CHECK(scene.town.building(scene.site)->built());
}

TEST(game_taskbar_build_takes_a_resident_off_automatic_work_when_nobody_is_idle)
{
    te::test::Graphics graphics;
    BuildScene scene; auto& town = scene.game.state();
    auto worker = [&]() -> const Person& { return *town.person(scene.worker); };
    town.setAuto(scene.worker, true);
    bool felling = false;
    for (int i = 0; i < 100 && !felling; ++i) { town.advance(.1); felling = worker().activity == Activity::Felling && !worker().moving(); }
    CHECK(felling);
    town.orderMove({scene.other}, scene.camp + Point{7, 0});
    int site = scene.buildTent(); CHECK(site >= 0); if (site < 0) return;
    CHECK(worker().task == Activity::Building); CHECK_EQ(worker().taskSite, site);
    CHECK(town.person(scene.other)->task == Activity::Moving);  // A direct order under way is kept.
    bool backToTheTree = false;
    for (int i = 0; i < 150; ++i) { town.advance(.1); backToTheTree |= worker().activity == Activity::Felling; }
    CHECK(!backToTheTree); CHECK_EQ(scene.trees(), 1);
    CHECK(town.building(site)->progress > 0);
}

TEST(game_a_road_through_a_tree_is_laid_with_the_wood_store_full)
{
    // The user: now and then a road was never built. Clearing a tree out of its way needed room in the wood store,
    // so with the store full the road waited for good; the logs are left where the tree falls instead.
    auto camp = WorldMap::generate(5, 64, 64).camp();
    Town town{clearing(camp + Point{4, 0})};
    town.scout(camp.x, camp.y, 16);
    CHECK(town.place(Structure::Camp, camp, 0));
    town.completeConstruction();
    town.advance(.01);
    for (const auto& p : town.people()) {
        town.orderStop({p.id});
        auto& person = const_cast<Person&>(p); person.food = person.rest = person.health = 1; person.stress = 0;
    }
    int worker = town.people().front().id;
    auto foot = treePosition(town.map(), int(camp.x + 4), int(camp.y), 0);
    CHECK(town.buildRoad({RoadAnchor::sharp(camp + Point{1.2f, 0}), RoadAnchor::sharp(foot), RoadAnchor::sharp(camp + Point{8, 0})}));
    int road = town.roads().roads().back().id;
    auto& stock = const_cast<Resources&>(town.stock());
    stock.wood = town.capacity().wood;
    CHECK(town.orderRoadwork({worker}, road));
    for (int i = 0; i < 1500 && town.roads().road(road)->built < 1; ++i) {
        const_cast<std::vector<Monster>&>(town.monsters()).clear();
        town.advance(.1);
    }
    CHECK_EQ(town.roads().road(road)->built, 1.f);
    CHECK_EQ(town.map().at(int(camp.x + 4), int(camp.y)).trees, 0);
    CHECK_EQ(town.wood(), town.capacity().wood);
}

TEST(game_a_bridge_left_half_laid_is_taken_up_again)
{
    // A builder called away while the road's end hangs over the water must be able to walk back out to it.
    auto camp = WorldMap::generate(5, 64, 64).camp();
    auto map = clearing();
    for (int y = int(camp.y) - 4; y <= int(camp.y) + 4; ++y)
        for (int x = int(camp.x) + 4; x <= int(camp.x) + 5; ++x) map.at(x, y).terrain = Terrain::Water;
    Town town{std::move(map)};
    town.scout(camp.x, camp.y, 16);
    CHECK(town.place(Structure::Camp, camp, 0));
    town.completeConstruction();
    town.advance(.01);
    for (const auto& p : town.people()) {
        town.orderStop({p.id});
        auto& person = const_cast<Person&>(p); person.food = person.rest = person.health = 1; person.stress = 0;
    }
    auto& stock = const_cast<Resources&>(town.stock());
    stock.gold = stock.wood = stock.stone = 100;
    int worker = town.people().front().id;
    RoadPath plan{RoadAnchor::sharp(camp + Point{1.2f, .5f}), RoadAnchor::sharp(camp + Point{9, .5f})};
    CHECK_EQ(town.canBuildRoad(plan).reason, std::string());
    CHECK(town.buildRoad(plan));
    int road = town.roads().roads().back().id;
    CHECK(town.orderRoadwork({worker}, road));
    auto step = [&] { const_cast<std::vector<Monster>&>(town.monsters()).clear(); town.advance(.1); };
    auto front = [&] { auto f = town.roads().road(road)->workPoint(); return town.map().at(int(f.x), int(f.y)).terrain; };
    for (int i = 0; i < 1500 && town.roads().road(road)->built < .5f; ++i) step();
    CHECK(front() == Terrain::Water);
    for (int i = 0; i < 4; ++i) step();
    town.orderMove({worker}, camp + Point{0, 2.5f});
    for (int i = 0; i < 200 && town.person(worker)->task == Activity::Moving; ++i) step();
    CHECK(town.orderRoadwork({worker}, road));
    for (int i = 0; i < 1500 && town.roads().road(road)->built < 1; ++i) step();
    CHECK_EQ(town.roads().road(road)->built, 1.f);
}
