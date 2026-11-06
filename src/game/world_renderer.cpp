#include "building_assets.h"
#include <stdexcept>
#include "world_renderer.h"
#include <cctype>
#include <tuple>
#include "cloud_mottle.h"
#include "terrain_painter.h"
#include "mountain_peaks.h"
#include "tree_painter.h"
#include "hvergelmir_painter.h"
#include "volcano_painter.h"
#include "world_sprites.h"
#include "ymir_statue.h"
#include "person_portrait.h"
#include <ui/ui.h>
#include <algorithm>
#include <array>
#include <cmath>

namespace hearthold
{
namespace
{
constexpr Rgb boulderLit{92, 90, 96}, boulderShade{60, 58, 66};
constexpr Rgb arcaneWisp{130, 240, 220}, violetWisp{200, 150, 255}, warmLight{232, 150, 64};


tvg::Scene* isoLayer()
{
    auto scene = tvg::Scene::gen();
    ui::setTransform(scene, isoMatrix());
    return scene;
}

void appendRoad(tvg::Shape* shape, const RoadPath& path)
{
    if (path.empty()) return;
    shape->moveTo(path[0].point.x, path[0].point.y);
    for (size_t i = 1; i < path.size(); ++i) shape->cubicTo(path[i - 1].out.x, path[i - 1].out.y, path[i].in.x, path[i].in.y, path[i].point.x, path[i].point.y);
}

constexpr Rgb dirt{88, 72, 52}, cobble{98, 94, 92}, cobbleJoint{66, 62, 62};

// One stroke per road, so crossings merge into one surface.
void roadStrokes(tvg::Scene* scene, const std::vector<const RoadPath*>& paths, uint8_t alpha, Rgb surface = dirt)
{
    auto shape = tvg::Shape::gen();
    for (const auto* path : paths) appendRoad(shape, *path);
    shape->strokeWidth(.46f);
    shape->strokeCap(tvg::StrokeCap::Round);
    shape->strokeJoin(tvg::StrokeJoin::Round);
    shape->strokeFill(surface.r, surface.g, surface.b, alpha);
    scene->add(shape);
}

// The road's course, wandering a little like a track worn by feet and carts; paving keeps it truer.
std::vector<Point> wornCourse(const Road& road)
{
    std::vector<Point> out;
    float total = road.length(), walked = 0, sway = road.paved ? .05f : .16f;
    for (size_t i = 0; i < road.line.size(); ++i) {
        if (i) walked += distance(road.line[i - 1], road.line[i]);
        auto ahead = normalized(road.line[std::min(i + 1, road.line.size() - 1)] - road.line[i ? i - 1 : 0]);
        float taper = std::min({1.f, walked / 1.2f, (total - walked) / 1.2f});  // Ends stay put where roads join.
        float offset = (fractalNoise(19 + uint32_t(road.id) * 31, walked * .55f, 1.7f) - .5f) * 2 * sway * taper;
        out.push_back(road.line[i] + Point{-ahead.y, ahead.x} * offset);
    }
    return out;
}

// The first `share` of a course, cut mid-segment.
std::vector<Point> stretch(const std::vector<Point>& course, float share, bool fromStart)
{
    if (course.empty()) return {};
    float total = 0;
    for (size_t i = 1; i < course.size(); ++i) total += distance(course[i - 1], course[i]);
    float cut = total * std::clamp(share, 0.f, 1.f), walked = 0;
    std::vector<Point> head{course.front()}, tail;
    for (size_t i = 1; i < course.size(); ++i) {
        float leg = distance(course[i - 1], course[i]);
        if (walked + leg <= cut) head.push_back(course[i]);
        else if (walked < cut) {
            auto mid = lerp(course[i - 1], course[i], (cut - walked) / leg);
            head.push_back(mid);
            tail.push_back(mid);
            tail.push_back(course[i]);
        } else tail.push_back(course[i]);
        walked += leg;
    }
    if (tail.empty()) tail.push_back(course.back());
    return fromStart ? head : tail;
}

void appendLine(tvg::Shape* shape, const std::vector<Point>& points)
{
    if (points.size() < 2) return;
    shape->moveTo(points[0].x, points[0].y);
    for (size_t i = 1; i < points.size(); ++i) shape->lineTo(points[i].x, points[i].y);
}

void paintRoads(tvg::Scene* scene, const RoadNetwork& network, const WorldMap& map)
{
    auto worn = tvg::Shape::gen(), stone = tvg::Shape::gen(), joints = tvg::Shape::gen(), plans = tvg::Shape::gen(), torn = tvg::Shape::gen();
    std::vector<std::vector<Point>> spans;
    for (const auto& road : network.roads()) {
        auto course = wornCourse(road);
        auto laid = stretch(course, road.laidEnd(), true);
        if (road.laidEnd() > 0) laid = stretch(laid, road.laidBegin() / road.laidEnd(), false);
        if (road.built <= 0) laid.clear();
        float pavedShare = road.paved ? 1 : road.paving >= 0 ? road.paving : 0;
        if (road.wear >= 1) appendLine(torn, laid);  // Rutted and broken until mended.
        else appendLine(worn, stretch(laid, pavedShare, false));
        if (pavedShare > 0 && road.wear < 1) {
            appendLine(stone, stretch(course, pavedShare, true));
            appendLine(joints, stretch(course, pavedShare, true));
        }
        if (road.laidBegin() > 0) appendLine(plans, stretch(course, road.laidBegin(), true));
        if (road.laidEnd() < 1) appendLine(plans, stretch(course, road.laidEnd(), false));
        // Where the laid road crosses water it becomes a bridge.
        std::vector<Point> run;
        auto close = [&] {
            if (run.size() >= 2) spans.push_back(run);
            run.clear();
        };
        for (size_t i = 0; i < laid.size(); ++i) {
            bool wet = map.terrainAt(laid[i]) == Terrain::Water;
            if (wet && run.empty() && i) run.push_back(laid[i - 1]);  // Start on the bank.
            if (wet || !run.empty()) run.push_back(laid[i]);
            if (!wet && run.size() > 1) close();
        }
        close();
    }
    auto style = [&](tvg::Shape* shape, float width, Rgba color) {
        shape->strokeWidth(width);
        shape->strokeCap(tvg::StrokeCap::Round);
        shape->strokeJoin(tvg::StrokeJoin::Round);
        shape->strokeFill(color.r, color.g, color.b, color.a);
        scene->add(shape);
    };
    style(worn, .46f, opaque(dirt));
    style(stone, .5f, opaque(cobble));
    float setts[] = {.07f, .1f};  // Rows of cobbles across the road.
    joints->strokeDash(setts, 2);
    style(joints, .36f, opaque(cobbleJoint));
    float ruts[] = {.3f, .22f};
    torn->strokeDash(ruts, 2);
    style(torn, .4f, {98, 76, 52, 200});
    float marks[] = {.22f, .16f};
    plans->strokeDash(marks, 2);
    style(plans, .07f, {214, 186, 120, 190});
    // Bridges: shadow on the water, a plank deck, rails and posts on both sides.
    auto shadow = tvg::Shape::gen(), deck = tvg::Shape::gen(), planks = tvg::Shape::gen(), rails = tvg::Shape::gen(), posts = tvg::Shape::gen();
    for (const auto& span : spans) {
        std::vector<Point> sunk, left, right;
        for (size_t i = 0; i < span.size(); ++i) {
            auto ahead = normalized(span[std::min(i + 1, span.size() - 1)] - span[i ? i - 1 : 0]);
            Point side{-ahead.y * .27f, ahead.x * .27f};
            sunk.push_back(span[i] + Point{.12f, .12f});
            left.push_back(span[i] + side);
            right.push_back(span[i] - side);
        }
        appendLine(shadow, sunk);
        appendLine(deck, span);
        appendLine(planks, span);
        appendLine(rails, left);
        appendLine(rails, right);
        float walked = 0, next = 0;
        for (size_t i = 0; i < span.size(); ++i) {
            if (i) walked += distance(span[i - 1], span[i]);
            if (walked < next) continue;
            next = walked + .7f;
            for (auto p : {left[i], right[i]}) posts->appendCircle(p.x, p.y, .08f, .08f);
        }
    }
    auto plank = [&](tvg::Shape* shape, float width, Rgba color) {
        shape->strokeWidth(width);
        shape->strokeCap(tvg::StrokeCap::Butt);
        shape->strokeJoin(tvg::StrokeJoin::Round);
        shape->strokeFill(color.r, color.g, color.b, color.a);
        scene->add(shape);
    };
    plank(shadow, .62f, {6, 10, 16, 140});
    plank(deck, .52f, opaque(Rgb{132, 98, 64}));
    float boards[] = {.035f, .07f};
    planks->strokeDash(boards, 2);
    plank(planks, .5f, opaque(Rgb{88, 62, 40}));
    style(rails, .08f, opaque(Rgb{74, 52, 34}));
    fill(posts, opaque(Rgb{54, 38, 26}));
    scene->add(posts);
}

Point frontOf(const Building& building) { return rotated({0, 1}, building.angle); }

// Depth row of a footprint: its front-most corner, matching the per-tile rows of trees.
int rowOf(const Footprint& footprint, int rows)
{
    float front = -1e9f;
    for (auto p : footprint.corners()) front = std::max(front, p.x + p.y);
    return std::clamp(int(std::floor(front + .01f)) - 2, 0, rows - 1);
}


int rowOf(Point p, int rows) { return std::clamp(int(std::floor(p.x + p.y)) - 1, 0, rows - 1); }

Footprint giantFootprint(const Giant& giant) { return {giant.center(), Giant::size / 2.f, 0}; }
Footprint volcanoFootprint(const Volcano& volcano) { return {volcano.center(), Volcano::size / 2.f, 0}; }

// A footprint's draw row. In front of Ymir's dais or the volcano's foot, within the screen column it spans, a
// building draws no earlier than their row (and after them in it), so neither paints over it.
int drawRow(const WorldMap& map, const Footprint& footprint, int rows)
{
    int row = rowOf(footprint, rows);
    float low = 1e9f, high = -1e9f;
    for (auto p : footprint.corners()) {
        low = std::min(low, p.x - p.y);
        high = std::max(high, p.x - p.y);
    }
    float u = footprint.center.x - footprint.center.y, s = footprint.center.x + footprint.center.y;
    auto before = [&](const Footprint& stone, float half) {
        float column = stone.center.x - stone.center.y;
        if (high <= column - half || low >= column + half) return;  // Beside its column.
        float front = stone.center.x + stone.center.y + half - std::min(std::abs(u - column), half);  // Its near faces.
        if (s > front) row = std::max(row, rowOf(stone, rows));
    };
    if (const auto& giant = map.giant()) before(giantFootprint(*giant), float(Giant::size));
    if (const auto& volcano = map.volcano()) before(volcanoFootprint(*volcano), float(Volcano::size));
    return row;
}

// The row a walker draws in. Diagonal rows alone misjudge big or turned buildings, so near one we
// compare against its actual footprint along the walker's screen column (u = x - y): in front of
// the footprint's near edge draws after the building, anywhere behind it draws before.
int standingRow(const Town& town, Point p, int rows)
{
    int row = rowOf(p, rows);
    float u = p.x - p.y, s = p.x + p.y;
    // Each nearby building whose blocking footprint shares the walker's screen column says whether the
    // walker is in front of it (draw after its row) or behind it (draw before). When two disagree,
    // the nearer building wins, since it is the one that can actually overlap the walker.
    int atLeast = -1, atMost = rows;
    float nearestFront = 1e9f, nearestBehind = 1e9f;
    auto weigh = [&](const Footprint& footprint, float size) {
        float gap = distance(footprint.center, p);
        if (gap > size + 1.5f) return;
        auto corners = footprint.corners();
        float front = -1e9f, back = 1e9f;
        for (size_t i = 0; i < corners.size(); ++i) {
            auto a = corners[i], b = corners[(i + 1) % corners.size()];
            float ua = a.x - a.y, ub = b.x - b.y;
            if ((u < std::min(ua, ub)) || (u > std::max(ua, ub)) || ua == ub) continue;
            float t = (u - ua) / (ub - ua), edge = (a.x + a.y) + ((b.x + b.y) - (a.x + a.y)) * t;
            front = std::max(front, edge);
            back = std::min(back, edge);
        }
        if (front < back) return;  // Not in this building's screen column.
        int own = drawRow(town.map(), footprint, rows);
        if (s >= front - .02f) {
            atLeast = std::max(atLeast, own);
            nearestFront = std::min(nearestFront, gap);
        } else if (s > back - 1.5f) {
            atMost = std::min(atMost, own - 1);
            nearestBehind = std::min(nearestBehind, gap);
        }
    };
    for (const auto& building : town.buildings()) weigh(building.footprint(), float(structureSpec(building.kind).size));
    // Ymir's dais and the volcano's foot stand among the buildings like two of them.
    if (const auto& giant = town.map().giant()) weigh(giantFootprint(*giant), float(Giant::size));
    if (const auto& volcano = town.map().volcano()) weigh(volcanoFootprint(*volcano), float(Volcano::size));
    if (atLeast <= atMost) row = std::clamp(row, std::max(atLeast, 0), std::min(atMost, rows - 1));
    else row = nearestFront <= nearestBehind ? atLeast : atMost;
    return std::clamp(row, 0, rows - 1);
}
}  // namespace

WorldRenderer::WorldRenderer()
    : root(tvg::Scene::gen()), world(tvg::Scene::gen()), ground(isoLayer()), farmland(isoLayer()), fog(isoLayer()), roads(isoLayer()), lights(tvg::Scene::gen()), objects(tvg::Scene::gen()),
      effects(tvg::Scene::gen()), overlay(tvg::Scene::gen()), background(tvg::Shape::gen()), vignette(tvg::Scene::gen()), darkness(tvg::Scene::gen()),
      warmth(tvg::Scene::gen()), memory(isoLayer()), clouds(tvg::Scene::gen()), sunlight(tvg::Scene::gen()), ornaments(tvg::Scene::gen()), combat(tvg::Scene::gen()), prints(isoLayer()),
      overcast(tvg::Shape::gen()), precipitation(tvg::Shape::gen())
{
    root->ref();
    root->add(background);
    root->add(world);
    root->add(overcast);
    root->add(vignette);
    // Night darkens everything but the pools that lamps, fires and windows light; glows sit on the ground.
    for (tvg::Paint* layer : std::initializer_list<tvg::Paint*>{ground, farmland, ornaments, roads, prints, lights, objects, effects, sunlight, clouds, darkness, warmth, memory, fog, combat, mapName, storm}) world->add(layer);
    world->add(precipitation);
    world->add(overlay);
    warmth->blend(tvg::BlendMethod::Screen);
    // Daylight over the whole world, so fair days look sunny and shadows read (see sunPassSpecs).
    for (const auto& spec : sunPassSpecs) {
        auto pass = tvg::Shape::gen();
        pass->appendRect(0, 0, 1, 1);  // Fitted to the view each frame.
        pass->fill(spec.r, spec.g, spec.b, spec.alpha);
        sunlight->add(blendLayer(pass, spec.method));
        sunPasses.push_back(pass);
    }
}

bool WorldRenderer::renew(Landmark& landmark, uint64_t key)
{
    if (landmark.paint && landmark.key == key) return false;
    release(landmark);
    landmark.paint = tvg::Scene::gen();
    landmark.paint->ref();
    landmark.key = key;
    return true;
}

void WorldRenderer::release(Landmark& landmark)
{
    if (landmark.paint) landmark.paint->unref();
    landmark = {};
}

WorldRenderer::~WorldRenderer()
{
    release(ymirPaint);
    release(volcanoPaint);
    root->unref();
    for (auto& [id, sprite] : sprites) sprite.paint->unref();
    for (auto& [id, figure] : figures) figure.paint->unref();
    for (auto& [id, beast] : beasts) beast.paint->unref();
    for (auto& [id, item] : visuals) {
        item.picture->unref(false);
        item.animation.reset();
    }
    for (auto& tree : fallingTrees) tree.paint->unref();
}

bool WorldRenderer::animating() const
{
    return !fallingTrees.empty() || std::any_of(visuals.begin(), visuals.end(), [](const auto& entry) { return entry.second.frame < entry.second.layout.frames; });
}

void WorldRenderer::invalidateMap()
{
    for (auto& tree : fallingTrees) { detach(rows[size_t(tree.row)], tree.paint); tree.paint->unref(); }
    fallingTrees.clear(); seenTreeEvent = 0;
    release(ymirPaint);
    release(volcanoPaint);
    nameDirty = true;
    clear(ground); groundTints.clear(); groundChunks.clear(); overviewChunks.clear(); detailedGround = overviewGround = nullptr; groundWidth = groundHeight = 0;
    clear(ornaments); ornamentLook = ~0ull;
    for (auto& entry : sprites) entry.second.row = -1;
    for (auto& entry : figures) { entry.second.row = -1; entry.second.last = {-1, -1}; }
    for (auto& entry : beasts) entry.second.row = -1;
    clear(objects); rows.clear(); rowTrees.clear(); rowBuildings.clear(); rowLamps.clear(); treeKeys.clear(); treeBounds.clear();
    clear(fog); clear(memory); visibilityPicture = nullptr; fogBorder = nullptr;
    exploredVisibility = {}; currentVisibility = {}; figureVisibility = {}; visibilityPixels.clear(); vision.clear();
    clear(combat); damageBack = damageLeft = nullptr; sparks.clear(); nextSpark = 0;
    clear(prints); footprints.clear(); lastStep.clear(); printsAt = -1;
    revision = roadRevision = ~uint64_t(0); climateKey = -1; sightCount = ~size_t(0);
}

void WorldRenderer::invalidateTerrain(TileRegion area)
{
    nameDirty = true;  // Painting the sea under Midgard's name moves it.
    bool whole = area.left <= 0 && area.top <= 0 && area.right >= groundWidth && area.bottom >= groundHeight;
    for (auto& chunk : groundChunks)
        if (chunk.area.intersects(area)) { chunk.dirty = true; chunk.edited = !whole; }
    if (whole) for (auto& chunk : overviewChunks) chunk.dirty = true;
    int first = std::max(0, area.left + area.top), last = std::min(int(treeKeys.size()), area.right + area.bottom);
    for (int row = first; row < last; ++row) treeKeys[size_t(row)] = ~0ull;
    revision = roadRevision = ~uint64_t(0); ornamentLook = ~0ull;
}

void WorldRenderer::finishTerrainEdits()
{
    if (std::count_if(groundChunks.begin(), groundChunks.end(), [](const auto& chunk) { return chunk.edited; }) < 32) return;
    for (auto& chunk : overviewChunks) chunk.dirty = true;
}

void WorldRenderer::updateGroundChunks(const WorldMap& map, const Climate& climate, bool recolor)
{
    groundWidth = map.width(); groundHeight = map.height();
    bool overview = view.zoom < .25f;
    if (!overviewGround) {
        overviewGround = tvg::Scene::gen(); detailedGround = tvg::Scene::gen();
        ground->add(overviewGround); ground->add(detailedGround);
    }
    overviewGround->opacity(overview ? 255 : 0);
    auto initialize = [&](std::vector<GroundChunk>& chunks, tvg::Scene* group, int width, bool patches) {
        if (!chunks.empty()) return;
        int height = width / 2;
        int left = int(std::floor((-map.height() * tileHalfWidth - 1024) / width)) * width;
        int right = int(std::ceil((map.width() * tileHalfWidth + 1024) / width)) * width;
        int first = int(std::floor(-512.f / height)) * height;
        for (int y = first; y < (map.width() + map.height()) * tileHalfHeight + 512; y += height)
            for (int x = left; x < right; x += width) {
                auto scene = tvg::Scene::gen();
                tvg::Matrix projected{1.f / 64, 1.f / 32, 0, -1.f / 64, 1.f / 32, 0, 0, 0, 1};
                ui::setTransform(scene, projected);
                auto clip = tvg::Shape::gen(); clip->appendRect(float(x), float(y), width, height); clip->fill(255, 255, 255);
                // Clippers inherit the parent transform, independently of their scene.
                ui::setTransform(clip, projected); scene->clip(clip);
                if (patches) {
                    auto sea = tvg::Shape::gen(); sea->appendRect(float(x), float(y), width, height); sea->fill(11, 18, 27);
                    scene->add(sea);
                }
                auto terrain = isoLayer(); scene->add(terrain); group->add(scene);
                auto a = unproject(float(x), float(y)), b = unproject(float(x + width), float(y + height));
                auto c = unproject(float(x + width), float(y)), d = unproject(float(x), float(y + height));
                chunks.push_back({{int(std::floor(a.x)), int(std::floor(c.y)), int(std::ceil(b.x)), int(std::ceil(d.y))},
                                  {float(x), float(y), float(width), float(height)}, scene, terrain, {}, true, false});
            }
    };
    initialize(groundChunks, detailedGround, 512, true);
    if (overview && overviewChunks.empty()) {
        // The terrain painter retains only region boundaries. One uncut overview avoids
        // repeating those contours and river clips in many large compositing surfaces.
        auto terrain = tvg::Scene::gen(); overviewGround->add(terrain);
        overviewChunks.push_back({{0, 0, map.width(), map.height()},
                                  {-map.height() * tileHalfWidth - 1024, -512,
                                   (map.width() + map.height()) * tileHalfWidth + 2048,
                                   (map.width() + map.height()) * tileHalfHeight + 1024},
                                  terrain, terrain, {}, true, false});
    }
    float left = view.x - viewWidth / 2 / view.zoom - 8, right = view.x + viewWidth / 2 / view.zoom + 8;
    float top = view.y - viewHeight / 2 / view.zoom - 8, bottom = view.y + viewHeight / 2 / view.zoom + 8;
    auto update = [&](std::vector<GroundChunk>& chunks, bool patchesOnly, bool wholeMap = false) {
        for (auto& chunk : chunks) {
            const auto& a = chunk.area; const auto& b = chunk.bounds;
            bool visible = (!patchesOnly || chunk.edited) && b.x + b.w >= left && b.x <= right && b.y + b.h >= top && b.y <= bottom;
            chunk.scene->opacity(visible ? 255 : 0);
            if (visible && chunk.dirty) {
                clear(chunk.terrain);
                TileRegion padding{a.left - 2, a.top - 2, a.right + 2, a.bottom + 2};
                chunk.tints = paintGround(chunk.terrain, map, wholeMap ? nullptr : &padding);
                tintGround(chunk.tints, climate); chunk.dirty = false;
                if (wholeMap) for (auto& detail : groundChunks) detail.edited = false;
            } else if (recolor && !chunk.tints.empty()) tintGround(chunk.tints, climate);
        }
    };
    // Small opaque patches update an overview without rebuilding its large cached regions.
    if (overview) update(overviewChunks, false, true);
    else if (recolor)
        for (const auto& chunk : overviewChunks) tintGround(chunk.tints, climate);
    update(groundChunks, overview);
}

void WorldRenderer::resize(float width, float height)
{
    if (width == viewWidth && height == viewHeight) return;
    viewWidth = width;
    viewHeight = height;
    background->reset();
    background->appendRect(0, 0, width, height);
    background->fill(11, 18, 27);  // Open sea.
    overcast->reset();
    overcast->appendRect(0, 0, width, height);
    // A soft darkening toward the corners; the software path redraws in full, so the gradient no
    // longer accumulates and needs no stepped bands.
    clear(vignette);
    auto frame = tvg::Shape::gen();
    frame->appendRect(0, 0, width, height);
    auto falloff = tvg::RadialGradient::gen();
    float reach = std::hypot(width, height) / 2;
    falloff->radial(width / 2, height / 2, reach, width / 2, height / 2, 0);
    tvg::Fill::ColorStop stops[] = {{0, 5, 6, 10, 0}, {.62f, 5, 6, 10, 0}, {1, 5, 6, 10, 110}};
    falloff->colorStops(stops, 3);
    frame->fill(falloff);
    vignette->add(frame);
}

int WorldRenderer::buildingDrawnAt(const Town& town, Point at) const
{
    int found = -1;
    float front = -1e30f;
    for (const auto& building : town.buildings()) {
        auto item = visuals.find(building.id);
        if (item == visuals.end() || !item->second.picture) continue;
        float left = 1e30f, right = -1e30f, bottom = -1e30f;
        for (auto corner : building.footprint().corners()) {
            auto p = project(corner.x, corner.y);
            left = std::min(left, p.x); right = std::max(right, p.x); bottom = std::max(bottom, p.y);
        }
        auto anchor = project(building.corner().x, building.corner().y);
        float top = std::min(anchor.y - item->second.layout.originY, bottom);
        if (at.x < left || at.x > right || at.y < top || at.y > bottom) continue;
        float depth = project(building.center.x, building.center.y).y;
        if (depth > front) { front = depth; found = building.id; }
    }
    return found;
}

void WorldRenderer::lightning(const Strike& next)
{
    strike = next;
    struck = view.toWorld({next.across * viewWidth, next.down * viewHeight}, viewWidth, viewHeight);
}

void WorldRenderer::paintStorm(double seconds, float night)
{
    clear(storm);
    if (!strike) return;
    float t = float(seconds - strike->at);
    if (t > .9f) strike.reset();
    if (t < 0 || t > .9f) return;
    // Two quick flickers, then the light dies away; it shows far stronger at night.
    float pulse = t < .05f ? 1 : t < .1f ? .3f : t < .16f ? .9f : std::exp(-(t - .16f) / .14f);
    float strength = std::min(1.f, strike->brightness * pulse * (.55f + .45f * night));
    float halfWidth = viewWidth / 2 / view.zoom, halfHeight = viewHeight / 2 / view.zoom, pixel = 1 / view.zoom;
    // A cold sheet of light over the land, brightest towards where it struck, in view or beyond it.
    auto sheet = tvg::Shape::gen();
    sheet->appendRect(view.x - halfWidth, view.y - halfHeight, 2 * halfWidth, 2 * halfHeight);
    fill(sheet, opaque(Rgb{214, 224, 255}, uint8_t(95 * strength)));
    storm->add(sheet);
    storm->add(glow(struck, halfWidth * 1.5f, halfHeight * 1.3f, {236, 240, 255}, uint8_t(160 * strength)));
    bool inView = strike->across >= 0 && strike->across <= 1;
    if (strike->reach > Strike::Reach::Middle || !inView || t >= .26f) return;
    // The bolt: from the clouds above the view down to where it strikes, jagged, forking, white in pale blue.
    auto seed = strike->seed;
    Point top{struck.x + (hash01(seed, 1, 0, 0xb017u) - .5f) * halfWidth * .4f, view.y - halfHeight - 60 * pixel};
    float reach = distance(top, struck), sway = 0;
    constexpr int steps = 14;
    std::vector<Point> path{top};
    for (int i = 1; i < steps; ++i) {
        sway = sway * .6f + (hash01(seed, i, 1, 0xb017u) - .5f) * reach * .09f;
        path.push_back(lerp(top, struck, float(i) / steps) + Point{sway, 0});
    }
    path.push_back(struck);
    auto outer = tvg::Shape::gen(), core = tvg::Shape::gen();
    appendStrip(outer, path, 5 * pixel, 8 * pixel);
    appendStrip(core, path, 1.6f * pixel, 3 * pixel);
    for (int k = 0; k < 2; ++k) {
        std::vector<Point> fork{path[size_t(4 + hash01(seed, k, 2, 0xb017u) * 6)]};
        float side = k ? 1.f : -1.f;
        for (int i = 1; i <= 5; ++i) fork.push_back(fork.back() + Point{side * reach * (.02f + .03f * hash01(seed, k * 8 + i, 3, 0xb017u)), reach * .045f});
        appendStrip(outer, fork, 3 * pixel, .5f * pixel);
        appendStrip(core, fork, pixel, .3f * pixel);
    }
    fill(outer, opaque(Rgb{168, 186, 255}, uint8_t(220 * pulse)));
    fill(core, opaque(Rgb{255, 255, 255}, uint8_t(255 * std::min(1.f, pulse * 1.2f))));
    storm->add(outer);
    storm->add(core);
    // A soft burst of light on the ground where it strikes, white at its heart.
    storm->add(glow(struck, 70 * pixel, 30 * pixel, {236, 242, 255}, uint8_t(230 * pulse)));
    storm->add(ellipse(struck, 9 * pixel, 4 * pixel, opaque(Rgb{255, 255, 255}, uint8_t(255 * pulse))));
}

void WorldRenderer::update(const Town& town, const Traffic& traffic, const Camera& camera, float width, float height, double seconds, const Preview& preview,
                           const std::vector<int>& selected)
{
    resize(width, height);
    this->view = camera;
    fitToView();
    tvg::Matrix view{camera.zoom, 0, width / 2 - camera.x * camera.zoom, 0, camera.zoom, height / 2 - camera.y * camera.zoom, 0, 0, 1};
    ui::setTransform(world, view);
    paintMapName(town.map(), camera.zoom);
    // Seasons and snow change the ground in small steps, so a gradual change repaints rarely.
    const auto& climate = town.climate();
    paintStorm(seconds, climate.night);
    int key = int(climate.summer * 8) | int(climate.autumn * 8) << 4 | int(climate.snow * 10) << 8 | int(climate.frost * 4) << 12;
    if (editorView) updateGroundChunks(town.map(), climate, key != climateKey);
    auto generation = buildingCatalogGeneration();
    bool objectsChanged = town.objectRevision() != revision || key != climateKey || generation != appearanceGeneration;
    bool roadsChanged = town.roadRevision() != roadRevision;
    if (objectsChanged) {
        appearanceGeneration = generation;
        revision = town.objectRevision();
        syncVisuals(town, seconds);
        if (!editorView && groundTints.empty()) groundTints = paintGround(ground, town.map());
        if (key != climateKey) {
            climateKey = key;
            tintGround(groundTints, climate);
        }
        clear(farmland);
        paintFields(farmland, town);
        buildObjects(town, climate);
    }
    if (roadsChanged) {
        roadRevision = town.roadRevision();
        clear(roads);
        paintRoads(roads, town.roads(), town.map());
    }
    if (objectsChanged || roadsChanged) {
        bool lightsChanged = buildRoadLights(town, traffic, objectsChanged);
        if (lightsChanged) {
            if (!editorView) buildDarkness(town.map());
            else { lastFlicker = -1; animate(town, 0); }
        }
        shownPreview = {};
        shownPreview.zoom = -1;  // Force the overlay to refresh after a rebuild.
    }
    if (!(preview == shownPreview)) {
        shownPreview = preview;
        buildPreview(preview);
    }
    cullTrees();
    if (editorView) {
        float top = camera.y - height / 2 / camera.zoom, bottom = camera.y + height / 2 / camera.zoom;
        for (size_t i = 0; i < rows.size(); ++i) {
            float base = (i + 1) * tileHalfHeight;
            // Ymir's and the volcano's rows reach far up: each baseline lies below its feet.
            float reach = int(i) == ymirRow ? ymirHeight + 6 * tileHalfHeight : int(i) == fireRow ? volcanoHeight + volcanoSmoke + 12 * tileHalfHeight : 140;
            uint8_t opacity = base + 32 >= top && base - reach <= bottom ? 255 : 0;
            rowBuildings[i]->opacity(opacity); rowLamps[i]->opacity(opacity); rows[i]->opacity(opacity);
        }
        fog->opacity(0); memory->opacity(0); darkness->opacity(0); warmth->opacity(0);
        clouds->opacity(0); overcast->opacity(0); precipitation->opacity(0);
        if (sceneView) moveAgents(town, traffic, 0, selected);
        return;
    }
    updateVision(town);
    tread(town, seconds);
    sparkle(town, seconds);
    markDamage(town);
    moveAgents(town, traffic, seconds, selected);
    updateFelling(town);
    animate(town, seconds);
}

void WorldRenderer::syncVisuals(const Town& town, double seconds)
{
    for (auto it = visuals.begin(); it != visuals.end();) {
        auto* building = town.building(it->first);
        if (building && building->version == it->second.version && building->center == it->second.center && building->angle == it->second.angle) { ++it; continue; }
        detach(objects, it->second.picture);
        it->second.picture->unref(false);
        it->second.animation.reset();
        it = visuals.erase(it);
    }
    for (const auto& building : town.buildings()) {
        std::vector<uint64_t> appearances{buildingAppearanceRevision(building.kind)};
        for (const auto& stage : building.replaced) appearances.push_back(buildingAppearanceRevision(stage.kind));
        auto& item = visuals[building.id];
        bool retained = bool(item.animation);
        if (retained && item.appearances == appearances) continue;
        bool complete = retained && item.frame >= item.layout.frames;
        float fraction = retained && item.layout.frames > 0 ? item.frame / item.layout.frames : 0;
        // Build the replacement before releasing the accepted animation.
        auto layout = riseAnimation(building.kind, building.variant, building.replaced, building.angle);
        auto animation = std::unique_ptr<tvg::Animation>(tvg::Animation::gen());
        auto picture = animation->picture();
        if (picture->load(layout.json.data(), uint32_t(layout.json.size()), "lottie+json", nullptr, true) != tvg::Result::Success)
            throw std::runtime_error("Cannot load building animation: " + std::string(buildingAssetId(building.kind)));
        std::string{}.swap(layout.json);
        if (retained) {
            detach(objects, item.picture);
            item.picture->unref(false);
        }
        item.animation = std::move(animation);
        item.picture = picture;
        item.picture->ref();
        item.layout = std::move(layout);
        item.version = building.version;
        item.center = building.center;
        item.angle = building.angle;
        item.appearances = std::move(appearances);
        item.start = seconds;
        item.frame = sceneView && building.built() ? item.layout.frames
                   : !building.built() ? building.progress * item.layout.frames * .92f
                   : complete ? item.layout.frames : fraction * item.layout.frames;
        item.animation->frame(std::min(item.frame, item.layout.frames - 1));
        auto corner = building.corner();
        auto anchor = project(corner.x, corner.y);
        item.picture->translate(anchor.x - item.layout.originX, anchor.y - item.layout.originY);
    }
}

void WorldRenderer::buildObjects(const Town& town, const Climate& climate)
{
    clear(lights);
    clear(effects);
    pools.clear();
    pulses.clear();
    ymirGlints = {};
    ymirRow = -1;
    fireRow = -1;
    wisps.clear();
    wispPaints.clear();
    flame = flameCore = nullptr;
    const auto& map = town.map();
    int count = map.width() + map.height() - 1;
    // Rows persist: buildings, then trees, then the holder for moving sprites. Only what changed is rebuilt.
    if (rows.empty()) {
        for (int row = 0; row < count; ++row) {
            for (auto* list : {&rowBuildings, &rowLamps, &rowTrees, &rows}) {
                list->push_back(tvg::Scene::gen());
                objects->add(list->back());
            }
        }
        treeKeys.assign(size_t(count), ~0ull);
        treeBounds.resize(size_t(count));
    }
    for (auto* scene : rowBuildings) clear(scene);
    std::vector<std::vector<const Building*>> buildingRows(static_cast<size_t>(count));
    for (const auto& building : town.buildings()) buildingRows[size_t(drawRow(map, building.footprint(), count))].push_back(&building);
    std::vector<std::vector<const Dungeon*>> dungeonRows(static_cast<size_t>(count));
    for (const auto& site : map.dungeons())
        if (site.discovered) dungeonRows[size_t(std::min(count - 1, site.origin.x + site.origin.y + 2))].push_back(&site);
    const auto& giant = map.giant();
    int giantRow = giant && map.revealed(giant->center()) ? rowOf(giantFootprint(*giant), count) : -1;
    const auto& volcano = map.volcano();
    int volcanoRow = volcano && map.revealed(volcano->center()) ? rowOf(volcanoFootprint(*volcano), count) : -1;
    auto spring = map.hvergelmir();
    int springRow = map.revealed(spring) && isWater(map.terrainAt(spring)) ? std::min(count - 1, int(spring.x) + int(spring.y)) : -1;

    bool snowy = climate.snow > .3f;
    uint64_t look = uint64_t(climate.autumn * 8) << 1 | uint64_t(climate.snow * 8) << 5 | uint64_t(snowy);
    // The ornaments follow the season, and Hvergelmir's chasm shows the moment it is found.
    if (uint64_t ornamentKey = look | uint64_t(springRow >= 0) << 40; ornamentKey != ornamentLook) {
        ornamentLook = ornamentKey;
        paintOrnaments(map, climate);
    }
    for (int row = 0; row < count; ++row) {
        auto* here = rowBuildings[size_t(row)];
        // Ymir first in his row: buildings that share it stand in front of his dais.
        // Ymir and the volcano first in their rows, kept from one rebuild to the next while they look the same.
        if (row == giantRow) {
            auto heart = giant->center();
            bool inWater = isWater(map.terrainAt({heart.x + 4.6f, heart.y + 4.6f}));  // Just before his front corner.
            uint64_t key = uint64_t(climate.snow > .3f) | uint64_t(inWater) << 1 | uint64_t(uint32_t(giant->origin.x)) << 8 | uint64_t(uint32_t(giant->origin.y)) << 32;
            if (renew(ymirPaint, key)) ymirLight = paintYmir(ymirPaint.paint, project(heart.x, heart.y), climate, inWater);
            here->add(ymirPaint.paint);
            lightYmir(lights, project(heart.x, heart.y));
            addPool({ymirLight.dais, 190, 95, {}, Flicker::Magic});
            for (auto eye : ymirLight.eyes) addPool({eye, 9, 6, {}, Flicker::Magic});
            ymirGlints = {ymirLight.glints[0], ymirLight.glints[1]};
            ymirRow = row;
        }
        if (row == volcanoRow) {
            auto heart = volcano->center();
            uint64_t key = uint64_t(map.seed()) | uint64_t(uint32_t(volcano->origin.x)) << 32 | uint64_t(uint32_t(volcano->origin.y)) << 48;
            if (renew(volcanoPaint, key)) volcanoLight = paintVolcano(volcanoPaint.paint, project(heart.x, heart.y), map.seed());
            here->add(volcanoPaint.paint);
            lightVolcano(lights, volcanoLight);
            addPool({volcanoLight.crater, 260, 130, {200, 80, 30}, Flicker::Fire});
            for (auto flow : volcanoLight.flows) addPool({flow, 70, 35, {170, 64, 26}, Flicker::Hearth});
            fireRow = row;
        }
        if (row == springRow) {
            // Hvergelmir's deep glows cold through the night.
            auto deep = project(spring.x, spring.y) + Point{0, 30};
            lights->add(glow(deep, 170, 70, {90, 190, 230}, 46));
            addPool({deep, 180, 80, {}, Flicker::Magic});
        }
        for (const auto* building : buildingRows[size_t(row)]) {
            here->add(visuals.at(building->id).picture);
            int size = structureSpec(building->kind).size;
            Point middle = building->center;
            if (building->kind == Structure::Camp && building->built()) {
                auto ox = building->corner().x, oy = building->corner().y;
                firePosition = project(ox + .62f, oy + .86f);
                auto* fireGlow = glow(firePosition, 80, 40, {236, 140, 56}, 50);
                lights->add(fireGlow);
                addPool({firePosition, 120, 60, {160, 96, 40}, Flicker::Fire, fireGlow});
                for (int i = 0; i < 6; ++i) {
                    float angle = i * 1.047f;
                    here->add(ellipse({firePosition.x + std::cos(angle) * 6, firePosition.y + std::sin(angle) * 3}, 2, 1.4f, {70, 66, 70}));
                }
                flame = tvg::Shape::gen();
                flameCore = tvg::Shape::gen();
                here->add(flame);
                here->add(flameCore);
                lastFlicker = -1;
            } else if (!building->built()) {
                continue;
            } else if (building->kind == Structure::Shrine || building->kind == Structure::MageTower || building->kind == Structure::Portal) {
                bool tower = building->kind != Structure::Shrine;
                auto* aura = glow(project(middle.x, middle.y), 40, 20, tower ? violetWisp : arcaneWisp, 60);
                lights->add(aura);
                addPool({project(middle.x, middle.y), 70, 35, {}, Flicker::Magic, aura});
                for (int i = 0; i < 3; ++i) wisps.push_back({project(middle.x, middle.y), tower ? violetWisp : arcaneWisp, 18.f + i * 6});
            } else if (isHome(building->kind) || isMarket(building->kind) || building->kind == Structure::Tavern || isLodging(building->kind) || building->kind == Structure::Guild || building->kind == Structure::GuildHall || building->kind == Structure::Chapel || isOutfitter(building->kind) || isSeat(building->kind)) {
                // Warm window light spilling onto the ground.
                auto spill = middle + frontOf(*building) * (size / 2.f + .1f);
                auto* windowGlow = glow(project(spill.x, spill.y), 28.f * size, 14.f * size, warmLight, 30);
                lights->add(windowGlow);
                addPool({project(spill.x, spill.y), 42.f * size, 22.f * size, {100, 70, 40}, Flicker::Hearth, windowGlow});
            }
        }
        for (const auto* site : dungeonRows[size_t(row)]) {
            if (auto* pulse = dungeonSprite(here, lights, *site)) pulses.push_back(pulse);
            addPool({project(site->origin.x + 1.f, site->origin.y + 1.f), 90, 45, {}, Flicker::Magic});
            Rgb tint = site->kind == DungeonKind::Cave ? arcaneWisp : site->kind == DungeonKind::Ruin ? Rgb{170, 250, 130} : violetWisp;
            for (int i = 0; i < 3; ++i) wisps.push_back({project(site->origin.x + 1.f, site->origin.y + 1.f), tint, 30.f + i * 10});
        }
        // Steam boils up off the sea where a lava run pours into it over the shore behind (only a run burns hot
        // enough to reach the edge), in a plume or two at each fall.
        for (int x = std::max(0, row - map.height() + 1); x <= std::min(row, map.width() - 1); ++x) {
            int y = row - x;
            if (map.at(x, y).terrain != Terrain::Sea || !map.at(x, y).revealed || hash01(map.seed(), x, y, 851) > .5f) continue;
            auto pours = [&](int lx, int ly) { return lx >= 0 && ly >= 0 && map.at(lx, ly).terrain == Terrain::Lava && map.value(Layer::Heat, {lx + .5f, ly + .5f}) >= 1.5f; };
            if (pours(x - 1, y) || pours(x, y - 1)) paintSteam(here, project(x + .35f, y + .35f), map.seed() ^ uint32_t(x * 73856093) ^ uint32_t(y * 19349663));
        }
        // Lava lights the night around it; one glow every third tile lights a field without a pool per tile.
        for (int x = std::max(0, row - map.height() + 1); x <= std::min(row, map.width() - 1); ++x) {
            int y = row - x;
            if (x % 3 || y % 3 || !map.at(x, y).revealed || map.at(x, y).terrain != Terrain::Lava) continue;
            auto at = project(x + .5f, y + .5f);
            auto* heat = glow(at, 96, 48, {255, 120, 40}, 42);  // Wide enough that neighbours run together.
            lights->add(heat);
            addPool({at, 120, 60, {150, 60, 24}, Flicker::Hearth, heat});
        }
        // Trees and boulders: only rebuilt when this row's trees or the season's look change.
        uint64_t key = look;
        for (int x = std::max(0, row - map.height() + 1); x <= std::min(row, map.width() - 1); ++x)
            key = key * 1099511628211ull ^ (map.at(x, row - x).trees | (uint64_t(map.at(x, row - x).quarried) << 8));
        if (key == treeKeys[size_t(row)]) continue;
        treeKeys[size_t(row)] = key;
        auto* trees = rowTrees[size_t(row)];
        clear(trees);
        TreeBatch woods(climate);
        PeakBatch peaks(climate);
        auto rockLit = tvg::Shape::gen(), rockShade = tvg::Shape::gen();
        for (int x = std::max(0, row - map.height() + 1); x <= std::min(row, map.width() - 1); ++x) {
            int y = row - x;
            const auto& tile = map.at(x, y);
            for (int i = 0; i < tile.trees; ++i) woods.add(treeAt(map, x, y, i));
            if (auto peak = peakAt(map, x, y)) peaks.add(*peak);
            if (mining::deposit(map, x, y)) {
                auto foot = mining::position(x, y), b = project(foot.x, foot.y);
                float s = mining::size(map, x, y);
                appendPolygon(rockLit, {{b.x - s, b.y}, {b.x - s * .3f, b.y - s * 1.1f}, {b.x + s * .2f, b.y + s * .2f}});
                appendPolygon(rockShade, {{b.x + s * .2f, b.y + s * .2f}, {b.x - s * .3f, b.y - s * 1.1f}, {b.x + s, b.y - s * .1f}});
            }
        }
        // Every tree and peak in a row stands on the same screen line, so one vertical gradient
        // per shape lights them all from above.
        float base = row * tileHalfHeight + tileHalfHeight;
        fill(rockLit, opaque(boulderLit));
        fill(rockShade, opaque(boulderShade));
        auto drawn = woods.finish(base);
        drawn.insert(drawn.end(), {rockLit, rockShade});
        auto ranges = peaks.finish(base);
        drawn.insert(drawn.end(), ranges.begin(), ranges.end());
        Point low{1e9f, 1e9f}, high{-1e9f, -1e9f};
        for (auto* shape : drawn) {
            trees->add(shape);
            const tvg::Point* points = nullptr; uint32_t size = 0;
            shape->path(nullptr, nullptr, &points, &size);
            for (uint32_t i = 0; i < size; ++i) {
                low.x = std::min(low.x, points[i].x); low.y = std::min(low.y, points[i].y);
                high.x = std::max(high.x, points[i].x); high.y = std::max(high.y, points[i].y);
            }
        }
        treeBounds[size_t(row)] = {low.x, low.y, std::max(0.f, high.x - low.x), std::max(0.f, high.y - low.y)};
    }
    for (const auto& wisp : wisps) {
        auto orb = tvg::Scene::gen();
        orb->add(ellipse({0, 0}, 5, 5, opaque(wisp.color, 50)));
        orb->add(ellipse({0, 0}, 2, 2, opaque(wisp.color)));
        effects->add(orb);
        wispPaints.push_back(orb);
    }
    buildingPools = pools.size();
    roadLights = tvg::Scene::gen();
    lights->add(roadLights);
}

void WorldRenderer::cullTrees()
{
    // The static path/control-point hull includes every tree and peak, independent of zoom.
    float padding = 2 / view.zoom;
    ui::Rect visible{view.x - viewWidth / 2 / view.zoom - padding, view.y - viewHeight / 2 / view.zoom - padding,
                     (viewWidth + 4) / view.zoom, (viewHeight + 4) / view.zoom};
    for (size_t i = 0; i < rowTrees.size(); ++i) {
        auto overlap = treeBounds[i].intersect(visible);
        rowTrees[i]->opacity(overlap.w > 0 && overlap.h > 0 ? 255 : 0);
    }
}

bool WorldRenderer::buildRoadLights(const Town& town, const Traffic& traffic, bool force)
{
    // Road progress moves the end lanterns without invalidating buildings, trees or their lights.
    std::vector<Point> junctions;
    for (size_t n = 0; n < traffic.graph().nodes().size(); ++n)
        if (traffic.graph().degree(n) != 2) junctions.push_back(traffic.graph().nodes()[n]);
    if (!force && junctions == lamps) return false;
    for (auto* row : rowLamps) clear(row);
    clear(roadLights);
    lamps = std::move(junctions);
    pools.resize(buildingPools);
    for (auto node : lamps) {
        auto row = rowLamps[size_t(rowOf(node, int(rowLamps.size())))];
        bool arcane = hash01(town.map().seed(), int(node.x * 7), int(node.y * 7), 77) < .5f;
        auto lamp = lantern(row, roadLights, project(node.x, node.y), arcane);
        addPool({project(node.x, node.y), 52, 26, {120, 90, 50}, arcane ? Flicker::Magic : Flicker::Flame, lamp.glow, lamp.halo, lamp.flame});
    }
    return true;
}

void WorldRenderer::paintMapName(const WorldMap& map, float zoom)
{
    // Lettered like a map, only once the view is wide enough to take in the land: 20 pixels tall on screen,
    // shrinking to 11 when the whole world fits.
    mapName->opacity(uint8_t(std::clamp((.9f - zoom) / .5f, 0.f, 1.f) * 255));
    if (nameDirty) {
        nameDirty = false;
        clear(mapName);
        lettering.reset();
        auto label = map.nameLabel();
        if (!label) return;
        auto name = tvg::Text::gen();
        if (name->font("DejaVuSans-Bold") != tvg::Result::Success) {
            delete name;
            return;
        }
        name->size(44);
        name->text("MIDGARD");
        name->fill(232, 224, 206);
        ui::Rect box;
        name->bounds(&box.x, &box.y, &box.w, &box.h);
        auto shadow = static_cast<tvg::Text*>(name->duplicate());
        shadow->fill(12, 14, 18);
        shadow->opacity(150);
        name->opacity(150);
        mapName->add(shadow);
        mapName->add(name);
        lettering = Lettering{name, shadow, project(label->x, label->y), box};
    }
    if (!lettering) return;
    float pixels = std::clamp(zoom * 60, 11.f, 20.f), scale = pixels / std::max(zoom, .01f) / 44;
    // A shadow a pixel down and right keeps the name legible over ice and snow.
    for (auto [text, shift] : {std::pair{lettering->shadow, 1.2f / std::max(zoom, .01f)}, std::pair{lettering->text, 0.f}}) {
        text->scale(scale);
        text->translate(lettering->at.x + shift - (lettering->box.x + lettering->box.w / 2) * scale, lettering->at.y + shift - (lettering->box.y + lettering->box.h / 2) * scale);
    }
}

void WorldRenderer::paintOrnaments(const WorldMap& map, const Climate& climate)
{
    // Flat things on the ground, under everyone's feet: wild flowers on lush grass and cracks in the ice.
    clear(ornaments);
    bool snowy = climate.snow > .3f;
    std::array<tvg::Shape*, 4> blooms{tvg::Shape::gen(), tvg::Shape::gen(), tvg::Shape::gen(), tvg::Shape::gen()};
    auto cracks = tvg::Shape::gen();
    for (int y = 0; y < map.height(); ++y)
        for (int x = 0; x < map.width(); ++x) {
            const auto& tile = map.at(x, y);
            if (!tile.revealed) continue;
            Point middle{x + .5f, y + .5f};
            if (tile.terrain == Terrain::Ice) {
                if (hash01(map.seed(), x, y, 93) < .5f) {
                    // A hairline wandering across the tile, widest in its middle and running out to points.
                    Point at{x + .15f + hash01(map.seed(), x, y, 94) * .5f, y + .15f + hash01(map.seed(), x, y, 95) * .5f};
                    float heading = hash01(map.seed(), x, y, 96) * 6.2832f;
                    std::array<Point, 4> line;
                    line[0] = project(at.x, at.y);
                    for (int k = 1; k < 4; ++k) {
                        heading += (hash01(map.seed(), x, y, 96 + k) - .5f) * 1.2f;
                        at = at + Point{std::cos(heading), std::sin(heading)} * .24f;
                        line[k] = project(at.x, at.y);
                    }
                    auto across = [&](int k) {
                        auto along = normalized(line[size_t(k + 1)] - line[size_t(k - 1)]);
                        return Point{-along.y * .45f, along.x * .45f};
                    };
                    appendPolygon(cracks, {line[0], line[1] + across(1), line[2] + across(2), line[3], line[2] - across(2), line[1] - across(1)});
                }
                continue;
            }
            // Flowers want lush grass: not near the desert or the beach, and not in dry meadow.
            bool lush = (tile.terrain == Terrain::Grass || tile.terrain == Terrain::Meadow) && map.value(Layer::Moisture, middle) > .4f &&
                        map.value(Layer::Heat, middle) < .52f && map.value(Layer::Land, middle) > .1f;
            if (!lush || tile.trees || snowy || map.value(Layer::Shade, middle) <= .58f || hash01(map.seed(), x, y, 70) >= .7f) continue;
            int colour = int(hash01(map.seed(), x / 3, y / 3, 71) * 4) % 4;
            int count = tile.terrain == Terrain::Meadow ? 7 : 4;
            if (climate.autumn > .5f) count /= 2;
            for (int i = 0; i < count; ++i) {
                Point spot{x + .15f + hash01(map.seed(), x, y, 72 + i) * .7f, y + .15f + hash01(map.seed(), x, y, 80 + i) * .7f};
                auto ground = map.terrainAt(spot);
                if (ground != Terrain::Grass && ground != Terrain::Meadow) continue;
                auto b = project(spot.x, spot.y);
                blooms[size_t(colour)]->appendCircle(b.x, b.y - 1, 1.6f, 1.1f);
            }
        }
    fill(cracks, Rgba{92, 120, 142, 170});
    ornaments->add(cracks);
    constexpr Rgb flowers[] = {{226, 120, 150}, {236, 206, 90}, {236, 236, 226}, {170, 130, 226}};
    for (size_t i = 0; i < blooms.size(); ++i) {
        fill(blooms[i], opaque(flowers[i]));
        ornaments->add(blooms[i]);
    }
    // Hvergelmir's chasm, once anyone has found it.
    auto spring = map.hvergelmir();
    if (map.inside(int(spring.x), int(spring.y)) && map.at(int(spring.x), int(spring.y)).revealed) paintHvergelmir(ornaments, map);
}

void WorldRenderer::buildPreview(const Preview& preview)
{
    clear(overlay);
    if (preview.kind == Preview::Kind::None) return;
    auto layer = isoLayer();
    overlay->add(layer);
    Rgba good{120, 210, 140, 90}, bad{230, 84, 70, 100};
    auto tint = preview.valid ? good : bad;
    float k = 1 / preview.zoom;
    if (!preview.road.empty()) {
        roadStrokes(layer, {&preview.road}, preview.kind == Preview::Kind::Clear ? 200 : 150, preview.kind == Preview::Kind::Clear ? Rgb{150, 60, 50} : dirt);
        if (preview.kind == Preview::Kind::Road) {
            // Keep the stroke legible while showing whether it can be built.
            auto spine = tvg::Shape::gen();
            appendRoad(spine, preview.road);
            spine->strokeWidth(.05f);
            spine->strokeCap(tvg::StrokeCap::Round);
            spine->strokeJoin(tvg::StrokeJoin::Round);
            spine->strokeFill(tint.r, tint.g, tint.b, 230);
            layer->add(spine);
        }
    }
    if (!preview.outline.empty()) {
        auto shape = tvg::Shape::gen();
        shape->moveTo(preview.outline[0].x, preview.outline[0].y);
        for (size_t i = 1; i < preview.outline.size(); ++i) shape->lineTo(preview.outline[i].x, preview.outline[i].y);
        if (preview.closed) {
            shape->close();
            fill(shape, tint);
        } else shape->lineTo(preview.cursor.x, preview.cursor.y);
        shape->strokeWidth(.06f);
        shape->strokeJoin(tvg::StrokeJoin::Round);
        shape->strokeFill(tint.r, tint.g, tint.b, 230);
        layer->add(shape);
        if (preview.kind == Preview::Kind::Field)
            for (size_t i = 0; i < preview.outline.size(); ++i) {
                auto p = project(preview.outline[i].x, preview.outline[i].y);
                float s = (i == 0 && !preview.closed && preview.active == 0 ? 5.5f : 3.6f) * k;
                auto knob = ellipse(p, s, s, {240, 232, 214, 255});
                knob->strokeWidth(1.4f * k);
                knob->strokeFill(20, 16, 12);
                overlay->add(knob);
            }
    }
    if (preview.brush) {
        auto at = project(preview.cursor.x, preview.cursor.y);
        auto ring = ellipse(at, 5.f * k, 5.f * k, {0, 0, 0, 0});
        ring->strokeWidth(1.5f * k);
        ring->strokeFill(tint.r, tint.g, tint.b, 230);
        overlay->add(ring);
        overlay->add(ellipse(at, 1.5f * k, 1.5f * k, {tint.r, tint.g, tint.b, 230}));
    }
}

void WorldRenderer::moveAgents(const Town& town, const Traffic& traffic, double seconds, const std::vector<int>& selected)
{
    for (auto& [id, sprite] : sprites) sprite.seen = false;
    int count = int(rows.size());
    for (const auto& agent : traffic.agents()) {
        auto& sprite = sprites[agent.id];
        sprite.seen = true;
        if (!sprite.paint) {
            sprite.paint = agentSprite(agent, DungeonKind::Cave);
            sprite.paint->ref();
        }
        auto at = agent.position();
        int row = standingRow(town, at, count);
        if (row != sprite.row) {
            if (sprite.row >= 0) detach(rows[size_t(sprite.row)], sprite.paint);
            rows[size_t(row)]->add(sprite.paint);
            sprite.row = row;
        }
        auto screen = project(at.x, at.y);
        auto heading = agent.heading();
        float facing = heading.x - heading.y < 0 ? -1.f : 1.f;
        float bob = -std::abs(std::sin(float(seconds) * 7 + agent.id)) * 1.2f;
        ui::setTransform(sprite.paint, {facing, 0, screen.x, 0, 1, screen.y + bob, 0, 0, 1});
        bool visible = town.map().revealed(at);
        sprite.paint->opacity(visible && inSight(at) ? 255 : 0);
    }
    for (auto it = sprites.begin(); it != sprites.end();) {
        if (it->second.seen) { ++it; continue; }
        if (it->second.row >= 0) detach(rows[size_t(it->second.row)], it->second.paint);
        it->second.paint->unref();
        it = sprites.erase(it);
    }
    // Named people.
    for (auto& [id, figure] : figures) figure.seen = false;
    for (const auto& person : town.people()) {
        auto& figure = figures[person.id];
        figure.seen = true;
        auto lookKey = ui::paintKey(person.look, person.race, person.calling, person.lookRevision, injuryOf(person) == Injury::Bandaged);
        if (figure.paint && figure.lookKey != lookKey) {
            if (figure.row >= 0) detach(rows[size_t(figure.row)], figure.paint);
            figure.paint->unref();
            figure.paint = nullptr;
            figure.parts = {};
            figure.row = -1;
            figure.striding = false;
        }
        if (!figure.paint) {
            figure.paint = personSprite(person, figure.parts);
            figure.paint->ref();
            figure.lookKey = std::move(lookKey);
        }
        // Keep the doorway's exterior occlusion order while crossing its short entry corridor.
        // The figure fades at the threshold instead of jumping behind the entire building.
        bool crossing = person.crossingDoorway();
        int row = standingRow(town, crossing ? person.entrance : person.position, count);
        if (row != figure.row) {
            if (figure.row >= 0) detach(rows[size_t(figure.row)], figure.paint);
            rows[size_t(row)]->add(figure.paint);
            figure.row = row;
        }
        auto screen = project(person.position.x, person.position.y);
        Point ahead{};
        if (crossing) ahead = person.inside ? person.threshold - person.entrance : person.entrance - person.threshold;
        else if (person.moving()) ahead = person.path.front() - person.position;
        else if (figure.last.x >= 0) ahead = person.position - figure.last;
        bool chopping = person.activity == Activity::Felling && !person.moving() && !crossing && person.tree >= 0;
        bool mining = person.activity == Activity::Mining && !person.moving() && !crossing && person.tree >= 0;
        if (mining) ahead = hearthold::mining::position(person.tree % town.map().width(), person.tree / town.map().width()) - person.position;
        if (chopping) {
            int x = person.tree % town.map().width(), y = person.tree / town.map().width();
            if (town.map().inside(x, y) && town.map().at(x, y).trees)
                ahead = treePosition(town.map(), x, y, town.map().at(x, y).trees - 1) - person.position;
        }
        if (std::abs(ahead.x - ahead.y) > .0001f) figure.facing = ahead.x - ahead.y < 0 ? -1.f : 1.f;
        // The stride follows the ground covered, so feet hurry on roads and drag in the woods.
        if (figure.last.x >= 0) figure.stride += std::min(1.f, distance(figure.last, person.position)) * 5.5f;
        figure.last = person.position;
        bool striding = !sceneView && (person.moving() || crossing);
        float bob = striding ? -std::abs(std::sin(figure.stride)) * 1.1f : 0;
        float collecting = !sceneView && person.activity == Activity::Collecting ?
            std::sin(3.14159265f * float(std::clamp(1 - (person.until - town.clock()) / (person.carriedProduct == Product::Stone ? hearthold::mining::collectSeconds : woodcutting::fallSeconds), 0., 1.))) : 0;
        ui::setTransform(figure.paint, {figure.facing, 0, screen.x, 0, 1 - .12f * collecting, screen.y + bob, 0, 0, 1});
        if (striding || figure.striding) {
            stridePose(figure.parts, figure.stride, striding);
        }
        if (!striding) animateGesture(figure.parts.arms, !sceneView && canIdleGesture(person) ? idleGesture(person.look ^ (uint32_t(person.id) * 7919u), moodOf(person), seconds) : GesturePose{});
        if ((chopping || mining) && !sceneView) {
            float angle = woodcutting::axeAngle(town.clock() - (person.until - woodcutting::cutSeconds));
            poseArm(figure.parts.arms[1], angle, angle * .25f, -angle * .2f);
        }
        figure.striding = striding;
        figure.paint->opacity(!sceneView && !inSight(person.position) ? 0 : uint8_t(std::lround(255 * person.visibility())));
        bool chosen = std::find(selected.begin(), selected.end(), person.id) != selected.end();
        figure.parts.ring->opacity(chosen ? 255 : 0);
        figure.parts.alert->opacity(person.stress > .7f || person.food < .15f ? 255 : 0);
        bool hammering = !person.moving() && !crossing && (person.activity == Activity::Building || person.activity == Activity::Roadwork);
        figure.parts.hammer->opacity(hammering ? 255 : 0);
        figure.parts.axe->opacity(chopping ? 255 : 0);
        figure.parts.pickaxe->opacity(mining ? 255 : 0);
        // A worker carrying their goods shows what they carry.
        const auto* job = person.activity == Activity::Hauling && person.carrying == 0 ? town.building(person.job) : nullptr;
        auto carried = job ? job->kind : Structure::Count;
        bool carrying = person.carrying > 0 && person.activity != Activity::Collecting;
        figure.parts.logs->opacity(carrying && person.carriedProduct == Product::Wood ? 255 : 0);
        figure.parts.stone->opacity(carrying && person.carriedProduct == Product::Stone ? 255 : 0);
        figure.parts.sack->opacity(job && carried != Structure::Lumberyard && carried != Structure::Quarry ? 255 : 0);
        if (hammering) ui::setTransform(figure.parts.hammer, {1, 0, 0, 0, 1, -std::abs(std::sin(float(seconds) * 9 + person.id)) * 2.5f, 0, 0, 1});
    }
    for (auto it = figures.begin(); it != figures.end();) {
        if (it->second.seen) { ++it; continue; }
        if (it->second.row >= 0) detach(rows[size_t(it->second.row)], it->second.paint);
        it->second.paint->unref();
        it = figures.erase(it);
    }
    // Monsters: prowlers about their lairs, raiders in the streets.
    for (auto& [id, sprite] : beasts) sprite.seen = false;
    for (const auto& beast : town.monsters()) {
        auto& sprite = beasts[beast.id];
        sprite.seen = true;
        if (!sprite.paint) {
            Agent look{};
            look.id = beast.id;
            look.kind = AgentKind::Monster;
            sprite.paint = agentSprite(look, town.map().dungeons()[size_t(beast.lair)].kind);
            sprite.paint->ref();
        }
        int row = standingRow(town, beast.position, count);
        if (row != sprite.row) {
            if (sprite.row >= 0) detach(rows[size_t(sprite.row)], sprite.paint);
            rows[size_t(row)]->add(sprite.paint);
            sprite.row = row;
        }
        auto screen = project(beast.position.x, beast.position.y);
        float facing = 1;
        if (!beast.path.empty()) {
            auto ahead = beast.path.front() - beast.position;
            facing = ahead.x - ahead.y < 0 ? -1.f : 1.f;
        }
        float lunge = beast.raider ? -std::abs(std::sin(float(seconds) * 6 + beast.id)) * 1.5f : 0;
        ui::setTransform(sprite.paint, {facing, 0, screen.x, 0, 1, screen.y + lunge, 0, 0, 1});
        sprite.paint->opacity(inSight(beast.position) ? 255 : 0);
    }
    for (auto it = beasts.begin(); it != beasts.end();) {
        if (it->second.seen) { ++it; continue; }
        if (it->second.row >= 0) detach(rows[size_t(it->second.row)], it->second.paint);
        it->second.paint->unref();
        it = beasts.erase(it);
    }
}

void WorldRenderer::buildDarkness(const WorldMap& map)
{
    clear(darkness);
    auto top = project(0, 0), right = project(float(map.width()), 0), left = project(0, float(map.height())), bottom = project(float(map.width()), float(map.height()));
    auto dark = tvg::Shape::gen();
    dark->appendRect(left.x, top.y, right.x - left.x, bottom.y - top.y);  // Fitted to the view each frame.
    dark->fill(4, 6, 22, 170);
    darkVeil = dark;
    // Each light lifts the dark smoothly from its core outward, and warms what it falls on.
    auto lit = tvg::Scene::gen();
    clear(warmth);
    for (auto& pool : pools) {
        // Lights soften the night, never erase it: alpha 190 at rest, drawn at their brightest flicker.
        pool.hole = softDisc(pool.rx, {255, 255, 255}, uint8_t(190 * brightest));
        lit->add(pool.hole);
        if (pool.warmth.r + pool.warmth.g + pool.warmth.b == 0) continue;
        pool.tint = softDisc(pool.rx * .8f, pool.warmth, 255);
        warmth->add(pool.tint);
    }
    dark->mask(lit, tvg::MaskMethod::InvAlpha);
    darkness->add(dark);
    fitToView(true);
    lastFlicker = -1;  // animate() places the holes and tints, and fades the tints, this same frame.
}

void WorldRenderer::addPool(Pool pool)
{
    if (pool.glow) pool.glowAt = pool.glow->transform();
    pools.push_back(pool);
}

void WorldRenderer::weather(const Climate& climate, double seconds)
{
    // Rain greys the view, storms most; a cloudy sky only casts more shadows. All of it, the rain
    // itself included, eases over some ten seconds rather than snapping when the weather turns.
    float grey = 0, sun = 1, shade = 1, cloudy = 0;
    switch (climate.weather) {
    case Weather::Cloudy: sun = .85f, cloudy = 1; break;
    case Weather::Rain: grey = 46, sun = .15f, shade = 0; break;
    case Weather::Snow: grey = 34, sun = .35f, shade = 0; break;
    case Weather::Storm: grey = 78, sun = .1f, shade = 0; break;
    case Weather::Clear: break;
    }
    float step = weatherAt < 0 ? 1 : 1 - std::exp(-float(seconds - weatherAt) * .22f);
    weatherAt = seconds;
    shownGrey += (grey - shownGrey) * step;
    shownSun += (sun - shownSun) * step;
    shownShade += (shade - shownShade) * step;
    shownCloudy += (cloudy - shownCloudy) * step;
    // Drops thin in and out; the last rain or snow keeps falling while it fades.
    if (climate.precipitating()) falling = climate.weather, fallingIntensity = climate.intensity;
    shownWet += ((climate.precipitating() ? 1.f : 0.f) - shownWet) * step;
    overcast->fill(34, 40, 52, uint8_t(shownGrey));
    precipitation->reset();
    // Zoomed far out, drops would shrink to dust: fade them away past a limit instead.
    float fade = std::clamp((view.zoom - .35f) / .3f, 0.f, 1.f);
    precipitation->opacity(uint8_t(255 * fade));
    if (shownWet < .02f || viewWidth <= 0 || fade <= 0) return;
    // Drops live on a repeating tile of the world, so the land and the weather move together on screen.
    constexpr float tile = 320;
    bool snow = falling == Weather::Snow, storm = falling == Weather::Storm;
    int wanted = int((snow ? 220 : storm ? 420 : 260) * (.3f + .7f * fallingIntensity) * shownWet);
    float k = 1 / std::max(view.zoom, .6f), halfW = viewWidth / 2 / view.zoom, halfH = viewHeight / 2 / view.zoom;
    int x0 = int(std::floor((view.x - halfW) / tile)) - 1, x1 = int(std::floor((view.x + halfW) / tile)) + 1;
    int y0 = int(std::floor((view.y - halfH) / tile)) - 1, y1 = int(std::floor((view.y + halfH) / tile)) + 1;
    int tiles = (x1 - x0 + 1) * (y1 - y0 + 1);
    int each = std::clamp(wanted / std::max(1, tiles), 0, 40);
    float t = float(seconds), wind = storm ? 260 : snow ? 24 : 90;
    for (int ty = y0; ty <= y1; ++ty)
        for (int tx = x0; tx <= x1; ++tx)
            for (int i = 0; i < each; ++i) {
                float speed = (snow ? 34 + hash01(9, i, tx, 3) * 26 : 620 + hash01(9, i, tx, 3) * 260) * k;
                float x = tx * tile + std::fmod(hash01(9, i, tx * 131 + ty, 1) * tile + wind * k * t, tile);
                float y = ty * tile + std::fmod(hash01(9, i, tx * 131 + ty, 2) * tile + speed * t, tile);
                if (snow) {
                    float sway = std::sin(t * 1.3f + i + tx) * 6 * k;
                    float r = (.9f + hash01(9, i, ty, 4) * 1.3f) * k;
                    precipitation->appendCircle(x + sway, y, r, r);
                } else {
                    precipitation->moveTo(x, y);
                    precipitation->lineTo(x - wind * .025f * k, y - 13 * k);
                }
            }
    if (snow) precipitation->fill(220, 228, 240, 200);
    else {
        precipitation->strokeWidth(k);
        precipitation->strokeFill(150, 170, 200, 120);
    }
}

void WorldRenderer::markDamage(const Town& town)
{
    if (!damageBack) {
        damageBack = tvg::Shape::gen();
        damageLeft = tvg::Shape::gen();
        combat->add(damageBack);
        combat->add(damageLeft);
    }
    damageBack->reset();
    damageLeft->reset();
    for (const auto& item : town.buildings()) {
        if (!item.built() || item.health >= 1 || !inSight(item.center)) continue;
        auto top = project(item.center.x, item.center.y);
        float width = 22.f + 8 * float(structureSpec(item.kind).size), y = top.y - 34 - 10 * float(structureSpec(item.kind).size);
        damageBack->appendRect(top.x - width / 2 - 1, y - 1, width + 2, 5, 1.5f, 1.5f);
        damageLeft->appendRect(top.x - width / 2, y, width * std::max(0.f, item.health), 3, 1, 1);
    }
    damageBack->fill(14, 12, 16, 210);
    damageLeft->fill(222, 82, 64);
}

void WorldRenderer::sparkle(const Town& town, double seconds)
{
    constexpr double life = 1;
    for (const auto& hit : town.hits()) {
        if (hit.serial < nextSpark) continue;
        nextSpark = hit.serial + 1;
        if (!inSight(hit.to)) continue;
        auto from = project(hit.from.x, hit.from.y), to = project(hit.to.x, hit.to.y);
        to.y -= 9;
        from.y -= 10;
        auto paint = tvg::Scene::gen();
        Rgb tint = hit.onPerson ? Rgb{240, 70, 60} : hit.ranged ? Rgb{200, 160, 255} : Rgb{255, 230, 160};
        if (hit.ranged) paint->add(line(from, to, 1.4f, opaque(tint, 220)));  // The arrow or bolt in flight.
        // A burst of short strokes where the blow lands.
        auto burst = tvg::Shape::gen();
        for (int i = 0; i < 6; ++i) {
            float angle = i * 1.047f + float(hit.serial % 7) * .3f;
            burst->moveTo(to.x + std::cos(angle) * 3, to.y + std::sin(angle) * 2);
            burst->lineTo(to.x + std::cos(angle) * 9, to.y + std::sin(angle) * 6);
        }
        burst->strokeWidth(1.6f);
        burst->strokeCap(tvg::StrokeCap::Round);
        burst->strokeFill(tint.r, tint.g, tint.b);
        paint->add(burst);
        if (!hit.ranged && !hit.onPerson) {
            auto slash = tvg::Shape::gen();  // A sweeping cut across the target.
            slash->moveTo(to.x - 9, to.y - 6);
            slash->cubicTo(to.x - 2, to.y - 2, to.x + 3, to.y + 2, to.x + 9, to.y + 7);
            slash->strokeWidth(2.2f);
            slash->strokeCap(tvg::StrokeCap::Round);
            slash->strokeFill(255, 250, 230, 230);
            paint->add(slash);
        }
        combat->add(paint);
        tvg::Paint* number = nullptr;
        auto text = tvg::Text::gen();
        if (text->font("DejaVuSans-Bold") == tvg::Result::Success) {
            text->size(11);
            text->text(("-" + std::to_string(hit.damage)).c_str());
            text->fill(tint.r, tint.g, tint.b);
            text->outline(2, 20, 14, 10);
            text->translate(to.x + 4, to.y - 14);
            combat->add(text);
            number = text;
        } else delete text;
        sparks.push_back({hit, seconds, paint, number});
    }
    for (auto it = sparks.begin(); it != sparks.end();) {
        float age = float(seconds - it->shown);
        if (age >= life) {
            // Faded: removed with its area repainted, then freed.
            auto drop = [&](tvg::Paint* gone) {
                gone->ref();
                combat->remove(gone);
                gone->unref();
            };
            drop(it->paint);
            if (it->number) drop(it->number);
            it = sparks.erase(it);
            continue;
        }
        // The impact flashes and fades fast; the number floats up and fades slowly.
        it->paint->opacity(uint8_t(255 * std::max(0.f, 1 - age / .35f)));
        if (it->number) {
            auto to = project(it->hit.to.x, it->hit.to.y);
            it->number->translate(to.x + 4, to.y - 23 - age * 20);
            it->number->opacity(uint8_t(255 * std::min(1.f, (1 - age) * 2.5f)));
        }
        ++it;
    }
}

void WorldRenderer::drift(const Climate& climate, double seconds)
{
    // The sun: strongest on clear days, veiled when cloudy, gone at night or in rain (eased in weather()).
    // Faded through each pass's own alpha: ThorVG GL composites a blended child of a part-opaque
    // scene against nothing, washing the whole view pale.
    float sun = shownSun * (1 - climate.night);
    for (size_t i = 0; i < sunPasses.size(); ++i) {
        const auto& spec = sunPassSpecs[i];
        sunPasses[i]->fill(spec.r, spec.g, spec.b, uint8_t(spec.alpha * sun));
    }
    sunlight->opacity(sun > .01f ? 255 : 0);
    // Cloud shadows: broad soft patches drifting over the land, scattered on fair days, and on a
    // cloudy day a noisy mottle of blotches between them; faint at night, none under rain.
    if (cloudShapes.empty()) {
        // A ragged cluster of stretched blobs strung along the wind. They are drawn solid and the
        // cluster is faded as one, so overlaps don't darken: one shadow with an irregular edge.
        auto cluster = [&](int seed) {
            auto shadow = tvg::Scene::gen();
            float x = 0, y = 0;
            for (int blob = 0; blob < 12; ++blob) {
                float r = 70 + hash01(31, seed, blob, 1) * 150;
                float stretch = 1.3f + hash01(31, seed, blob, 4) * 1.1f;
                auto puff = tvg::Shape::gen();
                puff->appendCircle(0, 0, r, r);
                auto edge = tvg::RadialGradient::gen();
                edge->radial(0, 0, r, 0, 0, 0);
                tvg::Fill::ColorStop stops[] = {{0, 8, 14, 24, 255}, {.6f, 8, 14, 24, 255}, {1, 8, 14, 24, 0}};
                edge->colorStops(stops, 3);
                puff->fill(edge);
                ui::setTransform(puff, {stretch, 0, x, 0, 1, y, 0, 0, 1});
                shadow->add(puff);
                // Wander on to the next blob: mostly along the wind, a little across it.
                x += (hash01(31, seed, blob, 2) - .3f) * 260;
                y += (hash01(31, seed, blob, 3) - .5f) * 150;
            }
            shadow->opacity(105);
            auto holder = tvg::Scene::gen();
            holder->add(shadow);
            clouds->add(holder);
            return holder;
        };
        for (int i = 0; i < cloudCols * cloudRows; ++i) cloudShapes.push_back(cluster(i));
        // The cloudy-day mottle: one tiling noise texture, repeated over the view.
        auto blotches = cloudMottle(mottleTexels, 53);
        mottle = tvg::Scene::gen();
        for (int i = 0; i < mottleCols * mottleRows; ++i) {
            auto picture = tvg::Picture::gen();
            picture->load(blotches.data(), uint32_t(mottleTexels), uint32_t(mottleTexels), tvg::ColorSpace::ARGB8888S, true);
            picture->size(mottleTile, mottleTile);
            mottle->add(picture);
            mottleTiles.push_back(picture);
        }
        clouds->add(mottle);
    }
    float shade = shownShade * (1 - .65f * climate.night);
    clouds->opacity(uint8_t(255 * shade));
    bool shown = shade > 0 && viewWidth > 0;
    // The whole pattern slides with the wind; tiles are counted in the pattern's own frame and each
    // tile always draws the same cluster, so a shadow never jumps or swaps shape as the view moves.
    float windX = float(seconds) * 42, windY = float(seconds) * 15;
    for (auto* shape : cloudShapes) shape->opacity(0);
    if (shown) {
        float halfW = viewWidth / 2 / view.zoom + cloudTile, halfH = viewHeight / 2 / view.zoom + cloudTile;
        int x0 = int(std::floor((view.x - halfW - windX) / cloudTile)), y0 = int(std::floor((view.y - halfH - windY) / cloudTile));
        // Zoomed far out the grid would wrap onto itself: keep the tiles nearest the middle.
        int x1 = std::min(int(std::floor((view.x + halfW - windX) / cloudTile)), x0 + cloudCols - 1);
        int y1 = std::min(int(std::floor((view.y + halfH - windY) / cloudTile)), y0 + cloudRows - 1);
        for (int ty = y0; ty <= y1; ++ty)
            for (int tx = x0; tx <= x1; ++tx) {
                if (hash01(37, tx, ty, 21) >= .7f) continue;  // Gaps of open sky.
                auto* cloud = cloudShapes[size_t(((tx % cloudCols + cloudCols) % cloudCols) + ((ty % cloudRows + cloudRows) % cloudRows) * cloudCols)];
                cloud->opacity(255);
                ui::setTransform(cloud, {1, 0, (tx + hash01(37, tx, ty)) * cloudTile + windX, 0, .5f, (ty + hash01(37, tx, ty, 9)) * cloudTile + windY, 0, 0, 1});
            }
    }
    // Zoomed far out the mottle would need more tiles than it has: fade it away instead.
    float mottleShown = shownCloudy * std::clamp((view.zoom - .2f) / .1f, 0.f, 1.f);
    mottle->opacity(uint8_t(120 * mottleShown));
    if (!shown || mottleShown <= 0) return;
    // Flattened onto the ground like the shadows, so a tile is half as tall as it is wide.
    float left = view.x - viewWidth / 2 / view.zoom - windX, top = view.y - viewHeight / 2 / view.zoom - windY;
    float x0 = std::floor(left / mottleTile) * mottleTile + windX, y0 = std::floor(top / (mottleTile / 2)) * (mottleTile / 2) + windY;
    for (int row = 0; row < mottleRows; ++row)
        for (int col = 0; col < mottleCols; ++col)
            ui::setTransform(mottleTiles[size_t(row * mottleCols + col)], {1, 0, x0 + col * mottleTile, 0, .5f, y0 + row * mottleTile / 2, 0, 0, 1});
}

void WorldRenderer::updateVision(const Town& town)
{
    const auto& map = town.map();
    bool first = !visibilityPicture;
    VisibilityMap::Region changed;
    if (first) {
        exploredVisibility.reset(map.width(), map.height());
        currentVisibility.reset(map.width(), map.height());
        figureVisibility.reset(map.width(), map.height());
        if (const auto& giant = map.giant()) figureVisibility.assign(giant->figure());
        sightCount = 0;
        visibilityPicture = tvg::Picture::gen();
        fogBorder = tvg::Shape::gen(); fogBorder->fill(0, 0, 0);
        fog->add(fogBorder); fog->add(visibilityPicture);
        fitToView(true);
        changed = {0, 0, exploredVisibility.columns(), exploredVisibility.rows()};
    }
    auto exploredVersion = exploredVisibility.revision();
    // Exploration history only grows in normal play. A replaced map invalidates the renderer;
    // a shortened history also resets the accumulated field.
    const auto& history = map.sights();
    if (history.size() < sightCount) {
        if (exploredVisibility.clear()) changed = {0, 0, exploredVisibility.columns(), exploredVisibility.rows()};
        sightCount = 0;
    }
    for (; sightCount < history.size(); ++sightCount) {
        auto sight = history[sightCount]; sight.radius += 1;
        exploredVisibility.stamp(sight, changed);
    }
    float night = town.climate().night;
    auto blend = [&](float day, float dark) { return day + (dark - day) * night; };
    vision.clear();
    for (const auto& p : town.people())
        if (p.visibility() > 0) vision.push_back({p.position, blend(8.5f, 5)});
    for (const auto& b : town.buildings()) {
        if (!b.built()) continue;
        float half = structureSpec(b.kind).size / 2.f, glow = 1;
        if (isSeat(b.kind)) glow = 4;
        else if (isLodging(b.kind) || b.kind == Structure::Tavern || b.kind == Structure::Guild || b.kind == Structure::GuildHall || b.kind == Structure::Chapel) glow = 2.5f;
        else if (isHome(b.kind)) glow = 1.5f;
        vision.push_back({b.center, half + blend(5, 3 + glow * 1.4f)});
    }
    for (auto at : lamps) vision.push_back({at, blend(4, 6.5f)});
    // Whoever sees the ground about the volcano sees all of it, so its crater and smoke are never left in memory
    // alone; its lava keeps everyone well back from the cone itself.
    if (const auto& volcano = map.volcano(); volcano && std::any_of(vision.begin(), vision.end(), [&](const Sight& s) { return distance(s.center, volcano->center()) <= s.radius + volcano->sights()[0].radius; }))
        for (auto sight : volcano->sights()) vision.push_back(sight);
    // Apply new/moving sources in this frame, including the explored fringe. Logical map
    // history is sampled every few world units and must not hold back what a unit sees now.
    bool currentChanged = currentVisibility.assign(vision, changed);
    if (first || currentChanged)
        for (auto sight : vision) { sight.radius += 1; exploredVisibility.stamp(sight, changed); }
    if (first || currentChanged || exploredVersion != exploredVisibility.revision()) {
        auto explored = exploredVisibility.coverage(), current = currentVisibility.coverage(), figure = figureVisibility.coverage();
        bool statue = figure.size() == explored.size();
        visibilityPixels.resize(explored.size());
        bool pixelsChanged = first;
        for (unsigned y = changed.top; y < changed.bottom; ++y) {
            auto row = size_t(y) * exploredVisibility.columns();
            for (size_t i = row + changed.left; i < row + changed.right; ++i) {
                // Ymir's figure shows plainly whatever anyone sees: drawn so, though it is no one's sight.
                unsigned shown = statue ? figure[i] : 0;
                unsigned seen = std::max<unsigned>(current[i], shown), known = std::max<unsigned>(explored[i], shown);
                unsigned memory = (190u * (255 - seen) + 127) / 255;
                unsigned alpha = 255 - ((255 - memory) * known + 127) / 255;
                unsigned tint = (memory * known + 127) / 255;
                // Native RGBA bytes avoid a GPU channel-conversion pass for this live texture.
                uint32_t pixel = alpha << 24 | ((8 * tint + 127) / 255) << 16 |
                                 ((3 * tint + 127) / 255) << 8 | (2 * tint + 127) / 255;
                pixelsChanged |= visibilityPixels[i] != pixel;
                visibilityPixels[i] = pixel;
            }
        }
        // Keep the raw buffer stable for the picture's lifetime. Reloading the same borrowed
        // image marks its pixels dirty; replacing a copied loader retains ThorVG's old bitmap.
        if (pixelsChanged) visibilityPicture->load(visibilityPixels.data(), exploredVisibility.columns(), exploredVisibility.rows(), tvg::ColorSpace::ABGR8888, false);
        if (first) {
            auto bounds = exploredVisibility.bounds();
            ui::setTransform(visibilityPicture, {bounds.w / exploredVisibility.columns(), 0, bounds.x,
                                                0, bounds.h / exploredVisibility.rows(), bounds.y, 0, 0, 1});
        }
    }
    fog->opacity(255);
}

void WorldRenderer::updateFelling(const Town& town)
{
    double now = town.clock();
    std::erase_if(fallingTrees, [&](const FallingTree& tree) {
        if (now - tree.at < woodcutting::fallSeconds) return false;
        detach(rows[size_t(tree.row)], tree.paint); tree.paint->unref();
        return true;
    });
    const auto& map = town.map();
    for (const auto& event : town.treeEvents()) {
        if (event.serial < seenTreeEvent) continue;
        seenTreeEvent = event.serial + 1;
        if (event.kind != TreeWorkEvent::Kind::Fall || now - event.at >= woodcutting::fallSeconds || fallingTrees.size() >= 64) continue;
        int x = event.cell % map.width(), y = event.cell / map.width();
        auto tree = treeAt(map, x, y, event.index);
        auto pivot = project(tree.foot.x, tree.foot.y);
        Point screen{(pivot.x - view.x) * view.zoom + viewWidth / 2, (pivot.y - view.y) * view.zoom + viewHeight / 2};
        if (!inSight(tree.foot) || screen.x < -128 || screen.x > viewWidth + 128 || screen.y < -128 || screen.y > viewHeight + 128) continue;
        auto* paint = tvg::Scene::gen(); paint->ref();
        auto* body = tvg::Scene::gen();
        TreeBatch batch(town.climate()); batch.add(tree);
        for (auto* shape : batch.finish(pivot.y)) body->add(shape);
        auto* dust = tvg::Shape::gen();
        for (int i = 0; i < 6; ++i) dust->appendCircle(pivot.x + (i - 2.5f) * 2, pivot.y - 1 - (i % 3), 1.2f, .65f);
        dust->fill(160, 132, 88); dust->opacity(0);
        paint->add(body); paint->add(dust);
        int row = std::clamp(x + y, 0, int(rows.size()) - 1);
        rows[size_t(row)]->add(paint);
        auto worker = project(event.worker.x, event.worker.y);
        fallingTrees.push_back({paint, body, dust, pivot, row, event.at, pivot.x < worker.x ? -1.f : 1.f});
    }
    for (const auto& tree : fallingTrees) {
        float t = float(std::clamp((now - tree.at) / woodcutting::fallSeconds, 0., 1.));
        float angle = tree.side * 1.46f * t * t, c = std::cos(angle), s = std::sin(angle), flat = 1 - .65f * t;
        auto p = tree.pivot;
        ui::setTransform(tree.body, {c, -s, p.x - c * p.x + s * p.y,
                                    s * flat, c * flat, p.y - s * flat * p.x - c * flat * p.y, 0, 0, 1});
        tree.paint->opacity(uint8_t(255 * std::clamp((1 - t) / .18f, 0.f, 1.f)));
        float puff = std::clamp((t - .45f) / .55f, 0.f, 1.f), scale = .4f + 1.1f * puff;
        ui::setTransform(tree.dust, {scale, 0, p.x * (1 - scale), 0, scale, p.y * (1 - scale), 0, 0, 1});
        tree.dust->opacity(uint8_t(140 * std::sin(puff * 3.14159265f)));
    }
}

void WorldRenderer::fitToView(bool force)
{
    if (viewWidth <= 0) return;
    float halfW = viewWidth / 2 / view.zoom * 1.25f + 64, halfH = viewHeight / 2 / view.zoom * 1.25f + 64;
    float rect[4] = {view.x - halfW, view.y - halfH, halfW * 2, halfH * 2};
    // Refit only when the view has moved noticeably, so still frames don't rebuild the veils.
    bool moved = force;
    for (int i = 0; i < 4; ++i) moved |= std::abs(rect[i] - fitted[i]) > 24 / view.zoom;
    if (!moved) return;
    std::copy(rect, rect + 4, fitted);
    for (auto* pass : sunPasses) {
        pass->reset();
        pass->appendRect(rect[0], rect[1], rect[2], rect[3]);
    }
    if (darkVeil) {
        darkVeil->reset();
        darkVeil->appendRect(rect[0], rect[1], rect[2], rect[3]);
    }
    // The fog and memory veils live in tile space: cover the view's corners there.
    float lo[2] = {1e9f, 1e9f}, hi[2] = {-1e9f, -1e9f};
    for (auto [sx, sy] : {std::pair{rect[0], rect[1]}, std::pair{rect[0] + rect[2], rect[1]}, std::pair{rect[0], rect[1] + rect[3]}, std::pair{rect[0] + rect[2], rect[1] + rect[3]}}) {
        auto t = unproject(sx, sy);
        lo[0] = std::min(lo[0], t.x), lo[1] = std::min(lo[1], t.y);
        hi[0] = std::max(hi[0], t.x), hi[1] = std::max(hi[1], t.y);
    }
    if (fogBorder) {
        auto b = exploredVisibility.bounds();
        float x0 = lo[0], y0 = lo[1], x1 = hi[0], y1 = hi[1];
        fogBorder->reset();
        // Four bounded strips keep the world outside the texture black while panning.
        auto rect = [&](float x, float y, float w, float h) { if (w > 0 && h > 0) fogBorder->appendRect(x, y, w, h); };
        rect(x0, y0, std::min(x1, b.x) - x0, y1 - y0);
        rect(std::max(x0, b.x + b.w), y0, x1 - std::max(x0, b.x + b.w), y1 - y0);
        float left = std::max(x0, b.x), right = std::min(x1, b.x + b.w);
        rect(left, y0, right - left, std::min(y1, b.y) - y0);
        rect(left, std::max(y0, b.y + b.h), right - left, y1 - std::max(y0, b.y + b.h));
    }
}

bool WorldRenderer::inSight(Point p) const
{
    return currentVisibility.sample(p) >= 119;  // The previous 85% radius cutoff in the shared field.
}

void WorldRenderer::tread(const Town& town, double seconds)
{
    const auto& sky = town.climate();
    // Prints fill in under fresh snow and vanish when it melts.
    double lasting = sky.weather == Weather::Snow ? 40 : 240;
    if (sky.snow < .15f) footprints.clear();
    footprints.erase(std::remove_if(footprints.begin(), footprints.end(), [&](const Print& p) { return seconds - p.made > lasting; }), footprints.end());
    bool changed = false;
    for (const auto& p : town.people()) {
        auto& last = lastStep[p.id];
        if (p.visibility() <= 0 || sky.snow < .2f) {
            last = p.position;
            continue;
        }
        if (distance(last, p.position) < .28f) continue;
        auto along = normalized(p.position - last);
        leftFoot = !leftFoot;
        Point side{-along.y * .06f, along.x * .06f};
        footprints.push_back({p.position + (leftFoot ? side : side * -1), seconds});
        last = p.position;
        changed = true;
    }
    if (footprints.size() > 900) footprints.erase(footprints.begin(), footprints.begin() + long(footprints.size() - 900));
    if (!changed && seconds - printsAt < 1) return;
    printsAt = seconds;
    clear(prints);
    if (footprints.empty()) return;
    auto marks = tvg::Shape::gen();
    for (const auto& print : footprints) marks->appendCircle(print.at.x, print.at.y, .045f, .045f);
    marks->fill(96, 106, 124, 150);
    prints->add(marks);
}

void WorldRenderer::animate(const Town& town, double seconds)
{
    float elapsed = lastAnimate < 0 ? 0 : float(seconds - lastAnimate);
    lastAnimate = seconds;
    uint8_t eyes = uint8_t(std::lround(255 * std::clamp(town.climate().night * 1.5f - .3f, 0.f, 1.f)));
    for (auto* glint : ymirGlints)
        if (glint) glint->opacity(eyes);
    for (auto& [id, item] : visuals) {
        // A site rises as it is built; a finished building plays the rest at its own pace.
        const auto* building = town.building(id);
        float frame = building && !building->built() ? building->progress * item.layout.frames * .92f
                                                     : std::min(item.layout.frames, item.frame + elapsed * item.layout.frameRate);
        if (frame != item.frame) {
            item.animation->frame(std::min(frame, item.layout.frames - 1));
            item.frame = frame;
        }
    }
    const auto& climate = town.climate();
    // Night fades through the veil's and tints' own alpha: the darkness and warmth scenes stay fully
    // opaque or hidden, as ThorVG GL misdraws a masked or blended layer at part opacity.
    bool dark = climate.night > .002f;
    darkness->opacity(dark ? 255 : 0);
    warmth->opacity(dark ? 255 : 0);
    if (darkVeil) darkVeil->fill(4, 6, 22, uint8_t(170 * climate.night));
    lights->opacity(uint8_t(70 + 100 * climate.night));
    // Ambient motion runs at 20 fps; the canvas repaints only the small regions it touches.
    weather(climate, seconds);
    drift(climate, seconds);
    if (seconds - lastFlicker < 1.0 / 20) return;
    lastFlicker = seconds;
    float t = float(seconds);
    for (size_t i = 0; i < pulses.size(); ++i) pulses[i]->opacity(uint8_t(170 + std::sin(t * 2.2f + i) * 70));
    for (size_t i = 0; i < wispPaints.size(); ++i) {
        const auto& wisp = wisps[i];
        float phase = t * (.7f + .13f * (i % 5)) + i * 2.1f;
        ui::setTransform(wispPaints[i], {1, 0, wisp.center.x + std::cos(phase) * wisp.radius, 0, 1,
                                          wisp.center.y - 22 + std::sin(phase) * wisp.radius * .45f + std::sin(t * 2.6f + i) * 4, 0, 0, 1});
    }
    // Every light wavers on its own course: its glow and halo, the pool it lifts from the night and
    // the warmth it casts, which also fades with the night through its own alpha (see above).
    for (auto& pool : pools) {
        auto f = flare(pool.flicker, pool.center, seconds);
        Point at = pool.center + f.sway;
        float reach = f.reach, squash = pool.ry / pool.rx;
        if (pool.glow) {
            auto m = pool.glowAt;
            m.e11 *= reach, m.e22 *= reach, m.e13 += f.sway.x, m.e23 += f.sway.y;
            ui::setTransform(pool.glow, m);
        }
        if (pool.halo) {
            float swell = 1 + 2 * (f.brightness - 1);  // A small halo has to swell more to show.
            ui::setTransform(pool.halo, {swell, 0, pool.flame.x * (1 - swell), 0, swell, pool.flame.y * (1 - swell), 0, 0, 1});
        }
        if (!pool.hole) continue;
        ui::setTransform(pool.hole, {reach, 0, at.x, 0, reach * squash, at.y, 0, 0, 1});
        pool.hole->opacity(uint8_t(255 * f.brightness / brightest));
        if (!pool.tint) continue;
        ui::setTransform(pool.tint, {reach, 0, at.x, 0, reach * squash, at.y - pool.ry * .25f, 0, 0, 1});
        pool.tint->opacity(uint8_t(90 * climate.night * f.brightness));
    }
    if (!flame) return;
    // The flame leaps and leans with the light it gives.
    auto p = firePosition;
    auto fire = flare(Flicker::Fire, p, seconds);
    float lift = (fire.brightness - 1) * 20, lean = fire.sway.x * .8f;
    float a = std::sin(t * 9.1f) * 1.6f + lean, b = std::sin(t * 13.7f + 1) * 2.2f + lean, c = std::sin(t * 7.3f + 2) * 1.2f;
    flame->reset();
    flame->moveTo(p.x - 5, p.y);
    flame->cubicTo(p.x - 6, p.y - 6, p.x - 2 + a, p.y - 9, p.x - 1 + a, p.y - 15 + c - lift);
    flame->cubicTo(p.x + 1, p.y - 10, p.x + 3 + b, p.y - 12, p.x + 2 + b, p.y - 18 - c - lift);
    flame->cubicTo(p.x + 6, p.y - 10, p.x + 7, p.y - 5, p.x + 5, p.y);
    flame->close();
    flame->fill(226, 104, 40);
    flameCore->reset();
    flameCore->moveTo(p.x - 2.6f, p.y);
    flameCore->cubicTo(p.x - 3, p.y - 4, p.x + a * .5f, p.y - 6, p.x + a * .6f, p.y - 10 + c - lift * .6f);
    flameCore->cubicTo(p.x + 2, p.y - 6, p.x + 3.4f, p.y - 3, p.x + 2.6f, p.y);
    flameCore->close();
    flameCore->fill(255, 200, 96);
}
}  // namespace hearthold
