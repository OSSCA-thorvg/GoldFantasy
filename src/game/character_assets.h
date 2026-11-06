#pragma once

#include "person_appearance.h"
#include "vector_paint.h"
#include <array>
#include <string_view>

namespace hearthold
{
inline constexpr int referenceHeadCount = 19;
inline constexpr int faceBaseCount = 30;
inline constexpr int eyeReferenceCount = 20;
inline constexpr int earAssetCount = faceBaseCount;
inline constexpr int hairAssetCount = 150;
inline constexpr int baldHairAsset = 19;
inline constexpr int outfitAssetCount = 14;

std::string_view headAssetName(int);
std::string_view faceBaseName(int);
std::string_view eyeAssetName(int);
enum class CharacterAssetGroup { Original, Modular, Colour, Dots, FlatLid };
enum class CharacterAssetGender { Masculine, Feminine, Unisex };
CharacterAssetGroup characterAssetGroup(int);
CharacterAssetGender characterAssetGender(int);
bool characterAssetReady(int);
int safeCharacterHairAsset(int);
void resolveCharacterAssets(Appearance&);
float characterAssetWeight(int, BodyType);
int randomCharacterReference(uint32_t seed, BodyType);
void useCharacterReference(Appearance&, int);
void setCharacterHeadBase(Appearance&, int);
struct CraniumFrame { Point crown, forehead, leftTemple, rightTemple; };
CraniumFrame characterCranium(const Appearance&);
enum class HairPart { Cap, Fringe, Back, Tied };
tvg::Scene* characterHairPart(const Appearance&, HairPart);
std::string_view hairAssetName(int);
std::string_view outfitAssetName(int);
bool characterOutfitReady(int);
int safeCharacterOutfitAsset(int);

struct FitAnchor { Point source, target; };
inline constexpr size_t faceAnchorCount = 16;
inline constexpr size_t hairAnchorCount = 15;
std::array<FitAnchor, hairAnchorCount> hairFitAnchors(const Appearance&);

// Positive scalp/lock skin weights; lower locks translate without changing their proportions.
class HairFit
{
public:
    explicit HairFit(const Appearance&, int hair = -1);
    Point map(Point) const;
    Point fringe(Point) const;
    Point rigid(Point) const;
    Point rigid(Point p,Point root) const;
    bool identity() const { return unchanged; }
private:
    bool unchanged = true;
    std::array<float,8> profileRatios{};
    float radius = 3.2f, crown = 3.2f, ratio = 1, height = 1, forehead = 0, temples = 1, length = 1, gap = 0;
};

struct CharacterBounds { float left, top, right, bottom; };
CharacterBounds characterHeadBounds(const Appearance&);
struct CharacterPlacement { float scale; Point origin; };
CharacterPlacement characterPortraitPlacement(float width, float height);
CharacterPlacement characterFigurePlacement(int outfit, float width, float height);
CharacterPlacement characterFigurePlacement(const Appearance&, float width, float height);
float outfitBottom(int);
std::array<Point, 13> characterEyePath(const Appearance&);
tvg::Shape* characterSkull(const Appearance&);
tvg::Scene* characterHair(const Appearance&, bool front);
tvg::Scene* characterEars(const Appearance&);
std::array<Point, 2> characterEarRoots(const Appearance&);
tvg::Scene* characterEyes(const Appearance&);
tvg::Scene* characterBrows(const Appearance&);
tvg::Scene* characterFace(const Appearance&);
tvg::Scene* characterHead(const Appearance&);
tvg::Scene* characterOutfit(const Appearance&);
tvg::Scene* characterFigure(const Appearance&);
}  // namespace hearthold
