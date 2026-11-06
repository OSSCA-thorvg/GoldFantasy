#pragma once

#include "building_faces.h"
#include <cstddef>

namespace gameframework
{
struct DepthFragment
{
    size_t source = 0;
    Polygon polygon;
    bool line = false;
};
struct DepthBatch
{
    size_t source = 0;
    bool line = false;
    std::vector<Polygon> polygons;
};

// Back-to-front planar fragments; outlines contain only the original edges.
// Throws std::length_error if pathological intersections exceed the work budget.
std::vector<DepthFragment> depthOrder(const std::vector<Face>& faces, float frame);
// Consecutive fragments of one paint share coverage without changing depth order.
std::vector<DepthBatch> depthBatches(const std::vector<Face>& faces, float frame);
}  // namespace gameframework
