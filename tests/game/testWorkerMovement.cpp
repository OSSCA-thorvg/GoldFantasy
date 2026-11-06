#include <test/test.h>
#include <game/town.h>
#include <cmath>

namespace
{
using namespace hearthold;

struct WorkStreet
{
    Town town{5};
    Point camp = town.map().camp();

    WorkStreet()
    {
        town.scout(camp.x, camp.y, 12);
        CHECK(town.place(Structure::Camp, camp, 0));
        town.completeConstruction();
        CHECK(town.buildRoad({RoadAnchor::sharp(camp + Point{1, 0}), RoadAnchor::sharp(camp + Point{7, 0})}));
        town.advance(.01);
        for (const auto& person : town.people()) {
            auto& p = const_cast<Person&>(person);
            p.path.clear();
            p.activity = Activity::Holding;
            p.until = town.clock() + 100;
        }
    }
};
}

TEST(game_worker_movement_walks_to_advanced_road_front_without_teleporting)
{
    WorkStreet street;
    auto& town = street.town;
    int road = town.roads().roads().front().id;
    int first = town.people()[0].id, late = town.people()[1].id;
    CHECK(town.editPerson(first, street.camp + Point{1, 0}, 1));
    CHECK(town.editPerson(late, street.camp + Point{6.5f, 1.2f}, 1));
    CHECK(town.orderRoadwork({first, late}, road));
    float worst = 0;
    for (int step = 0; step < 240; ++step) {
        auto before = town.person(late)->position;
        town.advance(.05);
        worst = std::max(worst, distance(before, town.person(late)->position));
    }
    CHECK(worst <= 2.6f * .05f + .001f);
    CHECK(town.roads().roads().front().built > .2f);
}

TEST(game_worker_movement_failed_order_does_not_work_from_an_unreachable_location)
{
    WorkStreet street;
    auto& town = street.town;
    const auto seat = *town.camp();
    CHECK(town.editBuilding(seat.id, seat.center, seat.angle, .5f, 1));
    int worker = town.people()[0].id;
    CHECK(town.editPerson(worker, {.5f, .5f}, 1));
    town.advance(.01);
    auto& p = const_cast<Person&>(*town.person(worker));
    p.activity = Activity::Holding;
    p.until = town.clock() + 10;
    p.path.clear();
    CHECK(town.walking().path(p.position, town.camp()->door()).empty());
    CHECK(!town.orderBuild({worker}, seat.id));
    auto before = town.camp()->progress;
    town.advance(.05);
    CHECK(p.activity == Activity::Holding);
    CHECK_EQ(town.camp()->progress, before);
}

TEST(game_worker_movement_finished_road_does_not_send_builder_back_to_its_middle)
{
    WorkStreet street;
    auto& town = street.town;
    auto& road = const_cast<Road&>(town.roads().roads().front());
    road.built = .999f;
    int worker = town.people()[0].id;
    CHECK(town.editPerson(worker, road.along(road.built), 1));
    CHECK(town.orderRoadwork({worker}, road.id));
    for (int step = 0; step < 20 && road.built < 1; ++step) town.advance(.05);
    CHECK_EQ(road.built, 1.f);
    auto end = town.person(worker)->position;
    town.advance(.05);
    CHECK(town.person(worker)->activity == Activity::Idle);
    CHECK(!town.person(worker)->moving());
    CHECK(distance(end, town.person(worker)->position) < .001f);
}

TEST(game_worker_movement_crosses_doorway_continuously_and_reverses_orders)
{
    WorkStreet street;
    auto& town = street.town;
    auto spot = town.fit(Structure::Tavern, street.camp + Point{2.6f, 1.2f}, 0);
    CHECK(town.place(Structure::Tavern, spot.center, spot.angle));
    town.completeConstruction();
    town.advance(.01);
    const auto* tavern = town.building(town.buildingAt(spot.center));
    CHECK(tavern != nullptr);
    if (!tavern) return;
    int worker = town.people()[0].id;
    CHECK(town.editPerson(worker, tavern->door(), 1));
    CHECK(town.orderRelax({worker}, tavern->id));
    town.advance(.01);
    CHECK(town.person(worker)->inside);
    CHECK_EQ(town.person(worker)->visibility(), 1.f);
    bool partial = false;
    float previousVisibility = 1;
    for (int step = 0; step < 70 && town.person(worker)->doorway < 1; ++step) {
        auto before = town.person(worker)->position;
        town.advance(.05);
        const auto& p = *town.person(worker);
        CHECK(distance(before, p.position) <= 2.6f * .05f + .001f);
        CHECK(p.visibility() <= previousVisibility + .001f);
        previousVisibility = p.visibility();
        partial |= p.visibility() > 0 && p.visibility() < 1;
    }
    CHECK(partial);
    CHECK_EQ(town.person(worker)->doorway, 1.f);
    CHECK(distance(town.person(worker)->position, tavern->threshold()) < .001f);
    auto interior = town.person(worker)->position;
    town.orderMove({worker}, tavern->door());
    CHECK(distance(interior, town.person(worker)->position) < .001f);
    CHECK_EQ(town.person(worker)->visibility(), 0.f);
    town.advance(.1);
    auto midway = *town.person(worker);
    CHECK(midway.doorway > 0 && midway.doorway < 1);
    town.orderMove({worker}, street.camp + Point{5, 0});
    CHECK(distance(midway.position, town.person(worker)->position) < .001f);
    CHECK_EQ(town.person(worker)->doorway, midway.doorway);
    for (int step = 0; step < 70 && town.person(worker)->crossingDoorway(); ++step) town.advance(.05);
    CHECK_EQ(town.person(worker)->doorway, 0.f);
    CHECK_EQ(town.person(worker)->visibility(), 1.f);
    CHECK(distance(town.person(worker)->position, tavern->door()) < .001f);
}

