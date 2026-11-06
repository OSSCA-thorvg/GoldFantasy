// Opt-in, hidden OpenGL stress reproduction. No audio device or desktop focus.
#include <game/authoring/map_editor.h>
#include <ui/render.h>
#include <SDL3/SDL.h>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <numeric>
#include <stdexcept>

namespace
{
using namespace hearthold;
using Clock = std::chrono::steady_clock;
double us(Clock::time_point start) { return std::chrono::duration<double, std::micro>(Clock::now() - start).count(); }
void report(const char* name, std::vector<double> values)
{
    std::sort(values.begin(), values.end());
    std::cout << name << " mean_us=" << std::accumulate(values.begin(), values.end(), 0.) / values.size()
              << " p95_us=" << values[(values.size() - 1) * 95 / 100] << " max_us=" << values.back() << '\n';
}
void require(bool success, const ui::Renderer& renderer) { if (!success) throw std::runtime_error(renderer.error()); }
void run(std::string mode, int frames, int size)
{
    constexpr int width = 1280, height = 800;
    auto start = Clock::now();
    auto map = WorldMap::generate(5, size, size);
    std::cout << "mode=" << mode << " map=" << size << 'x' << size << " frames=" << frames << " generate_us=" << us(start) << '\n';
    ui::Renderer renderer(ui::RenderBackend::OpenGL);
    require(renderer.targetGl(SDL_GL_GetCurrentContext(), width, height), renderer);
    std::vector<double> mutation, update, draw, total;
    auto measure = [&](auto&& mutate, auto&& render, int frame) {
        auto begin = Clock::now(); require(renderer.sync(), renderer);
        auto stage = Clock::now(); mutate(frame); mutation.push_back(us(stage));
        stage = Clock::now(); render(frame); update.push_back(us(stage));
        stage = Clock::now(); require(renderer.draw(), renderer); draw.push_back(us(stage));
        total.push_back(us(begin));
    };
    if (mode.starts_with("editor-")) {
        MapEditor editor(std::move(map));
        ui::Context context;
        auto theme = ui::Theme::dark();
        require(renderer.attach(context.scene()), renderer);
        auto render = [&](int frame) {
            context.begin(theme, {0, 0, width, height}, frame / 60.);
            editor.render(context, {0, 0, width, height}, [](bool) {}); context.end();
        };
        start = Clock::now(); render(0); require(renderer.draw(), renderer); require(renderer.sync(), renderer);
        std::cout << "initial_draw_us=" << us(start) << '\n';
        editor.fit();
        Camera fitted = editor.view();
        auto bounds = editor.canvasBounds();
        Point pointer{bounds.x + bounds.w / 2, bounds.y + bounds.h / 2};
        if (mode == "editor-drag") {
            editor.resizeBrush(9); editor.choose(2); editor.pointerDown(context, pointer, false);
        }
        if (mode == "editor-paint") editor.document().beginStroke();
        auto mutate = [&](int frame) {
            if (mode == "editor-wheel") {
                // Visit the full map, chunk/overview transition, and close detail repeatedly.
                static constexpr float zooms[]{.035f, .08f, .18f, .24f, .26f, .5f, 1.4f, 4.f};
                editor.view().zoom = zooms[(frame / 4) % 8];
                editor.view().x = fitted.x + std::sin(frame * .11f) * 400;
                editor.view().y = fitted.y + std::cos(frame * .11f) * 250;
            } else if (mode == "editor-paint") {
                editor.view().zoom = .7f;
                editor.document().paint({size * .5f + std::sin(frame * .11f) * 8, size * .5f + std::cos(frame * .11f) * 8}, 12,
                                        frame % 2 ? Terrain::Forest : Terrain::Grass);
            } else if (mode == "editor-drag") {
                editor.pointerMove(context, {pointer.x + std::sin(frame * .25f) * 85, pointer.y + std::cos(frame * .25f) * 55});
            }
        };
        for (int frame = 0; frame < frames; ++frame) measure(mutate, render, frame + 1);
        if (mode == "editor-paint") editor.document().endStroke();
        if (mode == "editor-drag") {
            editor.pointerUp(context, pointer, false);
            std::vector<double> idle;
            for (int frame = 0; frame < 16; ++frame) {
                start = Clock::now(); require(renderer.sync(), renderer); render(frames + frame + 1); require(renderer.draw(), renderer); idle.push_back(us(start));
            }
            report("after_drag_idle", idle);
        }
        renderer.clear();
    } else {
        Town town(std::move(map), false);
        auto camp = town.map().camp(); town.scout(camp.x, camp.y, 32);
        if (!town.place(Structure::Camp, camp, 0)) throw std::runtime_error("cannot found camp");
        town.completeConstruction();
        town.reward({100000, 100000, 100000, 100000, 100000, 100000}); town.recruit(Role::Resident, Calling::Settler, 25);
        if (mode == "game-open") town.scout(size / 2.f, size / 2.f, size * 2.f);
        else for (int y = 2; y < size; y += 4) for (int x = 2; x < size; x += 4) town.scout(float(x), float(y), 3.5f);
        Traffic traffic(5); traffic.update(town, 0);
        WorldRenderer world;
        require(renderer.attach(world.scene()), renderer);
        auto center = project(size / 2.f, size / 2.f);
        Camera camera{center.x, center.y, .065f};
        const char* layerOption = std::getenv("HEARTHOLD_PROFILE_LAYER");
        const char* zoomOption = std::getenv("HEARTHOLD_PROFILE_ZOOM");
        auto render = [&](int frame) {
            world.update(town, traffic, camera, width, height, frame / 60., {});
            if (layerOption) {
                auto* scene = static_cast<tvg::Scene*>(*std::next(world.scene()->paints().begin()));
                int layer = 0, selected = std::stoi(layerOption);
                for (auto* paint : scene->paints()) if (layer++ != selected) paint->opacity(0);
            }
        };
        if (zoomOption) camera.zoom = std::stof(zoomOption);
        start = Clock::now(); render(0); require(renderer.draw(), renderer); require(renderer.sync(), renderer);
        std::cout << "initial_draw_us=" << us(start) << " workers=" << town.people().size() << " history=" << town.map().sights().size() << '\n';
        auto mutate = [&](int frame) {
            static constexpr float zooms[]{.04f, .065f, .12f, .25f, .5f, 1.4f, 3.f, 6.f};
            camera.zoom = zooms[(frame / 4) % 8];
            if (zoomOption) camera.zoom = std::stof(zoomOption);
            camera.x = center.x + std::sin(frame * .11f) * 400; camera.y = center.y + std::cos(frame * .11f) * 250;
            town.advance(1. / 60); traffic.update(town, frame / 60.);
        };
        for (int frame = 0; frame < frames; ++frame) measure(mutate, render, frame + 1);
        renderer.clear();
    }
    report("mutation", mutation); report("world.update", update); report("canvas.draw_sync", draw); report("frame.total", total);
}
}
int main(int argc, char** argv)
{
    SDL_Window* window = nullptr; SDL_GLContext context = nullptr; bool graphics = false; int result = 0;
    try {
        std::string mode = argc > 1 ? argv[1] : "editor-wheel";
        int frames = argc > 2 ? std::stoi(argv[2]) : 64, size = argc > 3 ? std::stoi(argv[3]) : 256;
        if (frames < 1 || size < 32 || size > 256 || (mode != "editor-fit" && mode != "editor-wheel" && mode != "editor-paint" && mode != "editor-drag" && mode != "game-open" && mode != "game-fog"))
            throw std::runtime_error("usage: Hearthold-map-profile [editor-fit|editor-wheel|editor-paint|editor-drag|game-open|game-fog] [FRAMES] [MAP_SIZE32..256]");
        if (!SDL_Init(SDL_INIT_VIDEO | SDL_INIT_EVENTS)) throw std::runtime_error(SDL_GetError());
        SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);
        SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3); SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 3); SDL_GL_SetAttribute(SDL_GL_STENCIL_SIZE, 8);
        window = SDL_CreateWindow("Hearthold hidden map stress", 1280, 800, SDL_WINDOW_OPENGL | SDL_WINDOW_HIDDEN);
        if (!window) throw std::runtime_error(SDL_GetError());
        context = SDL_GL_CreateContext(window);
        if (!context || !SDL_GL_MakeCurrent(window, context)) throw std::runtime_error(SDL_GetError());
        SDL_GL_SetSwapInterval(0);
        if (tvg::Initializer::init(0) != tvg::Result::Success) throw std::runtime_error("ThorVG initialization failed");
        graphics = true;
        if (tvg::Text::load(UI_FONT_PATH) != tvg::Result::Success || tvg::Text::load(UI_BOLD_FONT_PATH) != tvg::Result::Success) throw std::runtime_error("fonts failed");
        run(mode, frames, size);
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; result = 1; }
    if (graphics) { tvg::Text::unload(UI_BOLD_FONT_PATH); tvg::Text::unload(UI_FONT_PATH); tvg::Initializer::term(); }
    if (context) SDL_GL_DestroyContext(context);
    if (window) SDL_DestroyWindow(window);
    SDL_Quit();
    return result;
}
