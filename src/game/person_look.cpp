#include "person_look.h"
#include "character_assets.h"
#include "world_map.h"
#include <algorithm>
#include <iterator>
#include <string_view>
#include <array>

namespace hearthold
{
Injury injuryOf(const Person& person)
{
    if (person.health < .35f) return Injury::Bandaged;
    if (person.health < .6f) return Injury::Bruised;
    if (person.health < .85f) return Injury::Scratched;
    return Injury::None;
}

BodyType headBody(int head)
{
    return characterAssetGender(head)==CharacterAssetGender::Feminine?BodyType::Female:BodyType::Male;
}

Appearance appearanceOf(const Person& person)
{
    if (person.customLook) {auto look=*person.customLook;resolveCharacterAssets(look);return look;}
    auto roll = [&](int salt) { return hash01(person.look, 0, salt, 0x5eedu); };
    constexpr std::array<Rgb, 6> skins{{{240,205,179}, {231,183,159}, {211,153,130}, {183,126,100}, {151,98,76}, {109,73,57}}};
    constexpr std::array<Rgb, 6> hair{{{34,35,34}, {67,55,46}, {106,91,76}, {164,91,54}, {207,183,126}, {224,222,209}}};
    constexpr std::array<Rgb, 7> cloth{{{96,106,99}, {76,87,83}, {102,108,110}, {85,99,88}, {70,87,98}, {115,118,113}, {106,92,80}}};
    Appearance a{};
    a.seed = person.look;
    a.bodyType=roll(5)<.5f?BodyType::Male:BodyType::Female;
    useCharacterReference(a,randomCharacterReference(person.look,a.bodyType));
    a.outfitAsset = uint8_t(person.calling);
    a.skin = skins[size_t(roll(2) * skins.size()) % skins.size()];
    a.skinShade = mix(a.skin, {123,81,69}, .18f);
    a.hair = hair[size_t(roll(3) * hair.size()) % hair.size()];
    a.hairShade = scale(a.hair, .42f);
    a.hairEnd = a.hair;
    a.eyes = {20,23,22};
    a.cloth = cloth[size_t(person.calling)];
    a.clothShade = scale(a.cloth, .68f);
    a.trim = {146,130,99};
    a.hairStyle = HairStyle::Crop;
    a.headwear = Headwear::None;
    a.nose = Nose::Button;
    a.whiskers = Whiskers::None;
    a.eyeStyle = EyeStyle::Round;
    a.faceWidth = .5f; a.jaw = .4f;
    a.eyeSize = 1; a.eyeGap = 8.4f; a.browWeight = 1; a.mouthWidth = 6;
    a.mouthStyle = MouthStyle::Neutral;
    // Gender is sampled first; appearance follows weighted asset metadata.
    return a;
}
}  // namespace hearthold
