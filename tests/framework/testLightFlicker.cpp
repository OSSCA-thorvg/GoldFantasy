#include <test/test.h>
#include <GameEngine/GameFramework/light_flicker.h>
#include <algorithm>
#include <cmath>

using namespace gameframework;

TEST(framework_lights_flicker_smoothly_each_on_its_own_and_fire_most)
{
    struct Course
    {
        float low = 2, high = 0, mean = 0, jump = 0;
    };
    // Half a minute of one light, sampled as the renderer does at 20 fps.
    auto follow = [](Flicker kind, Point at) {
        Course c;
        float last = flare(kind, at, 0).brightness;
        for (int i = 0; i < 600; ++i) {
            float b = flare(kind, at, i / 20.0).brightness;
            c.low = std::min(c.low, b), c.high = std::max(c.high, b), c.mean += b / 600;
            c.jump = std::max(c.jump, std::abs(b - last));
            last = b;
        }
        return c;
    };
    Point here{120, 40}, there{-260, 310};
    for (auto kind : {Flicker::Fire, Flicker::Flame, Flicker::Hearth, Flicker::Magic}) {
        auto c = follow(kind, here);
        CHECK(c.high - c.low > .04f);          // Never still,
        CHECK(c.low > .75f && c.high < brightest);  // but only a flicker
        CHECK(std::abs(c.mean - 1) < .03f);    // about its resting look,
        CHECK(c.jump < .08f);                  // and never in jumps.
    }
    auto fire = follow(Flicker::Fire, here), hearth = follow(Flicker::Hearth, here);
    CHECK(fire.high - fire.low > hearth.high - hearth.low);
    float apart = 0;
    for (int i = 0; i < 200; ++i) apart = std::max(apart, std::abs(flare(Flicker::Flame, here, i / 20.0).brightness - flare(Flicker::Flame, there, i / 20.0).brightness));
    CHECK(apart > .03f);  // Two lamps never flicker in step.
    auto f = flare(Flicker::Fire, here, 3.3);
    CHECK(std::abs(f.reach * f.reach - f.brightness) < 1e-4f);
}
