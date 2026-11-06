#include <test/test.h>
#include <test/graphics.h>
#include <test/directory.h>
#include <game/application.h>
#include <game/ymir_born.h>
#include <game/building_assets.h>
#include <ui/render.h>
#include <core/io/io.h>
#include <core/io/path.h>
#include <fstream>
#include <limits>
#include <set>

namespace
{
double value(const ui::Application& app, std::string_view id)
{
    for (const auto& property : app.properties()) if (property.id == id) return property.value;
    throw std::runtime_error("Missing application property");
}
}

TEST(game_application_bounds_external_properties_before_numeric_conversion)
{
    te::test::Graphics graphics;
    auto app = hearthold::createApplication();
    CHECK(app->property("speed", 1e100));
    CHECK_EQ(value(*app, "speed"), 5);
    CHECK(app->property("camera.x", 1e100));
    CHECK_EQ(value(*app, "camera.x"), 20000);
    CHECK(app->property("camera.y", -1e100));
    CHECK_EQ(value(*app, "camera.y"), -20000);
    CHECK(!app->property("zoom", std::numeric_limits<double>::infinity()));
    CHECK(app->property("speed", -1e100));
    CHECK_EQ(value(*app, "speed"), 0);
}

TEST(game_application_accepts_editor_playback_without_changing_authored_speed)
{
    te::test::Graphics graphics;
    auto app = hearthold::createApplication();
    CHECK(app->property("speed", 3));
    for (auto state : {"stopped", "playing", "paused", "playing", "stopped"}) {
        CHECK(app->command("runtime.playback", state));
        CHECK_EQ(value(*app, "speed"), 3);
    }
    CHECK(!app->command("runtime.playback", "invalid"));
}

TEST(game_editor_scene_never_ticks_and_play_uses_an_independent_world)
{
    te::test::Graphics graphics;
    auto app = hearthold::createApplication();
    CHECK(app->command("runtime.playback", "stopped"));
    auto objects = app->sceneObjects();
    CHECK(objects.size() >= 3);
    auto unit = std::find_if(objects.begin(), objects.end(), [](const auto& item) { return item.type == "Unit"; });
    CHECK(unit != objects.end());
    if (unit == objects.end()) return;
    CHECK(app->selectSceneObject(unit->id));
    auto original = app->sceneProperties();
    double x = original.front().value;
    CHECK(app->sceneProperty("position.x", x + 1));
    CHECK(app->property("camera.x", 700));
    CHECK(app->property("world.hour", 12));
    double clock = value(*app, "world.clock");
    app->render(640, 400, 0);
    std::vector<uint32_t> pixels(640 * 400);
    ui::Renderer renderer(ui::RenderBackend::Cpu);
    CHECK(renderer.target(pixels, 640, 400)); CHECK(renderer.attach(app->scene()));
    CHECK(renderer.draw());
    auto frozen = pixels;
    for (double seconds : {1., 10.}) {
        app->render(640, 400, seconds);
        CHECK(renderer.draw());
        CHECK(pixels == frozen);
    }
    renderer.clear();
    CHECK_EQ(value(*app, "world.clock"), clock);
    CHECK_EQ(app->sceneProperties().front().value, x + 1);
    CHECK(app->command("runtime.playback", "playing"));
    CHECK(app->sceneProperty("position.x", x + 3));
    CHECK(app->property("camera.x", 1234));
    app->render(640, 400, 0);
    app->render(640, 400, .1);
    CHECK(value(*app, "world.clock") > clock);
    CHECK(app->command("runtime.playback", "paused"));
    double paused = value(*app, "world.clock");
    app->render(640, 400, .1);
    app->render(640, 400, 20);  // A paused module also rejects a mistakenly advancing host clock.
    CHECK_EQ(value(*app, "world.clock"), paused);
    CHECK(app->command("runtime.step"));
    app->render(640, 400, 20 + 1.0 / 60);
    CHECK(value(*app, "world.clock") > paused);
    CHECK(app->command("runtime.playback", "stopped"));
    CHECK_EQ(value(*app, "world.clock"), clock);
    CHECK_EQ(value(*app, "camera.x"), 700.0);
    CHECK_EQ(app->sceneProperties().front().value, x + 1);
    CHECK(app->command("runtime.playback", "playing"));
    CHECK_EQ(app->sceneProperties().front().value, x + 1);
    CHECK(app->command("runtime.playback", "stopped"));
}

