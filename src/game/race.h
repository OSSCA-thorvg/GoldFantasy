#pragma once

#include <cstdint>

namespace hearthold
{
// World identity, independent of the character's authored face, hair and outfit assets.
enum class Race : uint8_t { Human, God };
inline constexpr int raceCount = 2;
const char* raceName(Race);
}  // namespace hearthold
