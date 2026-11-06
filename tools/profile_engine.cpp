// Windowless CPU benchmarks for the shared UI, Lua bridge and GameFramework.
#include <GameEngine/engine.h>
#include <GameEngine/GameFramework/geometry.h>
#include <ui/script.h>
#include <algorithm>
#include <chrono>
#include <ctime>
#include <cstdlib>
#include <iostream>
#include <new>
#include <numeric>
#include <stdexcept>

namespace
{
size_t allocations = 0;
bool counting = false;
// Keep the matching malloc/free implementation opaque to GCC's new/delete pairing heuristic.
#if defined(__GNUC__)
__attribute__((noinline))
#endif
void release(void* value) { std::free(value); }
}
void* operator new(size_t size)
{
    if (counting) ++allocations;
    if (auto* value = std::malloc(size ? size : 1)) return value;
    throw std::bad_alloc();
}
void operator delete(void* value) noexcept { release(value); }
void operator delete(void* value, size_t) noexcept { release(value); }
void* operator new[](size_t size) { return ::operator new(size); }
void operator delete[](void* value) noexcept { ::operator delete(value); }
void operator delete[](void* value, size_t) noexcept { ::operator delete(value); }

namespace
{
using namespace gameframework;
using Wall = std::chrono::steady_clock;
volatile double checksum = 0;

template<typename Draw>
void measure(const std::string& name, int iterations, Draw draw)
{
    for (int i = 0; i < 5; ++i) draw(i);
    std::vector<double> times;
    times.reserve(size_t(iterations));
    allocations = 0;
    auto wall = Wall::now();
    auto cpu = std::clock();
    counting = true;
    try {
        for (int i = 0; i < iterations; ++i) {
            auto start = Wall::now();
            draw(i + 5);
            times.push_back(std::chrono::duration<double, std::micro>(Wall::now() - start).count());
        }
    } catch (...) { counting = false; throw; }
    counting = false;
    double cpuUs = double(std::clock() - cpu) * 1e6 / CLOCKS_PER_SEC;
    double wallUs = std::chrono::duration<double, std::micro>(Wall::now() - wall).count();
    std::sort(times.begin(), times.end());
    std::cout << name << " count=" << iterations << " cpu_mean_us=" << cpuUs / iterations
              << " wall_mean_us=" << wallUs / iterations << " wall_p95_us=" << times[(times.size() - 1) * 95 / 100]
              << " cpp_allocations_per_iteration=" << double(allocations) / iterations << '\n';
}

void submission(int count)
{
    ui::Context context;
    auto theme = ui::Theme::dark();
    measure("ui.rectangles." + std::to_string(count), 200, [&](int frame) {
        context.begin(theme, {0, 0, 1280, 800}, frame / 60.);
        for (int i = 0; i < count; ++i) context.rect({float(i % 80) * 16, float(i / 80) * 12, 12, 10}, theme.accent);
        context.end();
    });
}

void labels()
{
    ui::Context context;
    auto theme = ui::Theme::dark();
    measure("ui.elision.128", 200, [&](int frame) {
        context.begin(theme, {0, 0, 1280, 800}, frame / 60.);
        double sum = 0;
        for (int i = 0; i < 128; ++i) {
            auto label = context.elideText("Shared engine property label " + std::to_string(i), 120, 13);
            sum += label.size();
            context.text({0, float(i) * 20, 120, 20}, label, theme.text, 13);
        }
        checksum = sum;
        context.end();
    });
}

void textFields(bool focused)
{
    ui::Context context;
    auto theme = ui::Theme::dark();
    std::vector<ui::TextInput> inputs;
    std::vector<std::string> ids;
    for (int i = 0; i < 128; ++i) {
        std::string value = "Shared engine input value " + std::to_string(i);
        inputs.push_back({value, value.size()});
        ids.push_back("field/" + std::to_string(i));
    }
    if (focused) context.focus(ids.front());
    measure(focused ? "ui.text_fields.128.one_focused" : "ui.text_fields.128.unfocused", 200, [&](int frame) {
        context.begin(theme, {0, 0, 1280, 800}, frame / 60.);
        for (int i = 0; i < 128; ++i)
            ui::textField(context, ids[size_t(i)], {float(i % 8) * 160, float(i / 8) * 30, 152, 28}, inputs[size_t(i)], "Value");
        context.end();
    });
}

void scriptColors(const std::string& color)
{
    ui::Script script;
    ui::Context context;
    auto theme = ui::Theme::dark();
    auto source = "return {draw=function(ui) for i=1,1000 do ui.rect{x=(i%40)*10,y=math.floor(i/40)*10,width=8,height=8,color='" + color + "',radius=0} end end}";
    if (!script.load(source, "engine-profile")) throw std::runtime_error(script.error());
    measure("lua.rectangles.1000." + color, 200, [&](int frame) {
        context.begin(theme, {0, 0, 400, 300}, frame / 60.);
        if (!script.render(context, {0, 0, 400, 300})) throw std::runtime_error(script.error());
        context.end();
    });
}

class InspectorModule final : public ui::Application
{
    ui::Context context;
    ui::Theme theme = ui::Theme::dark();
public:
    std::string title() const override { return "Profile module"; }
    tvg::Scene* scene() const override { return context.scene(); }
    void event(const ui::AppEvent&) override {}
    void render(float width, float height, double seconds) override
    {
        context.begin(theme, {0, 0, width, height}, seconds);
        context.rect({0, 0, width, height}, theme.background);
        context.end();
    }
    std::vector<ui::Property> properties() const override
    {
        std::vector<ui::Property> result;
        result.reserve(128);
        for (int i = 0; i < 128; ++i) result.push_back({"p" + std::to_string(i), "Shared property " + std::to_string(i), double(i), 0, 255, 1});
        return result;
    }
};

void inspector()
{
    auto app = engine::create(std::make_shared<InspectorModule>(), {});
    measure("engine.inspector.128", 200, [&](int frame) { app->render(1280, 800, frame / 60.); });
}

void geometry()
{
    std::vector<Footprint> a, b;
    a.reserve(4096); b.reserve(4096);
    for (int i = 0; i < 4096; ++i) {
        a.push_back({{float(i % 32), float(i / 32)}, .5f + (i % 7) * .1f, i * .013f});
        auto second = a.back();
        second.center = second.center + Point{(i % 17 - 8) * .3f, (i % 11 - 5) * .3f};
        second.angle += .35f;
        b.push_back(second);
    }
    measure("framework.overlaps.4096", 200, [&](int) {
        double sum = 0;
        for (size_t i = 0; i < a.size(); ++i) sum += a[i].overlaps(b[i]);
        checksum = sum;
    });
    measure("framework.corners.4096", 200, [&](int) {
        double sum = 0;
        for (const auto& item : a) { auto points = item.corners(); sum += points.front().x; }
        checksum = sum;
    });
}
}

