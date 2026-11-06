#include "coordinate_hash.h"

namespace gameframework
{
namespace
{
uint32_t mix(uint32_t value)
{
    value ^= value >> 16;
    value *= 0x7feb352dU;
    value ^= value >> 15;
    value *= 0x846ca68bU;
    value ^= value >> 16;
    return value;
}
}  // namespace

float hash01(uint32_t seed, int x, int y, uint32_t salt)
{
    return float(mix(seed * 0x9e3779b9U ^ mix(uint32_t(x) * 0x85ebca6bU ^ mix(uint32_t(y) * 0xc2b2ae35U ^ salt))) >> 8) / float(1u << 24);
}
}  // namespace gameframework
