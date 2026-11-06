#pragma once

#include "building_catalog.h"

namespace hearthold
{
enum class HairStyle : uint8_t { Crop, Swept, Long, Ponytail, Bun, Braids, Wild, Bald, Bob, TwinTails, Straight };
enum class Headwear : uint8_t { None, Kerchief, Cap, Helmet, Hood, PointedHat, Circlet, WideBrim };
enum class Nose : uint8_t { Button, Straight, Broad, Hooked };
enum class Whiskers : uint8_t { None, Stubble, Moustache, Beard, LongBeard };
enum class EyeStyle : uint8_t { Round, Feline, Hooded, Arcane, Almond, Relaxed, Soft, Reflective };
enum class FaceShape : uint8_t { Natural, Oval, Round, Angular };
enum class MouthStyle : uint8_t { Smile, Neutral, Pout, Small };
enum class FringeStyle : uint8_t { Natural, SidePart, Curtain, Blunt, Textured };
enum class HairFinish : uint8_t { Flat, Gradient, Strands, Halftone };
enum class BodyType : uint8_t { Male, Female };
enum class PortraitEyeKind : uint8_t { Dots, Open };
enum class PortraitEyeForm : uint8_t { Round, Almond, HalfLid, Reference };

struct Appearance
{
    Rgb skin, skinShade, hair, hairShade, eyes, cloth, clothShade, trim;
    HairStyle hairStyle;
    Headwear headwear;
    Nose nose;
    Whiskers whiskers;
    EyeStyle eyeStyle;
    float faceWidth, jaw, eyeSize, eyeGap, browWeight, mouthWidth;
    float jawWidth = 1, chinLength = 1;
    float bodyHeight = 1, bodyWidth = 1;
    bool freckles, scar, earring, old, eyepatch, warpaint;
    bool tippedHair, comely, pointedEars, slitPupils;
    uint32_t seed;
    FaceShape faceShape = FaceShape::Natural;
    MouthStyle mouthStyle = MouthStyle::Smile;
    FringeStyle fringeStyle = FringeStyle::Natural;
    HairFinish hairFinish = HairFinish::Flat;
    Rgb hairEnd{180, 150, 120};
    float irisSize = 1, eyeTilt = 0, cheekFullness = .5f, lipFullness = 1;
    // Portrait controls are independent of the small, simplified world face.
    float eyeWidth = 1, eyeHeight = 1, eyeLevel = 0, lidDrop = 0;
    float noseScale = 1, earScale = 1, equipmentScale = 1;
    BodyType bodyType = BodyType::Male;
    // Reference-derived parts are independent of species and gameplay calling.
    uint8_t faceAsset = 0, hairAsset = 0, eyeReference = 0, outfitAsset = 0;
    uint8_t earAsset = 0;
    // The cranium drives attachment; the lower face never drives hair.
    uint8_t scalpAsset = 0;
    float scalpWidth = 1, scalpHeight = 1, foreheadShift = 0, templeWidth = 1;
    // 255 inherits the hairstyle; 19 removes that component.
    uint8_t hairCap = 255, hairFringe = 255, hairBack = 255, hairTied = 255;
    float hairLength = 1, sideLockGap = 0, earTilt = 0;
    float earHeight = 0;
    float faceBlend = 0, eyeOpenness = 1, eyeRoundness = 0, eyeStroke = 1, mouthCurve = 0;
    uint8_t scalpTarget = 255, jawTarget = 255;
    float scalpBlend = 0, jawBlend = 0;
    PortraitEyeKind portraitEyeKind = PortraitEyeKind::Dots;
    PortraitEyeForm portraitEyeForm = PortraitEyeForm::Round;
    bool eyeOutline = false, upperLid = true, browVisible = false;
    uint8_t browReference = 0;
    float pupilHeight = 1.35f, pupilY = -.22f;
    float browWidth = 1, browSpacing = 1, browHeight = 0, browTilt = 0, browCurve = 0;
};
}  // namespace hearthold
