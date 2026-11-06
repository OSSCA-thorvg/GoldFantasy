#include "common/fonts.h"
#include <test/directory.h>

using namespace te;

TEST(font_loads_ttf_cff_names_design_units_and_cmap_without_graphics_initialization)
{
    test::Fonts fonts;
    CHECK_EQ(fonts.database->fonts().size(), size_t(4));
    CHECK_EQ(fonts.database->find("m1 plain"), fonts.plain);
    CHECK_EQ(fonts.database->find("M1Fallback"), fonts.fallback);
    CHECK(test::near(fonts.database->unitsPerEm(fonts.plain), 1000));
    CHECK(fonts.database->glyph(fonts.plain, 'A'));
    CHECK(!fonts.database->glyph(fonts.plain, 0xac00));
    CHECK(fonts.database->glyph(fonts.fallback, 0xac00));
    CHECK(fonts.database->glyph(fonts.fallback, 0x4e2d));
    CHECK(!fonts.database->glyph(fonts.plain, 0x110000));
    CHECK(!fonts.database->glyph(fonts.plain, 0xd800));
    CHECK_EQ(fonts.database->load(test::fontPath("M1Plain.ttf").c_str()), fonts.plain);
}

TEST(font_reads_a_macintosh_only_postscript_name_without_substituting_the_family)
{
    std::unique_ptr<FontDatabase> database(FontDatabase::gen());
    auto font = database->load(test::fontPath("M1MacName.ttf").c_str());
    CHECK(font);
    CHECK_EQ(database->fonts().front().family, "M1 Macintosh Family");
    CHECK_EQ(database->fonts().front().name, "M1MacName");
    CHECK_EQ(database->find("M1MacName"), font);
    CHECK(database->glyph(font, 'A'));
}

TEST(font_matches_thorvg_legacy_kerning_without_applying_gpos)
{
    test::Fonts fonts;
    for (auto font : {fonts.plain, fonts.kern, fonts.gpos}) {
        auto a = fonts.database->glyph(font, 'A'), v = fonts.database->glyph(font, 'V');
        CHECK(test::near(fonts.database->textKerning(font, a, v), font == fonts.kern ? -200 : 0));
    }
}

TEST(font_selects_one_face_by_whole_text_coverage_and_prefers_it_on_ties)
{
    test::Fonts fonts;
    CHECK_EQ(fonts.database->textFontFor(fonts.plain, "Á"), fonts.plain);
    CHECK_EQ(fonts.database->textFontFor(fonts.plain, "Ω"), fonts.plain);
    fonts.database->fallbacks({fonts.fallback});
    CHECK_EQ(fonts.database->textFontFor(fonts.plain, "Ω️"), fonts.fallback);
    CHECK_EQ(fonts.database->textFontFor(fonts.plain, "AΩ"), fonts.plain);
    CHECK_EQ(fonts.database->textFontFor(fonts.plain, "AΩ中"), fonts.fallback);
}

TEST(font_memory_loading_owns_its_bytes_and_invalid_input_does_not_publish_a_face)
{
    std::ifstream input(test::fontPath("M1Plain.ttf"), std::ios::binary);
    std::vector<char> bytes{std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>()};
    std::unique_ptr<FontDatabase> database(FontDatabase::gen());
    auto id = database->load("owned", bytes.data(), bytes.size());
    CHECK(id);
    bytes.clear();
    bytes.shrink_to_fit();
    CHECK(database->glyph(id, 'A'));
    CHECK_EQ(database->find("owned"), id);
    CHECK(!database->load("invalid", "not a font", 10));
    CHECK(!database->load(nullptr));
    CHECK(!database->load(test::fontPath("M1Plain.ttf").c_str(), 1));
    CHECK_EQ(database->fonts().size(), size_t(1));
}

TEST(font_loads_and_finds_a_unicode_file_name)
{
    test::Directory directory;
    auto path = directory.path / std::filesystem::path(u8"★♪-🙂.ttf");
    std::filesystem::copy_file(io::pathFromUtf8(test::fontPath("M1Plain.ttf")), path);
    auto utf8 = io::pathToUtf8(path);
    std::unique_ptr<FontDatabase> database(FontDatabase::gen());
    auto id = database->load(utf8.c_str());
    CHECK(id);
    CHECK_EQ(database->load(utf8.c_str()), id);
    CHECK_EQ(database->find("★♪-🙂"), id);
    CHECK_EQ(database->fonts().size(), size_t(1));
}

TEST(font_loads_a_valid_font_file_above_64_mib)
{
    std::ifstream input(test::fontPath("M1Plain.ttf"), std::ios::binary);
    std::vector<char> bytes{std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>()};
    test::Directory directory;
    auto path = directory.file("large-font.ttf");
    {
        // Pad with a sparse tail so the file passes 64 MiB without holding that much in memory.
        std::ofstream file(path, std::ios::binary);
        file.write(bytes.data(), bytes.size());
        file.seekp(64 * 1024 * 1024);
        file.put(0);
        CHECK(bool(file));
    }
    std::unique_ptr<FontDatabase> database(FontDatabase::gen());
    auto id = database->load(io::pathToUtf8(path).c_str());
    CHECK(id);
    CHECK(database->glyph(id, 'A'));
}

TEST(font_registers_the_selected_collection_face_with_thorvg_text)
{
    test::Runtime runtime;
    std::unique_ptr<FontDatabase> database(FontDatabase::gen());
    auto font = database->load(test::fontPath("M1Collection.ttc").c_str(), 1);
    CHECK(font);
    CHECK_EQ(database->fonts().back().name, "M1Digits");
    auto name = database->textFont(font);
    CHECK(name);
    std::unique_ptr<tvg::Text> text(tvg::Text::gen());
    CHECK(text->font(name) == tvg::Result::Success);
    CHECK(text->size(15) == tvg::Result::Success);
    tvg::GlyphMetrics metrics{};
    CHECK(text->metrics("9", metrics) == tvg::Result::Success);
    CHECK(test::near(metrics.advance, 18.4f));
    CHECK(text->metrics("0", metrics) == tvg::Result::Success);
    CHECK(test::near(metrics.advance, 4));
}
