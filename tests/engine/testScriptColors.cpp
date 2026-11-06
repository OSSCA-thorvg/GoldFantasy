#include <test/test.h>
#include <test/graphics.h>
#include <ui/script.h>
#include <array>
#include <memory>

TEST(lua_color_tokens_follow_the_active_theme_on_retained_frames)
{
    te::test::Graphics graphics(false);
    ui::Script script;
    ui::Context context;
    CHECK(script.load(R"(
return { draw = function(ui)
    local colors = {'background','surface','raised','border','text','muted','accent','accentText','success','danger','#123456'}
    for i, color in ipairs(colors) do
        ui.rect {x = (i - 1) * 12, y = 0, width = 12, height = 12, radius = 0, color = color}
    end
    ui.rect {x = 132, y = 0, width = 12, height = 12, radius = 0}
end }
)", "colors"));
    constexpr std::array<ui::Color ui::Theme::*, 10> members{{
        &ui::Theme::background, &ui::Theme::surface, &ui::Theme::raised, &ui::Theme::border,
        &ui::Theme::text, &ui::Theme::muted, &ui::Theme::accent, &ui::Theme::accentText,
        &ui::Theme::success, &ui::Theme::danger,
    }};
    std::vector<uint32_t> pixels(144 * 12);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen());
    CHECK(canvas->target(pixels.data(), 144, 144, 12, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
    CHECK(canvas->add(context.scene()) == tvg::Result::Success);
    for (auto theme : {ui::Theme::dark(), ui::Theme::light()}) {
        context.begin(theme, {0, 0, 144, 12}, 0);
        CHECK(script.render(context, {0, 0, 144, 12}));
        context.end();
        CHECK(canvas->update() == tvg::Result::Success);
        CHECK(canvas->draw(true) == tvg::Result::Success);
        CHECK(canvas->sync() == tvg::Result::Success);
        auto packed = [](ui::Color c) { return uint32_t(c.a) << 24 | uint32_t(c.r) << 16 | uint32_t(c.g) << 8 | c.b; };
        for (size_t i = 0; i < members.size(); ++i) CHECK_EQ(pixels[6 * 144 + i * 12 + 6], packed(theme.*members[i]));
        CHECK_EQ(pixels[6 * 144 + 126], 0xff123456u);
        CHECK_EQ(pixels[6 * 144 + 138], packed(theme.raised));
    }
}

TEST(lua_color_lookup_keeps_invalid_color_errors)
{
    te::test::Graphics graphics(false);
    ui::Script script;
    ui::Context context;
    auto theme = ui::Theme::dark();
    for (auto color : {"missing-token", "#zzzzzz", "#12345"}) {
        CHECK(script.load("return { draw=function(ui) ui.rect {color='" + std::string(color) + "'} end }", "invalid-color"));
        context.begin(theme, {0, 0, 160, 32}, 0);
        CHECK(!script.render(context, {0, 0, 160, 32}));
        context.end();
        CHECK(script.error().find("color") != std::string::npos);
    }
}
