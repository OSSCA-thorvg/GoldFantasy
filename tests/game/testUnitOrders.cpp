#include <test/test.h>
#include <game/map_document.h>
#include <game/town.h>

namespace
{
using namespace hearthold;
struct OrderSite
{
    static WorldMap map()
    {
        MapDocument document(WorldMap::generate(5, 64, 64));
        auto camp = document.map().camp();
        document.beginStroke(); document.paint(camp, 12, Terrain::Grass); document.endStroke();
        auto map = document.gameMap();
        for (int y = 0; y < map.height(); ++y)
            for (int x = 0; x < map.width(); ++x) map.at(x, y).trees = map.at(x, y).wild = 0;
        auto tree = camp + Point{3, 3}; map.at(int(tree.x), int(tree.y)).trees = 1;
        return map;
    }
    Town town{map()};
    Point camp = town.map().camp(), tree = camp + Point{3, 3};
    int worker = town.people().front().id;
    OrderSite()
    {
        town.scout(camp.x, camp.y, 14);
        CHECK(town.place(Structure::Camp, camp, 0)); town.completeConstruction(); town.advance(.01);
        for (const auto& p : town.people()) town.orderStop({p.id});
        for (const auto& p : town.people()) {
            auto& person = const_cast<Person&>(p); person.food = person.rest = person.health = 1; person.stress = 0;
        }
    }
    int cell() const { return int(tree.y) * town.map().width() + int(tree.x); }
    int trees() const { return town.map().at(int(tree.x), int(tree.y)).trees; }
    void step(double seconds, bool clearMonsters = true)
    {
        if (clearMonsters) const_cast<std::vector<Monster>&>(town.monsters()).clear();
        town.advance(seconds);
    }
};
}

TEST(game_manual_units_stay_put_at_night_until_given_an_order)
{
    OrderSite site;
    auto before = site.town.person(site.worker)->position;
    CHECK(!site.town.person(site.worker)->autoMode);
    CHECK(site.town.editHour(23));
    for (int i = 0; i < 300; ++i) site.step(.1);
    const auto& p = *site.town.person(site.worker);
    CHECK(p.position == before); CHECK(!p.inside); CHECK(!p.moving()); CHECK_EQ(site.trees(), 1);
    CHECK(p.activity == Activity::Holding || p.activity == Activity::Idle);
}

TEST(game_auto_units_do_not_go_to_bed_just_because_it_is_night)
{
    OrderSite site;
    CHECK(site.town.editHour(23)); site.town.setAuto(site.worker, true);
    site.step(2);
    const auto& p = *site.town.person(site.worker);
    CHECK(p.activity != Activity::Sleeping); CHECK(!p.inside);
}

TEST(game_stop_cancels_movement_work_claims_and_combat_without_discarding_cargo)
{
    OrderSite site;
    CHECK(site.town.orderChop({site.worker}, site.cell()));
    site.step(1); site.town.orderStop({site.worker});
    auto stopped = site.town.person(site.worker)->position;
    site.step(2); CHECK(site.town.person(site.worker)->position == stopped);
    CHECK_EQ(site.town.person(site.worker)->tree, -1); CHECK_EQ(site.trees(), 1);
    CHECK(site.town.orderChop({site.worker}, site.cell()));
    for (int i = 0; i < 400 && site.town.person(site.worker)->carrying == 0; ++i) site.step(.1);
    CHECK_EQ(site.town.person(site.worker)->carrying, 3);
    site.town.orderStop({site.worker});
    auto at = site.town.person(site.worker)->position;
    int stock = site.town.wood(); site.town.releaseMonster(at + Point{1.5f, 0});
    site.step(1, false);
    const auto& p = *site.town.person(site.worker);
    CHECK(p.position == at); CHECK(!p.moving()); CHECK(!p.autoMode);
    CHECK_EQ(p.tree, -1); CHECK_EQ(p.foe, -1); CHECK(p.task == Activity::Idle);
    CHECK_EQ(p.carrying, 3); CHECK_EQ(site.town.wood(), stock);
}

