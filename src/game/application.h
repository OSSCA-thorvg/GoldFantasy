#pragma once
#include <ui/application.h>
#include <cstdint>
#include <memory>
#include <optional>

namespace hearthold
{
// Which world a new game starts in: the one as designed, or a fresh one rolled from a seed.
enum class WorldMode : uint8_t { Designed, Random };

struct LaunchOptions
{
    WorldMode world = WorldMode::Designed;
    std::optional<uint32_t> seed;  // A random world's seed; rolled anew when absent.
    std::string mapFile, characterFile, uiScript, buildingAssets, buildingFile;
    bool titleScreen = false;
    std::string saveFile;
    bool mapEditor = false, studio = false, buildingStudio = false, demo = false, raid = false;
    double days = 6;
    std::string weather;
};
// The seed the new game's world is generated from.
uint32_t worldSeed(const LaunchOptions&);
std::unique_ptr<ui::Application> createApplication(const LaunchOptions& = {});
std::unique_ptr<ui::Application> createSceneApplication(const LaunchOptions&);
class GameApp;
void buildDemo(GameApp&, double days);
}
