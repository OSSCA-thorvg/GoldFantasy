#include "building_model.h"
#include <algorithm>
#include <cmath>
#include <stdexcept>
namespace gameframework
{
// Paint back to front. A block standing on another (a storey, a chimney) paints right after its
// support, so towers in front of that support still cover it.
void sortModel(Model& model)
{
    auto depth = [](const Block& b) { return b.x0 + b.x1 + b.y0 + b.y1; };
    auto key = [&](const Block& block) {
        if (block.base <= 0) return depth(block);
        float cx = (block.x0 + block.x1) / 2, cy = (block.y0 + block.y1) / 2, support = depth(block);
        for (const auto& other : model.blocks)
            if (other.base < block.base && cx >= other.x0 && cx <= other.x1 && cy >= other.y0 && cy <= other.y1) support = depth(other);
        return support + .001f * block.base;
    };
    std::vector<std::pair<float, Block>> ordered;
    ordered.reserve(model.blocks.size());
    for (const auto& block : model.blocks) ordered.emplace_back(key(block), block);
    std::stable_sort(ordered.begin(), ordered.end(), [](const auto& a, const auto& b) { return a.first < b.first; });
    for (size_t i = 0; i < ordered.size(); ++i) model.blocks[i] = std::move(ordered[i].second);
}

// One quarter turn (+x to +y) of a rectangle about (c, c).
static void quarterTurn(float& x0, float& y0, float& x1, float& y1, float c)
{
    float nx0 = 2 * c - y1, nx1 = 2 * c - y0, ny0 = x0, ny1 = x1;
    x0 = nx0, x1 = nx1, y0 = ny0, y1 = ny1;
}

void orientModel(Model& model, int quarterTurns, float size)
{
    int turns = ((quarterTurns % 4) + 4) % 4;
    float c = size / 2;
    for (int t = 0; t < turns; ++t) {
        for (auto& block : model.blocks) {
            quarterTurn(block.x0, block.y0, block.x1, block.y1, c);
            block.doorFacing = (block.doorFacing + 1) % 4;
            if (block.shape == RoofShape::GableX) block.shape = RoofShape::GableY;
            else if (block.shape == RoofShape::GableY) block.shape = RoofShape::GableX;
        }
        for (auto& patch : model.patches) quarterTurn(patch.x0, patch.y0, patch.x1, patch.y1, c);
    }
    sortModel(model);
}

void splitAngle(float angle, int& quarterTurns, float& remainder)
{
    constexpr float quarter = 1.5707963f;
    if (!std::isfinite(angle)) throw std::invalid_argument("building angle must be finite");
    if (std::abs(angle) > 1e6f) angle = std::remainder(angle, quarter * 4);
    int turns = int(std::lround(angle / quarter));
    remainder = angle - turns * quarter;
    quarterTurns = ((turns % 4) + 4) % 4;
}

}  // namespace gameframework
