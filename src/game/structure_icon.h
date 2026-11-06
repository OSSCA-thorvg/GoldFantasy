#pragma once

#include "building_catalog.h"
#include <thorvg.h>

namespace hearthold
{
// The finished building as a still vector picture fitted into width x height, for menus.
tvg::Scene* structureIcon(Structure, float width, float height);
}  // namespace hearthold