TEST(game_manual_tree_order_chops_collects_delivers_and_then_stops)
{
    OrderSite site;
    int stock = site.town.wood();
    CHECK(site.town.orderChop({site.worker}, site.cell()));
    bool carried = false, delivered = false;
    for (int i = 0; i < 500; ++i) {
        site.step(.1);
        const auto& p = *site.town.person(site.worker);
        if (p.carrying) { carried = true; CHECK_EQ(site.town.wood(), stock); }
        if (site.town.wood() == stock + 3) { delivered = true; break; }
    }
    CHECK(carried); CHECK(delivered); CHECK_EQ(site.trees(), 0);
    site.step(.5); auto at = site.town.person(site.worker)->position;
    site.step(5); CHECK(site.town.person(site.worker)->position == at);
}

TEST(game_explicit_move_has_priority_and_attack_move_fights_without_harvest_detours)
{
    for (bool attack : {false, true}) {
        OrderSite site; auto at = site.town.person(site.worker)->position;
        site.town.releaseMonster(at + Point{1.8f, 0}); CHECK(!site.town.monsters().empty());
        if (site.town.monsters().empty()) return;
        const_cast<Monster&>(site.town.monsters().back()).health = .2f;
        auto goal = site.camp + Point{4, 3};
        if (attack) site.town.orderAttackMove({site.worker}, goal); else site.town.orderMove({site.worker}, goal);
        site.step(.1, false);
        CHECK(site.town.person(site.worker)->activity == (attack ? Activity::Fighting : Activity::Moving));
        for (int i = 0; i < 400; ++i) site.step(.1, !attack);
        CHECK(distance(site.town.person(site.worker)->position, goal) < .25f); CHECK_EQ(site.trees(), 1);
    }
}

TEST(game_manual_move_reaches_the_destination_without_automatic_harvest_detours)
{
    OrderSite site; auto foot = treePosition(site.town.map(), int(site.tree.x), int(site.tree.y), 0);
    auto goal = foot + Point{7, 0}; CHECK(site.town.editPerson(site.worker, foot + Point{-2, 0}, 1));
    int stock = site.town.wood(); site.town.orderMove({site.worker}, goal);
    site.step(20);
    CHECK_EQ(site.trees(), 1); CHECK_EQ(site.town.wood(), stock);
    CHECK(distance(site.town.person(site.worker)->position, goal) < .25f);
}

TEST(game_new_move_and_attack_move_orders_interrupt_chopping_without_reacquiring_the_tree)
{
    for (bool attack : {false, true}) {
        OrderSite site; CHECK(site.town.orderChop({site.worker}, site.cell()));
        for (int i = 0; i < 400; ++i) {
            site.step(.1);
            const auto& p = *site.town.person(site.worker);
            if (p.activity == Activity::Felling && !p.moving()) break;
        }
        auto before = site.town.person(site.worker)->position, goal = before + Point{4, -2};
        if (attack) site.town.orderAttackMove({site.worker}, goal); else site.town.orderMove({site.worker}, goal);
        site.step(.3);
        const auto& p = *site.town.person(site.worker);
        CHECK(p.activity == Activity::Moving); CHECK_EQ(p.tree, -1);
        CHECK(distance(before, p.position) > .1f); CHECK_EQ(site.trees(), 1);
        site.step(12); CHECK(distance(site.town.person(site.worker)->position, goal) < .25f);
    }
}

TEST(game_new_move_goes_to_the_destination_before_delivering_previously_carried_logs)
{
    OrderSite site; CHECK(site.town.orderChop({site.worker}, site.cell()));
    for (int i = 0; i < 500 && site.town.person(site.worker)->carrying == 0; ++i) site.step(.1);
    auto before = site.town.person(site.worker)->position, goal = before + Point{4, 0};
    CHECK_EQ(site.town.person(site.worker)->carrying, 3);
    site.town.orderMove({site.worker}, goal); site.step(.3);
    const auto& p = *site.town.person(site.worker);
    CHECK(p.activity == Activity::Moving); CHECK_EQ(p.carrying, 3); CHECK(p.position.x > before.x);
}

TEST(game_auto_residents_walk_around_to_look_for_work_while_manual_residents_hold)
{
    OrderSite site; auto& map = const_cast<WorldMap&>(site.town.map()); map.at(int(site.tree.x), int(site.tree.y)).trees = 0;
    auto before = site.town.person(site.worker)->position;
    site.town.setAuto(site.worker, true); bool wandered = false;
    for (int i = 0; i < 200; ++i) { site.step(.1); wandered |= distance(before, site.town.person(site.worker)->position) > .8f; }
    CHECK(wandered);
    site.town.orderStop({site.worker}); before = site.town.person(site.worker)->position;
    site.step(10); CHECK(site.town.person(site.worker)->position == before);
}
