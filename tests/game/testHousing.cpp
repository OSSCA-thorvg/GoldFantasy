#include <test/test.h>
#include <game/map_document.h>
#include <game/town.h>

namespace
{
using namespace hearthold;
struct HousingSite
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
    int worker = town.people().front().id, home = -1;
    HousingSite()
    {
        town.scout(camp.x, camp.y, 15);
        CHECK(town.place(Structure::Camp, camp, 0)); town.completeConstruction();
        CHECK(town.buildRoad({RoadAnchor::sharp(camp + Point{1.2f, 0}), RoadAnchor::sharp(camp + Point{8, 0})}));
        town.completeConstruction();
        auto spot = town.fit(Structure::Tent, camp + Point{4, -1.4f}, 0);
        CHECK(town.place(Structure::Tent, spot.center, spot.angle)); town.completeConstruction();
        home = town.buildingAt(spot.center); town.advance(.01);
        // These tests exercise residents explicitly assigned to the tent.
        for (const auto& p : town.people()) const_cast<Person&>(p).home = home;
        for (const auto& p : town.people()) town.orderStop({p.id});
    }
    void step(double seconds)
    {
        const_cast<std::vector<Monster>&>(town.monsters()).clear(); town.advance(seconds);
    }
    int addHostel()
    {
        auto spot = town.fit(Structure::Hostel, camp + Point{5, 1.8f}, 0);
        CHECK_EQ(town.canPlace(Structure::Hostel, spot.center, spot.angle).reason, std::string());
        CHECK(town.place(Structure::Hostel, spot.center, spot.angle)); town.completeConstruction();
        int id = town.buildingAt(spot.center);
        town.setWorkers(id, 0);
        return id;
    }
};
}

TEST(game_housing_lists_assigned_residents_even_when_they_are_outside)
{
    HousingSite site;
    auto residents = site.town.occupants(site.home);
    CHECK_EQ(residents.size(), size_t(2));
    for (int id : residents) { CHECK_EQ(site.town.person(id)->home, site.home); CHECK(!site.town.person(id)->inside); }
    CHECK(site.town.occupants(-1).empty());
}

TEST(game_housing_manual_rest_enters_recovers_and_stays_until_told_to_leave)
{
    HousingSite site;
    auto& p = const_cast<Person&>(*site.town.person(site.worker)); p.rest = .4f;
    CHECK(site.town.orderRest({site.worker}, site.home));
    site.step(20);
    CHECK(p.inside); CHECK(p.activity == Activity::Sleeping); CHECK_EQ(p.target, site.home); CHECK(p.rest > .4f);
    p.rest = 1; site.step(2); CHECK(p.inside); CHECK(p.activity == Activity::Sleeping);
    CHECK(site.town.orderLeave({site.worker}));
    site.step(5); CHECK(!p.inside); CHECK(!p.crossingDoorway()); CHECK(!p.moving());
    CHECK(p.activity == Activity::Holding); CHECK(p.task == Activity::Idle);
    auto outside = p.position; site.step(5); CHECK(p.position == outside);
}

TEST(game_housing_move_order_interrupts_rest_and_exits_through_the_door)
{
    HousingSite site;
    CHECK(site.town.orderRest({site.worker}, site.home)); site.step(15);
    const auto* p = site.town.person(site.worker); CHECK(p->inside);
    auto before = p->position, goal = site.camp + Point{6, 2};
    site.town.orderMove({site.worker}, goal); site.step(.1);
    CHECK(distance(before, p->position) < .35f);
    site.step(20); CHECK(!p->inside); CHECK(!p->crossingDoorway()); CHECK(distance(p->position, goal) < .25f);
}

TEST(game_housing_stopped_occupants_still_have_a_shelter_and_can_leave)
{
    HousingSite site;
    CHECK(site.town.orderRest({site.worker}, site.home)); site.step(15);
    site.town.orderStop({site.worker});
    CHECK_EQ(site.town.shelterOf(*site.town.person(site.worker)), site.home);
    CHECK(site.town.orderLeave({site.worker})); site.step(5);
    CHECK(!site.town.person(site.worker)->inside); CHECK(!site.town.person(site.worker)->crossingDoorway());
}

