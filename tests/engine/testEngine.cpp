#include <test/test.h>
#include <test/graphics.h>
#include <test/directory.h>
#include <GameEngine/engine.h>
#include <GameEngine/layout.h>
#include <fstream>
#include <chrono>
#include <set>

namespace
{
class Module final : public ui::Application
{
    ui::Context context;
    ui::Theme theme = ui::Theme::dark();
public:
    double seconds = -1, speed = 1;
    int resets = 0;
    int events = 0;
    float viewWidth = 0, viewHeight = 0;
    ui::AppEvent last{};
    std::set<std::string> pressedKeys;
    std::string playback = "playing";
    std::vector<std::string> playbackChanges;
    std::string title() const override { return "Test module"; }
    tvg::Scene* scene() const override { return context.scene(); }
    void render(float width, float height, double time) override
    {
        seconds = time;
        viewWidth = width; viewHeight = height;
        context.begin(theme, {0, 0, width, height}, time); context.end();
    }
    void event(const ui::AppEvent& event) override
    {
        last = event;
        ++events;
        if (event.type == ui::AppEvent::Type::KeyDown) pressedKeys.insert(event.text);
        else if (event.type == ui::AppEvent::Type::KeyUp) pressedKeys.erase(event.text);
    }
    std::vector<ui::Property> properties() const override { return {{"speed", "Speed", speed, 0, 10, 1}}; }
    bool property(std::string_view id, double value) override { if (id != "speed") return false; speed = value; return true; }
    bool command(std::string_view id, std::string_view argument) override
    {
        if (id == "runtime.playback") {
            playback = argument;
            playbackChanges.push_back(playback);
            return true;
        }
        if (id != "reset") return false;
        speed = 1; ++resets; return true;
    }
};
}

TEST(engine_notifies_module_of_initial_play_pause_stop_and_resume)
{
    te::test::Graphics graphics;
    auto module = std::make_shared<Module>();
    auto app = engine::create(module, {});
    CHECK_EQ(module->playback, std::string("stopped"));
    app->render(1000, 700, 0);
    app->render(1000, 700, .1);
    CHECK_EQ(module->playback, std::string("stopped"));
    CHECK(app->command("pause"));
    CHECK_EQ(module->playback, std::string("stopped"));
    CHECK(app->command("play"));
    CHECK_EQ(module->playback, std::string("playing"));
    CHECK(app->command("pause"));
    CHECK_EQ(module->playback, std::string("paused"));
    CHECK(app->command("play"));
    CHECK_EQ(module->playback, std::string("playing"));
    CHECK(app->command("stop"));
    CHECK_EQ(module->playback, std::string("stopped"));
    app->render(1000, 700, .2);
    CHECK_EQ(module->playbackChanges.size(), size_t(5));
}

TEST(engine_time_controls_scale_only_playback_and_step_a_paused_frame)
{
    te::test::Graphics graphics;
    auto module = std::make_shared<Module>();
    auto app = engine::create(module, {});
    auto time = [&] {
        for (const auto& property : app->properties()) if (property.id == "engine.time") return property.value;
        return -1.;
    };
    app->render(1280, 800, 0);
    CHECK(app->command("time-scale", "2"));
    app->render(1280, 800, 5);
    CHECK_EQ(time(), 0.0);
    CHECK(app->command("play"));
    app->render(1280, 800, 5.1);
    CHECK(std::abs(time() - .2) < .00001);
    CHECK(app->command("pause"));
    app->render(1280, 800, 5.2);
    CHECK(std::abs(time() - .2) < .00001);
    CHECK(app->command("step"));
    app->render(1280, 800, 5.3);
    CHECK(std::abs(time() - .2 - 1.0 / 60) < .00001);
    auto stepped = time();
    app->render(1280, 800, 6);
    CHECK_EQ(time(), stepped);
    CHECK_EQ(module->playback, std::string("paused"));
    CHECK(!app->command("time-scale", "nan"));
    CHECK(!app->command("time-scale", "0"));
    CHECK(!app->property("engine.time", 100));
    CHECK(app->command("stop"));
    CHECK_EQ(time(), 0.0);
    CHECK(app->command("step"));
    app->render(1280, 800, 7);
    CHECK(std::abs(time() - 1.0 / 60) < .00001);
}

