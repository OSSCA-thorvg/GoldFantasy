#include <test/test.h>
#include <game/application.h>
#include <test/graphics.h>
#include <game/game_app.h>
#include <game/map_document.h>
#include <game/town.h>
#include <game/tree_painter.h>
#include <algorithm>
#include <limits>

namespace
{
using namespace hearthold;
// A built camp, a laid road east of it and one tree south of it; both residents held by Stop, one picked out.
struct Yard
{
    GameApp game{5};
    Point camp, tree;
    int worker, other;
    double wall = 0;
    Yard()
    {
        MapDocument document(WorldMap::generate(5, 64, 64));
        camp = document.map().camp(); tree = camp + Point{3, 3};
        document.beginStroke(); document.paint(camp, 14, Terrain::Grass); document.endStroke();
        auto map = document.gameMap();
        for (int y = 0; y < map.height(); ++y)
            for (int x = 0; x < map.width(); ++x) map.at(x, y).trees = map.at(x, y).wild = 0;
        map.at(int(tree.x), int(tree.y)).trees = 1;
        game.state() = Town(std::move(map));
        auto& town = game.state(); town.scout(camp.x, camp.y, 16);
        CHECK(town.place(Structure::Camp, camp, 0)); town.completeConstruction();
        CHECK(town.buildRoad({RoadAnchor::sharp(camp + Point{1.2f, 0}), RoadAnchor::sharp(camp + Point{8, 0})}));
        town.completeConstruction(); town.advance(.01);
        worker = town.people()[0].id; other = town.people()[1].id;
        auto focus = project(camp.x + 2, camp.y + 1); game.view() = {focus.x, focus.y, 1.5f};
        game.togglePause(); hold();
    }
    void hold()
    {
        game.state().orderStop({worker, other});
        game.selectPeople({worker}); frame();
    }
    void frame(double seconds = -1) { wall = std::max(wall, seconds); game.render(1280, 800, wall); }
    Point screen(Point p) const { return const_cast<GameApp&>(game).view().toScreen(project(p.x, p.y), 1280, 800); }
    Point ground(Point s) const
    {
        auto at = const_cast<GameApp&>(game).view().toWorld(s, 1280, 800);
        return unproject(at.x, at.y);
    }
    void click(Point p, PointerButton button)
    {
        game.pointerDown(p.x, p.y, button); game.pointerUp(p.x, p.y, button); frame(); frame(wall + .25);
    }
    const Person& unit() { return *game.state().person(worker); }
    int tent(bool finished)
    {
        auto& town = game.state();
        auto spot = town.fit(Structure::Tent, camp + Point{4, -1.5f}, 0);
        CHECK(town.place(Structure::Tent, spot.center, spot.angle));
        int id = town.buildingAt(spot.center);
        if (finished) town.completeConstruction();
        hold();
        return id;
    }
    // A point on a building's drawing just above its footprint on screen, where the ground below is not its own.
    Point body(int id)
    {
        const auto& place = *game.state().building(id);
        float top = std::numeric_limits<float>::infinity();
        for (auto corner : place.footprint().corners()) top = std::min(top, screen(corner).y);
        Point at{screen(place.center).x, top - 4};
        CHECK(game.state().buildingAt(ground(at)) != id);
        return at;
    }
};
}

TEST(game_right_click_on_open_ground_puts_the_unit_to_work_nearby)
{
    // The user: a right click means go there, and if there is work about, do it.
    te::test::Graphics graphics;
    {
        Yard field;  // A tree a couple of paces from where the click lands: fell it.
        auto foot = treePosition(field.game.state().map(), int(field.tree.x), int(field.tree.y), 0);
        field.click(field.screen(foot + Point{2, 1}), PointerButton::Secondary);
        CHECK(field.unit().task == Activity::Felling);
        CHECK_EQ(field.unit().taskSite, int(field.tree.y) * 64 + int(field.tree.x));
    }
    {
        Yard field;  // A building site there comes first.
        int site = field.tent(false);
        field.click(field.screen(field.game.state().building(site)->center + Point{1.4f, 1.4f}), PointerButton::Secondary);
        CHECK(field.unit().task == Activity::Building);
        CHECK_EQ(field.unit().taskSite, site);
    }
    {
        Yard field;  // Nothing to do there: just go.
        field.click(field.screen(field.camp + Point{-6, 6}), PointerButton::Secondary);
        CHECK(field.unit().task == Activity::Moving);
    }
}

TEST(game_right_click_on_a_home_drawing_sends_the_unit_in_to_rest_and_a_left_click_picks_it)
{
    // A right click on the resident's own home means go in and rest. A building's body stands above its
    // footprint on screen, and clicking that is clicking the building.
    te::test::Graphics graphics;
    Yard field;
    int home = field.tent(true);
    const_cast<Person&>(field.unit()).home = home;
    auto tent = field.body(home);
    field.click(tent, PointerButton::Secondary);
    CHECK(field.unit().task == Activity::Sleeping);
    CHECK_EQ(field.unit().taskSite, home);
    field.hold();
    int camp = field.game.state().buildingAt(field.camp);
    field.click(field.body(camp), PointerButton::Secondary);
    CHECK(field.unit().task != Activity::Sleeping);
    CHECK_EQ(field.unit().taskSite, -1);
    CHECK(field.unit().task == Activity::Moving);
    CHECK(!field.unit().path.empty());
    CHECK(distance(field.unit().path.back(), field.game.state().building(camp)->door()) < .3f);
    field.game.selectPeople({}); field.frame();
    field.click(tent, PointerButton::Primary);
    CHECK_EQ(field.game.selectedBuilding(), home);
}

TEST(game_letter_keys_reach_the_game_past_an_input_method_while_playing)
{
    // The user: keyboard orders (attack, move...) did nothing. An input method composing text (Korean, Japanese,
    // Chinese) swallows the letter keys the game's orders use, so text input stays off while nothing takes typing.
    te::test::Graphics graphics;
    auto app = createApplication();
    app->render(1280, 800, 0);
    CHECK(app->command("ui.text-input", "off"));
#if HEARTHOLD_WITH_EDITOR
    CHECK(app->command("edit.character", {}));
    app->render(1280, 800, .1);
    CHECK(!app->command("ui.text-input", "off"));  // The character editor has names to type.
#endif
}