TEST(game_housing_rest_respects_bed_reservations_and_rejects_other_buildings)
{
    HousingSite site;
    site.town.recruit(Role::Resident, Calling::Settler, 1);
    std::vector<int> first{site.worker, site.town.people()[1].id};
    CHECK(site.town.orderRest(first, site.home));
    CHECK(!site.town.orderRest({site.town.people().back().id}, site.home));
    auto spot = site.town.fit(Structure::Well, site.camp + Point{6, -1.4f}, 0);
    CHECK(site.town.place(Structure::Well, spot.center, spot.angle)); site.town.completeConstruction();
    CHECK(!site.town.orderRest(first, site.town.buildingAt(spot.center)));
}

TEST(game_unit_condition_tags_coexist_with_each_other_and_with_the_current_activity)
{
    HousingSite site;
    auto& p = const_cast<Person&>(*site.town.person(site.worker));
    p.food = .2f; p.rest = .1f; p.health = .5f; p.stress = .9f; p.activity = Activity::Building;
    auto& climate = const_cast<Climate&>(site.town.climate()); climate.temperature = -5; climate.weather = Weather::Snow; climate.intensity = 1;
    auto tags = site.town.conditions(p);
    for (auto expected : {Condition::Hungry, Condition::Exhausted, Condition::Cold, Condition::SnowedOn, Condition::Wounded, Condition::Distressed})
        CHECK(std::find(tags.begin(), tags.end(), expected) != tags.end());
    CHECK(p.activity == Activity::Building);
    p.food = 1; auto fed = site.town.conditions(p);
    CHECK(std::find(fed.begin(), fed.end(), Condition::Hungry) == fed.end());
    CHECK(std::find(fed.begin(), fed.end(), Condition::Cold) != fed.end());
}

TEST(game_housing_rejects_nonresident_even_with_free_beds)
{
    HousingSite site;
    auto& p = const_cast<Person&>(*site.town.person(site.worker));
    p.home = -1;
    CHECK(!site.town.orderRest({p.id}, site.home));
    CHECK(p.task != Activity::Sleeping);
    site.step(15);
    CHECK(!p.inside);
}

TEST(game_player_order_reaches_clicked_position_before_starting_rest)
{
    HousingSite site;
    CHECK(site.town.orderRest({site.worker}, site.home));
    auto click = site.camp + Point{6, 2};
    site.town.approachOrder({site.worker}, click);
    const auto& p = *site.town.person(site.worker);
    CHECK(p.approachingOrder);
    CHECK(p.activity == Activity::Moving);
    CHECK(p.task == Activity::Sleeping);
    CHECK(!p.path.empty());
    CHECK(distance(p.path.back(), click) < .3f);
    site.step(30);
    CHECK(!p.approachingOrder);
    CHECK(p.inside);
    CHECK(p.activity == Activity::Sleeping);
}

TEST(game_lodging_rejects_resident_rest_in_hostels_and_their_upgrades)
{
    HousingSite site; int lodging = site.addHostel();
    for (auto kind : {Structure::Hostel, Structure::Inn, Structure::GrandInn}) {
        const_cast<Building*>(site.town.building(lodging))->kind = kind;
        CHECK(!site.town.orderRest({site.worker}, lodging));
        CHECK(site.town.person(site.worker)->task != Activity::Sleeping);
        CHECK_EQ(site.town.person(site.worker)->home, site.home);
    }
    CHECK(site.town.orderRest({site.worker}, site.home));
}

TEST(game_lodging_residents_do_not_choose_guest_meals_when_they_have_no_home)
{
    HousingSite site; int lodging = site.addHostel();
    auto& p = const_cast<Person&>(*site.town.person(site.worker));
    p.home = -1; p.food = .1f; p.rest = 1; p.health = 1; p.stress = 0;
    site.town.setAuto(site.worker, true);
    bool visited = false;
    for (int i = 0; i < 80; ++i) {
        site.step(.1);
        const auto& unit = *site.town.person(site.worker);
        visited |= (unit.target == lodging && unit.activity == Activity::Eating) || site.town.shelterOf(unit) == lodging;
    }
    CHECK(!visited);
}