TEST(engine_edit_preview_does_not_execute_script_frames_or_share_play_state)
{
    te::test::Graphics graphics;
    te::test::Directory directory;
    auto path = directory.file("scene.lua");
    std::ofstream(path) << R"(
local draws = 0
return {
    properties = {{id='size',value=2,minimum=1,maximum=10}},
    state = {ticks=0},
    update = function(state,dt) state.ticks=state.ticks+dt end,
    draw = function(ui,state,view,p)
        draws=draws+1
        if view.time==0 then assert(draws==1 and state.ticks==0) end
        state.ticks=state.ticks+1
        ui.rect{x=10,y=10,width=p.size*10,height=20,color='accent'}
    end
})";
    auto app = engine::create({}, path);
    for (double t : {0., .1, 1.}) app->render(900, 600, t);
    CHECK(app->property("size", 3));
    app->render(900, 600, 1.1);  // Rebuild an isolated preview after an authored edit.
    CHECK(app->command("play"));
    CHECK(app->property("size", 8));
    app->render(900, 600, 1.2);
    CHECK(app->command("pause"));
    app->render(900, 600, 1.3);
    app->render(900, 600, 1.4);
    CHECK(app->command("stop"));
    CHECK_EQ(app->properties().front().value, 3.0);
    app->render(900, 600, 1.5);
    CHECK(app->command("play"));
}

TEST(engine_runtime_errors_suspend_module_playback_and_closing_stops_it)
{
    te::test::Graphics graphics;
    te::test::Directory directory;
    auto path = directory.file("broken.lua");
    std::ofstream(path) << "return {update=function() error('broken update') end,draw=function() end}";
    auto module = std::make_shared<Module>();
    {
        auto app = engine::create(module, path);
        app->render(1000, 700, 0);
        CHECK(app->command("play"));
        app->render(1000, 700, .1);
        CHECK_EQ(module->playback, std::string("paused"));
        CHECK(!app->command("play"));
    }
    CHECK_EQ(module->playback, std::string("stopped"));
}

TEST(engine_canvas_toolbar_controls_playback_without_forwarding_clicks_to_the_game)
{
    te::test::Graphics graphics;
    auto module = std::make_shared<Module>();
    auto app = engine::create(module, {});
    app->render(1440, 900, 0);
    auto panels = engine::layout(1440, 900, true);
    auto click = [&](ui::Rect button) {
        ui::AppEvent event{};
        event.x = button.x + button.w / 2; event.y = button.y + button.h / 2;
        event.type = ui::AppEvent::Type::PointerDown; app->event(event);
        event.type = ui::AppEvent::Type::PointerUp; app->event(event);
    };
    click(panels.pause);  // Disabled until Play.
    CHECK_EQ(module->playback, std::string("stopped"));
    click(panels.play);
    app->render(1440, 900, .1);
    CHECK_EQ(module->playback, std::string("playing"));
    click(panels.pause);
    app->render(1440, 900, .2);
    CHECK_EQ(module->playback, std::string("paused"));
    CHECK_EQ(module->seconds, .1);
    click(panels.play);
    app->render(1440, 900, .3);
    CHECK_EQ(module->playback, std::string("playing"));
    click(panels.stop);
    app->render(1440, 900, .4);
    CHECK_EQ(module->playback, std::string("stopped"));
    CHECK_EQ(module->seconds, 0.0);
    CHECK_EQ(module->events, 0);
}

TEST(engine_module_play_pause_stop_keeps_authored_properties_and_translates_input)
{
    te::test::Graphics graphics;
    auto module = std::make_shared<Module>();
    auto app = engine::create(module, {});
    app->render(1000, 700, 0);
    CHECK_EQ(module->seconds, 0.0);
    CHECK(app->command("play"));
    app->render(1000, 700, .1);
    CHECK_EQ(module->seconds, .1);
    CHECK(app->command("pause"));
    CHECK(app->property("speed", 7));
    app->render(1000, 700, .2);
    CHECK_EQ(module->seconds, .1);
    CHECK_EQ(module->speed, 7.0);
    ui::AppEvent event{};
    event.type = ui::AppEvent::Type::PointerDown;
    auto preview = engine::layout(1000, 700, true).preview;
    event.x = preview.x + preview.w / 2; event.y = preview.y + preview.h / 2;
    app->event(event);
    CHECK(std::abs(module->last.x - 640) < .001f);
    CHECK(std::abs(module->last.y - 400) < .001f);
    CHECK(app->command("stop"));
    app->render(1000, 700, .3);
    CHECK_EQ(module->seconds, 0.0);
    CHECK_EQ(module->resets, 1);
    CHECK_EQ(module->speed, 7.0);
}

