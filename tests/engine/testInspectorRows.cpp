#include <test/test.h>
#include <test/graphics.h>
#include <GameEngine/engine.h>
#include <GameEngine/layout.h>
#include <algorithm>

namespace
{
class PropertyModule final : public ui::Application
{
    ui::Context context;
    ui::Theme theme = ui::Theme::dark();
public:
    std::vector<double> values = std::vector<double>(128);
    bool actors = false;
    std::string selected = "actor0";
    std::string title() const override { return "Property rows"; }
    tvg::Scene* scene() const override { return context.scene(); }
    void event(const ui::AppEvent&) override {}
    void render(float width, float height, double time) override
    {
        context.begin(theme, {0, 0, width, height}, time); context.end();
    }
    std::vector<ui::Property> properties() const override
    {
        std::vector<ui::Property> result;
        for (size_t i = 0; i < values.size(); ++i)
            result.push_back({"p" + std::to_string(i), "Property " + std::to_string(i), values[i], 0, 1000, 1});
        return result;
    }
    bool property(std::string_view id, double value) override
    {
        for (size_t i = 0; i < values.size(); ++i) if (id == "p" + std::to_string(i)) { values[i] = value; return true; }
        return false;
    }
    std::vector<ui::SceneObject> sceneObjects() const override
    {
        std::vector<ui::SceneObject> result;
        if (actors) for (size_t i = 0; i < 128; ++i)
            result.push_back({"actor" + std::to_string(i), "Actor " + std::to_string(i), "Unit"});
        return result;
    }
    std::string sceneSelection() const override { return selected; }
    bool selectSceneObject(std::string_view id) override
    {
        if (!std::ranges::any_of(sceneObjects(), [&](const auto& object) { return object.id == id; })) return false;
        selected = id; return true;
    }
};

void labelsWithPrefix(tvg::Paint* paint, std::string_view prefix, std::vector<std::string>& labels)
{
    if (paint->type() == tvg::Type::Text) {
        auto value = static_cast<tvg::Text*>(paint)->text();
        if (value && std::string_view(value).starts_with(prefix)) labels.emplace_back(value);
    } else if (paint->type() == tvg::Type::Scene) {
        for (auto child : static_cast<tvg::Scene*>(paint)->paints()) labelsWithPrefix(child, prefix, labels);
    }
}
std::vector<std::string> labelsWithPrefix(const ui::Application& app, std::string_view prefix = "Property ")
{
    std::vector<std::string> labels;
    labelsWithPrefix(app.scene(), prefix, labels);
    return labels;
}
}

TEST(engine_inspector_submits_only_visible_property_rows)
{
    te::test::Graphics graphics;
    auto app = engine::create(std::make_shared<PropertyModule>(), {});
    app->render(1280, 800, 0);
    auto labels = labelsWithPrefix(*app);
    CHECK(std::ranges::find(labels, std::string_view("Property 0")) != labels.end());
    CHECK(std::ranges::find(labels, std::string_view("Property 127")) == labels.end());
    CHECK(labels.size() < 24);
}

TEST(engine_inspector_scrolling_retains_an_uncommitted_focused_value)
{
    te::test::Graphics graphics;
    auto module = std::make_shared<PropertyModule>();
    auto app = engine::create(module, {});
    app->render(1280, 800, 0);
    auto panels = engine::layout(1280, 800, true);
    ui::AppEvent event{};
    event.x = panels.inspector.x + panels.inspector.w - 90;
    event.y = panels.inspector.y + 82;
    event.type = ui::AppEvent::Type::PointerDown; event.button = 1; app->event(event);
    event.type = ui::AppEvent::Type::PointerUp; app->event(event);
    event.type = ui::AppEvent::Type::KeyDown; event.key = ui::Key::Backspace; app->event(event);
    event.type = ui::AppEvent::Type::Text; event.text = "17"; app->event(event);
    event.type = ui::AppEvent::Type::Wheel; event.delta = -10000; app->event(event);
    app->render(1280, 800, .1);
    event.type = ui::AppEvent::Type::KeyDown; event.key = ui::Key::Enter; event.text.clear(); app->event(event);
    CHECK_EQ(module->values[0], 17.0);
    app->render(1280, 800, .2);
    auto labels = labelsWithPrefix(*app);
    CHECK(std::ranges::find(labels, std::string_view("Property 127")) != labels.end());
    CHECK(std::ranges::find(labels, std::string_view("Property 0")) == labels.end());
    CHECK(labels.size() < 24);
    event.type = ui::AppEvent::Type::Wheel; event.delta = 10000; app->event(event);
    app->render(1280, 800, .3);
    labels = labelsWithPrefix(*app);
    CHECK(std::ranges::find(labels, std::string_view("Property 0")) != labels.end());
}

TEST(engine_inspector_scene_list_draws_visible_actors_and_scrolls_to_the_last_actor)
{
    te::test::Graphics graphics;
    auto module = std::make_shared<PropertyModule>(); module->actors = true;
    auto app = engine::create(module, {});
    app->render(1280, 800, 0);
    auto labels = labelsWithPrefix(*app, "Unit · Actor ");
    CHECK_EQ(labels.size(), size_t(6));
    CHECK_EQ(labels.front(), std::string("Unit · Actor 0"));
    auto panels = engine::layout(1280, 800, true);
    ui::AppEvent event{};
    event.type = ui::AppEvent::Type::Wheel; event.delta = -10000;
    event.x = panels.inspector.x + 40; event.y = panels.inspector.y + 90;
    app->event(event); app->render(1280, 800, .1);
    labels = labelsWithPrefix(*app, "Unit · Actor ");
    CHECK_EQ(labels.size(), size_t(6));
    CHECK_EQ(labels.back(), std::string("Unit · Actor 127"));
    event.type = ui::AppEvent::Type::PointerDown; event.button = 1; event.y = panels.inspector.y + 68 + 5 * 26 + 12; app->event(event);
    event.type = ui::AppEvent::Type::PointerUp; app->event(event);
    CHECK_EQ(module->selected, std::string("actor127"));
}
