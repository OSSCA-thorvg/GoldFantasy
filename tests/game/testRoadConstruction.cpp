#include <test/test.h>
#include <game/map_document.h>
#include <game/town.h>

namespace
{
using namespace hearthold;
struct RoadSite
{
    static WorldMap map()
    {
        MapDocument document(WorldMap::generate(5, 64, 64));
        document.beginStroke(); document.paint(document.map().camp(), 14, Terrain::Grass); document.endStroke();
        auto map = document.gameMap();
        for (int y = 0; y < map.height(); ++y)
            for (int x = 0; x < map.width(); ++x) map.at(x, y).trees = map.at(x, y).wild = 0;
        return map;
    }
    Town town{map()};
    Point camp = town.map().camp();
    int worker = town.people().front().id;
    RoadSite()
    {
        town.scout(camp.x, camp.y, 15);
        CHECK(town.place(Structure::Camp, camp, 0)); town.completeConstruction(); town.advance(.01);
        for (const auto& person : town.people()) {
            auto& p = const_cast<Person&>(person);
            p.activity = Activity::Holding; p.until = town.clock() + 1000; p.path.clear(); p.food = p.rest = 1;
        }
    }
    Point at(float x, float y = 0) const { return camp + Point{x, y}; }
    int plan(Point a, Point b)
    {
        CHECK(town.buildRoad({RoadAnchor::sharp(a), RoadAnchor::sharp(b)}));
        return town.roads().roads().back().id;
    }
    void step(double seconds)
    {
        const_cast<std::vector<Monster>&>(town.monsters()).clear(); town.advance(seconds);
    }
};
}

TEST(game_road_extension_builds_its_unfinished_connection_before_the_remote_branch)
{
    RoadSite site;
    int trunk = site.plan(site.at(1.2f), site.at(8));
    int branch = site.plan(site.at(8), site.at(8, 6));
    CHECK(site.town.editPerson(site.worker, site.at(8, 5), 1));
    CHECK(site.town.orderRoadwork({site.worker}, branch));
    CHECK_EQ(site.town.person(site.worker)->target, trunk);
    bool extended = false;
    for (int i = 0; i < 800; ++i) {
        site.step(.1);
        const auto* parent = site.town.roads().road(trunk);
        const auto* child = site.town.roads().road(branch);
        if (child->built > 0) { CHECK(parent->built >= .98f); extended = true; break; }
    }
    CHECK(extended);
}

TEST(game_road_drawn_toward_camp_starts_construction_at_the_connected_end)
{
    RoadSite site;
    int id = site.plan(site.at(8), site.at(1.2f));
    CHECK(site.town.orderRoadwork({site.worker}, id));
    const auto& worker = *site.town.person(site.worker);
    CHECK(!worker.path.empty());
    if (!worker.path.empty()) CHECK(distance(worker.path.back(), site.at(1.2f)) < .2f);
    for (int i = 0; i < 200 && site.town.roads().road(id)->built == 0; ++i) site.step(.1);
    auto laid = site.town.roads().builtSegments();
    CHECK(!laid.empty());
    bool touchesCamp = false;
    for (const auto& segment : laid) touchesCamp |= distance(segment.a, site.camp) < 1.6f || distance(segment.b, site.camp) < 1.6f;
    CHECK(touchesCamp);
}

TEST(game_road_crossing_a_plan_begins_at_the_intersection_after_it_is_reached)
{
    RoadSite site;
    int trunk = site.plan(site.at(1.2f), site.at(8));
    int branch = site.plan(site.at(4, -4), site.at(4, 4));
    CHECK(site.town.orderRoadwork({site.worker}, branch));
    bool extended = false;
    for (int i = 0; i < 800; ++i) {
        site.step(.1);
        if (site.town.roads().road(branch)->built <= 0) continue;
        CHECK(site.town.roads().road(trunk)->built >= .38f);
        bool touchesJunction = false;
        for (const auto& segment : site.town.roads().builtSegments())
            if (segment.road == branch) touchesJunction |= segmentDistance(site.at(4), segment.a, segment.b) < .25f;
        CHECK(touchesJunction); extended = true; break;
    }
    CHECK(extended);
}

TEST(game_road_workers_walk_back_to_the_junction_and_do_not_teleport_at_completion)
{
    for (bool crossing : {false, true}) {
        RoadSite site;
        site.plan(site.at(1.2f), site.at(8)); site.town.completeConstruction();
        int id = crossing ? site.plan(site.at(4, -3), site.at(4, 3)) : site.plan(site.at(8), site.at(12));
        site.town.setAuto(site.worker, false);
        CHECK(site.town.orderRoadwork({site.worker}, id));
        bool complete = false;
        for (int i = 0; i < 1400; ++i) {
            auto before = site.town.person(site.worker)->position;
            site.step(.1);
            CHECK(distance(before, site.town.person(site.worker)->position) < .35f);
            if (site.town.roads().road(id)->built >= 1) { complete = true; break; }
        }
        CHECK(complete);
    }
}

TEST(game_rotated_roads_at_the_camp_connection_boundary_match_placement_validation)
{
    for (int turn = 0; turn < 36; ++turn) {
        RoadSite site;
        auto direction = rotated({1, 0}, turn * .1745f);
        RoadPath path{RoadAnchor::sharp(site.camp + direction * 1.3f), RoadAnchor::sharp(site.camp + direction * 8)};
        if (!site.town.canBuildRoad(path).ok) continue;
        CHECK(site.town.buildRoad(path));
    }
}
