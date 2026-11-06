#pragma once

#include <test/test.h>
#include <game/terrain_painter.h>
#include <game/world_map.h>
#include <memory>
#include <vector>

namespace hearthold::test
{
// The ground's brightness at a point, painted as the game paints it in daylight and seen from close up.
inline float groundLight(const WorldMap& map, Point at)
{
    constexpr int size = 9;
    std::vector<uint32_t> pixels(size * size);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen());
    CHECK(canvas->target(pixels.data(), size, size, size, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
    auto iso = tvg::Scene::gen();
    TileRegion area{int(at.x) - 3, int(at.y) - 3, int(at.x) + 4, int(at.y) + 4};
    tintGround(paintGround(iso, map, &area), Climate{});
    constexpr float zoom = 4;
    auto matrix = isoMatrix();
    auto focus = project(at.x, at.y);
    matrix.e11 *= zoom; matrix.e12 *= zoom; matrix.e21 *= zoom; matrix.e22 *= zoom;
    matrix.e13 = size / 2.f - focus.x * zoom; matrix.e23 = size / 2.f - focus.y * zoom;
    iso->transform(matrix);
    CHECK(canvas->add(iso) == tvg::Result::Success);
    CHECK(canvas->draw(true) == tvg::Result::Success);
    CHECK(canvas->sync() == tvg::Result::Success);
    auto pixel = pixels[size * size / 2];
    return .3f * float((pixel >> 16) & 255) + .59f * float((pixel >> 8) & 255) + .11f * float(pixel & 255);
}
}  // namespace hearthold::test
