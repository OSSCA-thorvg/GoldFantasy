#include <test/test.h>
#include <test/graphics.h>
#include <game/town.h>
#include <game/traffic.h>
#include <game/world_renderer.h>
#include <algorithm>
#include <iterator>
#include <memory>

namespace
{
using namespace hearthold;
std::vector<tvg::Scene*> treeRows(WorldRenderer& renderer)
{
    auto* world = static_cast<tvg::Scene*>(*std::next(renderer.scene()->paints().begin()));
    auto* objects = static_cast<tvg::Scene*>(*std::next(world->paints().begin(), 6));
    std::vector<tvg::Scene*> trees;
    size_t index = 0;
    for (auto* row : objects->paints())
        if (index++ % 4 == 2) trees.push_back(static_cast<tvg::Scene*>(row));
    return trees;
}

tvg::Scene* fogLayer(WorldRenderer& renderer)
{
    auto* world = static_cast<tvg::Scene*>(*std::next(renderer.scene()->paints().begin()));
    return static_cast<tvg::Scene*>(*std::next(world->paints().begin(), 13));
}

struct Surface
{
    WorldRenderer renderer;
    static constexpr int width = 320, height = 240;
    std::vector<uint32_t> pixels = std::vector<uint32_t>(width * height);
    std::unique_ptr<tvg::SwCanvas> canvas{tvg::SwCanvas::gen(tvg::EngineOption::Default)};
    Surface()
    {
        CHECK(canvas->target(pixels.data(), width, width, height, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
        CHECK(canvas->add(renderer.scene()) == tvg::Result::Success);
    }
    void frame(const Town& town, const Traffic& traffic, Camera camera, double seconds, bool allTrees)
    {
        CHECK(canvas->sync() == tvg::Result::Success);
        renderer.update(town, traffic, camera, width, height, seconds, {});
        if (allTrees) {
            for (auto* row : treeRows(renderer)) row->opacity(255);
        }
        CHECK(canvas->update() == tvg::Result::Success);
        CHECK(canvas->draw(true) == tvg::Result::Success);
        CHECK(canvas->sync() == tvg::Result::Success);
    }
};
}

TEST(game_zoom_culls_static_tree_rows_without_changing_visible_pixels)
{
    te::test::Graphics graphics(false);
    Town town(WorldMap::generate(5, 64, 64), false);
    town.scout(32, 32, 120);
    Traffic traffic(5); traffic.update(town, 0);
    Surface culled, complete;
    int frame = 0;
    for (auto view : {Point{22, 22}, Point{40, 16}, Point{14, 46}, Point{32, 32}})
        for (float zoom : {.35f, 1.3f, 3.5f}) {
            auto p = project(view.x, view.y);
            Camera camera{p.x, p.y, zoom};
            double seconds = frame++ / 60.;
            culled.frame(town, traffic, camera, seconds, false);
            complete.frame(town, traffic, camera, seconds, true);
            CHECK(culled.pixels == complete.pixels);
            auto rows = treeRows(culled.renderer);
            CHECK(std::any_of(rows.begin(), rows.end(), [](auto* row) { return row->opacity() == 0; }));
        }
    // A full map invalidation clears the old bounds and rebuilds the retained rows safely.
    culled.renderer.invalidateMap(); complete.renderer.invalidateMap();
    auto p = project(22, 22);
    culled.frame(town, traffic, {p.x, p.y, 1.3f}, 1, false);
    complete.frame(town, traffic, {p.x, p.y, 1.3f}, 1, true);
    CHECK(culled.pixels == complete.pixels);
}

TEST(game_fog_uses_one_bounded_image_across_long_histories_and_map_replacement)
{
    te::test::Graphics graphics(false);
    Town town(WorldMap::generate(5, 64, 64), false);
    for (int y = 2; y < 64; y += 4)
        for (int x = 2; x < 64; x += 4) town.scout(float(x), float(y), 3);
    Traffic traffic(5); traffic.update(town, 0);
    Surface surface;
    for (auto view : {Point{12, 12}, Point{48, 36}, Point{20, 48}, Point{-20, -20}}) {
        auto p = project(view.x, view.y);
        surface.frame(town, traffic, {p.x, p.y, 1.4f}, 0, false);
        auto* fog = fogLayer(surface.renderer);
        CHECK_EQ(fog->paints().size(), 2u);  // One border shape and one RGBA field.
        unsigned pictures = 0;
        for (auto* paint : fog->paints()) {
            pictures += paint->type() == tvg::Type::Picture;
            const tvg::Paint* mask = nullptr;
            CHECK(paint->mask(&mask) == tvg::MaskMethod::None);
        }
        CHECK_EQ(pictures, 1u);
    }
    surface.renderer.invalidateMap();
    Town replaced(WorldMap::generate(12, 48, 48), false);
    auto p = project(24, 24);
    surface.frame(replaced, traffic, {p.x, p.y, 1.4f}, 0, false);
    CHECK_EQ(fogLayer(surface.renderer)->paints().size(), 2u);
}

TEST(game_current_sight_is_drawn_on_the_first_frame_after_a_source_moves)
{
    te::test::Graphics graphics(false);
    Town town(5, 64);
    Traffic traffic(5); traffic.update(town, 0);
    WorldRenderer renderer;
    auto* root = renderer.scene();
    auto* world = static_cast<tvg::Scene*>(*std::next(root->paints().begin()));
    auto* fog = fogLayer(renderer);
    std::vector<uint32_t> pixels(64 * 64);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen());
    CHECK(canvas->target(pixels.data(), 64, 64, 64, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
    CHECK(canvas->add(root) == tvg::Result::Success);
    auto frame = [&] {
        CHECK(canvas->sync() == tvg::Result::Success);
        renderer.update(town, traffic, {0, 0, 1}, 64, 64, 0, {});
        // Keep the real ownership graph and isolate its fog over a white background.
        static_cast<tvg::Shape*>(root->paints().front())->fill(255, 255, 255);
        for (auto* paint : root->paints()) if (paint != root->paints().front() && paint != world) paint->opacity(0);
        for (auto* paint : world->paints()) if (paint != fog) paint->opacity(0);
        ui::setTransform(world, {1, 0, 0, 0, 1, 0, 0, 0, 1});
        ui::setTransform(fog, {1, 0, 0, 0, 1, 0, 0, 0, 1});
        CHECK(canvas->update() == tvg::Result::Success); CHECK(canvas->draw(true) == tvg::Result::Success);
        CHECK(canvas->sync() == tvg::Result::Success);
    };
    frame();
    auto id = town.people().front().id;
    // Two lookouts far from the camp, where the other settlers' sight does not reach, and from each other.
    auto camp = town.map().camp();
    const Point corners[] = {{12.5f, 12.5f}, {50.5f, 12.5f}, {12.5f, 50.5f}, {50.5f, 50.5f}};
    auto first = *std::max_element(std::begin(corners), std::end(corners), [&](Point a, Point b) { return distance(a, camp) < distance(b, camp); });
    auto apart = [&](Point p) { return std::min(distance(p, camp), distance(p, first)); };
    auto second = *std::max_element(std::begin(corners), std::end(corners), [&](Point a, Point b) { return apart(a) < apart(b); });
    auto pixel = [&](Point p) { return pixels[size_t(p.y) * 64 + size_t(p.x)]; };
    CHECK(town.editPerson(id, first, 1));
    frame();
    CHECK(renderer.visible(first));
    CHECK_EQ(pixel(first), 0xffffffffu);
    // A move without elapsed wall time must update the raster immediately, too.
    CHECK(town.editPerson(id, second, 1));
    frame();
    CHECK_EQ(pixel(second), 0xffffffffu);
    CHECK(!renderer.visible(first));
    CHECK(pixel(first) != 0xffffffffu);  // Explored memory remains.
    canvas.reset();
}
