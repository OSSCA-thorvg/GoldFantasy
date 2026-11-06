#pragma once

#include <test/test.h>
#include <test/graphics.h>
#include <ui/text/text.h>
#include <core/io/path.h>
#include <thorvg.h>
#include <memory>
#include <vector>
#include <cmath>
#include <filesystem>
#include <fstream>

namespace te::test
{
inline std::string fontPath(const char* name)
{
    return io::pathToUtf8(std::filesystem::path(FONT_DATA_PATH) / name);
}
inline bool near(float a, float b, float epsilon = 0.001f)
{
    return std::abs(a - b) <= epsilon;
}
struct Fonts
{
    std::unique_ptr<FontDatabase> database{FontDatabase::gen()};
    FontId plain = database->load(fontPath("M1Plain.ttf").c_str());
    FontId kern = database->load(fontPath("M1Kern.ttf").c_str());
    FontId gpos = database->load(fontPath("M1Gpos.ttf").c_str());
    FontId fallback = database->load(fontPath("M1Fallback.otf").c_str());
    Fonts()
    {
        CHECK(plain);
        CHECK(kern);
        CHECK(gpos);
        CHECK(fallback);
    }
};
struct Runtime : Graphics
{
    Runtime() : Graphics(false) {}
};
}  // namespace te::test
