#pragma once
#include "building_catalog.h"
#include <GameEngine/GameFramework/building_asset.h>
#include <core/io/io.h>
#include <filesystem>
#include <string>
#include <string_view>

namespace hearthold
{
struct BuildingAssetFile
{
    gameframework::BuildingAsset asset;
    std::filesystem::path path;
    te::io::DiskStamp stamp;
    te::io::FileFormat format;
};
// Original file snapshot survives in-memory Apply. Committed editor saves update it separately.
BuildingAssetFile buildingAssetFile(Structure);
void rememberBuildingAssetFile(const BuildingAssetFile&);
const char* buildingAssetId(Structure);
const gameframework::BuildingAsset& buildingAsset(Structure);
std::filesystem::path buildingAssetPath(Structure);
uint64_t buildingAppearanceRevision(Structure);
uint64_t buildingCatalogGeneration();
const std::string& buildingAssetsWarning();
// Explicit directories never fall back. Reload stages the entire catalog before publishing.
bool loadBuildingAssets(const std::filesystem::path& directory, std::string& error);
bool loadDefaultBuildingAssets(const std::filesystem::path& installedDirectory, std::string& error);
bool reloadBuildingAssets(std::string& error);
bool applyBuildingAsset(const gameframework::BuildingAsset&, std::string& error);
bool applyBuildingAsset(std::string_view json, std::string& error);
}  // namespace hearthold
