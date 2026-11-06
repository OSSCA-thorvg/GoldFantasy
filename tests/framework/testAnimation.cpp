#include <test/test.h>
#include <GameEngine/GameFramework/animation.h>
#include <cmath>

TEST(framework_easing_clamps_endpoints_and_stays_monotonic)
{
    for (auto curve : {gameframework::smoothstep, gameframework::outCubic}) {
        CHECK(curve(-1) == 0);
        CHECK(curve(0) == 0);
        CHECK(curve(1) == 1);
        CHECK(curve(2) == 1);
        float previous = 0;
        for (int i = 1; i < 100; ++i) {
            float value = curve(i / 100.f);
            CHECK(value > previous && value < 1);
            previous = value;
        }
    }
    CHECK(std::abs(gameframework::smoothstep(.5f) - .5f) < 1e-6f);
    CHECK(std::abs(gameframework::outCubic(.5f) - .875f) < 1e-6f);
}