TEST(game_worker_movement_hidden_occupant_uses_upgraded_door_and_partial_crossing_stays_continuous)
{
    WorkStreet street;
    auto& town = street.town;
    auto& seat = const_cast<Building&>(*town.camp());
    int worker = town.people()[0].id;
    auto& p = const_cast<Person&>(*town.person(worker));
    p.activity = Activity::Sleeping;
    p.target = seat.id;
    p.rest = .2f;
    p.inside = true;
    p.doorway = 1;
    p.entrance = seat.door();
    p.threshold = p.position = seat.threshold();
    seat.kind = Structure::Keep;
    CHECK(town.editBuilding(seat.id, seat.center, .6f, 1, 1));
    town.advance(.01);
    CHECK_EQ(p.visibility(), 0.f);
    CHECK(distance(p.position, seat.threshold()) < .001f);
    CHECK(distance(p.entrance, seat.door()) < .001f);
    town.orderMove({worker}, seat.door());
    CHECK_EQ(p.doorway, 1.f);
    CHECK(distance(p.position, seat.threshold()) < .001f);
    town.advance(.05);
    CHECK(p.crossingDoorway());
    auto before = p.position;
    auto entrance = p.entrance, threshold = p.threshold;
    CHECK(town.editBuilding(seat.id, seat.center, 1.8f, 1, 1));
    town.advance(.05);
    CHECK(distance(before, p.position) <= 2.6f * .05f + .001f);
    CHECK(distance(p.entrance, entrance) < .001f);
    CHECK(distance(p.threshold, threshold) < .001f);
}

TEST(game_worker_movement_manor_merge_keeps_indoor_occupant_at_surviving_door)
{
    WorkStreet street;
    auto& town = street.town;
    CHECK(town.buildRoad({RoadAnchor::sharp(street.camp + Point{1, 0}), RoadAnchor::sharp(street.camp + Point{1, -3})}));
    CHECK(town.buildRoad({RoadAnchor::sharp(street.camp + Point{1, -3}), RoadAnchor::sharp(street.camp + Point{7, -3})}));
    std::vector<int> homes;
    for (float row : {-1.f, -2.f})
        for (int i : {1, 2}) {
            auto spot = town.fit(Structure::Tent, street.camp + Point{2.2f + i * 1.15f, row}, 0);
            CHECK(town.place(Structure::Tent, spot.center, spot.angle));
            homes.push_back(town.buildingAt(spot.center));
        }
    town.completeConstruction();
    town.recruit(Role::Resident, Calling::Settler, 22);
    town.reward({500, 500, 500, 900, 0, 3000});
    for (int id : homes) {
        auto& home = const_cast<Building&>(*town.building(id));
        home.kind = Structure::Townhouse;
        home.growth = structureSpec(Structure::Townhouse).growthDays;
    }
    auto& p = const_cast<Person&>(town.people()[0]);
    const auto& home = *town.building(homes.back());
    p.home = p.target = home.id;
    p.activity = Activity::Sleeping;
    p.inside = true;
    p.doorway = 1;
    p.rest = .2f;
    p.entrance = home.door();
    p.threshold = p.position = home.threshold();
    CHECK(town.editHour(23.999));
    town.advance(.04);
    town.advance(.01);
    const auto* manor = town.building(p.home);
    CHECK(manor && manor->kind == Structure::Manor);
    if (!manor) return;
    CHECK_EQ(p.target, manor->id);
    CHECK_EQ(p.visibility(), 0.f);
    CHECK(distance(p.position, manor->threshold()) < .001f);
    CHECK(distance(p.entrance, manor->door()) < .001f);
}

TEST(game_worker_movement_uses_reachable_camp_when_own_door_is_blocked)
{
    WorkStreet street;
    auto& town = street.town;
    auto spot = town.fit(Structure::Tent, street.camp + Point{2.2f, -1}, 0);
    CHECK(town.place(Structure::Tent, spot.center, spot.angle));
    town.completeConstruction();
    int home = town.buildingAt(spot.center);
    CHECK(town.editBuilding(home, {2, 2}, 0, 1, 1));
    town.advance(.01);
    auto& p = const_cast<Person&>(town.people()[0]);
    CHECK(town.editPerson(p.id, town.camp()->door(), 1));
    p.home = home;
    p.path.clear();
    p.activity = Activity::Idle;
    p.until = town.clock();
    p.food = .1f;
    CHECK(town.walking().path(p.position, town.building(home)->door()).empty());
    town.advance(.1);
    CHECK(p.activity == Activity::Eating);
    CHECK_EQ(p.target, town.camp()->id);
    town.advance(.1);
    CHECK(p.food > .9f);
    CHECK(p.inside);
    p.activity = Activity::Idle;
    p.until = town.clock();
    p.inside = false;
    p.doorway = 0;
    p.position = town.camp()->door();
    p.rest = .05f;
    p.path.clear();
    town.advance(.1);
    CHECK(p.activity == Activity::Sleeping);
    CHECK_EQ(p.target, town.camp()->id);
    town.advance(.1);
    CHECK(p.inside);
}
