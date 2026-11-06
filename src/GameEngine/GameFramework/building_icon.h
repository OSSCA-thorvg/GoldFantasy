#pragma once
#include "building_model.h"
#include <thorvg.h>
namespace gameframework
{
tvg::Scene* buildingIcon(const Model&, float footprint, float width, float height,
    float angle = 0, BuildingProjection projection = {});
}  // namespace gameframework
