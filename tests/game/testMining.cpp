#include <test/test.h>
#include <test/directory.h>
#include <game/map_document.h>
#include <game/town.h>

namespace
{
using namespace hearthold;
struct MineSite
{
    static WorldMap map()
    {
        MapDocument document(WorldMap::generate(5, 64, 64));
        auto camp = document.map().camp();
        document.beginStroke(); document.paint(camp, 14, Terrain::Grass); document.paint(camp + Point{4, 3}, 1.8f, Terrain::Rock); document.endStroke();
        auto map = document.gameMap(); bool kept = false;
        for (int y = 0; y < map.height(); ++y) for (int x = 0; x < map.width(); ++x) {
            auto& tile = map.at(x, y); tile.trees = tile.wild = 0;
            if (mining::deposit(map, x, y)) {
                tile.quarried = kept || distance(mining::position(x, y), camp) > 7;
                if (!tile.quarried) kept = true;
            }
        }
        return map;
    }
    Town town{map()};
    int worker = town.people().front().id, cell = -1;
    MineSite()
    {
        auto camp = town.map().camp(); town.scout(camp.x, camp.y, 15);
        CHECK(town.place(Structure::Camp, camp, 0)); town.completeConstruction(); town.advance(.01);
        for (const auto& p : town.people()) town.orderStop({p.id});
        for (int y = 0; y < town.map().height(); ++y) for (int x = 0; x < town.map().width(); ++x)
            if (mining::deposit(town.map(), x, y)) cell = y * town.map().width() + x;
        CHECK(cell >= 0);
    }
    bool exists() const { return mining::deposit(town.map(), cell % town.map().width(), cell / town.map().width()); }
    void step(double seconds = .1) { const_cast<std::vector<Monster>&>(town.monsters()).clear(); town.advance(seconds); }
};
}

TEST(game_mining_breaks_a_real_rock_carries_stone_and_increases_stock_only_on_delivery)
{
    MineSite site; int stock = site.town.stock().stone, wood = site.town.wood();
    CHECK(site.town.orderMine({site.worker}, site.cell)); bool carried = false, delivered = false;
    for (int i = 0; i < 700; ++i) {
        site.step(); const auto* p = site.town.person(site.worker);
        if (p->carrying) { carried = true; CHECK(p->carriedProduct == Product::Stone); CHECK_EQ(site.town.stock().stone, stock); }
        if (site.town.stock().stone > stock) { delivered = true; CHECK_EQ(p->carrying, 0); break; }
    }
    CHECK(carried); CHECK(delivered); CHECK(!site.exists()); CHECK_EQ(site.town.stock().stone, stock + 3); CHECK_EQ(site.town.wood(), wood);
}

TEST(game_auto_residents_find_and_mine_nearby_stone_without_a_quarry)
{
    MineSite site; int stock = site.town.stock().stone; site.town.setAuto(site.worker, true);
    for (int i = 0; i < 1000 && site.town.stock().stone == stock; ++i) site.step();
    CHECK_EQ(site.town.stock().stone, stock + 3); CHECK(!site.exists());
}

TEST(game_quarry_workers_mine_and_deliver_real_deposits_without_creating_phantom_cargo_after_depletion)
{
    MineSite site; auto camp = site.town.map().camp();
    CHECK(site.town.buildRoad({RoadAnchor::sharp(camp + Point{1.2f, 0}), RoadAnchor::sharp(camp + Point{8, 0})}));
    site.town.completeConstruction();
    auto lot = site.town.fit(Structure::Quarry, camp + Point{2, 1.4f}, 0);
    auto check = site.town.canPlace(Structure::Quarry, lot.center, lot.angle);
    CHECK_EQ(check.reason, std::string{}); if (!check.ok) return;
    CHECK(site.town.place(Structure::Quarry, lot.center, lot.angle));
    site.town.completeConstruction(); int quarry = site.town.buildingAt(lot.center);
    CHECK(quarry >= 0); if (quarry < 0) return;
    CHECK(site.town.assignJob({site.worker}, quarry));
    int stock = site.town.stock().stone; bool mined = false;
    for (int i = 0; i < 1000 && site.town.stock().stone == stock; ++i) {
        site.step(); mined |= site.town.person(site.worker)->activity == Activity::Mining;
    }
    CHECK(mined); CHECK(!site.exists()); CHECK_EQ(site.town.stock().stone, stock + 3);
    for (int i = 0; i < 600; ++i) {
        site.step(); const auto& p = *site.town.person(site.worker);
        CHECK(p.activity != Activity::Hauling || p.carrying > 0);
    }
    CHECK_EQ(site.town.stock().stone, stock + 3);
}

TEST(game_mining_claims_are_exclusive_and_new_move_orders_release_the_claim_immediately)
{
    MineSite site; int other = site.town.people()[1].id;
    CHECK(site.town.orderMine({site.worker}, site.cell)); CHECK(site.town.orderMine({other}, site.cell));
    site.step(.1);
    CHECK(site.town.person(site.worker)->activity == Activity::Mining);
    CHECK(site.town.person(other)->activity != Activity::Mining);
    auto goal = site.town.map().camp() + Point{-4, 0}; site.town.orderMove({site.worker}, goal); site.step(.2);
    CHECK(site.town.person(site.worker)->activity == Activity::Moving); CHECK_EQ(site.town.person(site.worker)->tree, -1); CHECK(site.exists());
}

TEST(game_mining_waits_for_storage_room_and_retries_without_losing_stone)
{
    MineSite site; CHECK(site.town.orderMine({site.worker}, site.cell));
    for (int i = 0; i < 500 && site.town.person(site.worker)->carrying == 0; ++i) site.step();
    site.town.reward({0, 0, site.town.capacity().stone - site.town.stock().stone});
    site.step(5); CHECK_EQ(site.town.person(site.worker)->carrying, 3);
    site.town.reward({0, 0, -3}); site.step(15);
    CHECK_EQ(site.town.person(site.worker)->carrying, 0); CHECK_EQ(site.town.stock().stone, site.town.capacity().stone);
}

TEST(game_mined_rocks_stay_depleted_when_a_map_is_saved_and_loaded)
{
    MineSite site;
    auto map = site.town.map(); map.at(site.cell % map.width(), site.cell / map.width()).quarried = true;
    MapDocument document(std::move(map)); te::test::Directory directory; std::string error; WorldMap loaded;
    auto path = directory.file("quarried.hearthmap"); CHECK(document.save(path, error)); CHECK(MapDocument::read(path, loaded, error));
    CHECK(loaded.at(site.cell % loaded.width(), site.cell / loaded.width()).quarried);
    CHECK(!mining::deposit(loaded, site.cell % loaded.width(), site.cell / loaded.width()));
}
