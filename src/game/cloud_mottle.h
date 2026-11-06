#pragma once
#include <cstdint>
#include <vector>

namespace hearthold
{
// A seamlessly tiling size x size field of soft cloud-shadow blotches: straight-alpha ARGB, dark
// blue-grey with alpha carrying the shadow. Drawn stretched over the land on cloudy days.
std::vector<uint32_t> cloudMottle(int size, uint32_t seed);
}  // namespace hearthold
