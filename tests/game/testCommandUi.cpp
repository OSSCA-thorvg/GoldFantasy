#include "common/hud_text.h"
#include <test/test.h>
#include <test/graphics.h>
#include <game/application.h>
#include <game/game_app.h>
#include <game/map_document.h>
#include <game/tree_painter.h>

namespace
{
using namespace hearthold;
struct CommandScene
{
    GameApp game{5};
    Point camp, tree;
    int worker, other;
    double wall = 0;
    CommandScene()
    {
        MapDocument document(WorldMap::generate(5, 64, 64));
        camp = document.map().camp(); tree = camp + Point{3, 3};
        document.beginStroke(); document.paint(camp, 12, Terrain::Grass); document.endStroke();
        auto map = document.gameMap();
        for (int y = 0; y < map.height(); ++y)
            for (int x = 0; x < map.width(); ++x) map.at(x, y).trees = map.at(x, y).wild = 0;
        map.at(int(tree.x), int(tree.y)).trees = 1;
        game.state() = Town(std::move(map));
        auto& town = game.state(); town.scout(camp.x, camp.y, 14);
        CHECK(town.place(Structure::Camp, camp, 0)); town.completeConstruction();
        CHECK(town.buildRoad({RoadAnchor::sharp(camp + Point{1.2f, 0}), RoadAnchor::sharp(camp + Point{8, 0})}));
        town.completeConstruction(); town.advance(.01);
        worker = town.people()[0].id; other = town.people()[1].id;
        town.orderStop({worker, other});
        auto focus = project(camp.x, camp.y); game.view() = {focus.x, focus.y, 1};
        game.selectPeople({}); game.togglePause(); frame();
    }
    void frame(double seconds = -1) { wall = std::max(wall, seconds); game.render(1280, 800, wall); }
    Point screen(Point p) const { return const_cast<GameApp&>(game).view().toScreen(project(p.x, p.y), 1280, 800); }
    void click(Point p, PointerButton button = PointerButton::Primary)
    {
        game.pointerDown(p.x, p.y, button); game.pointerUp(p.x, p.y, button); frame(); frame(wall + .25);
    }
    bool button(const char* label)
    {
        frame(wall + .3);
        auto found = test::textBounds(game.hudScene(), label); CHECK(!found.empty());
        if (found.empty()) return false;
        const auto& r = found.back(); click({r.x + r.w / 2, r.y + r.h / 2}); return true;
    }
    int buildTent(float offset = 4)
    {
        game.pointerMove(640, 784); frame(); frame(wall + .3);
        if (!button("Housing") || !button("Tent")) return -1;
        auto spot = game.state().fit(Structure::Tent, camp + Point{offset, -1.5f}, 0);
        click(screen(spot.center)); return game.state().buildingAt(spot.center);
    }
};
}

TEST(game_keyboard_commands_show_target_cursors_and_stop_clears_them)
{
    te::test::Graphics graphics;
    auto app = createApplication(); app->render(1280, 800, 0);
    ui::AppEvent pointer{}; pointer.type = ui::AppEvent::Type::PointerMove; pointer.x = 600; pointer.y = 300; app->event(pointer);
    ui::AppEvent key{}; key.type = ui::AppEvent::Type::KeyDown;
    for (auto command : {"m", "a", "w"}) {
        key.text = command; app->event(key); app->render(1280, 800, 0);
        CHECK(app->command("ui.cursor", "crosshair"));
        key.text = "s"; key.control = true; app->event(key); app->render(1280, 800, 0);
        CHECK(app->command("ui.cursor", "crosshair")); key.control = false;
        key.text = "s"; app->event(key); app->render(1280, 800, 0);
        CHECK(!app->command("ui.cursor", "crosshair"));
    }
}

