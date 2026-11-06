#pragma once

#include "building_model.h"
#include <functional>
#include <utility>
#include <vector>

namespace gameframework
{
struct Vertex
{
    float x = 0, y = 0, depth = 0;
    operator Point() const { return {x, y}; }
    bool operator==(const Vertex&) const = default;
};
using Polygon = std::vector<Vertex>;
using OpacityKeys = std::vector<std::pair<float, float>>;  // (frame, 0..100); one key means static.

// One animated Lottie shape group, sampled per frame.
struct Face
{
    enum class Style { Filled, Outlined, Line };
    std::function<Polygon(float frame)> shape;
    Rgb color;
    Style style = Style::Outlined;
    float width = 1.2f;  // Line width; outlines use the shared outline width.
    OpacityKeys opacity;
};

// Rising for a new stage, sinking for a replaced one.
struct Motion
{
    float start = 0;  // Frame the whole structure starts at.
    bool sinking = false;
    Point offset;     // Units, in the new structure's frame.
    float turn = 0;   // Residual rotation within +-45 degrees about `pivot`.
    Point pivot;
    BuildingProjection projection;

    // Depth increases toward the viewer along each orthographic projection ray.
    Vertex place(float x, float y, float z = 0) const;

    float wall(const Block&, float frame) const;
    float roof(const Block&, float frame) const;
    // 0..1 pop-in for late details such as banners and crystals.
    float detail(const Block&, float frame) const;
    OpacityKeys body(float delay) const;
    OpacityKeys late(float delay, float riseAt) const;
};

void buildingFaces(const Model&, const Motion&, std::vector<Face>& faces);
}  // namespace gameframework
