#include "building_assets.h"
#include <core/io/io.h>
#include <core/io/path.h>
#include <array>
#include <stdexcept>

#ifndef BUILDING_ASSET_PATH
#define BUILDING_ASSET_PATH "src/game/assets/buildings"
#endif

namespace hearthold
{
namespace
{
using gameframework::BuildingAsset;
constexpr size_t count = size_t(Structure::Count);
constexpr const char* ids[]{"camp", "tent", "cottage", "townhouse", "manor", "market-stalls", "market-hall", "bazaar",
    "farm", "lumberyard", "quarry", "well", "storehouse", "shrine", "mage-tower", "portal", "tavern", "hostel", "inn",
    "grand-inn", "guild", "guild-hall", "chapel", "weaponsmith", "armorer", "apothecary", "palisade", "keep", "castle"};
constexpr size_t slots[]{1, 12, 6, 6, 6, 4, 12, 4, 1, 1, 1, 1, 1, 1, 1, 1, 3, 4, 3, 3, 1, 1, 4, 3, 3, 3, 2, 2, 2};
static_assert(std::size(ids) == count && std::size(slots) == count);
struct Catalog
{
    std::array<BuildingAsset, count> assets;
    std::array<std::filesystem::path, count> paths;
    std::array<BuildingAssetFile, count> files;
    std::array<uint64_t, count> revisions{};
    std::filesystem::path directory;
    std::string warning;
    uint64_t generation = 0;
    bool overrides = false;
};
Catalog& catalog() { static Catalog state; return state; }
size_t index(Structure kind)
{
    if (size_t(kind) >= count) throw std::invalid_argument("unknown building structure");
    return size_t(kind);
}
bool compatible(const BuildingAsset& asset, size_t i, std::string& error)
{
    if (!gameframework::validateBuildingAsset(asset, error)) return false;
    if (asset.id != ids[i]) { error = "id: expected " + std::string(ids[i]); return false; }
    if (asset.footprint != structureSpec(Structure(i)).size) { error = "footprint: incompatible with game structure " + asset.id; return false; }
    if (asset.variants.size() != slots[i]) { error = "variants: " + asset.id + " requires " + std::to_string(slots[i]) + " slots"; return false; }
    return true;
}
bool read(const std::filesystem::path& path, size_t i, BuildingAsset& asset, BuildingAssetFile& file, std::string& error)
{
    auto loaded = te::io::load(path, {.maxBytes = 4 * 1024 * 1024});
    if (!loaded) { error = te::io::pathToUtf8(path) + ": " + loaded.error.message; return false; }
    if (!gameframework::decodeBuildingAsset(loaded.value.text, asset, error) || !compatible(asset, i, error)) {
        error = te::io::pathToUtf8(path) + ": " + error;
        return false;
    }
    file = {asset, path, loaded.value.stamp, loaded.value.format};
    return true;
}
bool load(const std::filesystem::path& directory, bool overrides, std::string& error)
{
    auto& state = catalog();
    std::array<BuildingAsset, count> assets;
    std::array<std::filesystem::path, count> paths;
    std::array<BuildingAssetFile, count> files;
    std::string warning;
    for (size_t i = 0; i < count; ++i) {
        paths[i] = directory / (std::string(ids[i]) + ".json");
        if (!read(paths[i], i, assets[i], files[i], error)) return false;
#ifdef __EMSCRIPTEN__
        if (overrides) {
            auto path = std::filesystem::path("/data/assets/buildings") / (std::string(ids[i]) + ".json");
            std::error_code ec;
            bool exists = std::filesystem::exists(path, ec);
            if (exists || ec) {
                BuildingAsset replacement;
                BuildingAssetFile replacementFile;
                std::string problem;
                if (!ec && read(path, i, replacement, replacementFile, problem)) { assets[i] = std::move(replacement); paths[i] = path; files[i] = std::move(replacementFile); }
                else { if (!warning.empty()) warning += '\n'; warning += ec ? te::io::pathToUtf8(path) + ": " + ec.message() : problem; }
            }
        }
#endif
    }
    bool changed = !state.generation;
    for (size_t i = 0; i < count; ++i) if (state.assets[i] != assets[i]) { ++state.revisions[i]; changed = true; }
    state.assets = std::move(assets);
    state.paths = std::move(paths);
    state.files = std::move(files);
    state.directory = directory;
    state.overrides = overrides;
    state.warning = std::move(warning);
    if (changed) ++state.generation;
    error.clear();
    return true;
}
void ready()
{
    if (catalog().generation) return;
    std::string error;
    if (!loadDefaultBuildingAssets({}, error)) throw std::runtime_error("Building assets: " + error);
}
}  // namespace

BuildingAssetFile buildingAssetFile(Structure kind) { ready(); return catalog().files[index(kind)]; }
void rememberBuildingAssetFile(const BuildingAssetFile& file)
{
    ready();
    for (size_t i = 0; i < count; ++i) if (file.asset.id == ids[i]) {
        catalog().files[i] = file; catalog().paths[i] = file.path; return;
    }
}
const char* buildingAssetId(Structure kind) { return ids[index(kind)]; }
const BuildingAsset& buildingAsset(Structure kind) { ready(); return catalog().assets[index(kind)]; }
std::filesystem::path buildingAssetPath(Structure kind) { ready(); return catalog().paths[index(kind)]; }
uint64_t buildingAppearanceRevision(Structure kind) { ready(); return catalog().revisions[index(kind)]; }
uint64_t buildingCatalogGeneration() { ready(); return catalog().generation; }
const std::string& buildingAssetsWarning() { ready(); return catalog().warning; }

bool loadBuildingAssets(const std::filesystem::path& directory, std::string& error) { return load(directory, false, error); }
bool loadDefaultBuildingAssets(const std::filesystem::path& installedDirectory, std::string& error)
{
#ifdef __EMSCRIPTEN__
    (void)installedDirectory;
    return load("/assets/buildings", true, error);
#else
    if (!installedDirectory.empty()) {
        std::error_code ec;
        bool exists = std::filesystem::exists(installedDirectory, ec);
        if (ec) { error = te::io::pathToUtf8(installedDirectory) + ": " + ec.message(); return false; }
        if (exists) return load(installedDirectory, false, error);
    }
    return load(te::io::pathFromUtf8(BUILDING_ASSET_PATH), false, error);
#endif
}
bool reloadBuildingAssets(std::string& error)
{
    if (!catalog().generation) return loadDefaultBuildingAssets({}, error);
    return load(catalog().directory, catalog().overrides, error);
}
bool applyBuildingAsset(const BuildingAsset& asset, std::string& error)
{
    size_t i = 0;
    while (i < count && asset.id != ids[i]) ++i;
    if (i == count) { error = "id: unknown game building " + asset.id; return false; }
    if (!compatible(asset, i, error)) return false;
    ready();
    auto& state = catalog();
    if (state.assets[i] != asset) { state.assets[i] = asset; ++state.revisions[i]; ++state.generation; }
    error.clear();
    return true;
}
bool applyBuildingAsset(std::string_view json, std::string& error)
{
    BuildingAsset asset;
    return gameframework::decodeBuildingAsset(json, asset, error) && applyBuildingAsset(asset, error);
}
Model structureModel(Structure kind, uint32_t variant) { return gameframework::buildingVariant(buildingAsset(kind), variant); }
}  // namespace hearthold