TEST(engine_inspector_docks_on_either_side_without_overlapping_the_preview_or_transport)
{
    for (auto side : {engine::InspectorSide::Left, engine::InspectorSide::Right}) {
        for (auto [width, height] : {std::pair{1440.f, 900.f}, {1024.f, 768.f}, {840.f, 600.f}, {640.f, 480.f}, {360.f, 560.f}}) {
            for (bool module : {false, true}) {
                auto panels = engine::layout(width, height, module, true, side);
                CHECK(panels.inspector.x >= 0);
                CHECK(panels.inspector.x + panels.inspector.w <= width);
                if (width < 840) {
                    CHECK_EQ(panels.viewport.w, 0.f);
                    CHECK_EQ(panels.preview.w, 0.f);
                    continue;
                }
                CHECK(panels.preview.x >= panels.viewport.x);
                CHECK(panels.preview.x + panels.preview.w <= panels.viewport.x + panels.viewport.w + .01f);
                CHECK(panels.play.x >= panels.viewportHeader.x);
                CHECK(panels.stop.x + panels.stop.w <= panels.viewportHeader.x + panels.viewportHeader.w);
                if (side == engine::InspectorSide::Left) CHECK(panels.viewport.x > panels.inspector.x + panels.inspector.w);
                else CHECK(panels.viewport.x + panels.viewport.w < panels.inspector.x);
                if (module) CHECK(std::abs(panels.preview.w / panels.preview.h - 1.6f) < .001f);
            }
        }
    }
}

TEST(engine_inspector_move_button_keeps_properties_input_mapping_and_session_position)
{
    te::test::Graphics graphics;
    auto module = std::make_shared<Module>();
    auto app = engine::create(module, {});
    app->render(1440, 900, 0);
    auto click = [&](float x, float y) {
        ui::AppEvent event{};
        event.x = x; event.y = y;
        event.type = ui::AppEvent::Type::PointerDown; app->event(event);
        event.type = ui::AppEvent::Type::PointerUp; app->event(event);
    };
    auto right = engine::layout(1440, 900, true);
    click(right.inspectorMove.x + 14, right.inspectorMove.y + 14);
    app->render(1440, 900, .1);
    auto left = engine::layout(1440, 900, true, true, engine::InspectorSide::Left);
    click(left.preview.x + left.preview.w / 2, left.preview.y + left.preview.h / 2);
    CHECK(std::abs(module->last.x - 640) < .001f);
    CHECK(std::abs(module->last.y - 400) < .001f);
    auto events = module->events;
    click(left.inspector.w - 24, left.inspector.y + 82);
    CHECK_EQ(module->speed, 2.0);
    CHECK_EQ(module->events, events);
    CHECK(app->command("toggle-inspector"));
    app->render(1440, 900, .2);
    CHECK(app->command("play"));
    CHECK(app->command("stop"));
    CHECK(app->command("toggle-inspector"));
    app->render(1440, 900, .3);
    click(left.inspector.w - 24, left.inspector.y + 82);
    CHECK_EQ(module->speed, 3.0);
    CHECK_EQ(module->events, events);
    CHECK(!app->command("inspector-side", "invalid"));
    click(left.inspectorMove.x + 14, left.inspectorMove.y + 14);
    app->render(1440, 900, .4);
    click(right.inspector.x + right.inspector.w - 24, right.inspector.y + 82);
    CHECK_EQ(module->speed, 4.0);
    CHECK_EQ(module->playback, std::string("stopped"));
}

TEST(engine_resizable_inspector_leaves_room_for_the_canvas_and_controls)
{
    for (auto side : {engine::InspectorSide::Left, engine::InspectorSide::Right}) {
        for (float width : {1440.f, 1024.f, 840.f, 640.f}) {
            for (float requested : {100.f, 240.f, 420.f, 2000.f}) {
                auto panels = engine::layout(width, 900, true, true, side, requested);
                if (width < 840) {
                    CHECK_EQ(panels.inspector.w, width);
                    CHECK_EQ(panels.inspectorResize.w, 0.f);
                    continue;
                }
                CHECK(panels.inspector.w >= 240);
                CHECK(panels.viewport.w >= 360);
                CHECK(panels.inspectorResize.w >= 7);
                CHECK(panels.inspectorResize.x >= 0 && panels.inspectorResize.x + panels.inspectorResize.w <= width);
                CHECK(panels.play.x >= panels.viewport.x);
                CHECK(panels.stop.x + panels.stop.w <= panels.viewport.x + panels.viewport.w);
                CHECK(panels.preview.x >= panels.viewport.x);
                CHECK(panels.preview.x + panels.preview.w <= panels.viewport.x + panels.viewport.w + .01f);
                CHECK(std::abs(panels.preview.w / panels.preview.h - 1.6f) < .001f);
            }
        }
    }
}