TEST(game_lodging_removes_old_resident_beds_and_exits_through_the_door)
{
    for (bool automatic : {false, true}) {
        HousingSite site; int lodging = site.addHostel();
        const auto& place = *site.town.building(lodging);
        auto& p = const_cast<Person&>(*site.town.person(site.worker));
        p.home = p.bed = p.target = p.taskSite = lodging;
        p.activity = p.task = Activity::Sleeping; p.ordered = true; p.autoMode = automatic;
        p.path.clear(); p.inside = true; p.doorway = 1;
        p.entrance = place.door(); p.position = p.threshold = place.threshold();
        site.step(.1);
        const auto& leaving = *site.town.person(site.worker);
        CHECK(!leaving.inside); CHECK(leaving.crossingDoorway()); CHECK_EQ(leaving.autoMode, automatic);
        CHECK_EQ(leaving.home, site.home); CHECK_EQ(leaving.bed, -1); CHECK(leaving.taskSite != lodging);
        auto occupants = site.town.occupants(lodging);
        CHECK(std::find(occupants.begin(), occupants.end(), site.worker) == occupants.end());
        site.step(8);
        CHECK(site.town.shelterOf(*site.town.person(site.worker)) != lodging);
    }
}

TEST(game_lodging_cancels_an_old_resident_rest_order_before_arrival)
{
    HousingSite site; int lodging = site.addHostel();
    auto& p = const_cast<Person&>(*site.town.person(site.worker));
    p.task = p.activity = Activity::Sleeping; p.taskSite = p.target = lodging; p.ordered = true;
    p.path = site.town.walking().path(p.position, site.town.building(lodging)->door());
    site.step(.1);
    CHECK(site.town.person(site.worker)->task != Activity::Sleeping);
    CHECK(site.town.person(site.worker)->target != lodging);
    CHECK(!site.town.person(site.worker)->inside);
}

TEST(game_lodging_guests_keep_their_beds_sleep_inside_and_pay)
{
    HousingSite site; int lodging = site.addHostel();
    site.town.recruit(Role::Guest, Calling::Traveller, 1);
    int guest = site.town.people().back().id;
    auto& p = const_cast<Person&>(*site.town.person(guest));
    CHECK_EQ(p.bed, lodging); p.rest = .01f; p.food = 1; p.activity = Activity::Idle; p.until = 0;
    int purse = p.purse;
    site.step(15);
    const auto& resting = *site.town.person(guest);
    CHECK(resting.role == Role::Guest); CHECK_EQ(resting.bed, lodging);
    CHECK(resting.inside); CHECK(resting.activity == Activity::Sleeping); CHECK_EQ(resting.target, lodging);
    CHECK(resting.rest > .01f); CHECK(resting.purse < purse); CHECK(site.town.building(lodging)->earned >= 2);
    auto occupants = site.town.occupants(lodging);
    CHECK(std::find(occupants.begin(), occupants.end(), guest) != occupants.end());
}

TEST(game_lodging_a_guest_who_settles_leaves_guest_accommodation)
{
    HousingSite site; int lodging = site.addHostel();
    site.town.recruit(Role::Guest, Calling::Traveller, 1);
    int guest = site.town.people().back().id;
    auto& p = const_cast<Person&>(*site.town.person(guest));
    p.rest = .01f; p.food = 1; p.activity = Activity::Idle; p.until = 0;
    site.step(15); CHECK(site.town.person(guest)->inside);
    CHECK(site.town.settle(guest));
    const auto& resident = *site.town.person(guest);
    CHECK(resident.role == Role::Resident); CHECK_EQ(resident.bed, -1);
    CHECK(resident.home != lodging); CHECK(!resident.inside); CHECK(resident.crossingDoorway());
    site.step(8);
    CHECK(site.town.shelterOf(*site.town.person(guest)) != lodging);
}

TEST(game_housing_keeps_camp_residents_when_a_tent_is_completed)
{
    Town town{HousingSite::map()};
    auto camp = town.map().camp();
    town.scout(camp.x, camp.y, 15);
    CHECK(town.place(Structure::Camp, camp, 0)); town.completeConstruction();
    int home = town.buildingAt(camp);
    for (const auto& p : town.people()) CHECK_EQ(p.home, home);
    CHECK(town.buildRoad({RoadAnchor::sharp(camp + Point{1.2f, 0}), RoadAnchor::sharp(camp + Point{8, 0})}));
    town.completeConstruction();
    auto spot = town.fit(Structure::Tent, camp + Point{4, -1.4f}, 0);
    CHECK(town.place(Structure::Tent, spot.center, spot.angle)); town.completeConstruction();
    town.advance(.01);
    for (const auto& p : town.people()) CHECK_EQ(p.home, home);
}
