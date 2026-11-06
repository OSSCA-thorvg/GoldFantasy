#include "common/scene_lookup.h"
#include <test/test.h>
#include <test/graphics.h>
#include <game/world_renderer.h>
#include <algorithm>
#include <cmath>

namespace
{
using namespace hearthold;

tvg::Scene* figureAt(tvg::Paint* paint, Point screen) { return test::figureAt(paint, screen.x, screen.y); }
using test::parentOf;

struct WorkerScene
{
    Town town{5};
    Traffic traffic{5};
    WorldRenderer renderer;
    Camera camera;
    Person& worker = const_cast<Person&>(town.people().front());

    WorkerScene()
    {
        worker.position = town.map().camp() + Point{.314f, .173f};
        worker.path.clear();
        worker.activity = Activity::Working;
        worker.inside = false;
    }
    void frame(double seconds) { renderer.update(town, traffic, camera, 800, 600, seconds, {}); }
    tvg::Scene* figure() { return figureAt(renderer.scene(), project(worker.position.x, worker.position.y)); }
};
}

TEST(game_worker_retains_facing_when_arriving_at_work)
{
    te::test::Graphics graphics(false);
    WorkerScene scene;
    scene.worker.path = {scene.worker.position + Point{-1, 0}};
    scene.frame(0);
    auto* walking = scene.figure();
    CHECK(walking);
    if (!walking) return;
    CHECK_EQ(walking->transform().e11, -1.f);
    scene.worker.path.clear();
    scene.frame(.1);
    CHECK(scene.figure() == walking);
    CHECK_EQ(walking->transform().e11, -1.f);
}

TEST(game_worker_doorway_fade_retains_the_figure_and_entrance_depth_row)
{
    te::test::Graphics graphics(false);
    WorkerScene scene;
    auto center = scene.town.map().camp();
    scene.town.scout(center.x, center.y, 10);
    CHECK(scene.town.place(Structure::Camp, center, .37f));
    scene.town.completeConstruction();
    const auto& building = scene.town.buildings().front();
    auto& worker = scene.worker;
    worker.entrance = building.door();
    worker.threshold = building.threshold();
    worker.position = worker.entrance;
    scene.frame(0);
    auto* figure = scene.figure();
    CHECK(figure);
    if (!figure) return;
    auto* exteriorRow = parentOf(scene.renderer.scene(), figure);
    CHECK(exteriorRow);
    CHECK_EQ(figure->opacity(), 255);

    float corridor = distance(worker.entrance, worker.threshold);
    CHECK(corridor > .01f);
    if (corridor <= .01f) return;
    float halfFade = 1 - std::min(corridor, .35f) * .5f / corridor;
    double seconds = 0;
    auto cross = [&](float progress, bool entering) {
        worker.inside = entering;
        worker.doorway = progress;
        worker.position = lerp(worker.entrance, worker.threshold, progress);
        scene.frame(seconds += .1);
        CHECK(parentOf(scene.renderer.scene(), figure) == exteriorRow);
        CHECK_EQ(figure->opacity(), uint8_t(std::lround(255 * worker.visibility())));
        CHECK(std::abs(figure->transform().e13 - project(worker.position.x, worker.position.y).x) < .001f);
    };
    cross(.25f, true);
    cross(.5f, true);
    cross(halfFade, true);
    CHECK(figure->opacity() > 0 && figure->opacity() < 255);
    worker.doorway = 1;
    worker.position = worker.threshold;
    scene.frame(seconds += .1);
    CHECK_EQ(figure->opacity(), 0);
    CHECK(parentOf(scene.renderer.scene(), figure));
    cross(halfFade, false);
    CHECK(figure->opacity() > 0 && figure->opacity() < 255);
    cross(.25f, false);
    cross(0, false);
    CHECK_EQ(figure->opacity(), 255);
}

TEST(game_worker_entering_a_remote_interior_stays_visible_during_the_fade)
{
    te::test::Graphics graphics(false);
    WorkerScene scene;
    // Nobody else supplies sight at this isolated entrance.
    for (const auto& other : scene.town.people())
        if (other.id != scene.worker.id) const_cast<Person&>(other).doorway = 1;
    auto& worker = scene.worker;
    worker.entrance = worker.position;
    worker.threshold = worker.position + Point{0, -.3f};
    worker.doorway = .5f;
    worker.inside = true;
    worker.position = lerp(worker.entrance, worker.threshold, .5f);
    scene.frame(0);
    auto* figure = scene.figure();
    CHECK(figure);
    if (!figure) return;
    CHECK(scene.renderer.visible(worker.position));
    CHECK(figure->opacity() > 0 && figure->opacity() < 255);
}
