#pragma once

#include <thorvg.h>
#include <GameEngine/GameFramework/geometry.h>

namespace hearthold
{
// One tile is a 64x32 diamond; tile (i, j) covers [i, i + 1) x [j, j + 1) in tile space.
constexpr float tileHalfWidth = 32, tileHalfHeight = 16;

using gameframework::Point;
using gameframework::Camera;
using gameframework::Outline;
using gameframework::Footprint;
using gameframework::length;
using gameframework::distance;
using gameframework::normalized;
using gameframework::lerp;
using gameframework::rotated;
using gameframework::segmentDistance;
using gameframework::closestOnSegment;
using gameframework::segmentsCross;
using gameframework::area;
using gameframework::centroid;
using gameframework::contains;
using gameframework::selfIntersects;
using gameframework::outlineDistance;
using gameframework::overlaps;
using gameframework::cubic;

// Tile-space position plus height in pixels to unscaled screen space.
inline Point project(float tx, float ty, float z = 0)
{
    return {(tx - ty) * tileHalfWidth, (tx + ty) * tileHalfHeight - z};
}

inline Point unproject(float sx, float sy)
{
    float u = sx / tileHalfWidth, v = sy / tileHalfHeight;
    return {(u + v) / 2, (v - u) / 2};
}

// Draws tile-space geometry (flat terrain, roads) directly as iso diamonds.
inline tvg::Matrix isoMatrix()
{
    return {tileHalfWidth, -tileHalfWidth, 0, tileHalfHeight, tileHalfHeight, 0, 0, 0, 1};
}

}  // namespace hearthold
