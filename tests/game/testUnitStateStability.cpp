#include <test/test.h>
#include <game/map_document.h>
#include <game/town.h>
#include <sstream>

namespace
{
using namespace hearthold;
struct WorkSite
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
    WorkSite()
    {
        town.scout(camp.x, camp.y, 16);
        CHECK(town.place(Structure::Camp, camp, 0)); town.completeConstruction();
        CHECK(town.buildRoad({RoadAnchor::sharp(camp + Point{1.2f, 0}), RoadAnchor::sharp(camp + Point{8, 0})}));
        town.completeConstruction(); town.advance(.01);
        for (const auto& p : town.people()) town.orderStop({p.id});
    }
    Person& person() { return const_cast<Person&>(*town.person(worker)); }
    int order(Activity activity, bool automatic = true)
    {
        town.setAuto(worker, automatic);
        person().food = person().rest = person().health = 1; person().stress = 0;
        if (activity == Activity::Roadwork) {
            CHECK(town.buildRoad({RoadAnchor::sharp(camp + Point{8, 0}), RoadAnchor::sharp(camp + Point{12, 0})}));
            int id = town.roads().roads().back().id;
            CHECK(town.editPerson(worker, *town.roadWorkPosition(id), 1));
            CHECK(town.orderRoadwork({worker}, id)); return id;
        }
        auto kind = activity == Activity::Working ? Structure::Well : Structure::Tent;
        auto spot = town.fit(kind, camp + Point{4, -1.4f}, 0);
        CHECK(town.place(kind, spot.center, spot.angle));
        int id = town.buildingAt(spot.center);
        if (activity == Activity::Working) town.completeConstruction();
        CHECK(town.editPerson(worker, town.building(id)->door(), 1));
        CHECK(activity == Activity::Working ? town.assignJob({worker}, id) : town.orderBuild({worker}, id));
        return id;
    }
    void step(double seconds = 1. / 60)
    {
        const_cast<std::vector<Monster>&>(town.monsters()).clear(); town.advance(seconds);
    }
    bool noRapidReturns(double seconds)
    {
        Activity previous = person().activity, beforePrevious = previous;
        double changedAt = town.clock(); int rapid = 0, changes = 0;
        std::ostringstream trace;
        for (int i = 0; i < int(seconds * 60); ++i) {
            step(); auto current = person().activity;
            if (current == previous) continue;
            if (current == beforePrevious && town.clock() - changedAt < 1.1) ++rapid;
            if (changes++ < 16) trace << town.clock() << ": " << activityName(previous) << " -> " << activityName(current) << '\n';
            beforePrevious = previous; previous = current; changedAt = town.clock();
        }
        if (rapid) std::cerr << trace.str() << rapid << " rapid state returns\n";
        return rapid == 0;
    }
};
}

TEST(game_unit_states_do_not_bounce_between_ordered_work_and_idle_when_hungry)
{
    for (auto activity : {Activity::Building, Activity::Roadwork, Activity::Working}) {
        WorkSite site; site.order(activity); site.person().food = .2f;
        CHECK(site.noRapidReturns(5));
        CHECK(site.person().food > .5f || site.person().activity == Activity::Eating);
        CHECK(site.person().task == activity);
    }
}

TEST(game_unit_states_resolve_stress_before_resuming_ordered_work)
{
    WorkSite site; site.order(Activity::Building); site.person().stress = .9f;
    CHECK(site.noRapidReturns(5));
    CHECK(site.person().activity == Activity::Brooding || site.person().activity == Activity::Relaxing);
    CHECK(site.person().task == Activity::Building);
}

TEST(game_unit_states_stay_steady_and_construction_clears_trees_with_the_store_full)
{
    // Clearing a site with the wood store full used to hold the builder until room was found, and the user saw
    // construction never happen; the tree now comes down and its logs are left by the work.
    WorkSite site;
    int id = site.order(Activity::Building, false);
    auto center = site.town.building(id)->center;
    auto& map = const_cast<WorldMap&>(site.town.map());
    map.at(int(center.x), int(center.y)).trees = 1;
    site.town.reward({0, site.town.capacity().wood - site.town.wood()});
    CHECK(site.noRapidReturns(5));
    CHECK(site.person().task == Activity::Building);
    for (int i = 0; i < 1200 && !site.town.building(id)->built(); ++i) site.step(.1);
    CHECK(site.town.building(id)->built());
    CHECK_EQ(map.at(int(center.x), int(center.y)).trees, 0);
    CHECK_EQ(site.town.wood(), site.town.capacity().wood);
}

TEST(game_unit_states_keep_working_with_a_hunger_tag_when_there_is_no_food_to_eat)
{
    WorkSite site; int id = site.order(Activity::Building);
    site.town.reward({0, 0, 0, -site.town.stock().food}); site.person().food = .2f;
    CHECK(site.noRapidReturns(5)); CHECK(site.town.building(id)->progress > 0);
    CHECK(site.person().activity == Activity::Building);
    auto tags = site.town.conditions(site.person());
    CHECK(std::find(tags.begin(), tags.end(), Condition::Hungry) != tags.end());
}

TEST(game_unit_states_eating_at_the_current_door_starts_the_meal_once)
{
    WorkSite site; site.town.setAuto(site.worker, true);
    CHECK(site.town.editPerson(site.worker, site.town.camp()->door(), 1)); site.person().food = .2f;
    int stock = site.town.stock().food;
    site.step(.1);
    for (int i = 0; i < 30 && site.person().food < .9f; ++i) site.step();
    CHECK(site.person().activity == Activity::Eating); CHECK(site.person().food > .9f);
    CHECK(site.noRapidReturns(3));
    CHECK_EQ(site.town.stock().food, stock - 1);
}

TEST(game_unit_states_manual_work_retains_all_needs_tags_without_automatic_interruptions)
{
    WorkSite site; site.order(Activity::Building, false);
    site.person().food = .08f; site.person().rest = .08f; site.person().stress = .9f;
    CHECK(site.noRapidReturns(5)); CHECK(site.person().activity == Activity::Building);
    auto tags = site.town.conditions(site.person());
    for (auto tag : {Condition::Starving, Condition::Exhausted, Condition::Distressed})
        CHECK(std::find(tags.begin(), tags.end(), tag) != tags.end());
}
