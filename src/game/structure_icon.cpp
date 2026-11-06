#include "structure_icon.h"
#include <GameEngine/GameFramework/building_icon.h>
namespace hearthold
{
tvg::Scene* structureIcon(Structure kind, float width, float height)
{
    return gameframework::buildingIcon(structureModel(kind, 4), float(structureSpec(kind).size), width, height);
}
}  // namespace hearthold