TEST(engine_inspector_resize_keeps_input_mapping_and_width_across_docking_and_playback)
{
    te::test::Graphics graphics;
    auto module = std::make_shared<Module>();
    auto app = engine::create(module, {});
    app->render(1440, 900, 0);
    auto pointer = [&](ui::AppEvent::Type type, float x, float y) {
        ui::AppEvent event{}; event.type = type; event.x = x; event.y = y; app->event(event);
    };
    using Type = ui::AppEvent::Type;
    auto initial = engine::layout(1440, 900, true);
    float edge = initial.inspectorResize.x + 3;
    pointer(Type::PointerMove, edge, 400);
    CHECK(app->command("ui.cursor", "resize-horizontal"));
    pointer(Type::PointerDown, edge, 400);
    pointer(Type::PointerMove, edge - 240, 400);
    app->render(1440, 900, .1);
    CHECK(app->command("ui.cursor", "resize-horizontal"));
    CHECK_EQ(module->events, 0);
    // Release can land at a different position from the last move.
    pointer(Type::PointerUp, edge - 140, 400);
    app->render(1440, 900, .2);
    auto resized = engine::layout(1440, 900, true, true, engine::InspectorSide::Right, 420);
    auto preview = resized.preview;
    pointer(Type::PointerDown, preview.x + preview.w / 2, preview.y + preview.h / 2);
    pointer(Type::PointerUp, preview.x + preview.w / 2, preview.y + preview.h / 2);
    CHECK(std::abs(module->last.x - 640) < .001f);
    CHECK(std::abs(module->last.y - 400) < .001f);
    auto events = module->events;
    CHECK(app->command("inspector-side", "left"));
    CHECK(app->command("toggle-inspector")); app->render(1440, 900, .3);
    CHECK(app->command("play")); CHECK(app->command("stop"));
    CHECK(app->command("toggle-inspector")); app->render(1440, 900, .4);
    pointer(Type::PointerDown, 420 - 24, 162);
    pointer(Type::PointerUp, 420 - 24, 162);
    CHECK_EQ(module->speed, 2.0);
    CHECK_EQ(module->events, events);
    CHECK_EQ(module->playback, std::string("stopped"));
    auto left = engine::layout(1440, 900, true, true, engine::InspectorSide::Left, 420);
    pointer(Type::PointerDown, left.inspectorResize.x + 3, 400);
    pointer(Type::PointerMove, left.inspectorResize.x + 103, 400);
    app->render(1440, 900, .5);
    pointer(Type::PointerUp, left.inspectorResize.x + 103, 400);
    app->render(1440, 900, .6);
    pointer(Type::PointerDown, 520 - 24, 162);
    pointer(Type::PointerUp, 520 - 24, 162);
    CHECK_EQ(module->speed, 3.0);
    CHECK_EQ(module->events, events);
}

TEST(engine_inspector_resize_can_cancel_and_restores_preferred_width_after_window_changes)
{
    te::test::Graphics graphics;
    using Type = ui::AppEvent::Type;
    for (auto side : {engine::InspectorSide::Left, engine::InspectorSide::Right}) {
        auto module = std::make_shared<Module>();
        auto app = engine::create(module, {});
        CHECK(app->command("inspector-side", side == engine::InspectorSide::Left ? "left" : "right"));
        app->render(1440, 900, 0);
        // Pin visibility on; compact windows otherwise hide the panel by default.
        CHECK(app->command("toggle-inspector"));
        CHECK(app->command("toggle-inspector"));
        app->render(1440, 900, 0);
        auto pointer = [&](Type type, float x) {
            ui::AppEvent event{}; event.type = type; event.x = x; event.y = 400; app->event(event);
        };
        float edge = engine::layout(1440, 900, true, true, side).inspectorResize.x + 3;
        float direction = side == engine::InspectorSide::Left ? 1.f : -1.f;
        for (bool escape : {false, true}) {
            pointer(Type::PointerDown, edge);
            pointer(Type::PointerMove, edge + direction * 200);
            app->render(1440, 900, .1);
            if (escape) {
                ui::AppEvent event{}; event.type = Type::KeyDown; event.key = ui::Key::Escape; app->event(event);
            } else pointer(Type::PointerCancel, edge + direction * 200);
            pointer(Type::PointerUp, edge + direction * 200);
            app->render(1440, 900, .2);
            pointer(Type::PointerMove, edge);
            CHECK(app->command("ui.cursor", "resize-horizontal"));
        }
        pointer(Type::PointerDown, edge);
        pointer(Type::PointerUp, edge + direction * 420);  // Keep a 700px preference.
        app->render(1440, 900, .3);
        app->render(900, 700, .4);  // Temporarily clamped to leave space for the canvas.
        float narrowEdge = engine::layout(900, 700, true, true, side, 700).inspectorResize.x + 3;
        pointer(Type::PointerMove, narrowEdge);
        CHECK(app->command("ui.cursor", "resize-horizontal"));
        app->render(1440, 900, .5);
        float wideEdge = engine::layout(1440, 900, true, true, side, 700).inspectorResize.x + 3;
        pointer(Type::PointerMove, wideEdge);
        CHECK(app->command("ui.cursor", "resize-horizontal"));
        pointer(Type::PointerDown, wideEdge);
        pointer(Type::PointerMove, wideEdge - direction * 100);
        app->render(640, 480, .6);  // Window resize cancels an unfinished adjustment.
        pointer(Type::PointerUp, wideEdge - direction * 100);
        app->render(1440, 900, .7);
        pointer(Type::PointerMove, wideEdge);
        CHECK(app->command("ui.cursor", "resize-horizontal"));
    }
}

