#include <test/test.h>
#include <test/graphics.h>
#include <ui/ui.h>
#include <ui/text/text.h>
#include <cmath>
#include <memory>

TEST(ui_text_elision_keeps_fitting_labels_and_hides_unreadable_fragments)
{
    te::test::Graphics graphics;
    ui::Context context;
    auto theme = ui::Theme::light();
    context.begin(theme, {0, 0, 500, 40});
    const std::string title = "Window title.txt";
    for (bool bold : {false, true}) {
        CHECK_EQ(context.elideText(title, context.textWidth(title, 12, bold), 12, bold), title);
        auto width = context.textWidth("Window…", 12, bold);
        auto shortened = context.elideText(title, width, 12, bold);
        CHECK_EQ(shortened, std::string("Window…"));
        CHECK(context.textWidth(shortened, 12, bold) <= width);
        CHECK(context.elideText(title, context.textWidth("W…", 12, bold) - 1, 12, bold).empty());
        CHECK(context.elideText(title, 0, 12, bold).empty());
        CHECK(context.elideText(title, -1, 12, bold).empty());
        CHECK(context.elideText("", 200, 12, bold).empty());
    }
}

TEST(ui_text_elision_preserves_utf8_and_the_modified_indicator)
{
    te::test::Graphics graphics;
    ui::Context context;
    auto theme = ui::Theme::light();
    context.begin(theme, {0, 0, 500, 40});
    const std::string title = "é★🙂-a-long-filename.txt";
    const std::string suffix = " ·";
    for (bool bold : {false, true}) {
        CHECK_EQ(context.elideText(title, 1000, 12, bold, suffix), title + suffix);
        const std::string expected = "é★🙂… ·";
        float width = context.textWidth(expected, 12, bold);
        auto shortened = context.elideText(title, width, 12, bold, suffix);
        CHECK_EQ(shortened, expected);
        CHECK(context.textWidth(shortened, 12, bold) <= width);
        for (float available = 1; available < width; available += 1) {
            auto fitted = context.elideText(title, available, 12, bold, suffix);
            te::Codepoints valid;
            CHECK(valid.add(fitted));
            CHECK(context.textWidth(fitted, 12, bold) <= available);
            if (!fitted.empty()) CHECK(fitted.substr(fitted.size() - 6) == "… ·");
        }
    }
}

TEST(ui_text_measurement_matches_the_rendered_font_weight)
{
    te::test::Graphics graphics;
    ui::Context context;
    auto theme = ui::Theme::light();
    std::vector<uint32_t> pixels(500 * 40);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen());
    CHECK(canvas->target(pixels.data(), 500, 500, 40, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
    CHECK(canvas->add(context.scene()) == tvg::Result::Success);
    const std::string title = "Window title.txt";
    for (bool bold : {false, true}) {
        context.begin(theme, {0, 0, 500, 40});
        context.text({0, 0, 500, 40}, title, theme.text, 12, bold);
        context.end();
        CHECK(canvas->update() == tvg::Result::Success);
        CHECK(canvas->draw(true) == tvg::Result::Success);
        CHECK(canvas->sync() == tvg::Result::Success);
        auto group = static_cast<tvg::Scene*>(context.scene()->paints().back());
        auto text = static_cast<tvg::Text*>(group->paints().front());
        float x = 0, y = 0, width = 0, height = 0;
        CHECK(text->bounds(&x, &y, &width, &height) == tvg::Result::Success);
        CHECK(std::abs(width - context.textWidth(title, 12, bold)) < 0.001f);
    }
}

TEST(ui_text_resolver_keeps_prefix_measurements_on_the_rendered_face)
{
    te::test::Graphics graphics;
    ui::Context context;
    auto theme = ui::Theme::light();
    const std::string title = "Window fallback";
    context.fontFor = [](std::string_view text, bool bold) {
        return bold || text.find("fallback") != std::string_view::npos ? "DejaVuSans-Bold" : "DejaVuSans";
    };
    std::vector<uint32_t> pixels(500 * 40);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen());
    CHECK(canvas->target(pixels.data(), 500, 500, 40, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
    context.begin(theme, {0, 0, 500, 40});
    context.text({0, 0, 500, 40}, title, theme.text, 12);
    context.end();
    CHECK(canvas->add(context.scene()) == tvg::Result::Success);
    CHECK(canvas->draw(true) == tvg::Result::Success);
    CHECK(canvas->sync() == tvg::Result::Success);
    auto group = static_cast<tvg::Scene*>(context.scene()->paints().back());
    auto label = static_cast<tvg::Text*>(group->paints().front());
    float x = 0, y = 0, width = 0, height = 0;
    CHECK(label->bounds(&x, &y, &width, &height) == tvg::Result::Success);
    CHECK(std::abs(width - context.textWidth(title, 12)) < 0.001f);
    auto prefix = context.textWidth("Window", 12, false, title);
    CHECK(std::abs(prefix - context.textWidth("Window", 12, true)) < 0.001f);
    CHECK(std::abs(prefix - context.textWidth("Window", 12)) > 0.01f);
}
