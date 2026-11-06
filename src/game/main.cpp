#include "application.h"
#include <ui/host.h>
#include <iostream>
#include <stdexcept>

int main(int argc, char** argv)
{
    hearthold::LaunchOptions game;
    game.titleScreen = true;
    ui::HostOptions host;
    host.backend = HEARTHOLD_RENDERER_WGPU ? ui::RenderBackend::WebGPU : ui::RenderBackend::OpenGL;
    try {
        for (int i = 1; i < argc; ++i) {
            std::string arg = argv[i];
            auto value = [&]() -> std::string { if (++i >= argc) throw std::runtime_error("Missing value for " + arg); return argv[i]; };
            if (arg == "--seed") {
                game.seed = uint32_t(std::stoul(value()));
                game.world = hearthold::WorldMode::Random;  // A seed names a random world.
            } else if (arg == "--world") {
                auto world = value();
                if (world == "designed") game.world = hearthold::WorldMode::Designed;
                else if (world == "random") game.world = hearthold::WorldMode::Random;
                else throw std::runtime_error("World must be designed or random");
            }
            else if (arg == "--map-file") game.mapFile = value();
            else if (arg == "--ui-script") game.uiScript = value();
            else if (arg == "--building-assets") game.buildingAssets = value();
            else if (arg == "--demo") game.demo = true;
            else if (arg == "--days") game.days = std::stod(value());
            else if (arg == "--weather") game.weather = value();
            else if (arg == "--raid") game.raid = true;
#if HEARTHOLD_WITH_EDITOR
            else if (arg == "--character-studio") game.studio = true;
            else if (arg == "--map-editor") game.mapEditor = true;
            else if (arg == "--character-file") game.characterFile = value();
            else if (arg == "--building-studio") game.buildingStudio = true;
            else if (arg == "--building-file") game.buildingFile = value();
#endif
            else if (arg == "--save-file") game.saveFile = value();
            else if (arg == "--frames") host.frames = unsigned(std::stoul(value()));
            else if (arg == "--hidden") host.hidden = true;
            else if (arg == "--renderer") {
                auto renderer = value();
                if (renderer == "gl") host.backend = ui::RenderBackend::OpenGL;
                else if (renderer == "wgpu") host.backend = ui::RenderBackend::WebGPU;
                else throw std::runtime_error("Game renderer must be gl or wgpu");
            } else if (arg == "--help") {
                std::cout << "Hearthold (" HEARTHOLD_PROFILE ")\n"
                    "--world designed|random --seed N --map-file PATH --ui-script PATH --demo --days N --weather clear|rain|snow|storm --raid\n"
                    "New games start in the world as designed; --world random rolls a fresh one, --seed N picks one.\n"
                    "--building-assets DIRECTORY --save-file PATH --renderer gl|wgpu --hidden --frames N\n";
#if HEARTHOLD_WITH_EDITOR
                std::cout << "--map-editor --character-studio --character-file PATH --building-studio --building-file PATH\n";
#endif
                return 0;
            } else throw std::runtime_error("Unknown option: " + arg);
        }
        if (game.world == hearthold::WorldMode::Random && !game.seed) {
            game.seed = hearthold::worldSeed(game);
            std::cout << "Hearthold: a random world, seed " << *game.seed << " (--seed " << *game.seed << " starts there again)\n";
        }
        return ui::run([game] { return hearthold::createApplication(game); }, host);
    } catch (const std::exception& error) { std::cerr << "Hearthold: " << error.what() << '\n'; return 1; }
}