TEST(engine_inspector_divider_supports_keyboard_adjustments_and_default_width)
{
    te::test::Graphics graphics;
    auto module = std::make_shared<Module>();
    auto app = engine::create(module, {});
    app->render(1440, 900, 0);
    auto panels = engine::layout(1440, 900, true);
    ui::AppEvent event{}; event.x = panels.inspectorResize.x + 3; event.y = 400;
    event.type = ui::AppEvent::Type::PointerDown; app->event(event);
    event.type = ui::AppEvent::Type::PointerUp; app->event(event);
    auto adjust = [&](ui::Key key, bool shift, float expected) {
        ui::AppEvent event{}; event.type = ui::AppEvent::Type::KeyDown; event.key = key; event.shift = shift;
        app->event(event); app->render(1440, 900, .1);
        auto resized = engine::layout(1440, 900, true, true, engine::InspectorSide::Right, expected);
        event.type = ui::AppEvent::Type::PointerMove; event.x = resized.inspectorResize.x + 3; event.y = 400;
        app->event(event);
        CHECK(app->command("ui.cursor", "resize-horizontal"));
    };
    adjust(ui::Key::Left, false, 290);
    adjust(ui::Key::Right, true, 250);
    adjust(ui::Key::Home, false, 280);
    CHECK(!app->command("ui.cursor", "unknown"));
    CHECK_EQ(module->events, 0);
}

TEST(engine_inspector_drag_commits_only_at_an_edge_and_never_routes_to_the_game)
{
    te::test::Graphics graphics;
    auto module = std::make_shared<Module>();
    auto app = engine::create(module, {});
    app->render(1440, 900, 0);
    auto right = engine::layout(1440, 900, true);
    auto left = engine::layout(1440, 900, true, true, engine::InspectorSide::Left);
    auto pointer = [&](ui::AppEvent::Type type, float x, float y) {
        ui::AppEvent event{}; event.type = type; event.x = x; event.y = y;
        app->event(event);
    };
    using Type = ui::AppEvent::Type;
    pointer(Type::PointerDown, right.inspectorHandle.x + 50, right.inspectorHandle.y + 14);
    pointer(Type::PointerMove, 700, 400);
    app->render(1440, 900, .1);  // Show the docking targets without changing layout yet.
    pointer(Type::PointerMove, 12, 400);
    pointer(Type::PointerUp, 12, 400);
    app->render(1440, 900, .2);
    pointer(Type::PointerDown, left.inspector.w - 24, left.inspector.y + 82);
    pointer(Type::PointerUp, left.inspector.w - 24, left.inspector.y + 82);
    CHECK_EQ(module->speed, 2.0);
    CHECK_EQ(module->events, 0);

    for (auto cancel : {"escape", "capture", "outside"}) {
        pointer(Type::PointerDown, left.inspectorHandle.x + 50, left.inspectorHandle.y + 14);
        pointer(Type::PointerMove, 1428, 400);
        if (std::string_view(cancel) == "escape") {
            ui::AppEvent escape{}; escape.type = Type::KeyDown; escape.key = ui::Key::Escape;
            app->event(escape);
        } else if (std::string_view(cancel) == "capture") pointer(Type::PointerCancel, 1428, 400);
        // The release position, not a stale move event, determines the final target.
        pointer(Type::PointerUp, 700, 400);
        app->render(1440, 900, .3);
        auto speed = module->speed;
        pointer(Type::PointerDown, left.inspector.w - 24, left.inspector.y + 82);
        pointer(Type::PointerUp, left.inspector.w - 24, left.inspector.y + 82);
        CHECK_EQ(module->speed, speed + 1);
        CHECK_EQ(module->events, 0);
    }
}

