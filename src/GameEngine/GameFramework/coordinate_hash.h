#pragma once

#include <cstdint>

namespace gameframework
{
float hash01(uint32_t seed, int x, int y, uint32_t salt = 0);
}  // namespace gameframework
