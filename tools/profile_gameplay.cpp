// Hidden full-game OpenGL reproduction: road construction, wheel zoom, ambience and offline mixer.
#include <game/game_app.h>
#include <game/sound_board.h>
#include <ui/render.h>
#include <SDL3/SDL.h>
#include <algorithm>
#include <chrono>
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
void run(int frames, int roads, int sights, int workers, bool wheel, bool audio)
{
    GameApp game(5);
    auto& town = game.state();
    auto c = town.map().camp();
    town.scout(c.x, c.y, 32);
    if (!town.place(Structure::Camp, c, 0)) throw std::runtime_error("cannot found camp");
    town.completeConstruction();
    size_t initialSights = town.map().sights().size();
    for (int i = 0; town.map().sights().size() < initialSights + size_t(sights) && i < 4096; ++i) {
        float x = 2 + (i % 64) * (town.map().width() - 4.f) / 64;
        float y = 2 + (i / 64) * (town.map().height() - 4.f) / 64;
        town.scout(x, y, 4);
    }
    if (town.map().sights().size() != initialSights + size_t(sights)) throw std::runtime_error("too many sight patches");
    town.reward({100000, 100000, 100000, 100000, 100000, 100000});
    town.recruit(Role::Resident, Calling::Settler, workers - 5);
    if (town.people().size() != size_t(workers)) throw std::runtime_error("incorrect profile population");
    for (int i = 0; town.roads().roads().size() < size_t(roads) && i < roads * 40; ++i) {
        float angle = i * 2.3999632f;
        RoadPath path{RoadAnchor::sharp(c + rotated({1.2f, 0}, angle)), RoadAnchor::sharp(c + rotated({8.f + i % 12, 0}, angle))};
        town.buildRoad(path);
    }
    if (town.roads().roads().size() != size_t(roads)) throw std::runtime_error("not enough legal road sites");
    town.advance(1. / 60);
    size_t worker = 0;
    for (const auto& p : town.people())
        if (roads && !town.orderRoadwork({p.id}, town.roads().roads()[worker++ % size_t(roads)].id))
            throw std::runtime_error("worker cannot reach assigned road");
    game.selectTool(Tool::Road);
    game.selectPeople({});
    game.setSpeed(1);
    game.view().zoom = wheel ? .28f : 1.4f;
    std::unique_ptr<tvg::Scene, void(*)(tvg::Scene*)> root(tvg::Scene::gen(), [](auto* scene) { scene->unref(); });
    root->ref(); root->add(game.worldScene()); root->add(game.hudScene());
    ui::Renderer renderer(ui::RenderBackend::OpenGL);
    if (!renderer.targetGl(SDL_GL_GetCurrentContext(), 1280, 800) || !renderer.attach(root.get())) throw std::runtime_error(renderer.error());
    SoundBoard mixer(false);
    std::vector<float> samples(735 * 2);
    game.render(1280, 800, 0);
    if (!renderer.draw()) throw std::runtime_error(renderer.error());
    std::vector<double> events, updates, ambience, mixing, draws, totals;
    for (int frame = 0; frame < frames; ++frame) {
        auto total = Clock::now();
        if (!renderer.sync()) throw std::runtime_error(renderer.error());
        auto start = Clock::now();
        if (wheel && frame % 2 == 0) game.wheel(640, 400, frame % 120 < 60 ? 1 : -1);
        events.push_back(us(start));
        start = Clock::now(); game.render(1280, 800, (frame + 1) / 60.); updates.push_back(us(start));
        start = Clock::now(); mixer.setAmbience(game.ambience());
        for (auto cue : game.takeCues()) mixer.play(cue);
        ambience.push_back(us(start));
        start = Clock::now(); if (audio) mixer.render(samples.data(), 735); mixing.push_back(us(start));
        start = Clock::now(); if (!renderer.draw()) throw std::runtime_error(renderer.error()); draws.push_back(us(start));
        totals.push_back(us(total));
    }
    std::cout << "frames=" << frames << " roads=" << roads << " workers=" << town.people().size() << " wheel=" << wheel << " sights=" << town.map().sights().size() << " offline_audio=" << audio << '\n';
    report("wheel", events); report("game.update", updates); report("ambience", ambience);
    report("audio.offline", mixing); report("canvas.draw_sync", draws); report("frame.total", totals);
    renderer.clear(); root->remove();
}
}
int main(int argc, char** argv)
{
    int frames = 240, roads = 32, sights = 0, workers = 30;
    bool wheel = true, audio = false;
    SDL_Window* window = nullptr;
    SDL_GLContext context = nullptr;
    bool graphics = false;
    int result = 0;
    try {
        for (int i = 1; i < argc; ++i) {
            std::string arg(argv[i]);
            if ((arg == "--frames" || arg == "--roads" || arg == "--sights" || arg == "--workers") && i + 1 < argc) {
                int value = std::stoi(argv[++i]);
                if (value < 1) throw std::runtime_error("positive counts required");
                if (arg == "--frames") frames = value; else if (arg == "--roads") roads = value;
                else if (arg == "--workers") workers = value; else sights = value;
            } else if (arg == "--still") wheel = false;
            else if (arg == "--audio") audio = true;
            else throw std::runtime_error("usage: Hearthold-gameplay-profile [--frames N] [--roads N] [--sights N] [--workers 5..1000] [--still] [--audio]");
        }
        if (workers < 5 || workers > 1000) throw std::runtime_error("profile workers must be 5..1000");
        if (!SDL_Init(SDL_INIT_VIDEO | SDL_INIT_EVENTS)) throw std::runtime_error(SDL_GetError());
        SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);
        SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3); SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 3);
        SDL_GL_SetAttribute(SDL_GL_STENCIL_SIZE, 8);
        window = SDL_CreateWindow("Hearthold hidden gameplay profile", 1280, 800, SDL_WINDOW_OPENGL | SDL_WINDOW_HIDDEN);
        if (!window) throw std::runtime_error(SDL_GetError());
        context = SDL_GL_CreateContext(window);
        if (!context || !SDL_GL_MakeCurrent(window, context)) throw std::runtime_error(SDL_GetError());
        SDL_GL_SetSwapInterval(0);
        if (tvg::Initializer::init(0) != tvg::Result::Success) throw std::runtime_error("ThorVG initialization failed");
        graphics = true;
        if (tvg::Text::load(UI_FONT_PATH) != tvg::Result::Success || tvg::Text::load(UI_BOLD_FONT_PATH) != tvg::Result::Success)
            throw std::runtime_error("font initialization failed");
        run(frames, roads, sights, workers, wheel, audio);
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; result = 1; }
    if (graphics) { tvg::Text::unload(UI_BOLD_FONT_PATH); tvg::Text::unload(UI_FONT_PATH); tvg::Initializer::term(); }
    if (context) SDL_GL_DestroyContext(context);
    if (window) SDL_DestroyWindow(window);
    SDL_Quit();
    return result;
}