TEST(engine_inspector_drag_is_cancelled_when_resize_hides_the_panel)
{
    te::test::Graphics graphics;
    auto module = std::make_shared<Module>();
    auto app = engine::create(module, {});
    app->render(1440, 900, 0);
    auto panels = engine::layout(1440, 900, true);
    ui::AppEvent event{}; event.type = ui::AppEvent::Type::PointerDown;
    event.x = panels.inspectorHandle.x + 50; event.y = panels.inspectorHandle.y + 14;
    app->event(event);
    event.type = ui::AppEvent::Type::PointerMove; event.x = 12; event.y = 400;
    app->event(event);
    app->render(640, 480, .1);
    event.type = ui::AppEvent::Type::PointerUp;
    app->event(event);
    app->render(1440, 900, .2);
    event.type = ui::AppEvent::Type::PointerDown;
    event.x = panels.inspector.x + panels.inspector.w - 24; event.y = panels.inspector.y + 82;
    app->event(event);
    event.type = ui::AppEvent::Type::PointerUp; app->event(event);
    CHECK_EQ(module->speed, 2.0);
    CHECK_EQ(module->events, 0);
}

TEST(engine_module_releases_held_keys_after_inspector_takes_focus)
{
    te::test::Graphics graphics;
    auto module = std::make_shared<Module>();
    auto app = engine::create(module, {});
    app->render(1280, 800, 0);
    ui::AppEvent event{};
    event.type = ui::AppEvent::Type::PointerDown;
    auto panels = engine::layout(1280, 800, true);
    event.x = panels.preview.x + panels.preview.w / 2; event.y = panels.preview.y + panels.preview.h / 2;
    app->event(event);
    event.type = ui::AppEvent::Type::KeyDown;
    event.key = ui::Key::Right; event.text = "right";
    app->event(event);
    CHECK(module->pressedKeys.contains("right"));
    event.type = ui::AppEvent::Type::PointerDown;
    event.x = panels.inspector.x + panels.inspector.w - 90; event.y = panels.inspector.y + 82;
    app->event(event);
    event.type = ui::AppEvent::Type::KeyUp;
    app->event(event);
    CHECK(module->pressedKeys.empty());
    event.text = "left";
    app->event(event);
    CHECK_EQ(module->last.text, "right");
}

TEST(engine_script_hot_reload_and_property_files_work_while_playing)
{
    te::test::Graphics graphics;
    te::test::Directory directory;
    auto path = directory.file("project.lua");
    auto write = [&](int value) {
        std::ofstream out(path);
        out << "return { title='Scene " << value << "', properties = {{id='speed', value=" << value << ",maximum=10}}, draw=function() end }";
    };
    write(2);
    auto app = engine::create({}, path);
    app->render(900, 600, 0);
    CHECK(app->command("play"));
    CHECK(app->property("speed", 6));
    CHECK(app->command("save-properties"));
    CHECK(app->property("speed", 9));
    CHECK(app->command("load-properties"));
    CHECK_EQ(app->properties().front().value, 6.0);
    write(3);
    std::filesystem::last_write_time(path, std::filesystem::last_write_time(path) + std::chrono::seconds(1));
    app->render(900, 600, .3);
    CHECK(app->title().find("Scene 3") != std::string::npos);
    CHECK_EQ(app->properties().front().value, 6.0);
    std::ofstream(path) << "this is not valid Lua";
    CHECK(!app->command("reload"));
    CHECK_EQ(app->properties().front().value, 6.0);
    app->render(900, 600, .4);
    CHECK(app->command("stop"));
    CHECK_EQ(app->properties().front().value, 3.0);  // Runtime overrides do not write back to the authored script.
}

