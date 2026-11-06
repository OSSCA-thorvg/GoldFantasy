#include "rise_animation.h"
namespace hearthold
{
RiseAnimation riseAnimation(Structure kind, uint32_t variant, const std::vector<Stage>& replaced, float angle)
{
    std::vector<gameframework::BuildingStage> stages;
    for (const auto& stage : replaced) stages.push_back({structureModel(stage.kind, stage.variant), float(structureSpec(stage.kind).size), stage.dx, stage.dy});
    return gameframework::buildingRiseAnimation(structureModel(kind, variant), float(structureSpec(kind).size), stages, angle);
}
}  // namespace hearthold
