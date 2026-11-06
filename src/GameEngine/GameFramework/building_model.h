#pragma once

#include "geometry.h"
#include <cstdint>
#include <vector>

namespace gameframework
{
enum class RoofShape : uint8_t { Flat, GableX, GableY, Pyramid };
enum class Trim : uint8_t { None, Timber, Crenels, Stakes };
enum class Ornament : uint8_t { None, Banner, Crystal };

struct Rgb
{
    uint8_t r, g, b;
    bool operator==(const Rgb&) const = default;
};

// One iso box with a roof, in tile units relative to the structure's footprint corner.
struct Block
{
    float x0, y0, x1, y1;
    float wall, roof;  // Heights in unscaled pixels.
    RoofShape shape;
    Rgb wallLit, wallShade, roofLit, roofShade;
    float base = 0;     // Starting height, e.g. an upper storey or a chimney.
    float delay = 0;    // Frames before this block starts rising.
    int windows = 0;    // Lit windows per visible wall.
    bool door = false;
    Trim trim = Trim::None;
    Rgb glass = {232, 162, 72};
    Ornament ornament = Ornament::None;
    Rgb accent = {156, 40, 46};  // Banner cloth or crystal tint.
    uint8_t doorFacing = 0;  // Transient quarter-turn orientation; authored doors face +y.
    bool operator==(const Block&) const = default;
};

// Flat ground cover such as fields or paving, with optional furrows along x.
struct Patch
{
    float x0, y0, x1, y1;
    Rgb color;
    int furrows = 0;
    Rgb furrow = {0, 0, 0};
    float delay = 0;
    bool operator==(const Patch&) const = default;
};

struct Model
{
    std::vector<Patch> patches;
    std::vector<Block> blocks;  // Source order breaks ties between coplanar details.
    bool operator==(const Model&) const = default;
};

void sortModel(Model&);
void orientModel(Model&, int quarterTurns, float footprint);
void splitAngle(float angle, int& quarterTurns, float& remainder);
struct BuildingProjection
{
    float halfWidth = 32, halfHeight = 16;
    Point project(float x, float y, float z = 0) const { return {(x - y) * halfWidth, (x + y) * halfHeight - z}; }
};
}  // namespace gameframework
