#pragma once

#include "person_appearance.h"
#include <array>
#include <cstdint>
#include <string_view>

namespace hearthold
{
// The world as designed: the seed every new game starts from unless a random world is chosen.
inline constexpr uint32_t designedWorldSeed = 5;

inline constexpr std::string_view birthNotice = "Askr and Embla wake at Ymir's feet, born of the giant's stone";

struct Founder
{
    std::string_view name, past;
    BodyType bodyType;
};

inline constexpr std::array<Founder, 2> foundingPeople = std::to_array<Founder>({
    {"Askr", "Born under Ymir's left arm", BodyType::Male},
    {"Embla", "Woke under Ymir's arm beside Askr", BodyType::Female},
});
}  // namespace hearthold
