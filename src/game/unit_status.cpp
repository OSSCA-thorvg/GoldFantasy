#include "town.h"
#include <array>

namespace hearthold
{
const char* conditionName(Condition condition)
{
    constexpr std::array names{"Hungry", "Starving", "Exhausted", "Thirsty", "Cold", "Soaked", "Snowed on", "Slept outside",
                               "No home", "Unpaid", "Short of coin", "No bed at an inn", "Enjoyed the tavern", "Wounded", "Breaking down", "Content"};
    return names[size_t(condition)];
}

bool positiveCondition(Condition condition) { return condition == Condition::Relaxed || condition == Condition::Content; }

std::vector<Condition> Town::conditions(const Person& p) const
{
    const auto& sky = climate();
    std::vector<Condition> out;
    if (p.food < .1f) out.push_back(Condition::Starving);
    else if (p.food < .3f) out.push_back(Condition::Hungry);
    if (p.rest < .2f) out.push_back(Condition::Exhausted);
    if (thirst) out.push_back(Condition::Thirsty);
    if (!p.inside && sky.temperature < 2) out.push_back(Condition::Cold);
    if (!p.inside && sky.precipitating()) out.push_back(sky.weather == Weather::Snow ? Condition::SnowedOn : Condition::Soaked);
    if (p.sleptOutside) out.push_back(Condition::SleptOutside);
    if (p.role == Role::Resident && p.home < 0) out.push_back(Condition::NoHome);
    if (p.unpaid) out.push_back(p.purse < 3 ? Condition::ShortOfCoin : Condition::Unpaid);
    if (p.role == Role::Guest && p.bed < 0) out.push_back(Condition::NoGuestBed);
    if (time - p.relaxedAt < secondsPerDay) out.push_back(Condition::Relaxed);
    if (p.health < .6f) out.push_back(Condition::Wounded);
    if (p.stress >= .85f) out.push_back(Condition::Distressed);
    if (out.empty()) out.push_back(Condition::Content);
    return out;
}

std::vector<std::string> Town::thoughts(const Person& p) const
{
    std::vector<std::string> out;
    for (auto condition : conditions(p)) out.emplace_back(conditionName(condition));
    return out;
}
}  // namespace hearthold
