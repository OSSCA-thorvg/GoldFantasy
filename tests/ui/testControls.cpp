#include <test/test.h>
#include <test/graphics.h>
#include <ui/ui.h>
#include <memory>
#include <cmath>

namespace
{
using Runtime = te::test::Graphics;
}  // namespace

TEST(ui_disabled_controls_cannot_activate_or_receive_focus)
{
    Runtime runtime;
    auto theme = ui::Theme::dark();
    ui::Context context;
    int clicks = 0;
    context.begin(theme, {0, 0, 240, 100});
    ui::button(context, "first", {10, 10, 60, 30}, "First", [&] { ++clicks; });
    ui::button(context, "disabled", {80, 10, 60, 30}, "Disabled", [&] { clicks += 100; }, ui::ButtonStyle::Default, false);
    ui::button(context, "last", {150, 10, 60, 30}, "Last", [&] { ++clicks; });
    context.end();
    context.pointerDown(100, 20);
    context.pointerUp(100, 20);
    CHECK_EQ(clicks, 0);
    context.key(ui::Key::Tab);
    CHECK_EQ(context.focused(), "first");
    context.key(ui::Key::Tab);
    CHECK_EQ(context.focused(), "last");
    context.key(ui::Key::Space);
    CHECK_EQ(clicks, 1);
    context.key(ui::Key::Tab, true);
    CHECK_EQ(context.focused(), "first");
}

TEST(ui_pointer_capture_drags_outside_and_disappearing_controls_cancel)
{
    Runtime runtime;
    auto theme = ui::Theme::dark();
    ui::Context context;
    float dragX = 0, dragY = 0;
    context.begin(theme, {0, 0, 300, 100});
    context.control("drag", {10, 10, 100, 30}, [&](const ui::Event& event) {
        if (event.type == ui::EventType::Drag) { dragX = event.x; dragY = event.y; }
    });
    context.end();
    context.pointerDown(20, 20);
    context.pointerMove(250, 80);
    CHECK_EQ(dragX, 250.0f);
    CHECK_EQ(dragY, 80.0f);
    context.begin(theme, {0, 0, 300, 100});
    context.end();
    int clicks = 0;
    context.begin(theme, {0, 0, 300, 100});
    ui::button(context, "drag", {10, 10, 100, 30}, "Replacement", [&] { ++clicks; });
    context.end();
    context.pointerUp(20, 20);
    CHECK_EQ(clicks, 0);
}

TEST(ui_text_values_edit_utf8_codepoints_without_an_editor)
{
    ui::TextInput input;
    input.insert("A★é🙂");
    input.edit(ui::Key::Backspace);
    CHECK_EQ(input.value, "A★é");
    input.edit(ui::Key::Left);
    input.edit(ui::Key::Backspace);
    CHECK_EQ(input.value, "Aé");
    input.edit(ui::Key::Delete);
    CHECK_EQ(input.value, "A");
    input.insert("x\ny\t");
    CHECK_EQ(input.value, "Axy");
}

TEST(ui_hover_refresh_during_a_frame_does_not_dispatch_drag)
{
    Runtime runtime;
    auto theme = ui::Theme::dark();
    ui::Context context;
    int drags = 0;
    context.begin(theme, {0, 0, 300, 100});
    context.control("drag", {10, 10, 100, 30}, [&](const ui::Event& event) { if (event.type == ui::EventType::Drag) ++drags; });
    context.end();
    context.pointerDown(20, 20);
    context.setPointerPosition(30, 20);
    CHECK_EQ(drags, 0);
    context.pointerMove(40, 20);
    CHECK_EQ(drags, 1);
}

TEST(ui_modal_dialog_traps_input_and_restores_focus)
{
    Runtime runtime;
    auto theme = ui::Theme::dark();
    ui::Context context;
    bool closed = false;
    int backgroundClicks = 0;
    context.focus("background");
    auto draw = [&](bool modal) {
        context.begin(theme, {0, 0, 640, 480});
        ui::button(context, "background", {10, 10, 90, 30}, "Background", [&] { ++backgroundClicks; });
        if (modal) {
            context.modal("dialog/close", [&] { closed = true; });
            context.control("dialog/backdrop", {0, 0, 640, 480}, [&](const ui::Event& event) { if (event.type == ui::EventType::Activate) closed = true; }, true, false);
            ui::button(context, "dialog/close", {260, 220, 120, 40}, "Close", [&] { closed = true; });
        }
        context.end();
    };
    draw(false);
    draw(true);
    CHECK_EQ(context.focused(), "dialog/close");
    context.pointerDown(20, 20);
    context.pointerUp(20, 20);
    CHECK(closed);
    CHECK_EQ(backgroundClicks, 0);
    closed = false;
    context.key(ui::Key::Escape);
    CHECK(closed);
    draw(false);
    CHECK_EQ(context.focused(), "background");
}

