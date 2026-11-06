#pragma once

#include "person_look.h"
#include <filesystem>
#include <string_view>

namespace hearthold
{
struct CharacterPreset
{
    std::string name;
    Race race = Race::Human;
    Calling calling = Calling::Settler;
    uint32_t seed = 1;
    Appearance look{};
};

CharacterPreset characterPreset(const Person&);
bool validCharacter(const CharacterPreset&);
bool applyCharacter(Person&, const CharacterPreset&);
void refreshShades(Appearance&);
std::string encodeCharacter(const CharacterPreset&);
bool decodeCharacter(std::string_view, CharacterPreset&, std::string& error);
bool saveCharacter(const std::filesystem::path&, const CharacterPreset&, std::string& error);
bool loadCharacter(const std::filesystem::path&, CharacterPreset&, std::string& error);
}  // namespace hearthold
