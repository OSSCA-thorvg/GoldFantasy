#include <test/test.h>
#include <test/graphics.h>
#include <ui/ui.h>
#include <algorithm>
#include <cstdint>
#include <memory>

namespace
{
struct IconControls
{
    te::test::Graphics runtime;
    ui::Theme theme = ui::Theme::dark();
    ui::Context context;
    std::vector<uint32_t> pixels = std::vector<uint32_t>(144 * 72);
    std::unique_ptr<tvg::SwCanvas> canvas{tvg::SwCanvas::gen()};

    IconControls()
    {
        // Keep decoration and theme changes out of the glyph-only continuity comparison.
        theme.background = theme.surface = theme.raised = theme.selection = theme.border = theme.accent = {0, 0, 0};
        theme.text = theme.muted = theme.accentText = {255, 255, 255};
        CHECK(canvas->target(pixels.data(), 144, 144, 72, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
        CHECK(canvas->add(context.scene()) == tvg::Result::Success);
    }

    void begin(double seconds)
    {
        context.begin(theme, {0, 0, 144, 72}, seconds);
        context.rect({0, 0, 144, 72}, theme.background);
    }

    void end()
    {
        context.end();
        CHECK(canvas->update() == tvg::Result::Success);
        CHECK(canvas->draw(true) == tvg::Result::Success);
        CHECK(canvas->sync() == tvg::Result::Success);
    }

    std::vector<uint32_t> ink(int x = 24, int y = 24, int width = 24, int height = 24) const
    {
        std::vector<uint32_t> result;
        for (int row = y; row < y + height; ++row)
            result.insert(result.end(), pixels.begin() + row * 144 + x, pixels.begin() + row * 144 + x + width);
        return result;
    }

    static unsigned energy(const std::vector<uint32_t>& image)
    {
        unsigned result = 0;
        for (auto pixel : image) result += (pixel >> 16) & 255;
        return result;
    }
};

struct RetainedIcons
{
    static constexpr unsigned width = 96, height = 64;
    ui::Context context;
    ui::Theme theme = ui::Theme::dark();
    std::vector<uint32_t> pixels = std::vector<uint32_t>(width * height);
    std::unique_ptr<tvg::SwCanvas> canvas;
    bool fresh;

    explicit RetainedIcons(bool freshCanvas) : fresh(freshCanvas)
    {
        if (!fresh) attachCanvas();
    }

    void attachCanvas()
    {
        canvas.reset(tvg::SwCanvas::gen());
        CHECK(canvas->target(pixels.data(), width, width, height, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
        // ThorVG paints remain bound to their renderer; snapshots give the reference a fresh renderer.
        CHECK(canvas->add(fresh ? context.scene()->duplicate() : context.scene()) == tvg::Result::Success);
    }

    std::vector<uint32_t> draw(double seconds, ui::Rect bounds, ui::IconState state,
                               bool clipped = false, ui::Rect clip = {}, bool visible = true)
    {
        context.begin(theme, {0, 0, width, height}, seconds);
        auto icon = [&] { context.icon("retained", bounds, "folder", {255, 255, 255}, state); };
        if (visible) {
            if (clipped) context.clip(clip, icon);
            else icon();
        }
        context.end();
        if (fresh) attachCanvas();
        CHECK(canvas->update() == tvg::Result::Success);
        CHECK(canvas->draw(true) == tvg::Result::Success);
        CHECK(canvas->sync() == tvg::Result::Success);
        auto result = pixels;
        if (fresh) canvas.reset();
        return result;
    }

    tvg::Picture* picture() const
    {
        std::function<tvg::Picture*(tvg::Paint*)> find = [&](tvg::Paint* paint) -> tvg::Picture* {
            if (paint->type() == tvg::Type::Picture) return static_cast<tvg::Picture*>(paint);
            if (paint->type() == tvg::Type::Scene)
                for (auto child : static_cast<tvg::Scene*>(paint)->paints())
                    if (auto picture = find(child)) return picture;
            return nullptr;
        };
        return find(context.scene());
    }
};
}  // namespace

TEST(ui_icon_button_interrupted_pointer_states_preserve_visible_ink)
{
    IconControls view;
    bool enabled = true, active = false;
    unsigned clicks = 0;
    auto draw = [&](double seconds) {
        view.begin(seconds);
        ui::button(view.context, "folder-button", {12, 12, 48, 48}, "", [&] { active = !active; ++clicks; },
                   ui::ButtonStyle::Quiet, enabled, ui::Icon::Folder, active);
        view.end();
        return view.ink();
    };
    auto idle = draw(0);
    CHECK(IconControls::energy(idle) > 0);
    CHECK(!view.context.iconsAnimating());
    view.context.pointerMove(36, 36);
    CHECK(draw(0) == idle);
    CHECK(view.context.iconsAnimating());
    auto hovering = draw(.08);
    CHECK(hovering != idle);

    view.context.pointerDown(36, 36);
    CHECK(draw(.08) == hovering);
    CHECK(view.context.iconsAnimating());
    auto pressing = draw(.14);
    CHECK(pressing != hovering);
    view.context.pointerUp(36, 36);
    CHECK_EQ(clicks, 1u);
    CHECK(active);
    CHECK(draw(.14) == pressing);
    auto selected = draw(.5);
    CHECK(selected != pressing);
    CHECK(IconControls::energy(selected) > IconControls::energy(idle));
    CHECK(!view.context.iconsAnimating());

    enabled = false;
    CHECK(draw(.5) == selected);
    auto disabled = draw(.7);
    CHECK(IconControls::energy(disabled) < IconControls::energy(idle));
    CHECK(!view.context.iconsAnimating());
    view.context.pointerDown(36, 36);
    view.context.pointerUp(36, 36);
    CHECK_EQ(clicks, 1u);
    CHECK(draw(.8) == disabled);
}

TEST(ui_icon_button_instances_keep_separate_transitions_when_draw_order_changes)
{
    IconControls view;
    auto draw = [&](double seconds, bool reverse) {
        view.begin(seconds);
        auto first = [&] { ui::button(view.context, "left", {12, 12, 48, 48}, "", {},
                                     ui::ButtonStyle::Quiet, true, ui::Icon::Folder); };
        auto second = [&] { ui::button(view.context, "right", {84, 12, 48, 48}, "", {},
                                      ui::ButtonStyle::Quiet, true, "folder"); };
        if (reverse) { second(); first(); }
        else { first(); second(); }
        view.end();
    };
    draw(0, false);
    auto idle = view.ink();
    CHECK(idle == view.ink(96));
    view.context.pointerMove(36, 36);
    draw(0, false);
    draw(.08, false);
    auto leftMoving = view.ink();
    CHECK(leftMoving != idle);
    CHECK(view.ink(96) == idle);
    draw(.08, true);
    CHECK(view.ink() == leftMoving);
    CHECK(view.ink(96) == idle);

    view.context.pointerMove(108, 36);
    draw(.08, true);
    CHECK(view.ink() == leftMoving);
    CHECK(view.ink(96) == idle);
    draw(.4, false);
    CHECK(view.ink() == idle);
    CHECK(view.ink(96) != idle);
    CHECK(!view.context.iconsAnimating());
}

TEST(ui_checked_control_and_named_button_render_icons_without_text_symbols)
{
    IconControls view;
    bool checked = false;
    auto draw = [&](double seconds) {
        view.begin(seconds);
        ui::checkbox(view.context, "option", {12, 12, 48, 48}, "", checked, [&](bool value) { checked = value; });
        ui::button(view.context, "next", {84, 12, 48, 48}, "", {}, ui::ButtonStyle::Quiet, true, ui::Icon::Chevron);
        view.end();
    };
    draw(0);
    auto emptyBox = view.ink(14, 29, 14, 14);
    CHECK_EQ(IconControls::energy(emptyBox), 0u);
    CHECK(IconControls::energy(view.ink(96)) > 0);
    view.context.focus("option");
    view.context.key(ui::Key::Space);
    CHECK(checked);
    draw(.08);
    CHECK(IconControls::energy(view.ink(14, 29, 14, 14)) > 0);
    CHECK(!view.context.iconsAnimating());
}

TEST(ui_retained_icons_match_fresh_canvas_during_animation_reparent_clip_and_removal)
{
    te::test::Graphics runtime;
    RetainedIcons retained(false), reference(true);
    ui::IconState idle, hover, active;
    hover.hovered = true;
    active.active = true;
    auto draw = [&](double seconds, ui::Rect bounds, ui::IconState state,
                    bool clipped = false, ui::Rect clip = {}, bool visible = true) {
        auto expected = reference.draw(seconds, bounds, state, clipped, clip, visible);
        auto actual = retained.draw(seconds, bounds, state, clipped, clip, visible);
        CHECK(actual == expected);
        return actual;
    };
    auto resting = draw(0, {8, 8, 24, 24}, idle);
    auto picture = retained.picture();
    CHECK(picture);
    CHECK(draw(0, {8, 8, 24, 24}, idle) == resting);
    CHECK(retained.picture() == picture);
    draw(.01, {8, 8, 24, 24}, hover);
    CHECK(draw(.08, {8, 8, 24, 24}, hover) != resting);
    draw(.12, {47, 8, 24, 24}, hover, true, {48, 8, 14, 24});
    CHECK(retained.picture() == picture);
    draw(.18, {47, 8, 24, 24}, hover, true, {50, 9, 10, 16});
    draw(.4, {47, 8, 24, 24}, hover, true, {48, 8, 20, 24});
    CHECK(!retained.context.iconsAnimating());
    draw(.41, {10, 32, 24, 24}, active);
    CHECK(retained.picture() == picture);
    draw(.5, {10, 32, 24, 24}, active);
    draw(.8, {10, 32, 24, 24}, active);
    CHECK(!retained.context.iconsAnimating());
    draw(.81, {10, 32, 24, 24}, hover, true, {12, 33, 12, 20});
    CHECK(retained.context.iconsAnimating());
    auto empty = draw(.9, {}, hover, false, {}, false);
    CHECK(std::all_of(empty.begin(), empty.end(), [](uint32_t pixel) { return pixel == 0; }));
    CHECK(!retained.picture());
    CHECK(!retained.context.iconsAnimating());
    draw(1, {8, 8, 24, 24}, active);
    CHECK(!retained.context.iconsAnimating());
}

TEST(ui_retained_icons_replace_and_remove_assets_without_leaving_old_pixels)
{
    te::test::Graphics runtime;
    RetainedIcons retained(false), reference(true);
    auto draw = [&](double seconds, bool visible = true) {
        auto expected = reference.draw(seconds, {8, 8, 24, 24}, {}, false, {}, visible);
        auto actual = retained.draw(seconds, {8, 8, 24, 24}, {}, false, {}, visible);
        CHECK(actual == expected);
        return actual;
    };
    auto original = draw(0);
    auto picture = retained.picture();
    ui::IconAsset replacement{"folder", R"(<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect x="3" y="3" width="8" height="8" fill="#247bd1"/></svg>)", "svg"};
    replacement.tint = false;
    std::string error;
    CHECK(retained.context.setIcons({replacement}, error));
    CHECK(reference.context.setIcons({replacement}, error));
    auto changed = draw(.1);
    CHECK(changed != original);
    CHECK(retained.picture() && retained.picture() != picture);
    CHECK(!retained.context.iconsAnimating());
    CHECK(draw(.2) == changed);
    CHECK(retained.context.setIcons({}, error));
    CHECK(reference.context.setIcons({}, error));
    CHECK(draw(.3) == original);
    auto empty = draw(.4, false);
    CHECK(std::all_of(empty.begin(), empty.end(), [](uint32_t pixel) { return pixel == 0; }));
    CHECK(!retained.picture());
}
