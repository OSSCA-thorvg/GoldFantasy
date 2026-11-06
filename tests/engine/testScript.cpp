#include <test/test.h>
#include <test/graphics.h>
#include <ui/script.h>
#include <fstream>
#include <iterator>

namespace
{
bool draw(ui::Script& script, ui::Context& context)
{
    static auto theme = ui::Theme::dark();
    context.begin(theme, {0, 0, 400, 300}, 0);
    auto result = script.render(context, {0, 0, 400, 300});
    context.end();
    return result;
}
}

TEST(lua_project_reload_preserves_runtime_state_and_only_edited_properties)
{
    te::test::Graphics graphics;
    ui::Script script;
    ui::Context context;
    CHECK(script.load(R"(
return {
    state = { ticks = 0 },
    properties = {
        { id = 'speed', value = 2, maximum = 10 },
        { id = 'size', value = 4, maximum = 10 },
    },
    update = function(state, dt) state.ticks = state.ticks + dt end,
    draw = function() end,
})", "original"));
    CHECK(script.property("speed", 7));
    CHECK(script.update(3));
    CHECK(script.load(R"(
return {
    state = { ticks = 0 },
    properties = {
        { id = 'speed', value = 1, maximum = 5 },
        { id = 'size', value = 9, maximum = 10 },
    },
    draw = function(ui, state, view, p)
        assert(state.ticks == 3)
        assert(p.speed == 5)
        assert(p.size == 9)
    end,
})", "reloaded"));
    CHECK(draw(script, context));
    CHECK(!script.load("return { broken syntax", "invalid"));
    CHECK(!script.error().empty());
    CHECK(draw(script, context));
}

TEST(lua_project_reset_restores_scene_but_keeps_authored_properties)
{
    te::test::Graphics graphics;
    ui::Script script;
    ui::Context context;
    CHECK(script.load(R"(
return {
    state = { ticks = 0 },
    properties = { { id = 'speed', value = 1, maximum = 10 } },
    update = function(state, dt) state.ticks = state.ticks + dt end,
    draw = function(ui, state, view, p) assert(state.ticks == 0 and p.speed == 8) end,
})", "reset"));
    CHECK(script.property("speed", 8));
    CHECK(script.update(1));
    CHECK(script.reset());
    CHECK(draw(script, context));
}

TEST(lua_project_forks_have_independent_state_and_properties)
{
    te::test::Graphics graphics;
    ui::Script script;
    ui::Context context;
    CHECK(script.load(R"(
return {
    state={ticks=0},
    properties={{id='expected',value=0,maximum=10}},
    update=function(state,dt) state.ticks=state.ticks+dt end,
    draw=function(ui,state,view,p) assert(state.ticks==p.expected) end,
})", "fork"));
    CHECK(script.update(5)); CHECK(script.property("expected", 5));
    auto runtime = script.fork();
    CHECK(runtime != nullptr);
    if (!runtime) return;
    CHECK(runtime->update(2)); CHECK(runtime->property("expected", 7));
    CHECK(draw(*runtime, context));
    CHECK(draw(script, context));
    CHECK_EQ(script.properties().front().value, 5.0);
}

TEST(lua_project_buttons_route_commands_and_release_old_callbacks_on_reload)
{
    te::test::Graphics graphics;
    ui::Script script;
    ui::Context context;
    std::string command;
    script.onCommand = [&](std::string_view value) { command = value; };
    CHECK(script.load(R"(
return { draw = function(ui)
    ui.button { id = 'play', x = 10, y = 10, width = 100, height = 30, text = 'Play', command = 'play' }
end }
)", "button"));
    CHECK(draw(script, context));
    context.pointerDown(20, 20); context.pointerUp(20, 20);
    CHECK_EQ(command, "play");
    command.clear();
    CHECK(script.load("return { draw = function() end }", "replacement"));
    context.pointerDown(20, 20); context.pointerUp(20, 20);
    CHECK(command.empty());
}

TEST(lua_project_reports_errors_and_bounds_runaway_scripts)
{
    ui::Script script;
    CHECK(!script.load("while true do end", "loop"));
    CHECK(script.error().find("budget") != std::string::npos);
    CHECK(!script.load("return { draw = false }", "bad-api"));
    CHECK(!script.load("return { properties = {{id = 'x', value = 0/0}}, draw = function() end }", "nan"));
    CHECK(script.load("assert(os == nil and io == nil and package == nil); return { draw = function() end }", "sandbox"));
    CHECK(script.load("return { update = function() error('failed update') end, draw = function() end }", "runtime"));
    CHECK(!script.update(.1));
    CHECK(script.error().find("failed update") != std::string::npos);
}

TEST(lua_project_numeric_controls_edit_live_authored_properties)
{
    te::test::Graphics graphics;
    ui::Script script;
    ui::Context context;
    CHECK(script.load(R"(
return {
    properties = { { id = 'speed', value = 1, maximum = 5, step = 2 } },
    draw = function(ui) ui.number { id = 'speed', x = 10, y = 10, width = 160, height = 32 } end,
})", "number"));
    CHECK(draw(script, context));
    context.pointerDown(155, 20); context.pointerUp(155, 20);
    CHECK_EQ(script.properties().front().value, 3.0);
    CHECK(script.reset());
    CHECK_EQ(script.properties().front().value, 3.0);
}

TEST(lua_engine_demo_renders_native_pixels_without_a_game_module)
{
    te::test::Graphics graphics;
    std::ifstream file(ENGINE_DEMO_PATH, std::ios::binary);
    CHECK(bool(file));
    std::string source((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
    ui::Script script;
    ui::Context context;
    CHECK(script.load(source, "demo"));
    CHECK(script.update(.25));
    CHECK(draw(script, context));
    std::vector<uint32_t> pixels(400 * 300);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen());
    CHECK(canvas->target(pixels.data(), 400, 400, 300, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
    CHECK(canvas->add(context.scene()) == tvg::Result::Success);
    CHECK(canvas->draw(true) == tvg::Result::Success);
    CHECK(canvas->sync() == tvg::Result::Success);
    CHECK(std::count_if(pixels.begin(), pixels.end(), [](uint32_t pixel) { return pixel != 0; }) > 100000);
    CHECK(std::any_of(pixels.begin(), pixels.end(), [&](uint32_t pixel) { return pixel != pixels.front(); }));
}
