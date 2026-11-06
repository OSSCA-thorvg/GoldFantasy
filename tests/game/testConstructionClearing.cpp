#include <test/test.h>
#include <game/map_document.h>
#include <game/town.h>

namespace
{
using namespace hearthold;
struct ClearingSite
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
    ClearingSite(bool found = true)
    {
        town.scout(camp.x, camp.y, 16);
        if (found) { CHECK(town.place(Structure::Camp, camp, 0)); town.completeConstruction(); }
        town.advance(.01);
        for (const auto& p : town.people()) town.orderStop({p.id});
    }
    Point tree(Point at)
    {
        auto& map = const_cast<WorldMap&>(town.map()); map.at(int(at.x), int(at.y)).trees = 1;
        return treePosition(map, int(at.x), int(at.y), 0);
    }
    int trees(Point at) const { return town.map().at(int(at.x), int(at.y)).trees; }
    void step() { const_cast<std::vector<Monster>&>(town.monsters()).clear(); town.advance(.1); }
};
}

TEST(game_building_plans_leave_trees_until_the_builder_chops_and_delivers_them)
{
    ClearingSite site;
    CHECK(site.town.buildRoad({RoadAnchor::sharp(site.camp + Point{1.2f, 0}), RoadAnchor::sharp(site.camp + Point{6, 0})}));
    site.town.completeConstruction();
    auto treeCell = site.camp + Point{3, 1}; auto foot = site.tree(treeCell);
    CHECK_EQ(site.town.canPlace(Structure::Tent, foot, 0).reason, std::string());
    CHECK(site.town.place(Structure::Tent, foot, 0));
    int id = site.town.buildingAt(foot), stock = site.town.wood();
    if (id < 0) return;
    CHECK_EQ(site.trees(treeCell), 1);
    CHECK(site.town.orderBuild({site.worker}, id));
    bool carried = false, delivered = false;
    for (int i = 0; i < 1300; ++i) {
        site.step();
        const auto& p = *site.town.person(site.worker);
        carried |= p.carrying > 0; delivered |= site.town.wood() == stock + 3;
        if (site.trees(treeCell)) CHECK_EQ(site.town.building(id)->progress, 0.f);
        if (!delivered) CHECK_EQ(site.town.wood(), stock);
        if (delivered && site.town.building(id)->built()) break;
    }
    CHECK(carried); CHECK(delivered); CHECK_EQ(site.trees(treeCell), 0); CHECK(site.town.building(id)->built());
}

TEST(game_road_plans_wait_for_real_tree_clearance_and_wood_delivery)
{
    ClearingSite site;
    auto treeCell = site.camp + Point{4, 0}; auto foot = site.tree(treeCell);
    CHECK(site.town.buildRoad({RoadAnchor::sharp(site.camp + Point{1.2f, 0}), RoadAnchor::sharp(foot), RoadAnchor::sharp(site.camp + Point{8, 0})}));
    int id = site.town.roads().roads().back().id, stock = site.town.wood();
    CHECK_EQ(site.trees(treeCell), 1); CHECK(site.town.orderRoadwork({site.worker}, id));
    bool carried = false, delivered = false;
    for (int i = 0; i < 1500; ++i) {
        site.step();
        carried |= site.town.person(site.worker)->carrying > 0; delivered |= site.town.wood() == stock + 3;
        if (site.trees(treeCell)) CHECK(site.town.roads().roads().back().built < .6f);
        if (delivered && site.town.roads().roads().back().built >= 1) break;
    }
    CHECK(carried); CHECK(delivered); CHECK_EQ(site.trees(treeCell), 0); CHECK_EQ(site.town.roads().road(id)->built, 1.f);
}

TEST(game_first_camp_can_clear_its_foundation_before_there_is_a_storage_depot)
{
    ClearingSite site(false);
    auto treeCell = site.camp; site.tree(treeCell);
    CHECK(site.town.place(Structure::Camp, site.camp, 0));
    int id = site.town.buildingAt(site.camp), stock = site.town.wood();
    CHECK(site.town.orderBuild({site.worker}, id));
    for (int i = 0; i < 1600; ++i) {
        site.step();
        if (site.town.building(id)->built() && site.town.wood() == stock + 3) break;
    }
    CHECK(site.town.building(id)->built()); CHECK_EQ(site.trees(treeCell), 0); CHECK_EQ(site.town.wood(), stock + 3);
}
