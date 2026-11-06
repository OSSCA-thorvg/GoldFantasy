#include "mouth_animation.h"
#include <algorithm>
#include <array>
#include <locale>
#include <sstream>
#include <stdexcept>

namespace gameframework
{
MouthTraits mouthTraits(MouthShape shape)
{
    switch (shape) {
    case MouthShape::Sealed: return {.015f, 0, .85f};
    case MouthShape::Open: return {.85f, 0, 1.2f};
    case MouthShape::Wide: return {.4f, 0, 1.35f};
    case MouthShape::Round: return {.68f, 1, 1};
    case MouthShape::Consonant: return {.28f, 0, 1};
    case MouthShape::Rest: return {0, 0, 1};
    }
    return {0, 0, 1};
}

std::unique_ptr<tvg::LottieAnimation> mouthAnimation(float width, float lipWeight)
{
    std::ostringstream out;
    out.imbue(std::locale::classic());
    out << R"({"v":"5.7.4","fr":60,"ip":0,"op":61,"w":128,"h":128,"assets":[],"layers":[{"ty":4,"ind":1,"ip":0,"op":61,"st":0,"sr":1,"ks":{"o":{"a":0,"k":100},"r":{"a":0,"k":0},"p":{"a":0,"k":[0,0]},"a":{"a":0,"k":[0,0]},"s":{"a":0,"k":[100,100]}},"shapes":[{"ty":"sh","ks":{"a":1,"k":[)";
    auto points = [&](const std::array<tvg::Point, 4>& values) {
        out << '[';
        for (size_t i = 0; i < values.size(); ++i) {
            if (i) out << ',';
            out << '[' << values[i].x << ',' << values[i].y << ']';
        }
        out << ']';
    };
    // Identical vertices and winding let ThorVG morph every pair of lip shapes.
    for (int i = 0; i <= int(MouthShape::Consonant); ++i) {
        if (i) out << ',';
        auto traits = mouthTraits(MouthShape(i));
        float w = 64 * width * traits.width * (1 - traits.round * .32f);
        float h = 64 * (.035f * lipWeight + traits.open * .5f);
        out << "{\"t\":" << i * 10 << ",\"h\":1,\"s\":[{\"c\":true,\"v\":";
        points({{{64 - w, 64}, {64, 64 - h * .7f}, {64 + w, 64}, {64, 64 + h}}});
        out << ",\"i\":";
        points({{{0, h * .55f}, {-w * .6f, 0}, {0, -h * .4f}, {w * .6f, 0}}});
        out << ",\"o\":";
        points({{{0, -h * .4f}, {w * .6f, 0}, {0, h * .55f}, {-w * .6f, 0}}});
        out << "}]}";
    }
    out << R"(]}},{"ty":"fl","c":{"a":1,"k":[)";
    for (int i = 0; i <= int(MouthShape::Consonant); ++i) {
        if (i) out << ',';
        bool closed = i <= int(MouthShape::Sealed);
        out << "{\"t\":" << i * 10 << ",\"h\":1,\"s\":[" << (closed ? 122 : 92) / 255.f << ','
            << (closed ? 52 : 34) / 255.f << ',' << (closed ? 60 : 42) / 255.f << "]}";
    }
    out << R"(]},"o":{"a":0,"k":100},"r":1}]}]})";
    auto json = out.str();
    std::unique_ptr<tvg::LottieAnimation> animation(tvg::LottieAnimation::gen());
    auto picture = animation->picture();
    if (picture->load(json.data(), uint32_t(json.size()), "lot", nullptr, true) != tvg::Result::Success)
        throw std::runtime_error("Cannot load portrait mouth animation");
    unsigned nodes = 0;
    std::unique_ptr<tvg::Accessor> accessor(tvg::Accessor::gen());
    accessor->set(picture, [](const tvg::Paint*, void* count) { return ++*static_cast<unsigned*>(count) < 2; }, &nodes);
    if (nodes < 2 || animation->totalFrame() <= 50)
        throw std::runtime_error("Invalid portrait mouth animation");
    animation->frame(0);
    return animation;
}

void tweenMouth(tvg::LottieAnimation& animation, const MouthBlend& blend)
{
    if (blend.from == blend.to) animation.frame(float(int(blend.to) * 10));
    else animation.tween(float(int(blend.from) * 10), float(int(blend.to) * 10), std::clamp(blend.progress, 0.f, 1.f));
}
}  // namespace gameframework
