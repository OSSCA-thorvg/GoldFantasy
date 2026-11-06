#pragma once

#include "person_appearance.h"

namespace hearthold
{
struct BodyProportions
{
    float shoulders, waist, hips, neck;
};

constexpr BodyProportions bodyProportions(BodyType type)
{
    return type == BodyType::Female ? BodyProportions{.96f, .91f, 1.02f, .96f}
                                    : BodyProportions{1.035f, 1, 1, 1};
}
}