TEST(game_normal_tree_can_be_selected_and_attack_or_work_click_orders_chopping)
{
    te::test::Graphics graphics;
    for (auto command : {GameApp::Order::Attack, GameApp::Order::Work}) {
        CommandScene scene;
        auto tree = treeAt(scene.game.state().map(), int(scene.tree.x), int(scene.tree.y), 0);
        auto point = scene.screen(tree.foot); point.y -= 12 * tree.size;
        scene.click(point); CHECK_EQ(scene.game.selectedTreeCell(), int(scene.tree.y) * 64 + int(scene.tree.x));
        scene.game.selectPeople({scene.worker}); scene.frame(); scene.game.prepare(command);
        scene.game.pointerDown(point.x, point.y, PointerButton::Secondary);
        scene.game.pointerUp(point.x, point.y, PointerButton::Secondary);
        const auto& worker = *scene.game.state().person(scene.worker);
        CHECK(worker.task == Activity::Felling); CHECK_EQ(worker.taskSite, int(scene.tree.y) * 64 + int(scene.tree.x));
    }
}

TEST(game_taskbar_build_assigns_an_idle_manual_unit_without_interrupting_a_busy_unit)
{
    te::test::Graphics graphics;
    CommandScene scene;
    scene.game.state().orderMove({scene.other}, scene.camp + Point{7, 0});
    int site = scene.buildTent(); CHECK(site >= 0);
    const auto& worker = *scene.game.state().person(scene.worker);
    CHECK(!worker.autoMode); CHECK(worker.task == Activity::Building); CHECK_EQ(worker.taskSite, site);
    CHECK(scene.game.state().person(scene.other)->task == Activity::Moving);
}

TEST(game_unit_build_menu_uses_the_selected_unit)
{
    te::test::Graphics graphics;
    CommandScene scene; scene.game.selectPeople({scene.other}); scene.frame(); scene.frame(scene.wall + .3);
    auto build = test::textBounds(scene.game.hudScene(), "Build"); CHECK_EQ(build.size(), size_t(1));
    if (build.empty()) return;
    auto unit = std::min_element(build.begin(), build.end(), [](const auto& a, const auto& b) { return a.y < b.y; });
    scene.click({unit->x + unit->w / 2, unit->y + unit->h / 2});
    if (!scene.button("Housing") || !scene.button("Tent")) return;
    auto spot = scene.game.state().fit(Structure::Tent, scene.camp + Point{4, -1.5f}, 0);
    scene.click(scene.screen(spot.center));
    CHECK(scene.game.state().person(scene.other)->task == Activity::Building);
    CHECK(scene.game.state().person(scene.worker)->task == Activity::Idle);
}

TEST(game_stop_does_not_immediately_reassign_old_global_tasks_but_new_tasks_can_use_the_unit)
{
    te::test::Graphics graphics;
    CommandScene scene;
    scene.game.state().orderMove({scene.other}, scene.camp + Point{7, 0});
    CHECK(scene.buildTent() >= 0);
    scene.game.selectPeople({scene.worker}); scene.game.stopSelected();
    scene.game.setSpeed(1); double start = scene.wall; scene.frame(start);
    for (int i = 1; i <= 10; ++i) scene.frame(start + i * .1);
    CHECK(scene.game.state().person(scene.worker)->task == Activity::Idle);
    scene.game.selectPeople({}); scene.frame(scene.wall + .1);
    int site = scene.buildTent(6); CHECK(site >= 0);
    CHECK_EQ(scene.game.state().person(scene.worker)->taskSite, site);
}

TEST(game_housing_panel_lists_residents_and_clicking_a_name_selects_that_unit)
{
    te::test::Graphics graphics;
    CommandScene scene; int home = scene.buildTent(); CHECK(home >= 0); if (home < 0) return;
    scene.game.state().completeConstruction(); scene.game.state().orderStop({scene.worker, scene.other});
    const_cast<Person&>(*scene.game.state().person(scene.worker)).home = home;
    scene.game.selectBuilding(home); scene.frame();
    if (!scene.button("Askr")) return;
    CHECK(scene.game.selectedPeople() == std::vector<int>{scene.worker});
}

