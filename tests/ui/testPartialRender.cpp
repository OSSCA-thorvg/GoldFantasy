#include <test/test.h>
#include <test/graphics.h>
#include <ui/ui.h>

namespace
{
constexpr int width = 240, height = 160;

struct Surface
{
    te::test::Graphics graphics;
    ui::Context context;
    ui::Theme theme = ui::Theme::dark();
    std::vector<uint32_t> pixels = std::vector<uint32_t>(width * height);
    std::unique_ptr<tvg::SwCanvas> canvas{tvg::SwCanvas::gen(tvg::EngineOption::SmartRender)};
    Surface()
    {
        CHECK(canvas->target(pixels.data(), width, width, height, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
        CHECK(canvas->add(context.scene()) == tvg::Result::Success);
    }
    // Draws without clearing and returns the dirty regions ThorVG repainted.
    std::vector<tvg::Region> draw(const std::function<void(ui::Context&)>& frame)
    {
        CHECK(canvas->sync() == tvg::Result::Success);
        context.begin(theme, {0, 0, width, height});
        frame(context);
        context.end();
        CHECK(canvas->update() == tvg::Result::Success);
        CHECK(canvas->draw(false) == tvg::Result::Success);
        std::vector<tvg::Region> regions(canvas->dirtyRegions());
        if (!regions.empty()) CHECK(canvas->dirtyRegions(regions.data(), uint32_t(regions.size())) == tvg::Result::Success);
        CHECK(canvas->sync() == tvg::Result::Success);
        return regions;
    }
    bool matchesFullRedraw()
    {
        auto partial = pixels;
        CHECK(canvas->update() == tvg::Result::Success);
        CHECK(canvas->draw(true) == tvg::Result::Success);
        CHECK(canvas->sync() == tvg::Result::Success);
        return partial == pixels;
    }
};

std::vector<tvg::Paint*> children(tvg::Scene* scene)
{
    return {scene->paints().begin(), scene->paints().end()};
}

bool within(const std::vector<tvg::Region>& regions, ui::Rect bounds)
{
    for (const auto& region : regions) {
        if (region.xMin < bounds.x - 1 || region.yMin < bounds.y - 1 || region.xMax > bounds.x + bounds.w + 1 || region.yMax > bounds.y + bounds.h + 1) return false;
    }
    return !regions.empty();
}
}  // namespace

TEST(ui_context_reuses_unchanged_paints_so_steady_frames_leave_no_dirty_regions)
{
    Surface surface;
    ui::Color accent{200, 80, 40};
    auto frame = [&](ui::Context& context) {
        context.rect({0, 0, width, height}, surface.theme.background);
        context.rect({10, 10, 60, 30}, accent, 4);
        context.line(10, 50, 120, 50, surface.theme.border);
        context.text({10, 60, 140, 24}, "Retained label", surface.theme.text);
        context.clip({150, 10, 80, 80}, [&] { context.rect({140, 20, 60, 20}, surface.theme.accent); });
        context.paint(ui::paintKey(surface.theme.muted), [&] {
            auto ellipse = tvg::Shape::gen();
            ellipse->appendCircle(190, 120, 20, 20);
            auto color = surface.theme.muted;
            ellipse->fill(color.r, color.g, color.b, color.a);
            return ellipse;
        });
    };
    surface.draw(frame);
    auto first = children(surface.context.scene());
    CHECK(surface.draw(frame).empty());
    CHECK(children(surface.context.scene()) == first);

    accent = {40, 80, 200};
    CHECK(within(surface.draw(frame), {10, 10, 60, 30}));
    CHECK(surface.matchesFullRedraw());
    CHECK(surface.draw(frame).empty());
}

TEST(ui_context_partial_redraw_matches_a_full_redraw_as_paints_change)
{
    Surface surface;
    int step = 0;
    auto frame = [&](ui::Context& context) {
        context.rect({0, 0, width, height}, surface.theme.background);
        if (step != 1) context.rect({10, 10, 50, 50}, {220, 40, 40});
        // Reordering keeps both paints but changes which one is on top.
        if (step == 2) context.rect({30, 30, 50, 50}, {40, 40, 220});
        else context.rect({30 + step * 4.0f, 30, 50, 50}, {40, 220, 40});
        if (step == 2) context.rect({10, 10, 50, 50}, {220, 40, 40});
        context.text({90, 10, 140, 24}, step == 3 ? "Changed" : "Label " + std::to_string(step % 2), surface.theme.text);
        if (step != 4) context.clip({100, 60, 60 + step * 10.0f, 60}, [&] { context.rect({90, 70, 120, 20}, surface.theme.accent); });
        context.line(0, 150, step * 40.0f, 150, surface.theme.text, 2);
    };
    surface.draw(frame);
    for (step = 1; step <= 5; ++step) {
        surface.draw(frame);
        CHECK(surface.matchesFullRedraw());
    }
    for (step = 0; step <= 5; ++step) {
        surface.draw(frame);
        CHECK(surface.matchesFullRedraw());
    }
}

TEST(ui_context_moves_retained_paints_between_clips_and_releases_unused_layers)
{
    te::test::Graphics graphics;
    ui::Context context;
    auto theme = ui::Theme::dark();
    auto red = tvg::Shape::gen();
    red->ref();
    red->appendRect(0, 0, 64, 64);
    red->fill(255, 0, 0);
    std::vector<uint32_t> pixels(64 * 64);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen());
    CHECK(canvas->target(pixels.data(), 64, 64, 64, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
    CHECK(canvas->add(context.scene()) == tvg::Result::Success);
    auto render = [&] {
        CHECK(canvas->update() == tvg::Result::Success);
        CHECK(canvas->draw(true) == tvg::Result::Success);
        CHECK(canvas->sync() == tvg::Result::Success);
    };
    for (bool left : {false, true, false}) {
        context.begin(theme, {0, 0, 64, 64});
        context.clip({0, 0, 32, 64}, [&] { if (left) context.add(red); });
        context.clip({32, 0, 32, 64}, [&] { if (!left) context.add(red); });
        context.end();
        render();
        CHECK_EQ(pixels[5], left ? 0xffff0000u : 0u);
        CHECK_EQ(pixels[45], left ? 0u : 0xffff0000u);
    }
    for (float width : {16.0f, 48.0f, 16.0f}) {
        context.begin(theme, {0, 0, 64, 64});
        context.clip({0, 0, width, 64}, [&] { context.add(red); });
        context.end();
        render();
        CHECK_EQ(pixels[5], 0xffff0000u);
        CHECK_EQ(pixels[40], width > 40 ? 0xffff0000u : 0u);
    }
    context.begin(theme, {0, 0, 64, 64});
    context.add(red);
    context.end();
    render();
    CHECK_EQ(pixels[45], 0xffff0000u);
    context.begin(theme, {0, 0, 64, 64});
    context.end();
    CHECK_EQ(red->refCnt(), uint16_t(1));
    red->unref();
}

