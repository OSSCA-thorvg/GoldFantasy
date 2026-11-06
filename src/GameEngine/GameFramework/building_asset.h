#pragma once
#include "building_model.h"
#include <string>
#include <string_view>
namespace gameframework
{
struct BuildingAsset
{
    std::string id, name;
    float footprint = 1;
    std::vector<Model> variants;
    bool operator==(const BuildingAsset&) const = default;
};
bool validateBuildingAsset(const BuildingAsset&, std::string& error);
bool decodeBuildingAsset(std::string_view, BuildingAsset&, std::string& error);
std::string encodeBuildingAsset(const BuildingAsset&);
const Model& buildingVariant(const BuildingAsset&, uint32_t seed);
}  // namespace gameframework