TEST(game_scene_metadata_bounds_writes_and_marks_world_statistics_read_only)
{
    te::test::Graphics graphics;
    auto app = hearthold::createApplication();
    CHECK(app->command("runtime.playback", "stopped"));
    CHECK(app->selectSceneObject("world"));
    CHECK(!app->sceneProperty("map.width", 10));
    CHECK(!app->selectSceneObject("unit:not-an-id"));
    CHECK(app->sceneProperty("world.hour", 18));
    CHECK(std::abs(value(*app, "world.hour") - 18) < .001);
    CHECK(app->command("runtime.playback", "playing"));
    CHECK(!app->sceneProperty("world.hour", 12));
    CHECK(app->sceneProperties().front().readOnly);
    CHECK(app->command("runtime.playback", "stopped"));
}

TEST(game_lua_hud_receives_keyboard_activation_and_releases_game_keys)
{
    te::test::Graphics graphics;
    te::test::Directory directory;
    auto path = directory.file("hud.lua");
    std::ofstream(path) << "return {draw=function(ui) ui.button{id='speed',x=0,y=0,width=100,height=30,text='Speed',command='speed'} end}";
    hearthold::LaunchOptions options;
    options.uiScript = te::io::pathToUtf8(path);
    auto app = hearthold::createApplication(options);
    app->render(800, 600, 0);
    ui::AppEvent event{};
    event.type = ui::AppEvent::Type::KeyDown;
    event.key = ui::Key::Right; event.text = "right";
    app->event(event);
    event.type = ui::AppEvent::Type::PointerDown;
    event.x = 20; event.y = 15;
    app->event(event);
    event.type = ui::AppEvent::Type::PointerUp;
    app->event(event);
    CHECK_EQ(value(*app, "speed"), 2);
    event.type = ui::AppEvent::Type::KeyUp;
    app->event(event);
    auto camera = value(*app, "camera.x");
    event.type = ui::AppEvent::Type::KeyDown;
    event.key = ui::Key::Space; event.text = "space";
    app->event(event);
    CHECK_EQ(value(*app, "speed"), 3);
    app->render(800, 600, .1);
    CHECK_EQ(value(*app, "camera.x"), camera);
}

TEST(game_pointer_cancel_does_not_activate_a_pressed_lua_control)
{
    te::test::Graphics graphics;
    te::test::Directory directory;
    auto path = directory.file("hud.lua");
    std::ofstream(path) << "return {draw=function(ui) ui.button{id='speed',x=0,y=0,width=100,height=30,text='Speed',command='speed'} end}";
    hearthold::LaunchOptions options;
    options.uiScript = te::io::pathToUtf8(path);
    auto app = hearthold::createApplication(options);
    app->render(800, 600, 0);
    ui::AppEvent event{};
    event.type = ui::AppEvent::Type::PointerDown;
    event.x = 20; event.y = 15;
    app->event(event);
    event.type = ui::AppEvent::Type::PointerCancel;
    app->event(event);
    event.type = ui::AppEvent::Type::PointerUp;
    app->event(event);
    CHECK_EQ(value(*app, "speed"), 1);
    event.type = ui::AppEvent::Type::PointerDown;
    app->event(event);
    event.type = ui::AppEvent::Type::PointerUp;
    app->event(event);
    CHECK_EQ(value(*app, "speed"), 2);
}

