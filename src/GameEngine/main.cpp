#include "engine.h"
#include <ui/host.h>
#include <ui/module.h>
#include <core/io/path.h>
#include <SDL3/SDL.h>
#include <iostream>
#include <stdexcept>
#ifdef HEARTHOLD_STATIC_GAME_MODULE
extern "C" ui::Application* hearthold_module_create();
extern "C" void hearthold_module_destroy(ui::Application*);
#endif

int main(int argc, char** argv)
{
    ui::HostOptions host;
    host.width = 1500; host.height = 900;
    host.backend = HEARTHOLD_RENDERER_WGPU ? ui::RenderBackend::WebGPU : ui::RenderBackend::OpenGL;
    std::filesystem::path script, module, building;
    bool standalone = false, buildingEditor = false;
    try {
        for (int i = 1; i < argc; ++i) {
            std::string arg = argv[i];
            auto value = [&]() -> std::string { if (++i >= argc) throw std::runtime_error("Missing value for " + arg); return argv[i]; };
            if (arg == "--script") script = te::io::pathFromUtf8(value());
            else if (arg == "--module") module = te::io::pathFromUtf8(value());
            else if (arg == "--standalone") standalone = true;
            else if (arg == "--building-asset") { building = te::io::pathFromUtf8(value()); buildingEditor = true; }
            else if (arg == "--building-editor") buildingEditor = true;
            else if (arg == "--frames") host.frames = unsigned(std::stoul(value()));
            else if (arg == "--hidden") host.hidden = true;
            else if (arg == "--renderer") {
                auto renderer = value();
                if (renderer == "gl") host.backend = ui::RenderBackend::OpenGL;
                else if (renderer == "wgpu") host.backend = ui::RenderBackend::WebGPU;
                else throw std::runtime_error("GameEngine renderer must be gl or wgpu");
            } else if (arg == "--help") {
                std::cout << "GameEngine --script PROJECT.lua | --module GAME_LIBRARY\n"
                    "--building-editor --building-asset PATH --renderer gl|wgpu --standalone --hidden --frames N\n";
                return 0;
            } else throw std::runtime_error("Unknown option: " + arg);
        }
        return ui::run([=] {
            std::shared_ptr<ui::Application> game;
#ifdef HEARTHOLD_STATIC_GAME_MODULE
            if (!standalone && module.empty() && script.empty()) game = {hearthold_module_create(), hearthold_module_destroy};
#else
            (void)standalone;
#endif
            if (!module.empty()) {
                std::string error;
                game = ui::loadModule(module, error);
                if (!game) throw std::runtime_error(error);
            }
            auto project = script;
            if (project.empty() && !game) {
#ifdef __EMSCRIPTEN__
                project = "/scripts/engine.lua";
#else
                auto base = SDL_GetBasePath();
                project = te::io::pathFromUtf8(base ? base : ".") / "../share/hearthold/scripts/engine.lua";
                if (!std::filesystem::exists(project)) project = ENGINE_SCRIPT_PATH;
#endif
            }
            std::filesystem::path example = ENGINE_BUILDING_PATH;
#ifndef __EMSCRIPTEN__
            auto base = SDL_GetBasePath();
            auto installed = te::io::pathFromUtf8(base ? base : ".") / "../share/hearthold/assets/engine-building.json";
            if (std::filesystem::is_regular_file(installed)) example = installed;
#endif
            auto app = engine::create(std::move(game), project, example);
            if (buildingEditor && !app->command("asset.editor", te::io::pathToUtf8(building)))
                throw std::runtime_error("Cannot open building asset: " + te::io::pathToUtf8(building));
            return app;
        }, host);
    } catch (const std::exception& error) { std::cerr << "GameEngine: " << error.what() << '\n'; return 1; }
}