int main(int argc, char** argv)
{
    std::string suite = argc > 1 ? argv[1] : "all";
    if (argc > 2 || (suite != "all" && suite != "ui" && suite != "lua" && suite != "geometry" && suite != "inspector" && suite != "fields")) {
        std::cerr << "usage: Hearthold-engine-profile [all|ui|lua|geometry|inspector|fields]\n";
        return 1;
    }
    if (tvg::Initializer::init(0) != tvg::Result::Success) return 1;
    int result = 0;
    try {
        if (tvg::Text::load(UI_FONT_PATH) != tvg::Result::Success || tvg::Text::load(UI_BOLD_FONT_PATH) != tvg::Result::Success)
            throw std::runtime_error("cannot load benchmark fonts");
        if (suite == "all" || suite == "ui") { for (int count : {100, 500, 2000, 5000}) submission(count); labels(); }
        if (suite == "all" || suite == "fields") { textFields(false); textFields(true); }
        if (suite == "all" || suite == "lua") { scriptColors("accent"); scriptColors("#112233"); }
        if (suite == "all" || suite == "geometry") geometry();
        if (suite == "all" || suite == "inspector") inspector();
    } catch (const std::exception& error) { counting = false; std::cerr << error.what() << '\n'; result = 1; }
    tvg::Text::unload(UI_BOLD_FONT_PATH); tvg::Text::unload(UI_FONT_PATH);
    tvg::Initializer::term();
    return result;
}