TEST(game_application_rejects_a_missing_explicit_building_catalog)
{
    te::test::Graphics graphics;
    te::test::Directory directory;
    hearthold::LaunchOptions options;
    options.buildingAssets = te::io::pathToUtf8(directory.file("missing"));
    bool rejected = false;
    try { hearthold::createApplication(options); }
    catch (const std::runtime_error& error) { rejected = std::string(error.what()).find("building assets") != std::string::npos; }
    CHECK(rejected);
}

TEST(game_application_routes_runtime_asset_updates_and_optional_authoring)
{
    te::test::Graphics graphics;
    te::test::Directory directory;
    auto app = hearthold::createApplication();
    auto original = hearthold::buildingAsset(hearthold::Structure::Cottage);
    auto candidate = original;
    candidate.variants[0].blocks[0].wall += 1;
    CHECK(app->command("asset.apply", gameframework::encodeBuildingAsset(candidate)));
    CHECK(hearthold::buildingAsset(hearthold::Structure::Cottage) == candidate);
    CHECK(!app->command("asset.apply", "{invalid"));
    CHECK(hearthold::buildingAsset(hearthold::Structure::Cottage) == candidate);
    CHECK(app->command("asset.apply", gameframework::encodeBuildingAsset(original)));
#if HEARTHOLD_WITH_EDITOR
    CHECK(app->command("asset.available"));
    ui::AppEvent event{};
    event.type = ui::AppEvent::Type::KeyDown; event.text = "f4";
    app->event(event);
    app->render(1280, 800, 0);
    auto path = directory.file("export.json");
    CHECK(app->command("asset.export", te::io::pathToUtf8(path)));
    auto loaded = te::io::load(path);
    CHECK(loaded);
    gameframework::BuildingAsset exported;
    std::string error;
    CHECK(gameframework::decodeBuildingAsset(loaded.value.text, exported, error));
    CHECK_EQ(exported.id, std::string("cottage"));
#else
    CHECK(!app->command("asset.available"));
    CHECK(!app->command("asset.editor"));
    CHECK(!app->command("edit.building"));
#endif
}

#if HEARTHOLD_WITH_EDITOR
TEST(game_building_studio_shortcut_works_after_a_lua_hud_control_has_focus)
{
    te::test::Graphics graphics;
    te::test::Directory directory;
    auto script = directory.file("hud.lua");
    std::ofstream(script) << "return {draw=function(ui) ui.button{id='pause',x=10,y=10,width=100,height=30,text='Pause',command='pause'} end}";
    hearthold::LaunchOptions options;
    options.uiScript = te::io::pathToUtf8(script);
    auto app = hearthold::createApplication(options);
    app->render(1280, 800, 0);
    ui::AppEvent event{};
    event.type = ui::AppEvent::Type::PointerDown; event.x = 20; event.y = 20; event.button = 1;
    app->event(event);
    event.type = ui::AppEvent::Type::PointerUp; app->event(event);
    event.type = ui::AppEvent::Type::KeyDown; event.text = "f4";
    app->event(event);
    CHECK(app->command("asset.export", te::io::pathToUtf8(directory.file("shortcut.json"))));
}
#endif

TEST(game_new_games_start_in_the_designed_world_unless_a_random_one_is_chosen)
{
    hearthold::LaunchOptions options;
    CHECK(options.world == hearthold::WorldMode::Designed);
    CHECK_EQ(hearthold::worldSeed(options), hearthold::designedWorldSeed);
    options.seed = 42;  // A seed alone does not leave the designed world: the mode decides.
    CHECK_EQ(hearthold::worldSeed(options), hearthold::designedWorldSeed);
    options.world = hearthold::WorldMode::Random;
    CHECK_EQ(hearthold::worldSeed(options), 42u);
    options.seed.reset();
    std::set<uint32_t> rolled;
    for (int i = 0; i < 4; ++i) rolled.insert(hearthold::worldSeed(options));
    CHECK(rolled.size() > 1);  // A fresh world each time.
}