TEST(game_right_clicking_own_housing_sends_selected_unit_to_rest_and_leave_returns_control)
{
    te::test::Graphics graphics;
    CommandScene scene; int home = scene.buildTent(); CHECK(home >= 0); if (home < 0) return;
    scene.game.state().completeConstruction(); scene.game.state().orderStop({scene.worker, scene.other});
    const_cast<Person&>(*scene.game.state().person(scene.other)).home = home;
    scene.game.selectPeople({scene.other}); scene.frame();
    auto point = scene.screen(scene.game.state().building(home)->center);
    scene.game.pointerDown(point.x, point.y, PointerButton::Secondary);
    scene.game.pointerUp(point.x, point.y, PointerButton::Secondary);
    const auto* p = scene.game.state().person(scene.other);
    CHECK(p->task == Activity::Sleeping); CHECK_EQ(p->taskSite, home);
    scene.game.state().advance(20); scene.frame(); CHECK(p->inside);
    scene.game.selectBuilding(home); scene.frame();
    if (!scene.button("Leave")) return;
    scene.game.state().advance(5); scene.frame(); CHECK(!p->inside); CHECK(!p->crossingDoorway());
    CHECK(scene.game.selectedPeople() == std::vector<int>{scene.other});
}

TEST(game_unit_hud_shows_multiple_condition_tags_separately_from_the_action)
{
    te::test::Graphics graphics;
    CommandScene scene; auto& p = const_cast<Person&>(*scene.game.state().person(scene.worker));
    p.food = .2f; p.rest = .1f; p.stress = .9f; p.health = .5f;
    auto& weather = const_cast<Climate&>(scene.game.state().climate());
    weather.temperature = -5; weather.weather = Weather::Snow; weather.intensity = 1;
    scene.game.selectPeople({scene.worker}); scene.frame(); scene.frame(scene.wall + .3);
    for (auto label : {"Hungry", "Cold", "Exhausted", "Snowed on", "Wounded", "Breaking down"})
        CHECK(!test::textBounds(scene.game.hudScene(), label).empty());
    CHECK(p.activity == Activity::Holding);
}

TEST(game_move_cursor_on_a_tree_keeps_the_new_move_command_instead_of_chopping)
{
    te::test::Graphics graphics; CommandScene scene;
    auto tree = treeAt(scene.game.state().map(), int(scene.tree.x), int(scene.tree.y), 0);
    auto point = scene.screen(tree.foot); point.y -= 12 * tree.size;
    scene.game.selectPeople({scene.worker}); scene.frame(); scene.game.prepare(GameApp::Order::Move); scene.click(point, PointerButton::Secondary);
    CHECK(scene.game.state().person(scene.worker)->task == Activity::Moving);
    CHECK_EQ(scene.game.state().person(scene.worker)->tree, -1);
}

TEST(game_context_dock_opens_only_at_the_thin_center_handle_and_animates_while_paused)
{
    te::test::Graphics graphics; CommandScene scene;
    auto bar = scene.game.contextPanelBounds(); double clock = scene.game.state().clock();
    CHECK(bar.w <= 120); CHECK(bar.h <= 10); CHECK(std::abs(bar.x + bar.w / 2 - 640) < .01f);
    scene.game.pointerMove(60, 784); scene.frame(.3);
    CHECK(test::textBounds(scene.game.hudScene(), "Housing").empty());
    scene.game.pointerMove(640, 784); scene.frame(.31); scene.frame(.39);
    auto halfway = scene.game.contextPanelBounds();
    CHECK(halfway.w > bar.w); CHECK(halfway.w < 606); CHECK(scene.game.animatingUi());
    CHECK(std::abs(halfway.x + halfway.w / 2 - 640) < .01f);
    scene.frame(.65); CHECK(!test::textBounds(scene.game.hudScene(), "Housing").empty());
    CHECK(scene.game.contextPanelBounds().h < 100);
    scene.game.pointerMove(0, 0); scene.frame(.7); scene.frame(1);
    CHECK(scene.game.contextPanelBounds().h <= 10); CHECK(!scene.game.animatingUi());
    CHECK_EQ(scene.game.state().clock(), clock);
}

