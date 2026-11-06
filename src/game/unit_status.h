#pragma once

#include <cstdint>

namespace hearthold
{
// Conditions coexist; Activity describes only what the unit is doing.
enum class Condition : uint8_t {
    Hungry, Starving, Exhausted, Thirsty, Cold, Soaked, SnowedOn, SleptOutside,
    NoHome, Unpaid, ShortOfCoin, NoGuestBed, Relaxed, Wounded, Distressed, Content
};
const char* conditionName(Condition);
bool positiveCondition(Condition);
}  // namespace hearthold
