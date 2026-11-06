#include <test/test.h>
#include <game/map_document.h>
#include <game/town.h>

namespace
{
using namespace hearthold;
WorldMap woodlot()
{
    MapDocument document(WorldMap::generate(5, 64, 64));
    auto camp = document.map().camp();
    document.beginStroke(); document.paint(camp, 12, Terrain::Grass); document.endStroke();
    auto map = document.gameMap();
    for (int y = 0; y < map.height(); ++y)
        for (int x = 0; x < map.width(); ++x) map.at(x, y).trees = map.at(x, y).wild = 0;
    auto tree = camp + Point{3, 3};
    map.at(int(tree.x), int(tree.y)).trees = 1;
    return map;
}
struct Woodlot
{
    Town town{woodlot()};
    Point camp = town.map().camp(), tree = camp + Point{3, 3};
    int worker = town.people().front().id;
    explicit Woodlot(bool found = true)
    {
        town.scout(camp.x, camp.y, 14);
        if (found) { CHECK(town.place(Structure::Camp, camp, 0)); town.completeConstruction(); }
        town.advance(.01);
        for (const auto& person : town.people()) {
            auto& p = const_cast<Person&>(person);
            p.path.clear(); p.inside = false; p.doorway = 0; p.food = p.rest = 1;
            p.activity = Activity::Holding; p.until = town.clock() + 1000;
        }
        idle(worker);
    }
    void idle(int id)
    {
        auto& p = const_cast<Person&>(*town.person(id));
        p.activity = Activity::Idle; p.until = 0; p.path.clear(); p.ordered = false; p.task = Activity::Idle;
    }
    int trees() const { return town.map().at(int(tree.x), int(tree.y)).trees; }
    bool begin()
    {
        for (int i = 0; i < 100; ++i) {
            town.advance(.1);
            if (town.person(worker)->activity == Activity::Felling && !town.person(worker)->moving()) return true;
        }
        return false;
    }
};
}

TEST(game_idle_woodcutting_walks_chops_and_delivers_before_stock_increases)
{
    Woodlot lot;
    int stock = lot.town.wood();
    CHECK(lot.begin());
    if (lot.town.person(lot.worker)->activity != Activity::Felling) return;
    CHECK_EQ(lot.trees(), 1); CHECK_EQ(lot.town.wood(), stock);
    lot.town.advance(1);
    CHECK_EQ(lot.trees(), 1); CHECK_EQ(lot.town.wood(), stock);
    bool carried = false, delivered = false;
    for (int i = 0; i < 300; ++i) {
        lot.town.advance(.1);
        const auto* p = lot.town.person(lot.worker);
        if (p->carrying > 0) { carried = true; CHECK_EQ(lot.town.wood(), stock); }
        if (lot.town.wood() > stock) { delivered = true; CHECK_EQ(p->carrying, 0); break; }
    }
    CHECK(carried); CHECK(delivered); CHECK_EQ(lot.trees(), 0); CHECK_EQ(lot.town.wood(), stock + 3);
}

TEST(game_idle_woodcutting_requires_a_nearby_tree_a_base_and_storage_room)
{
    for (int mode = 0; mode < 3; ++mode) {
        Woodlot lot(mode != 0);
        if (mode == 1) lot.town.reward({0, lot.town.capacity().wood - lot.town.wood()});
        if (mode == 2) CHECK(lot.town.editPerson(lot.worker, lot.camp + Point{-6, -6}, 1));
        int stock = lot.town.wood();
        for (int i = 0; i < 20; ++i) {
            lot.town.advance(.1);
            CHECK(lot.town.person(lot.worker)->activity != Activity::Felling);
        }
        CHECK_EQ(lot.trees(), 1); CHECK_EQ(lot.town.wood(), stock);
    }
}