TEST(game_context_dock_morphs_between_menu_pages_with_content_sized_centered_bounds)
{
    te::test::Graphics graphics; CommandScene scene;
    scene.game.pointerMove(640, 784); scene.frame(); scene.frame(.3);
    auto root = scene.game.contextPanelBounds();
    auto housing = test::textBounds(scene.game.hudScene(), "Housing"); CHECK_EQ(housing.size(), size_t(1));
    if (housing.empty()) return;
    auto r = housing.front();
    scene.game.pointerDown(r.x + r.w / 2, r.y + r.h / 2, PointerButton::Primary);
    scene.game.pointerUp(r.x + r.w / 2, r.y + r.h / 2, PointerButton::Primary);
    scene.frame(.31); scene.frame(.39);
    auto between = scene.game.contextPanelBounds(); CHECK(between.w < root.w); CHECK(between.w > 244);
    CHECK(std::abs(between.x + between.w / 2 - 640) < .01f);
    scene.frame(.6); auto small = scene.game.contextPanelBounds(); CHECK_EQ(small.w, 244.f);
    CHECK_EQ(test::textBounds(scene.game.hudScene(), "Tent").size(), size_t(1));
    CHECK(scene.button("Back")); CHECK(scene.button("Food"));
    CHECK(scene.game.contextPanelBounds().w > small.w); CHECK(scene.game.contextPanelBounds().w < root.w);
}

TEST(game_context_dock_replaces_global_build_with_unit_info_and_suppresses_the_hover_bar)
{
    te::test::Graphics graphics; CommandScene scene;
    scene.game.pointerMove(640, 784); scene.frame(); scene.frame(.3);
    auto menu = scene.game.contextPanelBounds();
    scene.game.selectPeople({scene.worker}); scene.frame(.31); scene.frame(.4);
    auto between = scene.game.contextPanelBounds(); CHECK(between.h > menu.h); CHECK(scene.game.animatingUi());
    scene.frame(.65); scene.game.pointerMove(640, 784); scene.frame(1);
    CHECK(test::textBounds(scene.game.hudScene(), "Housing").empty());
    CHECK_EQ(test::textBounds(scene.game.hudScene(), "Build").size(), size_t(1));
    CHECK_EQ(test::textBounds(scene.game.hudScene(), "Askr").size(), size_t(1));
    CHECK(scene.game.contextPanelBounds().w <= 650);
}

TEST(game_context_dock_changes_selected_unit_during_a_menu_morph_without_stale_commands)
{
    te::test::Graphics graphics; CommandScene scene;
    scene.game.selectPeople({scene.worker}); scene.frame(); scene.frame(.3);
    CHECK(scene.button("Build")); CHECK(scene.button("Housing"));
    scene.game.selectPeople({scene.other}); scene.frame(scene.wall + .01); scene.frame(scene.wall + .08);
    CHECK(scene.game.animatingUi()); scene.frame(scene.wall + .3);
    CHECK_EQ(test::textBounds(scene.game.hudScene(), "Embla").size(), size_t(1));
    CHECK(test::textBounds(scene.game.hudScene(), "Askr").empty());
    CHECK(test::textBounds(scene.game.hudScene(), "Tent").empty());
    CHECK(scene.button("Move  M"));
    auto destination = scene.camp + Point{-4, -2}; scene.click(scene.screen(destination), PointerButton::Secondary);
    CHECK(scene.game.state().person(scene.other)->task == Activity::Moving);
    CHECK(scene.game.state().person(scene.worker)->task == Activity::Idle);
}