TEST(ui_text_width_treats_the_theme_font_size_as_a_pixel_em)
{
    Runtime runtime;
    auto theme = ui::Theme::dark();
    theme.fontSize = 16;
    ui::Context context;
    context.begin(theme, {0, 0, 240, 96});
    context.text({16, 16, 160, 64}, "Hg", theme.text);
    context.end();
    std::unique_ptr<tvg::Text> reference(tvg::Text::gen());
    reference->font("DejaVuSans");
    reference->size(12);  // 12 font points = a 16px em in ThorVG's local coordinate space.
    reference->text("Hg");
    float x = 0, y = 0, w = 0, h = 0;
    CHECK(reference->bounds(&x, &y, &w, &h) == tvg::Result::Success);
    CHECK(std::abs(context.textWidth("Hg") - w) < 0.001f);
}

TEST(ui_scoped_clipping_limits_paint_and_pointer_targets)
{
    Runtime runtime;
    auto theme = ui::Theme::dark();
    ui::Context context;
    int activations = 0;
    context.begin(theme, {0, 0, 64, 64});
    context.clip({10, 10, 20, 20}, [&] {
        context.rect({0, 0, 64, 64}, {255, 0, 0});
        context.control("clipped", {0, 0, 64, 64}, [&](const ui::Event& event) { if (event.type == ui::EventType::Activate) ++activations; });
    });
    context.rect({40, 40, 10, 10}, {0, 255, 0});
    context.end();
    context.pointerDown(5, 5);
    context.pointerUp(5, 5);
    CHECK_EQ(activations, 0);
    context.pointerDown(15, 15);
    context.pointerUp(15, 15);
    CHECK_EQ(activations, 1);
    std::vector<uint32_t> pixels(64 * 64);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen());
    canvas->target(pixels.data(), 64, 64, 64, tvg::ColorSpace::ARGB8888);
    canvas->add(context.scene());
    CHECK(canvas->draw(true) == tvg::Result::Success);
    CHECK(canvas->sync() == tvg::Result::Success);
    CHECK_EQ(pixels[15 * 64 + 15], 0xffff0000u);
    CHECK_EQ(pixels[5 * 64 + 5], 0u);
    CHECK_EQ(pixels[45 * 64 + 45], 0xff00ff00u);
}

TEST(ui_retained_layers_can_fade_and_snapshot_without_retaining_old_input)
{
    Runtime runtime; ui::Context context; auto theme = ui::Theme::dark(); int oldClicks = 0, newClicks = 0;
    context.begin(theme, {0, 0, 240, 100}, 0);
    auto layer = context.layer({0, 0, 240, 100}, [&] {
        ui::button(context, "old", {10, 10, 80, 30}, "Old", [&] { ++oldClicks; });
    }, 90);
    context.end(); CHECK_EQ(layer->opacity(), uint8_t(90));
    auto copy = layer->duplicate(); copy->ref();
    std::shared_ptr<tvg::Paint> snapshot(copy, [](tvg::Paint* p) { p->unref(); });
    context.begin(theme, {0, 0, 240, 100}, .1);
    auto reused = context.layer({0, 0, 240, 100}, [&] {
        context.add(snapshot.get());
        ui::button(context, "new", {130, 10, 80, 30}, "New", [&] { ++newClicks; });
    });
    context.end(); CHECK(reused == layer); CHECK_EQ(reused->opacity(), uint8_t(255));
    context.pointerDown(30, 20); context.pointerUp(30, 20); CHECK_EQ(oldClicks, 0);
    context.pointerDown(150, 20); context.pointerUp(150, 20); CHECK_EQ(newClicks, 1);
    CHECK_EQ(snapshot->opacity(), uint8_t(90));
}
