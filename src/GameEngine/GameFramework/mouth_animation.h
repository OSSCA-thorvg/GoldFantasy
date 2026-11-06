#pragma once

#include <thorvg_lottie.h>
#include <memory>

namespace gameframework
{
enum class MouthShape : uint8_t { Rest, Sealed, Open, Wide, Round, Consonant };

struct MouthBlend
{
    MouthShape from = MouthShape::Rest, to = MouthShape::Rest;
    float progress = 0;
};

struct MouthTraits { float open, round, width; };
MouthTraits mouthTraits(MouthShape);
std::unique_ptr<tvg::LottieAnimation> mouthAnimation(float width, float lipWeight);
void tweenMouth(tvg::LottieAnimation&, const MouthBlend&);
}  // namespace gameframework
