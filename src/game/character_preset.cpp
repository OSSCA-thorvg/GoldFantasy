#include "character_preset.h"
#include "character_assets.h"
#include <core/io/io.h>
#include <algorithm>
#include <cmath>
#include <iomanip>
#include <limits>
#include <locale>
#include <sstream>

namespace hearthold
{
namespace
{
constexpr size_t maxPresetBytes = 8192;
constexpr Rgb Appearance::* colors[]{&Appearance::skin, &Appearance::skinShade, &Appearance::hair, &Appearance::hairShade,
                                    &Appearance::eyes, &Appearance::cloth, &Appearance::clothShade, &Appearance::trim};
constexpr bool Appearance::* details[]{&Appearance::freckles, &Appearance::scar, &Appearance::earring, &Appearance::old,
                                      &Appearance::eyepatch, &Appearance::warpaint, &Appearance::tippedHair, &Appearance::comely,
                                      &Appearance::pointedEars, &Appearance::slitPupils};

bool between(float value, float low, float high) { return std::isfinite(value) && value >= low && value <= high; }
}  // namespace

CharacterPreset characterPreset(const Person& p) { return {p.name, p.race, p.calling, p.look, appearanceOf(p)}; }

bool validCharacter(const CharacterPreset& p)
{
    const auto& a = p.look;
    return !p.name.empty() && p.name.size() <= 96
        && std::any_of(p.name.begin(), p.name.end(), [](unsigned char c) { return c > 32; })
        && std::none_of(p.name.begin(), p.name.end(), [](unsigned char c) { return c < 32 || c == 127; })
        && int(p.race) < raceCount && int(p.calling) <= int(Calling::Bard)
        && int(a.hairStyle) <= int(HairStyle::Straight) && int(a.headwear) <= int(Headwear::WideBrim)
        && int(a.nose) <= int(Nose::Hooked) && int(a.whiskers) <= int(Whiskers::LongBeard) && int(a.eyeStyle) <= int(EyeStyle::Reflective)
        && int(a.faceShape) <= int(FaceShape::Angular) && int(a.mouthStyle) <= int(MouthStyle::Small)
        && int(a.fringeStyle) <= int(FringeStyle::Textured) && int(a.hairFinish) <= int(HairFinish::Halftone)
        && int(a.bodyType) <= int(BodyType::Female)
        && between(a.faceWidth, -.35f, 1.35f) && between(a.jaw, -.2f, 1.2f) && between(a.eyeSize, .25f, 2.5f)
        && between(a.jawWidth, .65f, 1.35f) && between(a.chinLength, .65f, 1.5f)
        && between(a.eyeGap, 6, 11) && between(a.browWeight, .5f, 4) && between(a.mouthWidth, 3, 10)
        && between(a.bodyHeight, .75f, 1.25f) && between(a.bodyWidth, .75f, 1.25f)
        && between(a.irisSize, .5f, 1.4f) && between(a.eyeTilt, -.4f, .4f)
        && between(a.cheekFullness, 0, 1) && between(a.lipFullness, .75f, 1.25f)
        && between(a.eyeWidth, .4f, 1.8f) && between(a.eyeHeight, .4f, 1.8f)
        && between(a.eyeLevel, -.4f, .4f) && between(a.lidDrop, -.4f, .6f)
        && between(a.noseScale, .6f, 1.6f) && between(a.earScale, .7f, 1.3f)
        && between(a.equipmentScale, 0, 1.25f)
        && a.faceAsset < faceBaseCount && a.hairAsset < hairAssetCount && a.eyeReference < eyeReferenceCount && a.outfitAsset < outfitAssetCount
        && a.earAsset < earAssetCount && between(a.earHeight,-.5f,.5f)
        && a.scalpAsset < faceBaseCount && between(a.scalpWidth,.88f,1.12f) && between(a.scalpHeight,.88f,1.12f)
        && between(a.foreheadShift,-.2f,.2f) && between(a.templeWidth,.94f,1.06f)
        && (a.hairCap==255||a.hairCap<hairAssetCount) && (a.hairFringe==255||a.hairFringe<hairAssetCount)
        && (a.hairBack==255||a.hairBack<hairAssetCount) && (a.hairTied==255||a.hairTied<hairAssetCount)
        && between(a.hairLength,.8f,1.2f) && between(a.sideLockGap,-.2f,.4f) && between(a.earTilt,-.25f,.25f)
        && (a.scalpTarget==255||a.scalpTarget<faceBaseCount) && (a.jawTarget==255||a.jawTarget<faceBaseCount)
        && between(a.scalpBlend,0,1) && between(a.jawBlend,0,1)
        && int(a.portraitEyeKind)<=int(PortraitEyeKind::Open) && int(a.portraitEyeForm)<=int(PortraitEyeForm::Reference)
        && a.browReference<eyeReferenceCount && between(a.pupilHeight,.5f,2.f) && between(a.pupilY,-.6f,.6f)
        && between(a.browWidth,.5f,1.8f) && between(a.browSpacing,.7f,1.4f) && between(a.browHeight,-.7f,.7f)
        && between(a.browTilt,-.6f,.6f) && between(a.browCurve,-1,1)
        && between(a.faceBlend,0,1) && between(a.eyeOpenness,.1f,1.4f) && between(a.eyeRoundness,0,1)
        && between(a.eyeStroke,.25f,2.f) && between(a.mouthCurve,-1,1);
}

bool applyCharacter(Person& person, const CharacterPreset& preset)
{
    if (!validCharacter(preset)) return false;
    person.name = preset.name;
    person.race = preset.race;
    person.calling = preset.calling;
    person.look = preset.seed;
    person.customLook = preset.look;
    person.customLook->outfitAsset=uint8_t(safeCharacterOutfitAsset(preset.look.outfitAsset));
    ++person.lookRevision;
    return true;
}

void refreshShades(Appearance& a)
{
    a.skinShade = mix(scale(a.skin, .78f), {120, 60, 70}, .12f);
    a.hairShade = scale(a.hair, .66f);
    a.clothShade = scale(a.cloth, .68f);
}

std::string encodeCharacter(const CharacterPreset& p)
{
    std::ostringstream out;
    out.imbue(std::locale::classic());
    out << std::setprecision(std::numeric_limits<float>::max_digits10);
    out << "hearthold-character 9\nname " << std::quoted(p.name) << "\nidentity " << int(p.race) << ' ' << int(p.calling) << ' ' << p.seed << ' ' << p.look.seed << "\ncolors";
    for (auto member : colors) {
        auto c = p.look.*member;
        out << ' ' << int(c.r) << ' ' << int(c.g) << ' ' << int(c.b);
    }
    const auto& a = p.look;
    int outfit=a.outfitAsset<outfitAssetCount?safeCharacterOutfitAsset(a.outfitAsset):a.outfitAsset;
    out << "\nstyles " << int(a.hairStyle) << ' ' << int(a.headwear) << ' ' << int(a.nose) << ' ' << int(a.whiskers) << ' ' << int(a.eyeStyle)
        << "\nface " << a.faceWidth << ' ' << a.jaw << ' ' << a.eyeSize << ' ' << a.eyeGap << ' ' << a.browWeight << ' ' << a.mouthWidth
        << "\nbody " << a.bodyHeight << ' ' << a.bodyWidth << "\nbody-type " << int(a.bodyType) << "\njaw " << a.jawWidth << ' ' << a.chinLength
        << "\nfeatures " << int(a.faceShape) << ' ' << int(a.mouthStyle) << ' ' << int(a.fringeStyle) << ' ' << int(a.hairFinish)
        << ' ' << a.irisSize << ' ' << a.eyeTilt << ' ' << a.cheekFullness << ' ' << a.lipFullness
        << "\nhair-end " << int(a.hairEnd.r) << ' ' << int(a.hairEnd.g) << ' ' << int(a.hairEnd.b)
        << "\nportrait " << a.eyeWidth << ' ' << a.eyeHeight << ' ' << a.eyeLevel << ' ' << a.lidDrop
        << ' ' << a.noseScale << ' ' << a.earScale << ' ' << a.equipmentScale
        << "\nassets " << int(a.faceAsset) << ' ' << int(a.hairAsset) << ' ' << int(a.eyeReference) << ' ' << outfit
        << "\nears " << int(a.earAsset) << ' ' << a.earHeight
        << "\ncranium " << int(a.scalpAsset) << ' ' << a.scalpWidth << ' ' << a.scalpHeight << ' ' << a.foreheadShift << ' ' << a.templeWidth
        << "\nhair-parts " << int(a.hairCap) << ' ' << int(a.hairFringe) << ' ' << int(a.hairBack) << ' ' << int(a.hairTied)
        << "\nattachments " << a.hairLength << ' ' << a.sideLockGap << ' ' << a.earTilt
        << "\nface-morph " << int(a.scalpTarget) << ' ' << a.scalpBlend << ' ' << int(a.jawTarget) << ' ' << a.jawBlend
        << "\neye-system " << int(a.portraitEyeKind) << ' ' << int(a.portraitEyeForm) << ' ' << a.eyeOutline << ' ' << a.upperLid << ' ' << a.browVisible << ' ' << int(a.browReference) << ' ' << a.pupilHeight << ' ' << a.pupilY
        << "\nbrows " << a.browWidth << ' ' << a.browSpacing << ' ' << a.browHeight << ' ' << a.browTilt << ' ' << a.browCurve
        << "\nshape " << a.faceBlend << ' ' << a.eyeOpenness << ' ' << a.eyeRoundness << ' ' << a.eyeStroke << ' ' << a.mouthCurve << "\ndetails";
    for (auto member : details) out << ' ' << a.*member;
    return out.str() + '\n';
}

bool decodeCharacter(std::string_view text, CharacterPreset& output, std::string& error)
{
    error = "Invalid character preset (expected version 1 through 9).";
    if (text.size() > maxPresetBytes) { error = "Character preset exceeds 8 KiB."; return false; }
    std::istringstream in{std::string(text)};
    in.imbue(std::locale::classic());
    auto key = [&](const char* expected) { std::string name; return bool(in >> name) && name == expected; };
    CharacterPreset p;
    int version = 0, race = 0, calling = 0;
    uint64_t seed = 0, faceSeed = 0;
    if (!key("hearthold-character") || !(in >> version) || version < 1 || version > 9 || !key("name") || !(in >> std::quoted(p.name))
        || !key("identity") || !(in >> race >> calling >> seed >> faceSeed) || race < 0 || race >= (version >= 6 ? raceCount : 4) || calling < 0 || calling > int(Calling::Bard)
        || seed > UINT32_MAX || faceSeed > UINT32_MAX || !key("colors")) return false;
    p.race = version >= 6 ? Race(race) : Race::Human;
    p.calling = Calling(calling);
    p.seed = uint32_t(seed);
    p.look.seed = uint32_t(faceSeed);
    for (auto member : colors) {
        int r = 0, g = 0, b = 0;
        if (!(in >> r >> g >> b) || r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) return false;
        p.look.*member = {uint8_t(r), uint8_t(g), uint8_t(b)};
    }
    int hair = 0, hat = 0, nose = 0, beard = 0, eyes = 0;
    if (!key("styles") || !(in >> hair >> hat >> nose >> beard >> eyes) || hair < 0 || hair > int(HairStyle::Straight) || hat < 0 || hat > 7
        || nose < 0 || nose > 3 || beard < 0 || beard > 4 || eyes < 0 || eyes > int(EyeStyle::Reflective)) return false;
    auto& a = p.look;
    a.hairStyle = HairStyle(hair);
    a.headwear = Headwear(hat);
    a.nose = Nose(nose);
    a.whiskers = Whiskers(beard);
    a.eyeStyle = EyeStyle(eyes);
    if (!key("face") || !(in >> a.faceWidth >> a.jaw >> a.eyeSize >> a.eyeGap >> a.browWeight >> a.mouthWidth)
        || !key("body") || !(in >> a.bodyHeight >> a.bodyWidth)) return false;
    if (version >= 5) {
        int body = 0;
        if (!key("body-type") || !(in >> body) || body < 0 || body > int(BodyType::Female)) return false;
        a.bodyType = BodyType(body);
    }
    if (version >= 2 && (!key("jaw") || !(in >> a.jawWidth >> a.chinLength))) return false;
    a.hairEnd = a.hair;
    if (version >= 3) {
        int face = 0, mouth = 0, fringe = 0, finish = 0, r = 0, g = 0, b = 0;
        if (!key("features") || !(in >> face >> mouth >> fringe >> finish >> a.irisSize >> a.eyeTilt >> a.cheekFullness >> a.lipFullness)
            || face < 0 || face > 3 || mouth < 0 || mouth > 3 || fringe < 0 || fringe > 4 || finish < 0 || finish > 3
            || !key("hair-end") || !(in >> r >> g >> b) || r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) return false;
        a.faceShape = FaceShape(face);
        a.mouthStyle = MouthStyle(mouth);
        a.fringeStyle = FringeStyle(fringe);
        a.hairFinish = HairFinish(finish);
        a.hairEnd = {uint8_t(r), uint8_t(g), uint8_t(b)};
    }
    if (version >= 4 && (!key("portrait") || !(in >> a.eyeWidth >> a.eyeHeight >> a.eyeLevel >> a.lidDrop >> a.noseScale >> a.earScale >> a.equipmentScale))) return false;
    if (version >= 6) {
        int face=0,hairAsset=0,eye=0,outfit=0;
        if(!key("assets")||!(in>>face>>hairAsset>>eye>>outfit)||face<0||face>=(version>=9?faceBaseCount:version==8?4:referenceHeadCount)||hairAsset<0||hairAsset>=(version>=9?hairAssetCount:20)||eye<0||eye>=(version>=9?eyeReferenceCount:referenceHeadCount)||outfit<0||outfit>=outfitAssetCount)return false;
        int ear=face;
        if(version>=7&&(!key("ears")||!(in>>ear>>a.earHeight)||ear<0||ear>=(version>=9?earAssetCount:referenceHeadCount)))return false;
        a.earAsset=uint8_t(ear);
        if(version>=8) {
            int scalp=0,cap=255,fringe=255,back=255,tied=255;
            auto part=[version](int n){return n==255||(n>=0&&n<(version>=9?hairAssetCount:20));};
            if(!key("cranium")||!(in>>scalp>>a.scalpWidth>>a.scalpHeight>>a.foreheadShift>>a.templeWidth)||scalp<0||scalp>=(version>=9?faceBaseCount:4)
                ||!key("hair-parts")||!(in>>cap>>fringe>>back>>tied)||!part(cap)||!part(fringe)||!part(back)||!part(tied)
                ||!key("attachments")||!(in>>a.hairLength>>a.sideLockGap>>a.earTilt))return false;
            a.scalpAsset=uint8_t(scalp);a.hairCap=uint8_t(cap);a.hairFringe=uint8_t(fringe);a.hairBack=uint8_t(back);a.hairTied=uint8_t(tied);
        }
        if(version>=9) {
            int scalpTarget=255,jawTarget=255,kind=0,form=0,outline=0,lid=1,brows=0,brow=0;
            auto target=[](int value){return value==255||(value>=0&&value<faceBaseCount);};
            if(!key("face-morph")||!(in>>scalpTarget>>a.scalpBlend>>jawTarget>>a.jawBlend)||!target(scalpTarget)||!target(jawTarget)
                ||!key("eye-system")||!(in>>kind>>form>>outline>>lid>>brows>>brow>>a.pupilHeight>>a.pupilY)
                ||kind<0||kind>1||form<0||form>3||outline<0||outline>1||lid<0||lid>1||brows<0||brows>1||brow<0||brow>=eyeReferenceCount
                ||!key("brows")||!(in>>a.browWidth>>a.browSpacing>>a.browHeight>>a.browTilt>>a.browCurve))return false;
            a.scalpTarget=uint8_t(scalpTarget);a.jawTarget=uint8_t(jawTarget);a.portraitEyeKind=PortraitEyeKind(kind);a.portraitEyeForm=PortraitEyeForm(form);
            a.eyeOutline=outline!=0;a.upperLid=lid!=0;a.browVisible=brows!=0;a.browReference=uint8_t(brow);
        }
        if(!key("shape")||!(in>>a.faceBlend>>a.eyeOpenness>>a.eyeRoundness>>a.eyeStroke>>a.mouthCurve))return false;
        a.faceAsset=uint8_t(face);a.hairAsset=uint8_t(hairAsset);a.eyeReference=uint8_t(eye);a.outfitAsset=uint8_t(outfit);
    } else {
        constexpr uint8_t legacyHair[]{2,0,1,6,16,11,3,19,8,9,12};
        a.faceAsset=0;a.hairAsset=legacyHair[size_t(a.hairStyle)];
        a.eyeReference=a.eyeStyle==EyeStyle::Relaxed||a.eyeStyle==EyeStyle::Hooded?4:0;
        a.outfitAsset=uint8_t(p.calling);
        a.headwear=Headwear::None;
        a.whiskers=Whiskers::None;
    }
    if(version<9) {
        a.portraitEyeKind=PortraitEyeKind::Open;a.portraitEyeForm=PortraitEyeForm::Reference;
        a.eyeOutline=a.upperLid=a.browVisible=true;a.browReference=a.eyeReference;a.pupilHeight=1;a.pupilY=.02f;
        if(version==8) {
            constexpr uint8_t faces[]{0,22,24,21};a.faceAsset=faces[a.faceAsset];a.scalpAsset=faces[a.scalpAsset==1?0:a.scalpAsset];
            auto migrate=[](uint8_t id){return uint8_t(id<19?id+20:id);};
            a.hairAsset=migrate(a.hairAsset);a.hairCap=migrate(a.hairCap);a.hairFringe=migrate(a.hairFringe);a.hairBack=migrate(a.hairBack);a.hairTied=migrate(a.hairTied);
        } else a.scalpAsset=a.faceAsset;
    }
    if (!key("details")) return false;
    for (auto member : details) {
        int value = 0;
        if (!(in >> value) || (value != 0 && value != 1)) return false;
        a.*member = value != 0;
    }
    in >> std::ws;
    if (!in.eof() || !validCharacter(p)) return false;
    a.outfitAsset=uint8_t(safeCharacterOutfitAsset(a.outfitAsset));
    output = std::move(p);
    error.clear();
    return true;
}

bool saveCharacter(const std::filesystem::path& path, const CharacterPreset& p, std::string& error)
{
    error.clear();
    if (!validCharacter(p)) { error = "Enter a name of 1 to 96 bytes."; return false; }
    if (path.empty()) { error = "Enter a preset file path."; return false; }
    std::error_code ec;
    if (path.has_parent_path()) std::filesystem::create_directories(path.parent_path(), ec);
    if (ec) { error = ec.message(); return false; }
    auto baseline = te::io::load(path, {true, maxPresetBytes});
    if (!baseline) { error = baseline.error.message; return false; }
    auto saved = te::io::save(path, encodeCharacter(p), {{}, baseline.value.stamp, maxPresetBytes});
    if (!saved) { error = saved.error.message; return false; }
    return true;
}

bool loadCharacter(const std::filesystem::path& path, CharacterPreset& p, std::string& error)
{
    error.clear();
    auto loaded = te::io::load(path, {false, maxPresetBytes});
    if (!loaded) { error = loaded.error.message; return false; }
    return decodeCharacter(loaded.value.text, p, error);
}
}  // namespace hearthold
