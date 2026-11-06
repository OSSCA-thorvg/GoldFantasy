#include <test/test.h>
#include <game/town.h>
#include <game/traffic.h>

namespace
{
using namespace hearthold;
struct RoadTown
{
    Town town{5};
    Point c = town.map().camp();
    RoadTown()
    {
        town.scout(c.x, c.y, 10);
        CHECK(town.place(Structure::Camp, c, 0));
        town.completeConstruction();
        CHECK(town.buildRoad(path(7)));
    }
    RoadPath path(float reach) const { return {RoadAnchor::sharp(c + Point{1, 0}), RoadAnchor::sharp(c + Point{reach, 0})}; }
    int road() const { return town.roads().roads().front().id; }
};
}

TEST(game_road_progress_keeps_settlement_objects_but_invalidates_the_road)
{
    RoadTown f;
    f.town.advance(.01);
    auto roadRevision = f.town.roadRevision();
    auto objects = f.town.objectRevision();
    auto global = f.town.revision();
    CHECK(f.town.orderRoadwork({f.town.people().front().id}, f.road()));
    for (int i = 0; i < 200 && f.town.roadRevision() == roadRevision; ++i) f.town.advance(.1);
    CHECK(f.town.roadRevision() > roadRevision);
    CHECK(f.town.revision() > global);
    CHECK_EQ(f.town.objectRevision(), objects);
    CHECK(f.town.roads().roads().front().built > 0);
    f.town.scout(f.c.x + 5, f.c.y, 2);
    CHECK(f.town.objectRevision() > objects);
}

TEST(game_cart_graph_survives_scouting_people_and_paving)
{
    RoadTown f;
    f.town.completeConstruction();
    Traffic traffic(5);
    traffic.update(f.town, 0);
    CHECK(!traffic.graph().empty());
    const auto* nodes = traffic.graph().nodes().data();
    auto roadRevision = f.town.roadRevision();
    f.town.scout(f.c.x + 5, f.c.y, 2);
    f.town.recruit(Role::Resident, Calling::Settler, 1);
    traffic.update(f.town, 0);
    CHECK_EQ(f.town.roadRevision(), roadRevision);
    CHECK(traffic.graph().nodes().data() == nodes);
    auto objects = f.town.objectRevision();
    f.town.reward({0, 0, 100, 0, 0});
    CHECK(f.town.pave(f.road()));
    traffic.update(f.town, 0);
    CHECK(f.town.roadRevision() > roadRevision);
    CHECK_EQ(f.town.objectRevision(), objects);
    CHECK(traffic.graph().nodes().data() == nodes);
    f.town.completeConstruction();
    traffic.update(f.town, 0);
    CHECK(traffic.graph().nodes().data() == nodes);
    CHECK(f.town.roads().roads().front().paved);
}

TEST(game_cart_graph_follows_road_reshape_completion_and_demolition)
{
    RoadTown f;
    f.town.completeConstruction();
    Traffic traffic(5);
    traffic.update(f.town, 0);
    auto roadRevision = f.town.roadRevision();
    CHECK(f.town.reshapeRoad(f.road(), f.path(6)));
    CHECK(f.town.roadRevision() > roadRevision);
    traffic.update(f.town, 0);
    CHECK(traffic.graph().empty());
    f.town.completeConstruction();
    traffic.update(f.town, 0);
    CHECK(!traffic.graph().empty());
    roadRevision = f.town.roadRevision();
    CHECK(f.town.demolish(f.c + Point{3, 0}));
    CHECK(f.town.roadRevision() > roadRevision);
    traffic.update(f.town, 0);
    CHECK(traffic.graph().empty());
}