TEST(game_idle_woodcutting_preserves_distant_orders_and_assigned_jobs)
{
    Woodlot ordered;
    ordered.town.orderMove({ordered.worker}, ordered.camp + Point{8, -4});
    ordered.town.advance(3);
    CHECK(ordered.town.person(ordered.worker)->activity != Activity::Felling);
    CHECK_EQ(ordered.trees(), 1);
    Woodlot employed;
    CHECK(employed.town.buildRoad({RoadAnchor::sharp(employed.camp + Point{1, 0}), RoadAnchor::sharp(employed.camp + Point{7, 0})}));
    employed.town.completeConstruction();
    auto well = employed.town.fit(Structure::Well, employed.camp + Point{3, -1.4f}, 0);
    CHECK(employed.town.place(Structure::Well, well.center, well.angle));
    employed.town.completeConstruction();
    CHECK(employed.town.person(employed.worker)->job >= 0);
    employed.idle(employed.worker);
    employed.town.advance(15);
    CHECK(employed.town.person(employed.worker)->activity != Activity::Felling);
    CHECK_EQ(employed.trees(), 1);
}

TEST(game_idle_woodcutting_claims_each_tree_once_and_releases_interrupted_work)
{
    Woodlot lot;
    CHECK(lot.begin());
    if (lot.town.person(lot.worker)->activity != Activity::Felling) return;
    int other = lot.town.people()[1].id;
    lot.idle(other); lot.town.advance(.1);
    CHECK(lot.town.person(other)->activity != Activity::Felling);
    lot.town.orderStop({lot.worker});
    lot.idle(other);
    bool reassigned = false;
    for (int i = 0; i < 60; ++i) {
        lot.town.advance(.1);
        reassigned |= lot.town.person(other)->activity == Activity::Felling;
    }
    CHECK(reassigned);
}

TEST(game_idle_woodcutting_waits_for_the_fall_and_keeps_overflow_on_the_carrier)
{
    Woodlot lot;
    CHECK(lot.begin());
    if (lot.town.person(lot.worker)->activity != Activity::Felling) return;
    for (int i = 0; i < 80 && lot.trees(); ++i) lot.town.advance(.1);
    CHECK_EQ(lot.trees(), 0);
    CHECK(lot.town.person(lot.worker)->activity == Activity::Collecting);
    CHECK_EQ(lot.town.person(lot.worker)->carrying, 3);
    auto at = lot.town.person(lot.worker)->position;
    lot.town.advance(.3);
    CHECK(lot.town.person(lot.worker)->activity == Activity::Collecting);
    CHECK(lot.town.person(lot.worker)->position == at);
    int room = lot.town.capacity().wood;
    lot.town.reward({0, room - 1 - lot.town.wood()});
    for (int i = 0; i < 150 && lot.town.wood() < room; ++i) lot.town.advance(.1);
    CHECK_EQ(lot.town.wood(), room);
    CHECK_EQ(lot.town.person(lot.worker)->carrying, 2);
    lot.town.reward({0, -3});
    lot.town.advance(4);
    CHECK_EQ(lot.town.person(lot.worker)->carrying, 0);
    CHECK_EQ(lot.town.wood(), room - 1);
}

TEST(game_idle_woodcutting_emits_strokes_on_the_axe_impact_clock)
{
    Woodlot lot;
    CHECK(lot.begin());
    if (lot.town.person(lot.worker)->activity != Activity::Felling) return;
    double started = lot.town.person(lot.worker)->until - woodcutting::cutSeconds;
    lot.town.advance(1.95);
    int strokes = 0;
    for (const auto& event : lot.town.treeEvents()) {
        if (event.kind != TreeWorkEvent::Kind::Chop) continue;
        ++strokes;
        double phase = std::remainder(event.at - started - woodcutting::impactSeconds, woodcutting::swingSeconds);
        CHECK(std::abs(phase) < 1e-6);
        CHECK_EQ(event.person, lot.worker);
    }
    CHECK_EQ(strokes, 3);
    CHECK_EQ(lot.trees(), 1);
}