TEST(engine_preview_keeps_game_dimensions_and_maps_scaled_input_after_resize)
{
    te::test::Graphics graphics;
    auto module = std::make_shared<Module>();
    auto app = engine::create(module, {});
    for (auto [width, height] : {std::pair{1440.f, 900.f}, {1280.f, 800.f}, {1024.f, 768.f}, {800.f, 600.f}, {640.f, 480.f}, {400.f, 600.f}, {360.f, 560.f}}) {
        app->render(width, height, 0);
        CHECK_EQ(module->viewWidth, 1280.f);
        CHECK_EQ(module->viewHeight, 800.f);
        auto panels = engine::layout(width, height, true);
        CHECK(panels.play.y >= panels.viewportHeader.y);
        CHECK(panels.stop.y + panels.stop.h <= panels.viewport.y);
        CHECK(panels.play.x >= 0 && panels.stop.x + panels.stop.w <= panels.viewportHeader.w);
        CHECK(panels.play.x + panels.play.w < panels.pause.x);
        CHECK(panels.pause.x + panels.pause.w < panels.stop.x);
        CHECK(panels.preview.x >= 0 && panels.preview.y >= panels.viewport.y);
        CHECK(panels.preview.x + panels.preview.w <= panels.viewport.w + .01f);
        CHECK(panels.preview.y + panels.preview.h <= panels.footer.y + .01f);
        CHECK(std::abs(panels.preview.w / panels.preview.h - 1.6f) < .001f);
        if (width < 1100) CHECK(!panels.inspectorVisible);
        ui::AppEvent event{};
        event.type = ui::AppEvent::Type::PointerDown;
        event.x = panels.preview.x + panels.preview.w / 2;
        event.y = panels.preview.y + panels.preview.h / 2;
        app->event(event);
        CHECK(std::abs(module->last.x - 640) < .001f);
        CHECK(std::abs(module->last.y - 400) < .001f);
        event.type = ui::AppEvent::Type::PointerUp;
        app->event(event);
        event.type = ui::AppEvent::Type::Wheel;
        event.delta = -2;
        app->event(event);
        CHECK_EQ(module->last.delta, -2.f);
        CHECK(std::abs(module->last.x - 640) < .001f);
        auto count = module->events;
        event.type = ui::AppEvent::Type::PointerDown;
        event.x = 2; event.y = panels.viewport.y + 2;
        app->event(event);
        CHECK_EQ(module->events, count);
    }
}

TEST(engine_capture_keeps_its_mapping_until_release_when_the_window_resizes)
{
    te::test::Graphics graphics;
    auto module = std::make_shared<Module>();
    auto app = engine::create(module, {});
    app->render(1280, 800, 0);
    auto panels = engine::layout(1280, 800, true);
    ui::AppEvent event{};
    event.type = ui::AppEvent::Type::PointerDown;
    event.button = 3;
    event.x = panels.preview.x + panels.preview.w / 2;
    event.y = panels.preview.y + panels.preview.h / 2;
    app->event(event);
    app->render(640, 480, .1);
    event.type = ui::AppEvent::Type::PointerMove;
    event.x = panels.preview.x - 10 * panels.moduleScale;
    app->event(event);
    CHECK(std::abs(module->last.x + 10) < .001f);
    CHECK(std::abs(module->last.y - 400) < .001f);
    event.type = ui::AppEvent::Type::PointerUp;
    app->event(event);
    CHECK(std::abs(module->last.x + 10) < .001f);
}

TEST(engine_pointer_cancel_discards_module_capture_and_pressed_toolbar_action)
{
    te::test::Graphics graphics;
    auto module = std::make_shared<Module>();
    auto app = engine::create(module, {});
    app->render(1280, 800, 0);
    auto preview = engine::layout(1280, 800, true).preview;
    ui::AppEvent event{};
    event.type = ui::AppEvent::Type::PointerDown;
    event.x = preview.x + preview.w / 2; event.y = preview.y + preview.h / 2;
    app->event(event);
    event.type = ui::AppEvent::Type::PointerCancel;
    app->event(event);
    CHECK(module->last.type == ui::AppEvent::Type::PointerCancel);
    auto count = module->events;
    event.type = ui::AppEvent::Type::PointerUp;
    app->event(event);
    CHECK_EQ(module->events, count);

    event.type = ui::AppEvent::Type::PointerDown;
    auto play = engine::layout(1280, 800, true).play;
    event.x = play.x + play.w / 2; event.y = play.y + play.h / 2;
    app->event(event);
    event.type = ui::AppEvent::Type::PointerCancel;
    app->event(event);
    event.type = ui::AppEvent::Type::PointerUp;
    app->event(event);
    app->render(1280, 800, .1);
    CHECK_EQ(module->seconds, 0.0);
    event.type = ui::AppEvent::Type::PointerDown;
    app->event(event);
    event.type = ui::AppEvent::Type::PointerUp;
    app->event(event);
    app->render(1280, 800, .2);
    CHECK(module->seconds > 0);
}

