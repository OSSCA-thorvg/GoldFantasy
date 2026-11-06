#include "common/scene_lookup.h"
#include <test/test.h>
#include <test/graphics.h>
#include <game/game_app.h>
#include <game/map_document.h>
#include <game/town.h>
#include <game/traffic.h>
#include <game/world_renderer.h>
#include <algorithm>
#include <iterator>
#include <memory>
#include <vector>

namespace
{
using namespace hearthold;

// The world rendered into pixels at zoom 1, centred on a screen point.
struct Surface
{
    static constexpr int width = 480, height = 480;
    WorldRenderer renderer;
    Camera camera;
    std::vector<uint32_t> pixels = std::vector<uint32_t>(size_t(width) * height);
    std::unique_ptr<tvg::SwCanvas> canvas{tvg::SwCanvas::gen(tvg::EngineOption::Default)};
    explicit Surface(Point center) : camera{center.x, center.y, 1}
    {
        CHECK(canvas->target(pixels.data(), width, width, height, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
        CHECK(canvas->add(renderer.scene()) == tvg::Result::Success);
    }
    void frame(const Town& town, const Traffic& traffic, bool veiled = true, double seconds = 0)
    {
        CHECK(canvas->sync() == tvg::Result::Success);
        renderer.update(town, traffic, camera, width, height, seconds, {});
        // Without the veils, the same frame as if everything were in plain sight.
        std::vector<tvg::Paint*> veils;
        if (!veiled) {
            auto* world = static_cast<tvg::Scene*>(*std::next(renderer.scene()->paints().begin()));
            for (int layer : {13, 14}) veils.push_back(*std::next(world->paints().begin(), layer));  // Memory and fog.
            for (auto* veil : veils) veil->opacity(0);
        }
        CHECK(canvas->update() == tvg::Result::Success);
        CHECK(canvas->draw(true) == tvg::Result::Success);
        CHECK(canvas->sync() == tvg::Result::Success);
        for (auto* veil : veils) veil->opacity(255);
    }
    uint32_t at(Point world) const
    {
        auto p = camera.toScreen(world, width, height);
        int x = std::clamp(int(std::lround(p.x)), 0, width - 1), y = std::clamp(int(std::lround(p.y)), 0, height - 1);
        return pixels[size_t(y) * width + size_t(x)];
    }
};

int red(uint32_t c) { return int(c >> 16 & 255); }
int green(uint32_t c) { return int(c >> 8 & 255); }
int blue(uint32_t c) { return int(c & 255); }
int light(uint32_t c) { return red(c) + green(c) + blue(c); }

// The diagonal row a sprite at `world` is drawn in: objects hold buildings, lamps, trees and people per row.
int drawnRow(WorldRenderer& renderer, Point world)
{
    auto* scene = renderer.scene();
    auto* worldLayer = static_cast<tvg::Scene*>(*std::next(scene->paints().begin()));
    auto* objects = static_cast<tvg::Scene*>(*std::next(worldLayer->paints().begin(), 6));
    auto screen = project(world.x, world.y);
    auto* figure = test::figureAt(objects, screen.x, screen.y);
    auto* holder = figure ? test::parentOf(objects, figure) : nullptr;
    if (!holder) return -1;
    int index = 0;
    for (auto* row : objects->paints()) {
        if (row == holder) return index / 4;
        ++index;
    }
    return -1;
}
}  // namespace

TEST(game_ymir_gives_no_sight_but_is_always_drawn_plainly)
{
    // The user: the statue is land, nothing of the player's, so the ground about him is no one's sight; and his
    // brightening and darkening as people came and went looked wrong, so he always shows plainly.
    te::test::Graphics graphics(false);
    Town town(5);
    Traffic traffic(5);
    traffic.update(town, 0);
    if (!town.map().giant()) { CHECK(town.map().giant().has_value()); return; }
    auto heart = town.map().giant()->center();
    auto& people = const_cast<std::vector<Person>&>(town.people());
    for (auto& person : people) person.position = heart + Point{24, 24};
    auto base = project(heart.x, heart.y);
    Surface surface({base.x, base.y - 120});
    surface.frame(town, traffic);
    CHECK(!surface.renderer.visible(heart));
    CHECK(!surface.renderer.visible(heart + Point{1, -7}));
    // From the top of his throne and the ice of his crown down; and the bay beside him.
    const Point parts[] = {{-60, -428}, {0, -422}, {-32, -352}, {-84, -302}, {-60, -240}, {-112, -240}};
    const Point bay{250, -100};
    uint32_t veiled[std::size(parts)];
    for (size_t i = 0; i < std::size(parts); ++i) veiled[i] = surface.at(base + parts[i]);
    auto water = surface.at(base + bay);
    surface.frame(town, traffic, false);
    for (size_t i = 0; i < std::size(parts); ++i) CHECK(light(veiled[i]) * 10 >= light(surface.at(base + parts[i])) * 9);
    CHECK(light(water) * 10 < light(surface.at(base + bay)) * 7);
    // Someone at his feet sees him.
    people.front().position = heart + Point{3.5f, 3.5f};
    surface.frame(town, traffic);
    CHECK(surface.renderer.visible(heart));
}

TEST(game_buildings_before_ymirs_dais_draw_over_it)
{
    te::test::Graphics graphics(false);
    // Two towns alike but for storehouses tucked against the dais's two front faces, one of them by its east
    // corner, where it falls in an earlier diagonal row than his.
    auto build = [](Town& town, bool storehouses) {
        auto o = town.map().giant()->origin;
        town.scout(town.map().giant()->center().x, town.map().giant()->center().y, 16);
        CHECK(town.place(Structure::Camp, town.map().camp(), 0));
        town.completeConstruction();
        town.reward({200, 200, 200, 200, 0});
        CHECK(town.buildRoad({RoadAnchor::sharp({o.x + 8.6f, o.y + 1.f}), RoadAnchor::sharp({o.x + 8.6f, o.y + 6.f})}));
        CHECK(town.buildRoad({RoadAnchor::sharp({o.x + 8.6f, o.y + 6.f}), RoadAnchor::sharp({o.x + 8.6f, o.y + 8.6f}), RoadAnchor::sharp({o.x + 1.f, o.y + 8.6f})}));
        town.completeConstruction();
        if (storehouses)
            for (Point at : {Point{o.x + 7.f, o.y + 3.f}, Point{o.x + 3.f, o.y + 7.f}, Point{o.x + 7.f, o.y + .9f}}) CHECK(town.place(Structure::Storehouse, at, 0));
        town.completeConstruction();
    };
    // His mere drained in the editor, so buildings can stand against the dais.
    MapDocument drained(WorldMap::generate(5));
    if (!drained.map().giant()) { CHECK(drained.map().giant().has_value()); return; }
    CHECK(drained.paint(drained.map().giant()->center(), 10, Terrain::Grass));
    auto origin = drained.map().giant()->origin;
    CHECK(drained.setStart({origin.x + 9.5f, origin.y + 5.5f}));  // Beside his east face, where roads reach the dais.
    CHECK(drained.addDungeon({origin.x + 12.5f, origin.y + 11.5f}, DungeonKind::Cave));  // A den within the camp's reach.
    Town with(drained.gameMap()), without(drained.gameMap());
    build(with, true);
    build(without, false);
    Traffic traffic(5);
    traffic.update(with, 0);
    auto giant = *with.map().giant();
    auto base = project(giant.center().x, giant.center().y);
    Surface near({base.x, base.y - 60}), bare({base.x, base.y - 60});
    for (double seconds : {0., 4., 12., 30.}) {  // Long enough for new buildings to finish rising.
        near.frame(with, traffic, true, seconds);
        bare.frame(without, traffic, true, seconds);
    }
    // Where their roofs rise over the dais on screen, they show: counted inside the dais's own outline.
    const Outline dais{{-172, -30}, {-12, -110}, {12, -110}, {172, -30}, {172, 6}, {12, 86}, {-12, 86}, {-172, 6}};
    int left = 0, right = 0, corner = 0;
    for (int y = 0; y < Surface::height; ++y)
        for (int x = 0; x < Surface::width; ++x) {
            Point world{near.camera.x + x - Surface::width / 2.f, near.camera.y + y - Surface::height / 2.f};
            if (!contains(dais, world - base)) continue;
            size_t at = size_t(y) * Surface::width + size_t(x);
            if (near.pixels[at] == bare.pixels[at]) continue;
            (world.x < base.x ? left : right) += 1;
            corner += world.x > base.x + 140;
        }
    CHECK(left > 150);
    CHECK(right > 150);
    CHECK(corner > 60);
}

TEST(game_people_in_front_of_ymir_are_not_hidden_by_his_dais)
{
    te::test::Graphics graphics(false);
    Town town(5);
    Traffic traffic(5);
    traffic.update(town, 0);
    if (!town.map().giant()) { CHECK(town.map().giant().has_value()); return; }
    auto giant = *town.map().giant();
    int own = giant.origin.x + giant.origin.y + 2 * Giant::size - 2;  // His row: the footprint's front corner.
    auto id = town.people().front().id;
    auto heart = project(giant.center().x, giant.center().y);
    Surface surface(heart);
    // Just in front of the dais's south-east edge, though in an earlier diagonal row than his...
    Point front{giant.origin.x + 6.3f, giant.origin.y + 3.f};
    CHECK(town.editPerson(id, front, 1));
    surface.frame(town, traffic);
    CHECK(drawnRow(surface.renderer, front) >= own);
    // ...and just behind its north-east edge.
    Point behind{giant.origin.x + 3.f, giant.origin.y - .4f};
    CHECK(town.editPerson(id, behind, 1));
    surface.frame(town, traffic);
    int row = drawnRow(surface.renderer, behind);
    CHECK(row >= 0);
    CHECK(row < own);
}

TEST(game_the_opening_view_shows_ymir_over_the_founders)
{
    te::test::Graphics graphics(false);
    GameApp game(5);
    const auto& map = game.state().map();
    if (!map.giant()) { CHECK(map.giant().has_value()); return; }
    auto stone = project(map.giant()->center().x, map.giant()->center().y);
    auto camp = project(map.camp().x, map.camp().y);
    constexpr float width = 1280, height = 800;
    auto inside = [&](Point world) {
        auto p = game.view().toScreen(world, width, height);
        return p.x > 0 && p.y > 40 && p.x < width && p.y < height;
    };
    CHECK(inside(stone + Point{0, -440}));  // The top of his throne, below the resource bar.
    CHECK(inside(stone + Point{-140, 0}));
    CHECK(inside(stone + Point{140, 0}));
    for (const auto& p : game.state().people()) CHECK(inside(project(p.position.x, p.position.y)));
    CHECK(inside(camp));
}

TEST(game_ymirs_eyes_are_blank_stone_by_day_and_glow_at_night)
{
    te::test::Graphics graphics(false);
    Town town(5);
    Traffic traffic(5);
    traffic.update(town, 0);
    if (!town.map().giant()) { CHECK(town.map().giant().has_value()); return; }
    auto stone = project(town.map().giant()->center().x, town.map().giant()->center().y);
    Point eye = stone + Point{-20.4f, -360.8f};  // His west eye, on the head carved a size up.
    Surface surface({stone.x, stone.y - 300});
    surface.frame(town, traffic);
    auto day = surface.at(eye);
    CHECK(light(day) < 3 * 170);  // Stone, not a light that daylight washes white.
    CHECK(town.editHour(23));
    surface.frame(town, traffic);
    auto night = surface.at(eye);
    CHECK(blue(night) - red(night) > 40);
}

TEST(game_the_editor_keeps_ymir_in_view_while_his_feet_are_below_it)
{
    te::test::Graphics graphics(false);
    MapDocument doc(WorldMap::generate(5));
    Town town(doc.previewMap(), Town::MapPreview{});
    Traffic traffic(5);
    if (!town.map().giant()) { CHECK(town.map().giant().has_value()); return; }
    auto giant = *town.map().giant();
    auto stone = project(giant.center().x, giant.center().y);
    // His dais 300 px below the bottom of the view, his head and shoulders still in it.
    Surface surface({stone.x, stone.y - Surface::height / 2.f - 300});
    surface.renderer.setEditorView(true);
    surface.frame(town, traffic);
    auto* world = static_cast<tvg::Scene*>(*std::next(surface.renderer.scene()->paints().begin()));
    auto* objects = static_cast<tvg::Scene*>(*std::next(world->paints().begin(), 6));
    int row = giant.origin.x + giant.origin.y + 2 * Giant::size - 2;
    CHECK_EQ(int((*std::next(objects->paints().begin(), 4 * row))->opacity()), 255);
}
