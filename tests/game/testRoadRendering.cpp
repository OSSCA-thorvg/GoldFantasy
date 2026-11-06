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

tvg::Scene* pictureRow(tvg::Scene* scene)
{
    for (auto* paint : scene->paints())
        if (paint->type() == tvg::Type::Picture) return scene;
    for (auto* paint : scene->paints())
        if (paint->type() == tvg::Type::Scene)
            if (auto* found = pictureRow(static_cast<tvg::Scene*>(paint))) return found;
    return nullptr;
}

// Hold old paints alive so allocator reuse cannot hide a needless rebuild.
struct RetainedPaints
{
    tvg::Scene* scene;
    std::vector<tvg::Paint*> paints;
    explicit RetainedPaints(tvg::Scene* scene) : scene(scene), paints(scene->paints().begin(), scene->paints().end())
    {
        for (auto* paint : paints) paint->ref();
    }
    ~RetainedPaints() { for (auto* paint : paints) paint->unref(); }
    bool unchanged() const { return std::equal(paints.begin(), paints.end(), scene->paints().begin(), scene->paints().end()); }
};

tvg::Scene* worldLayer(const WorldRenderer& renderer, int index)
{
    auto* world = static_cast<tvg::Scene*>(*std::next(renderer.scene()->paints().begin()));
    return static_cast<tvg::Scene*>(*std::next(world->paints().begin(), index));
}

std::vector<Point> roadGeometry(const WorldRenderer& renderer)
{
    // World layers: ground, water, fields, ornaments, then the road surfaces.
    auto* roads = worldLayer(renderer, 3);
    std::vector<Point> result;
    for (auto* paint : roads->paints()) {
        const tvg::Point* points = nullptr; uint32_t count = 0;
        static_cast<tvg::Shape*>(paint)->path(nullptr, nullptr, &points, &count);
        for (uint32_t i = 0; i < count; ++i) result.push_back({points[i].x, points[i].y});
    }
    return result;
}

struct RoadTown
{
    Town town{5};
    Traffic traffic{5};
    WorldRenderer renderer;
    Camera camera;
    Point camp = town.map().camp();
    double seconds = 0;
    RoadTown()
    {
        town.scout(camp.x, camp.y, 12);
        CHECK(town.place(Structure::Camp, camp, 0));
        town.completeConstruction();
        CHECK(town.buildRoad({RoadAnchor::sharp(camp + Point{1, 0}), RoadAnchor::sharp(camp + Point{6, 0})}));
        auto focus = project(camp.x, camp.y); camera = {focus.x, focus.y, 1.4f};
    }
    void frame()
    {
        traffic.update(town, 0);
        renderer.update(town, traffic, camera, 640, 480, seconds, {});
    }
    void workUntilRoadChanges()
    {
        auto before = town.roadRevision();
        for (int i = 0; i < 200 && town.roadRevision() == before; ++i) { town.advance(.1); seconds += .1; }
        CHECK(town.roadRevision() != before);
    }
    void order()
    {
        std::vector<int> ids;
        for (const auto& person : town.people()) ids.push_back(person.id);
        CHECK(town.orderRoadwork(ids, town.roads().roads().front().id));
    }
};
}  // namespace

TEST(game_road_progress_retains_buildings_while_updating_surfaces_and_lights)
{
    te::test::Graphics graphics(false);
    RoadTown test;
    test.order(); test.frame();
    auto* row = pictureRow(test.renderer.scene());
    CHECK(row); if (!row) return;
    RetainedPaints buildings(row);
    auto geometry = roadGeometry(test.renderer);
    test.workUntilRoadChanges(); test.frame();
    CHECK(buildings.unchanged());
    CHECK(geometry != roadGeometry(test.renderer));
    // Exercise the rebuilt light masks on a real canvas, then a full invalidation.
    std::vector<uint32_t> pixels(640 * 480);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen(tvg::EngineOption::Default));
    CHECK(canvas->target(pixels.data(), 640, 640, 480, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
    CHECK(canvas->add(test.renderer.scene()) == tvg::Result::Success);
    CHECK(canvas->draw(true) == tvg::Result::Success); CHECK(canvas->sync() == tvg::Result::Success);
    test.renderer.invalidateMap(); test.frame();
    CHECK(canvas->update() == tvg::Result::Success);
    CHECK(canvas->draw(true) == tvg::Result::Success); CHECK(canvas->sync() == tvg::Result::Success);
}

TEST(game_road_paving_retains_buildings_and_updates_the_stone_surface)
{
    te::test::Graphics graphics(false);
    RoadTown test;
    test.town.completeConstruction();
    CHECK(test.town.pave(test.town.roads().roads().front().id));
    test.order(); test.frame();
    auto* row = pictureRow(test.renderer.scene());
    CHECK(row); if (!row) return;
    RetainedPaints buildings(row);
    auto* lights = worldLayer(test.renderer, 5);
    auto* roadLights = static_cast<tvg::Scene*>(lights->paints().back());
    RetainedPaints lanterns(roadLights);
    auto geometry = roadGeometry(test.renderer);
    test.workUntilRoadChanges(); test.frame();
    CHECK(buildings.unchanged());
    CHECK(lanterns.unchanged());  // Paving leaves the road's junctions in place.
    CHECK(geometry != roadGeometry(test.renderer));
}
