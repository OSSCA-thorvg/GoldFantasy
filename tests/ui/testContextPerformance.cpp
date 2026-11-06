#include <test/test.h>
#include <test/graphics.h>
#include <ui/ui.h>
#include <algorithm>

TEST(ui_context_many_retained_paints_keep_order_ignore_duplicates_and_release_omissions)
{
    te::test::Graphics graphics(false);
    std::vector<tvg::Paint*> paints;
    for (int i = 0; i < 1000; ++i) {
        auto paint = tvg::Shape::gen();
        paint->appendRect(float(i % 100), float(i / 100), 1, 1);
        paint->fill(uint8_t(i), 0, 0);
        paint->ref();
        paints.push_back(paint);
    }
    {
        ui::Context context;
        auto theme = ui::Theme::dark();
        for (int frame = 0; frame < 4; ++frame) {
            std::vector<tvg::Paint*> expected;
            context.begin(theme, {0, 0, 100, 100});
            context.add(nullptr);
            for (size_t i = 0; i < paints.size(); ++i) {
                auto index = frame % 2 ? paints.size() - 1 - i : i;
                if (frame >= 2 && index % 3 == 0) continue;
                auto paint = paints[index];
                context.add(paint);
                context.add(paint);
                expected.push_back(paint);
            }
            context.end();
            CHECK(std::equal(expected.begin(), expected.end(), context.scene()->paints().begin(), context.scene()->paints().end()));
            for (size_t i = 0; i < paints.size(); ++i)
                CHECK_EQ(paints[i]->refCnt(), uint16_t(frame >= 2 && i % 3 == 0 ? 1 : 2));
        }
    }
    for (auto paint : paints) { CHECK_EQ(paint->refCnt(), uint16_t(1)); paint->unref(); }
}

TEST(ui_context_duplicate_membership_is_local_to_each_clip_and_resets_each_frame)
{
    te::test::Graphics graphics(false);
    ui::Context context;
    auto theme = ui::Theme::dark();
    auto paint = tvg::Shape::gen();
    paint->appendRect(0, 0, 40, 40); paint->fill(255, 0, 0); paint->ref();
    for (int frame = 0; frame < 4; ++frame) {
        context.begin(theme, {0, 0, 80, 40});
        context.clip({0, 0, 40, 40}, [&] { if (frame % 2 == 0) { context.add(paint); context.add(paint); } });
        context.clip({40, 0, 40, 40}, [&] { if (frame % 2 != 0) { context.add(paint); context.add(paint); } });
        context.end();
        auto next = context.scene()->paints().begin();
        auto first = static_cast<tvg::Scene*>(*next++);
        auto second = static_cast<tvg::Scene*>(*next);
        CHECK_EQ(first->paints().size(), frame % 2 == 0 ? 1u : 0u);
        CHECK_EQ(second->paints().size(), frame % 2 != 0 ? 1u : 0u);
        CHECK_EQ(paint->refCnt(), uint16_t(2));
    }
    context.begin(theme, {0, 0, 80, 40}); context.end();
    CHECK_EQ(paint->refCnt(), uint16_t(1)); paint->unref();
}

TEST(ui_text_fields_measure_cursor_geometry_only_while_focused)
{
    te::test::Graphics graphics;
    ui::Context context;
    auto theme = ui::Theme::dark();
    ui::TextInput first{"A long input value that needs scrolling", 38};
    ui::TextInput second{"Another input", 13};
    int resolutions = 0;
    context.fontFor = [&](std::string_view, bool) { ++resolutions; return theme.font.c_str(); };
    auto frame = [&] {
        resolutions = 0;
        context.begin(theme, {0, 0, 300, 80});
        ui::textField(context, "first", {0, 0, 140, 32}, first, "");
        ui::textField(context, "second", {150, 0, 140, 32}, second, "");
        context.end();
    };
    frame();
    CHECK_EQ(resolutions, 2);  // Each label resolves its font; no unused caret measurement.
    context.focus("first");
    frame();
    CHECK_EQ(resolutions, 3);
    context.key(ui::Key::Home);
    CHECK_EQ(first.cursor, 0u);
    frame();
    CHECK_EQ(resolutions, 2);  // The empty prefix has zero width without a font lookup.
    context.key(ui::Key::End);
    CHECK_EQ(first.cursor, first.value.size());
    frame();
    CHECK_EQ(resolutions, 3);
    context.focus("");
    frame();
    CHECK_EQ(resolutions, 2);
}
