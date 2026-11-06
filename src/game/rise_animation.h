#pragma once

#include "building_catalog.h"
#include <GameEngine/GameFramework/building_animation.h>

namespace hearthold
{
using gameframework::RiseAnimation;

// Builds a Lottie where foundation, walls and roof morph up from the footprint with an overshoot,
// then windows light up. Replaced stages sink while the new one rises. Every path keeps its
// vertex count so ThorVG can interpolate the shapes.
// `angle` turns the structure about its footprint centre; stage offsets are in its unturned frame.
RiseAnimation riseAnimation(Structure, uint32_t variant, const std::vector<Stage>& replaced = {}, float angle = 0);
}  // namespace hearthold
