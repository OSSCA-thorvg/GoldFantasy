#pragma once

#include "climate.h"
#include "vector_paint.h"

namespace hearthold
{
class WorldMap;
enum class Terrain : uint8_t;

// A small environment study: the ground underfoot and the land behind either shoulder.
// Only these colours enter the paint key, so walking within the same patch retains the portrait.
struct PortraitBackdrop
{
    Rgb ground, left, right, distant;
};

PortraitBackdrop portraitBackdrop();
PortraitBackdrop portraitBackdrop(Terrain, const Climate& = {});
PortraitBackdrop portraitBackdrop(const WorldMap&, Point, const Climate&);
tvg::Scene* portraitBackground(const PortraitBackdrop&, float width, float height);
}  // namespace hearthold
