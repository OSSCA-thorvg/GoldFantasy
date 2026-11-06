#pragma once
#include "building_model.h"
#include <string>
namespace gameframework
{
struct RiseAnimation
{
    std::string json;
    float width = 0, height = 0;
    float originX = 0, originY = 0;
    float frames = 0, frameRate = 30;
};
struct BuildingStage
{
    Model model;
    float footprint = 1, dx = 0, dy = 0;
};
RiseAnimation buildingRiseAnimation(const Model&, float footprint,
    const std::vector<BuildingStage>& replaced = {}, float angle = 0,
    BuildingProjection projection = {});
RiseAnimation buildingStillAnimation(const Model&, float footprint, float angle = 0,
    BuildingProjection projection = {});
}  // namespace gameframework
