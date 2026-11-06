#include <test/test.h>
#include <test/graphics.h>
#include <test/directory.h>
#include <GameEngine/engine.h>
#include <ui/module.h>
#include <ui/render.h>
#include <core/io/io.h>
#include <core/json/json.h>
#include <algorithm>
#include <fstream>

TEST(engine_loads_cpp_game_module_and_preserves_properties_after_stop)
{
    te::test::Graphics graphics;
    std::string error;
    auto module = ui::loadModule(GAME_MODULE_PATH, error);
    CHECK(module != nullptr);
    CHECK(error.empty());
    if (!module) return;
    auto app = engine::create(module, {});
    CHECK(app->property("zoom", .75));
    CHECK(app->command("play"));
    app->render(960, 640, 0);
    app->render(960, 640, .1);
    CHECK(app->command("stop"));
    app->render(960, 640, .2);
    auto properties = app->properties();
    auto zoom = std::find_if(properties.begin(), properties.end(), [](const auto& item) { return item.id == "zoom"; });
    CHECK(zoom != properties.end());
    if (zoom != properties.end()) CHECK_EQ(zoom->value, .75);
    std::vector<uint32_t> pixels(960 * 640);
    ui::Renderer renderer(ui::RenderBackend::Cpu);
    CHECK(renderer.target(pixels, 960, 640));
    CHECK(renderer.attach(app->scene()));
    CHECK(renderer.draw());
    CHECK(std::any_of(pixels.begin(), pixels.end(), [](uint32_t pixel) { return pixel != 0; }));
    CHECK(!ui::loadModule("/missing-game-module", error));
    CHECK(!error.empty());
}

TEST(engine_scene_metadata_properties_save_load_and_restore_after_play)
{
    te::test::Graphics graphics;
    te::test::Directory directory;
    std::string error;
    auto module = ui::loadModule(GAME_MODULE_PATH, error);
    CHECK(module != nullptr);
    if (!module) return;
    auto path = directory.file("scene.lua");
    std::ofstream(path) << "return {draw=function() end}";
    auto app = engine::create(module, path);
    auto objects = app->sceneObjects();
    auto unit = std::find_if(objects.begin(), objects.end(), [](const auto& object) { return object.type == "Unit"; });
    CHECK(unit != objects.end());
    if (unit == objects.end()) return;
    CHECK(app->selectSceneObject(unit->id));
    double x = app->sceneProperties().front().value;
    CHECK(app->sceneProperty("position.x", x + 1));
    auto inspection = directory.file("inspection.json");
    CHECK(app->command("scene.inspect", inspection.string()));
    auto exported = te::io::load(inspection);
    CHECK(exported);
    te::json::Value metadata;
    CHECK(te::json::parse(exported.value.text, metadata, error));
    CHECK(metadata.find("mode") && *metadata.find("mode")->string() == "edit");
    CHECK_EQ(app->sceneSelection(), unit->id);
    CHECK(app->command("save-properties"));
    CHECK(app->sceneProperty("position.x", x + 2));
    CHECK(app->command("load-properties"));
    CHECK_EQ(app->sceneSelection(), unit->id);
    CHECK_EQ(app->sceneProperties().front().value, x + 1);
    CHECK(app->command("play"));
    CHECK(app->sceneProperty("position.x", x + 3));
    CHECK(app->command("stop"));
    CHECK_EQ(app->sceneProperties().front().value, x + 1);
}