TEST(engine_narrow_inspector_toggle_has_no_overlapping_viewport)
{
    te::test::Graphics graphics;
    auto module = std::make_shared<Module>();
    auto app = engine::create(module, {});
    app->render(640, 480, 0);
    CHECK(app->command("toggle-inspector"));
    app->render(640, 480, .1);
    auto panels = engine::layout(640, 480, true, true);
    CHECK_EQ(panels.preview.w, 0.f);
    CHECK_EQ(panels.inspector.x, 0.f);
    CHECK_EQ(panels.inspector.w, 640.f);
    ui::AppEvent event{};
    event.type = ui::AppEvent::Type::PointerDown;
    event.x = 320; event.y = 300;
    app->event(event);
    CHECK_EQ(module->events, 0);
    CHECK(app->property("speed", 6));
    CHECK(app->command("toggle-inspector"));
    app->render(640, 480, .2);
    CHECK_EQ(module->speed, 6.0);
    panels = engine::layout(640, 480, true, false);
    event.x = panels.preview.x + panels.preview.w / 2;
    event.y = panels.preview.y + panels.preview.h / 2;
    app->event(event);
    CHECK_EQ(module->events, 1);
}

TEST(engine_inspector_only_view_does_not_send_typing_to_a_hidden_game)
{
    te::test::Graphics graphics;
    auto module = std::make_shared<Module>();
    auto app = engine::create(module, {});
    app->render(1024, 768, 0);
    CHECK(app->command("toggle-inspector"));
    app->render(1024, 768, .1);
    auto panels = engine::layout(1024, 768, true, true);
    ui::AppEvent event{};
    event.type = ui::AppEvent::Type::PointerDown;
    event.x = panels.preview.x + panels.preview.w / 2;
    event.y = panels.preview.y + panels.preview.h / 2;
    app->event(event);
    event.type = ui::AppEvent::Type::PointerUp;
    app->event(event);
    event.type = ui::AppEvent::Type::KeyDown;
    event.text = "right"; event.key = ui::Key::Right;
    app->event(event);
    CHECK(module->pressedKeys.contains("right"));
    app->render(640, 480, .2);
    int count = module->events;
    event.text = "left"; event.key = ui::Key::Left;
    app->event(event);
    event.type = ui::AppEvent::Type::Text;
    event.text = "a";
    app->event(event);
    CHECK_EQ(module->events, count);
    event.type = ui::AppEvent::Type::KeyUp;
    event.text = "right";
    app->event(event);
    CHECK(module->pressedKeys.empty());
}

TEST(engine_opening_another_project_does_not_inherit_previous_overrides)
{
    te::test::Graphics graphics;
    te::test::Directory directory;
    auto first = directory.file("first.lua"), second = directory.file("second.lua");
    std::ofstream(first) << "return {properties={{id='speed',value=1,maximum=10}},draw=function()end}";
    std::ofstream(second) << "return {properties={{id='speed',value=3,maximum=10}},draw=function()end}";
    auto app = engine::create({}, first);
    CHECK(app->property("speed", 8));
    CHECK(app->command("open", second.string()));
    CHECK_EQ(app->properties().front().value, 3.0);
}

TEST(engine_building_editor_cancels_capture_and_keeps_owned_key_releases)
{
    te::test::Graphics graphics;
    auto module = std::make_shared<Module>();
    auto engine = engine::create(module, {}, std::filesystem::path(ENGINE_DEMO_PATH).parent_path() / "building.json");
    engine->render(1280, 800, 0);
    auto panels = engine::layout(1280, 800, true);
    ui::AppEvent down{ui::AppEvent::Type::PointerDown}; down.x = panels.preview.x + 100; down.y = panels.preview.y + 100;
    engine->event(down);
    ui::AppEvent key{ui::AppEvent::Type::KeyDown}; key.text = "left"; key.key = ui::Key::Left;
    engine->event(key); CHECK(module->pressedKeys.count("left") == 1);
    CHECK(engine->command("asset.editor"));
    CHECK(module->last.type == ui::AppEvent::Type::PointerCancel);
    engine->render(1280, 800, 1);
    auto events = module->events;
    engine->event(down);
    engine->event({ui::AppEvent::Type::Text, 0, 0, 0, 1, ui::Key::Unknown, "x"});
    CHECK(module->events == events);
    key.type = ui::AppEvent::Type::KeyUp; engine->event(key);
    CHECK(module->pressedKeys.empty()); CHECK(module->events == events + 1);
}
