#include <test/test.h>
#include <test/graphics.h>
#include <GameEngine/GameFramework/mouth_animation.h>
#include <vector>

using namespace gameframework;

TEST(framework_mouth_uses_thorvg_tween_for_intermediate_shapes_and_color)
{
    te::test::Graphics runtime(false);
    auto animation = mouthAnimation(.3f, 1);
    CHECK(animation->totalFrame() > 50);
    std::vector<uint32_t> pixels(128 * 128);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen(tvg::EngineOption::Default));
    CHECK(canvas->target(pixels.data(), 128, 128, 128, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
    CHECK(canvas->add(animation->picture()) == tvg::Result::Success);
    auto draw = [&](MouthBlend blend) {
        CHECK(canvas->sync() == tvg::Result::Success);
        tweenMouth(*animation, blend);
        CHECK(canvas->update() == tvg::Result::Success);
        CHECK(canvas->draw(true) == tvg::Result::Success);
        CHECK(canvas->sync() == tvg::Result::Success);
        return pixels;
    };
    auto mass = [](const std::vector<uint32_t>& pixels) {
        uint64_t total = 0;
        for (auto pixel : pixels) total += pixel >> 24;
        return total;
    };
    auto closed = draw({MouthShape::Rest, MouthShape::Open, 0});
    auto middle = draw({MouthShape::Rest, MouthShape::Open, .5f});
    auto open = draw({MouthShape::Rest, MouthShape::Open, 1});
    CHECK(mass(closed) < mass(middle) && mass(middle) < mass(open));
    CHECK(draw({MouthShape::Open, MouthShape::Rest, .5f}) == middle);
    auto round = draw({MouthShape::Open, MouthShape::Round, 1});
    CHECK(round != open);
    CHECK(draw({MouthShape::Open, MouthShape::Round, .5f}) != round);
    CHECK(draw({MouthShape::Rest, MouthShape::Open, 0}) == closed);
    for (auto shape : {MouthShape::Rest, MouthShape::Sealed, MouthShape::Open, MouthShape::Wide, MouthShape::Round, MouthShape::Consonant}) {
        auto result = draw({shape, shape, 0});
        CHECK(mass(result) > 0);
        for (auto pixel : result) CHECK(((pixel >> 16) & 255) <= 122);
    }
}
