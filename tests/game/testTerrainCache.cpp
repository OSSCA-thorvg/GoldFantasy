#include <test/test.h>
#include <test/graphics.h>
#include <game/map_document.h>
#include <game/terrain_painter.h>
#include <game/traffic.h>
#include <game/world_renderer.h>
#include <ui/ui.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <memory>
#include <utility>

namespace
{
using namespace hearthold;
static_assert(noexcept(std::declval<const WorldMap&>().sample(Layer::Land, 0, 0)));
static_assert(noexcept(std::declval<const WorldMap&>().value(Layer::Land, Point{})));
static_assert(noexcept(std::declval<const WorldMap&>().coast(0, 0)));

// Simple independent reference: paint each marching-squares cell separately. It intentionally
// retains interior edges so the optimized union is checked against the original sampled surface.
template<typename Sample>
tvg::Shape* referenceRegion(const WorldMap& map, Sample sample, const TileRegion* area)
{
    auto shape = tvg::Shape::gen();
    constexpr float step = 1.f / WorldMap::resolution;
    int left = area ? std::max(0, area->left * WorldMap::resolution) : 0;
    int top = area ? std::max(0, area->top * WorldMap::resolution) : 0;
    int right = area ? std::min(map.width() * WorldMap::resolution, area->right * WorldMap::resolution) : map.width() * WorldMap::resolution;
    int bottom = area ? std::min(map.height() * WorldMap::resolution, area->bottom * WorldMap::resolution) : map.height() * WorldMap::resolution;
    for (int y = top; y < bottom; ++y) for (int x = left; x < right; ++x) {
        std::array<Point, 4> corners{{{x * step, y * step}, {(x + 1) * step, y * step},
                                      {(x + 1) * step, (y + 1) * step}, {x * step, (y + 1) * step}}};
        std::array<float, 4> values{{sample(x, y), sample(x + 1, y), sample(x + 1, y + 1), sample(x, y + 1)}};
        std::array<Point, 8> polygon; size_t count = 0;
        for (size_t k = 0; k < 4; ++k) {
            size_t next = (k + 1) % 4;
            if (values[k] >= 0) polygon[count++] = corners[k];
            if ((values[k] >= 0) != (values[next] >= 0))
                polygon[count++] = lerp(corners[k], corners[next], values[k] / (values[k] - values[next]));
        }
        if (!count) continue;
        shape->moveTo(polygon[0].x, polygon[0].y);
        for (size_t k = 1; k < count; ++k) shape->lineTo(polygon[k].x, polygon[k].y);
        shape->close();
    }
    return shape;
}

std::vector<uint32_t> raster(tvg::Shape* shape, Point at, float zoom)
{
    constexpr int width = 240, height = 180;
    std::vector<uint32_t> pixels(width * height);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen());
    CHECK(canvas->target(pixels.data(), width, width, height, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
    shape->fill(255, 255, 255);
    auto matrix = isoMatrix(); auto focus = project(at.x, at.y);
    matrix.e11 *= zoom; matrix.e12 *= zoom; matrix.e21 *= zoom; matrix.e22 *= zoom;
    matrix.e13 = width / 2.f - focus.x * zoom; matrix.e23 = height / 2.f - focus.y * zoom;
    ui::setTransform(shape, matrix);
    CHECK(canvas->add(shape) == tvg::Result::Success);
    CHECK(canvas->draw(true) == tvg::Result::Success); CHECK(canvas->sync() == tvg::Result::Success);
    return pixels;
}

void compareRegions(const WorldMap& map, const TileRegion* area)
{
    std::unique_ptr<tvg::Scene> scene(tvg::Scene::gen());
    auto tints = paintGround(scene.get(), map, area);
    // Coast, interior islands and holes, laid over the sea's five depth bands; then a dense shade contour with
    // saddle cells (the middle shade level, after the land's eleven terrain classes, the lava's five bands, the
    // volcanic crests, the sand and the first shade).
    constexpr size_t coast = 5, middleShade = coast + 16;
    for (size_t index : {coast, middleShade}) {
        auto sample = [&](int x, int y) {
            float land = map.sample(Layer::Land, x, y);
            return index == coast ? land : std::min(land, map.sample(Layer::Shade, x, y) - .5f);
        };
        for (auto view : {Point{16, 16}, Point{8, 21}}) for (float zoom : {.2f, 1.4f}) {
            auto actual = raster(static_cast<tvg::Shape*>(tints[index].shape->duplicate()), view, zoom);
            auto expected = raster(referenceRegion(map, sample, area), view, zoom);
            int largest = 0;
            for (size_t i = 0; i < actual.size(); ++i)
                largest = std::max(largest, std::abs(int(actual[i] >> 24) - int(expected[i] >> 24)));
            // ThorVG's fixed-point edge accumulation can round an identical boundary by a byte.
            CHECK(largest <= 3);
        }
    }
}

struct TerrainSurface
{
    static constexpr int width = 320, height = 240;
    WorldRenderer renderer;
    std::vector<uint32_t> pixels = std::vector<uint32_t>(width * height);
    std::unique_ptr<tvg::SwCanvas> canvas{tvg::SwCanvas::gen()};
    TerrainSurface()
    {
        renderer.setEditorView(true);
        CHECK(canvas->target(pixels.data(), width, width, height, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
        CHECK(canvas->add(renderer.scene()) == tvg::Result::Success);
    }
    tvg::Scene* ground() const
    {
        auto world = static_cast<tvg::Scene*>(*std::next(renderer.scene()->paints().begin()));
        return static_cast<tvg::Scene*>(world->paints().front());
    }
    void frame(const Town& town, Camera camera, bool cliffs = true)
    {
        CHECK(canvas->sync() == tvg::Result::Success);
        Traffic traffic(5); traffic.update(town, 0);
        renderer.update(town, traffic, camera, width, height, 0, {});
        auto world = *std::next(renderer.scene()->paints().begin());
        for (auto paint : renderer.scene()->paints())
            if (paint != world && paint != renderer.scene()->paints().front()) paint->opacity(0);
        for (auto paint : static_cast<tvg::Scene*>(world)->paints()) if (paint != ground()) paint->opacity(0);
        auto cliffVisibility = [&](auto&& self, tvg::Scene* scene) -> void {
            // Terrain scenes begin with four sea paints and end with fifteen land/water
            // paints. The intervening cliff faces can batch differently at chunk cuts.
            if (scene->paints().size() > 15 && scene->paints().front()->type() == tvg::Type::Shape) {
                size_t k = 0;
                for (auto paint : scene->paints()) {
                    if (k >= 4 && k < scene->paints().size() - 15) paint->opacity(cliffs ? 255 : 0);
                    ++k;
                }
            }
            for (auto paint : scene->paints())
                if (paint->type() == tvg::Type::Scene) self(self, static_cast<tvg::Scene*>(paint));
        };
        cliffVisibility(cliffVisibility, ground());
        CHECK(canvas->update() == tvg::Result::Success); CHECK(canvas->draw(true) == tvg::Result::Success);
        CHECK(canvas->sync() == tvg::Result::Success);
    }
};

void compareTerrain(TerrainSurface& actual, TerrainSurface& expected, const Town& town, Camera camera)
{
    auto compare = [&](bool cliffs) {
        int largest = 0; size_t mismatched = 0;
        for (size_t i = 0; i < actual.pixels.size(); ++i) {
            bool different = false;
            for (int shift : {0, 8, 16, 24}) {
                int delta = std::abs(int(actual.pixels[i] >> shift & 255) - int(expected.pixels[i] >> shift & 255));
                largest = std::max(largest, delta); different |= delta > 3;
            }
            mismatched += different;
        }
        CHECK(largest <= (cliffs ? 16 : 3));
        CHECK(mismatched <= (cliffs ? actual.pixels.size() * 3 / 10000 : 0));
    };
    compare(true);
    // Allow the established cliff batching AA difference in under 0.03% of pixels, then
    // check every other terrain paint independently with the strict 3/255 tolerance.
    actual.frame(town, camera, false); expected.frame(town, camera, false); compare(false);
}
}  // namespace

TEST(game_terrain_union_preserves_sampled_coasts_holes_and_chunk_boundaries)
{
    te::test::Graphics graphics(false);
    MapDocument doc(WorldMap::generate(5, 32, 32));
    compareRegions(doc.map(), nullptr);
    // Editor brushes create both holes and disconnected patches; cuts can cross every border.
    doc.paint({16, 16}, 9, Terrain::Grass);
    doc.paint({16, 16}, 4, Terrain::Sea);
    doc.paint({6, 22}, 3, Terrain::Grass);
    compareRegions(doc.map(), nullptr);
    TileRegion chunk{8, 11, 23, 25}; compareRegions(doc.map(), &chunk);
    TileRegion outside{-20, -20, -10, -10}; compareRegions(doc.map(), &outside);
}

TEST(game_terrain_union_keeps_maximum_map_path_complexity_bounded)
{
    te::test::Graphics graphics(false);
    auto map = WorldMap::generate(5, 256, 256);
    std::unique_ptr<tvg::Scene> scene(tvg::Scene::gen());
    auto tints = paintGround(scene.get(), map);
    uint32_t points = 0; tints[5].shape->path(nullptr, nullptr, nullptr, &points);
    // The land's contour, laid over the sea's five depth bands, has about 5,000 vertices. Keeping cell interiors
    // takes over 24,000.
    CHECK(points < 8000);
    uint64_t total = 0;
    for (const auto& tint : tints) {
        tint.shape->path(nullptr, nullptr, nullptr, &points); total += points;
    }
    CHECK(total < 170000);
}

TEST(game_terrain_single_overview_retains_local_edits_and_refreshes_after_undo)
{
    te::test::Graphics graphics(false);
    MapDocument doc(WorldMap::generate(5, 32, 32));
    auto focus = project(16, 16); Camera camera{focus.x, focus.y, .12f};
    TerrainSurface retained;
    Town initial(doc.previewMap(), false); retained.frame(initial, camera);
    auto overview = static_cast<tvg::Scene*>(retained.ground()->paints().front());
    CHECK_EQ(overview->paints().size(), size_t(1));
    auto terrain = overview->paints().front();
    doc.takeDirtyArea();
    CHECK(doc.paint({16, 16}, 4, Terrain::Sea));
    retained.renderer.invalidateTerrain(doc.takeDirtyArea());
    Town edited(doc.previewMap(), false); retained.frame(edited, camera);
    CHECK(overview->paints().front() == terrain);
    { TerrainSurface fresh; fresh.frame(edited, camera); compareTerrain(retained, fresh, edited, camera); }
    CHECK(doc.paint({18, 18}, 3, Terrain::Grass));
    retained.renderer.invalidateTerrain(doc.takeDirtyArea());
    Town repainted(doc.previewMap(), false); retained.frame(repainted, camera);
    { TerrainSurface fresh; fresh.frame(repainted, camera); compareTerrain(retained, fresh, repainted, camera); }
    doc.undo(); retained.renderer.invalidateTerrain(doc.takeDirtyArea());
    Town undone(doc.previewMap(), false); retained.frame(undone, camera);
    { TerrainSurface fresh; fresh.frame(undone, camera); compareTerrain(retained, fresh, undone, camera); }
    doc.redo(); retained.renderer.invalidateTerrain(doc.takeDirtyArea());
    Town redone(doc.previewMap(), false); retained.frame(redone, camera);
    { TerrainSurface fresh; fresh.frame(redone, camera); compareTerrain(retained, fresh, redone, camera); }
    // Recolour while detailed terrain is visible, then return to the retained overview.
    redone.weather().previewTime(.8f, .5f); camera.zoom = 1.4f; retained.frame(redone, camera);
    camera.zoom = .12f; retained.frame(redone, camera);
    { TerrainSurface fresh; fresh.frame(redone, camera); compareTerrain(retained, fresh, redone, camera); }
}

TEST(game_terrain_wide_stroke_consolidates_patches_after_pointer_release)
{
    te::test::Graphics graphics(false);
    Town town(WorldMap::generate(5, 64, 64), false);
    auto at = project(32, 32); Camera camera{at.x, at.y, .08f};
    TerrainSurface retained, fresh;
    retained.frame(town, camera);
    // Many local invalidations model a stroke sweeping the island without making one global
    // invalidation. Completed strokes must not leave hundreds of clipped overlays active.
    for (int y = 0; y < 64; ++y)
        for (int x = 0; x < 64; ++x) retained.renderer.invalidateTerrain({x, y, x + 1, y + 1});
    retained.frame(town, camera);
    auto* detail = static_cast<tvg::Scene*>(*std::next(retained.ground()->paints().begin()));
    CHECK(std::any_of(detail->paints().begin(), detail->paints().end(), [](auto* p) { return p->opacity() != 0; }));
    retained.renderer.finishTerrainEdits(); retained.frame(town, camera); fresh.frame(town, camera);
    CHECK(std::none_of(detail->paints().begin(), detail->paints().end(), [](auto* p) { return p->opacity() != 0; }));
    CHECK(retained.pixels == fresh.pixels);
}