TEST(game_context_dock_reverses_an_interrupted_morph_from_its_current_bounds)
{
    te::test::Graphics graphics; CommandScene scene;
    scene.game.pointerMove(640, 784); scene.frame(.01); scene.frame(.08);
    auto first = scene.game.contextPanelBounds();
    scene.game.pointerMove(1000, 200); scene.frame(.08);
    auto reversed = scene.game.contextPanelBounds(); CHECK_EQ(first.w, reversed.w); CHECK_EQ(first.h, reversed.h);
    scene.frame(.13); auto smaller = scene.game.contextPanelBounds(); CHECK(smaller.w < first.w);
    scene.game.pointerMove(640, 784); scene.frame(.13);
    CHECK_EQ(scene.game.contextPanelBounds().w, smaller.w);
    scene.frame(.5); CHECK(!test::textBounds(scene.game.hudScene(), "Housing").empty());
}

TEST(game_context_dock_wraps_buttons_and_keeps_the_surface_centered_in_a_narrow_viewport)
{
    te::test::Graphics graphics; CommandScene scene;
    scene.game.render(420, 520, 0); scene.game.pointerMove(210, 504);
    scene.game.render(420, 520, .01); scene.game.render(420, 520, .3);
    auto panel = scene.game.contextPanelBounds(); CHECK(panel.w <= 396); CHECK(panel.x >= 12);
    CHECK(std::abs(panel.x + panel.w / 2 - 210) < .01f);
    for (auto label : {"Roads", "Housing", "Food", "Water", "Trade", "Lodging", "Faith"}) {
        auto text = test::textBounds(scene.game.hudScene(), label); CHECK_EQ(text.size(), size_t(1));
        if (text.empty()) continue;
        CHECK(text.front().x >= panel.x); CHECK(text.front().x + text.front().w <= panel.x + panel.w);
        CHECK(text.front().y >= panel.y); CHECK(text.front().y + text.front().h <= panel.y + panel.h);
    }
}

TEST(game_context_dock_resizing_keeps_content_live_without_accumulating_transition_snapshots)
{
    te::test::Graphics graphics; CommandScene scene;
    scene.game.selectPeople({scene.worker}); scene.frame(); scene.frame(.3);
    auto depth = [&](auto&& self, tvg::Paint* paint) -> int {
        int result = 1;
        if (paint->type() == tvg::Type::Scene)
            for (auto child : static_cast<tvg::Scene*>(paint)->paints()) result = std::max(result, 1 + self(self, child));
        return result;
    };
    int baseline = depth(depth, scene.game.hudScene());
    for (int i = 0; i < 24; ++i) {
        float width = 420.f + i * 2;
        scene.game.render(width, 520, .31 + i * .01);
        auto panel = scene.game.contextPanelBounds();
        CHECK(panel.w <= width - 24); CHECK(panel.x >= 12);
        CHECK(depth(depth, scene.game.hudScene()) <= baseline + 3);
    }
}

TEST(game_rocks_are_selectable_and_attack_or_work_orders_start_mining)
{
    te::test::Graphics graphics;
    for (auto command : {GameApp::Order::Attack, GameApp::Order::Work}) {
        CommandScene scene; auto& map = const_cast<WorldMap&>(scene.game.state().map());
        int cell = -1;
        for (int x = int(scene.camp.x) + 4; x <= int(scene.camp.x) + 7; ++x) {
            int y = int(scene.camp.y) + 1; map.at(x, y).terrain = Terrain::Rock; map.at(x, y).trees = 0;
            if (mining::deposit(map, x, y)) { cell = y * map.width() + x; break; }
        }
        CHECK(cell >= 0); if (cell < 0) return;
        auto point = scene.screen(mining::position(cell % map.width(), cell / map.width())); point.y -= 4;
        scene.click(point); CHECK_EQ(scene.game.selectedRockCell(), cell);
        scene.game.selectPeople({scene.worker}); scene.frame(); scene.game.prepare(command); scene.click(point, PointerButton::Secondary);
        CHECK(scene.game.state().person(scene.worker)->task == Activity::Mining); CHECK_EQ(scene.game.state().person(scene.worker)->taskSite, cell);
    }
}

