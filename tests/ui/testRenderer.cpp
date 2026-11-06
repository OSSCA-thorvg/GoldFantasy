#include <test/test.h>
#include <test/graphics.h>
#include <ui/render.h>
#include <ui/ui.h>

TEST(renderer_cpu_retargets_and_keeps_scene_ownership_with_the_application)
{
    te::test::Graphics graphics(false);
    ui::Context context;
    auto theme = ui::Theme::dark();
    std::vector<uint32_t> pixels(32 * 32);
    ui::Renderer renderer(ui::RenderBackend::Cpu);
    CHECK(renderer.target(pixels, 32, 32));
    CHECK(renderer.attach(context.scene()));
    context.begin(theme, {0, 0, 32, 32});
    context.rect({0, 0, 16, 32}, {255, 0, 0});
    context.end();
    CHECK(renderer.draw());
    CHECK_EQ(pixels[8 * 32 + 8], 0xffff0000u);
    CHECK_EQ(pixels[8 * 32 + 24], 0u);

    CHECK(renderer.sync());
    std::vector<uint32_t> resized(64 * 32);
    CHECK(renderer.target(resized, 64, 32));
    context.begin(theme, {0, 0, 64, 32});
    context.rect({32, 0, 32, 32}, {0, 0, 255});
    context.end();
    CHECK(renderer.draw());
    CHECK_EQ(resized[8 * 64 + 8], 0u);
    CHECK_EQ(resized[8 * 64 + 48], 0xff0000ffu);
    renderer.clear();
    CHECK(renderer.attach(context.scene()));
    CHECK(renderer.draw());
    CHECK_EQ(resized[8 * 64 + 48], 0xff0000ffu);
}

TEST(renderer_rejects_invalid_targets_without_changing_backend)
{
    te::test::Graphics graphics(false);
    ui::Renderer renderer(ui::RenderBackend::Cpu);
    std::vector<uint32_t> pixels(32 * 32);
    CHECK(!renderer.target(pixels, 64, 32));
    CHECK(!renderer.target(pixels, 0, 32));
    CHECK(!renderer.targetGl(nullptr, 32, 32));
    CHECK(!renderer.targetWebGpu({}, nullptr, 32, 32));
    CHECK(!renderer.attach(nullptr));
    CHECK(!renderer.error().empty());
    CHECK(renderer.backend() == ui::RenderBackend::Cpu);
    CHECK(renderer.target(pixels, 32, 32));
}
