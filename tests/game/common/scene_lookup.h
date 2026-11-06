#pragma once

#include <thorvg.h>
#include <cmath>

namespace hearthold::test
{
// The scene drawn at a screen point: sprites are translated to where they stand.
inline tvg::Scene* figureAt(tvg::Paint* paint, float x, float y)
{
    if (paint->type() != tvg::Type::Scene) return nullptr;
    auto* scene = static_cast<tvg::Scene*>(paint);
    auto transform = scene->transform();
    if (std::abs(transform.e13 - x) < .001f && std::abs(transform.e23 - y) < .001f) return scene;
    for (auto* child : scene->paints())
        if (auto* found = figureAt(child, x, y)) return found;
    return nullptr;
}

// The scene that holds `target` directly, searched from `scene` down.
inline tvg::Scene* parentOf(tvg::Scene* scene, tvg::Paint* target)
{
    for (auto* child : scene->paints()) {
        if (child == target) return scene;
        if (child->type() == tvg::Type::Scene)
            if (auto* found = parentOf(static_cast<tvg::Scene*>(child), target)) return found;
    }
    return nullptr;
}
}  // namespace hearthold::test