TEST(game_right_click_workplace_assigns_job_instead_of_relaxing)
{
    te::test::Graphics graphics;
    CommandScene scene;
    auto& town = scene.game.state();
    auto spot = town.fit(Structure::Tavern, scene.camp + Point{4, -2}, 0);
    CHECK(town.place(Structure::Tavern, spot.center, spot.angle)); town.completeConstruction();
    int id = town.buildingAt(spot.center);
    scene.game.selectPeople({scene.worker}); scene.frame();
    auto point = scene.screen(spot.center);
    scene.game.pointerDown(point.x, point.y, PointerButton::Secondary);
    scene.game.pointerUp(point.x, point.y, PointerButton::Secondary);
    CHECK_EQ(town.person(scene.worker)->job, id);
    CHECK(town.person(scene.worker)->task == Activity::Working);
}

TEST(game_left_click_home_selects_without_ordering_selected_unit)
{
    te::test::Graphics graphics;
    CommandScene scene;
    int home = scene.buildTent();
    scene.game.state().completeConstruction();
    scene.game.state().orderStop({scene.worker});
    scene.game.selectPeople({scene.worker}); scene.frame();
    auto point = scene.screen(scene.game.state().building(home)->center);
    scene.click(point);
    CHECK_EQ(scene.game.selectedBuilding(), home);
    CHECK(scene.game.state().person(scene.worker)->task == Activity::Idle);
}

TEST(game_lodging_inspector_lists_guests_and_clicking_does_not_order_resident_rest)
{
    te::test::Graphics graphics;
    CommandScene scene; auto& town = scene.game.state();
    auto spot = town.fit(Structure::Hostel, scene.camp + Point{5, 1.8f}, 0);
    CHECK(town.place(Structure::Hostel, spot.center, spot.angle)); town.completeConstruction();
    int lodging = town.buildingAt(spot.center);
    town.recruit(Role::Guest, Calling::Traveller, 1);
    scene.game.selectPeople({scene.worker}); scene.frame();
    scene.click(scene.screen(spot.center));
    CHECK_EQ(scene.game.selectedBuilding(), lodging);
    CHECK(town.person(scene.worker)->task == Activity::Idle);
    CHECK_EQ(test::textBounds(scene.game.hudScene(), "Guests 1  -  click a name to inspect").size(), size_t(1));
}

TEST(game_tree_command_without_storage_moves_instead_of_showing_failure)
{
    te::test::Graphics graphics;
    CommandScene scene;
    scene.game.state() = Town(scene.game.state().map());
    scene.game.state().scout(scene.camp.x, scene.camp.y, 14);
    scene.worker = scene.game.state().people().front().id;
    scene.game.state().orderStop({scene.worker});
    scene.game.selectPeople({scene.worker}); scene.frame();
    auto tree = treeAt(scene.game.state().map(), int(scene.tree.x), int(scene.tree.y), 0);
    auto point = scene.screen(tree.foot); point.y -= 12 * tree.size;
    scene.game.pointerDown(point.x, point.y, PointerButton::Secondary);
    scene.game.pointerUp(point.x, point.y, PointerButton::Secondary);
    CHECK(scene.game.state().person(scene.worker)->task == Activity::Moving);
    CHECK(!scene.game.state().person(scene.worker)->path.empty());
}

TEST(game_left_click_while_preparing_order_preserves_selection_until_right_click)
{
    te::test::Graphics graphics;
    for (auto order : {GameApp::Order::Move, GameApp::Order::Attack, GameApp::Order::Work}) {
        CommandScene scene;
        scene.game.selectPeople({scene.worker}); scene.frame();
        scene.game.prepare(order);
        auto point = scene.screen(scene.camp + Point{-6, 6});
        scene.click(point);
        CHECK(scene.game.selectedPeople() == std::vector<int>{scene.worker});
        CHECK(scene.game.state().person(scene.worker)->task == Activity::Idle);
        scene.game.pointerDown(point.x, point.y, PointerButton::Secondary);
        scene.game.pointerUp(point.x, point.y, PointerButton::Secondary);
        CHECK(scene.game.selectedPeople() == std::vector<int>{scene.worker});
        CHECK(scene.game.state().person(scene.worker)->task == Activity::Moving);
    }
}
