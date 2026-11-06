#include <test/test.h>
#include <test/graphics.h>
#include <game/game_app.h>
#include <algorithm>
#include <memory>

namespace
{
using namespace hearthold;
constexpr int width = 1280, height = 800;

struct SelectionScene
{
    GameApp game{5};
    std::vector<uint32_t> pixels = std::vector<uint32_t>(width * height);
    std::unique_ptr<tvg::SwCanvas> canvas{tvg::SwCanvas::gen()};
    SelectionScene()
    {
        game.selectPeople({});
        auto at = game.state().map().camp();
        auto focus = project(at.x, at.y);
        game.view() = {focus.x, focus.y, 1};
        CHECK(canvas->target(pixels.data(), width, width, height, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
        CHECK(canvas->add(game.hudScene()) == tvg::Result::Success);
        frame();
    }
    ~SelectionScene() { canvas->remove(); }
    void frame()
    {
        game.render(width, height, 0, false);
        CHECK(canvas->update() == tvg::Result::Success);
        CHECK(canvas->draw(true) == tvg::Result::Success);
        CHECK(canvas->sync() == tvg::Result::Success);
    }
    int alpha(int x, int y) const { return int(pixels[size_t(y * width + x)] >> 24); }
    void border(Point from, Point to)
    {
        int left = int(std::min(from.x, to.x)), right = int(std::max(from.x, to.x));
        int top = int(std::min(from.y, to.y)), bottom = int(std::max(from.y, to.y));
        int x = (left + right) / 2, y = (top + bottom) / 2;
        CHECK(alpha(x, top) > 160); CHECK(alpha(left, y) > 160);
        CHECK(alpha(x, bottom) > 160); CHECK(alpha(right, y) > 160);
        CHECK(alpha(x, top - 3) == 0); CHECK(alpha(left - 3, y) == 0);
        CHECK(alpha(x, top + 3) < 160); CHECK(alpha(left + 3, y) < 160);
        int horizontal = 0, vertical = 0;
        for (int d = -4; d <= 4; ++d) {
            horizontal += alpha(x, top + d) > 160;
            vertical += alpha(left + d, y) > 160;
        }
        CHECK_EQ(horizontal, 2); CHECK_EQ(vertical, 2);
    }
};
}

TEST(game_selection_box_keeps_screen_edges_and_stroke_while_resizing_zooming_and_panning)
{
    te::test::Graphics graphics;
    SelectionScene scene;
    for (float zoom : {.5f, 1.f, 3.f, 6.f}) {
        scene.game.view().zoom = zoom;
        for (bool reverse : {false, true}) {
            Point from{400, 250}, to{850, 450};
            if (reverse) std::swap(from, to);
            scene.game.pointerDown(from.x, from.y, PointerButton::Primary);
            scene.game.pointerMove(to.x, to.y); scene.frame();
            scene.border(from, to);
            to = reverse ? Point{300, 210} : Point{950, 510};
            scene.game.pointerMove(to.x, to.y); scene.frame();
            scene.border(from, to);
            scene.game.view().x += 40; scene.game.view().y -= 20;
            scene.frame(); scene.border(from, to);
            scene.game.cancelPointer(); scene.frame();
            CHECK_EQ(scene.alpha(600, int(std::min(from.y, to.y))), 0);
        }
    }
}

TEST(game_selection_box_tracks_the_pointer_outside_the_map_and_clears_on_release)
{
    te::test::Graphics graphics;
    SelectionScene scene;
    scene.game.view() = {-20000, -20000, .5f};
    scene.frame();
    Point from{400, 250}, to{850, 450};
    scene.game.pointerDown(from.x, from.y, PointerButton::Primary);
    scene.game.pointerMove(to.x, to.y); scene.frame(); scene.border(from, to);
    scene.game.pointerUp(to.x, to.y, PointerButton::Primary); scene.frame();
    CHECK_EQ(scene.alpha(600, 250), 0);
}

TEST(game_screen_selection_box_still_selects_the_units_it_encloses_at_each_zoom)
{
    te::test::Graphics graphics;
    SelectionScene scene;
    for (float zoom : {.5f, 1.f, 3.f, 6.f}) {
        scene.game.selectPeople({}); scene.game.view().zoom = zoom; scene.frame();
        Point from{width, height}, to{};
        for (const auto& person : scene.game.state().people()) {
            auto screen = scene.game.view().toScreen(project(person.position.x, person.position.y), width, height);
            from.x = std::min(from.x, screen.x - 16); from.y = std::min(from.y, screen.y - 24);
            to.x = std::max(to.x, screen.x + 16); to.y = std::max(to.y, screen.y + 16);
        }
        scene.game.pointerDown(from.x, from.y, PointerButton::Primary);
        scene.game.pointerMove(to.x, to.y);
        scene.game.pointerUp(to.x, to.y, PointerButton::Primary);
        CHECK_EQ(scene.game.selectedPeople().size(), scene.game.state().people().size());
    }
}
