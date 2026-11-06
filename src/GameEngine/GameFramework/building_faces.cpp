#include <GameEngine/GameFramework/animation.h>
#include "building_faces.h"
#include <algorithm>
#include <cmath>

namespace gameframework
{
namespace
{
constexpr Rgb timberLine{40, 30, 24};
constexpr Rgb doorWood{44, 30, 24};
constexpr Rgb pole{36, 30, 28};

float clamp01(float t) { return std::clamp(t, 0.f, 1.f); }
float outBack(float t)
{
    constexpr float c1 = 1.70158f, c3 = c1 + 1;
    t = clamp01(t) - 1;
    return 1 + c3 * t * t * t + c1 * t * t;
}

float inCubic(float t)
{
    t = clamp01(t);
    return t * t * t;
}
Rgb scaled(Rgb c, float k) { return {uint8_t(c.r * k), uint8_t(c.g * k), uint8_t(c.b * k)}; }

// Geometry of one block at a frame, shared by every face of it.
struct Shell
{
    Block b;
    Motion motion;
    float xm() const { return (b.x0 + b.x1) / 2; }
    float ym() const { return (b.y0 + b.y1) / 2; }
    Vertex at(float x, float y, float z) const { return motion.place(x, y, z); }
    float top(float f) const { return b.base + motion.wall(b, f); }
    float peak(float f) const { return top(f) + motion.roof(b, f); }
    // Highest point of the roof, where banners and crystals stand.
    Vertex summit(float f) const
    {
        switch (b.shape) {
        case RoofShape::GableX: return at(xm(), ym(), peak(f));
        case RoofShape::GableY: return at(xm(), ym(), peak(f));
        default: return at(xm(), ym(), peak(f));
        }
    }
    // A point on a visible wall: frontLeft is the +y face, otherwise the +x face. t runs along it.
    Vertex wall(bool frontLeft, float t, float z) const
    {
        return frontLeft ? at(b.x0 + (b.x1 - b.x0) * t, b.y1, z) : at(b.x1, b.y0 + (b.y1 - b.y0) * t, z);
    }
};

void roofFaces(std::vector<Face>& back, std::vector<Face>& front, const Shell& s)
{
    auto body = s.motion.body(s.b.delay);
    auto corner = [s](float x, float y) { return [s, x, y](float f) { return s.at(x, y, s.top(f)); }; };
    auto A = corner(s.b.x0, s.b.y0), B = corner(s.b.x1, s.b.y0), C = corner(s.b.x1, s.b.y1), D = corner(s.b.x0, s.b.y1);
    auto add = [&](std::vector<Face>& into, std::function<Polygon(float)> shape, Rgb color) { into.push_back({std::move(shape), color, Face::Style::Outlined, 1.2f, body}); };
    const auto& b = s.b;
    switch (b.shape) {
    case RoofShape::Flat:
        add(front, [=](float f) { return Polygon{A(f), B(f), C(f), D(f)}; }, b.roofLit);
        break;
    case RoofShape::GableX:
        add(back, [=](float f) { return Polygon{A(f), B(f), s.at(b.x1, s.ym(), s.peak(f)), s.at(b.x0, s.ym(), s.peak(f))}; }, b.roofShade);
        add(front, [=](float f) { return Polygon{D(f), C(f), s.at(b.x1, s.ym(), s.peak(f)), s.at(b.x0, s.ym(), s.peak(f))}; }, b.roofLit);
        break;
    case RoofShape::GableY:
        add(back, [=](float f) { return Polygon{A(f), D(f), s.at(s.xm(), b.y1, s.peak(f)), s.at(s.xm(), b.y0, s.peak(f))}; }, b.roofLit);
        add(front, [=](float f) { return Polygon{B(f), C(f), s.at(s.xm(), b.y1, s.peak(f)), s.at(s.xm(), b.y0, s.peak(f))}; }, b.roofShade);
        break;
    case RoofShape::Pyramid:
        add(back, [=](float f) { return Polygon{A(f), B(f), s.at(s.xm(), s.ym(), s.peak(f))}; }, b.roofShade);
        add(back, [=](float f) { return Polygon{A(f), D(f), s.at(s.xm(), s.ym(), s.peak(f))}; }, b.roofLit);
        add(front, [=](float f) { return Polygon{D(f), C(f), s.at(s.xm(), s.ym(), s.peak(f))}; }, b.roofLit);
        add(front, [=](float f) { return Polygon{C(f), B(f), s.at(s.xm(), s.ym(), s.peak(f))}; }, b.roofShade);
        break;
    }
}

void wallFaces(std::vector<Face>& faces, const Shell& s)
{
    const auto& b = s.b;
    auto body = s.motion.body(b.delay);
    // +y face (front-left); a y-gable end joins it as a pentagon. Same for +x and an x-gable.
    for (bool frontLeft : {true, false}) {
        bool gableEnd = frontLeft ? b.shape == RoofShape::GableY : b.shape == RoofShape::GableX;
        faces.push_back({[=](float f) {
            auto h = s.top(f);
            float apex = gableEnd ? s.peak(f) : h;
            return Polygon{s.wall(frontLeft, 0, b.base), s.wall(frontLeft, 1, b.base), s.wall(frontLeft, 1, h), s.wall(frontLeft, .5f, apex), s.wall(frontLeft, 0, h)};
        }, frontLeft ? b.wallLit : b.wallShade, Face::Style::Outlined, 1.2f, body});
    }
    if (b.trim == Trim::Timber) {
        for (bool frontLeft : {true, false}) {
            for (float t : {.04f, .96f}) faces.push_back({[=](float f) { return Polygon{s.wall(frontLeft, t, b.base), s.wall(frontLeft, t, s.top(f))}; }, timberLine, Face::Style::Line, 1.6f, body});
            faces.push_back({[=](float f) { float z = b.base + s.motion.wall(b, f) * .52f; return Polygon{s.wall(frontLeft, .04f, z), s.wall(frontLeft, .96f, z)}; }, timberLine, Face::Style::Line, 1.6f, body});
            float brace = frontLeft ? .72f : .3f;
            faces.push_back({[=](float f) { return Polygon{s.wall(frontLeft, brace - .18f, b.base + s.motion.wall(b, f) * .52f), s.wall(frontLeft, brace + .14f, s.top(f))}; }, timberLine, Face::Style::Line, 1.3f, body});
        }
    }
    auto opening = [&](bool frontLeft, float along, float halfWidth, float z0, float z1, Rgb color, OpacityKeys keys) {
        faces.push_back({[=](float f) {
            auto h = s.motion.wall(b, f);
            return Polygon{s.wall(frontLeft, along - halfWidth, b.base + h * z0), s.wall(frontLeft, along + halfWidth, b.base + h * z0),
                           s.wall(frontLeft, along + halfWidth, b.base + h * z1), s.wall(frontLeft, along - halfWidth, b.base + h * z1)};
        }, color, Face::Style::Filled, 1.2f, std::move(keys)});
    };
    for (bool frontLeft : {true, false}) {
        float span = frontLeft ? b.x1 - b.x0 : b.y1 - b.y0;
        float half = std::min(.07f / span, .18f);
        bool doorway = b.door && b.doorFacing == (frontLeft ? 0 : 3);
        for (int i = 0; i < b.windows; ++i) {
            float fraction = float(i + 1) / (b.windows + 1);
            float along = doorway ? (frontLeft ? .55f : .13f) + .32f * fraction : fraction;
            opening(frontLeft, along, half, .4f, .74f, b.glass, s.motion.late(b.delay, 28 + i * 2.f));
        }
    }
    // Quarter turns carry the authored entrance with its wall. The other two walls are hidden.
    if (b.door && (b.doorFacing == 0 || b.doorFacing == 3)) {
        bool frontLeft = b.doorFacing == 0;
        float span = frontLeft ? b.x1 - b.x0 : b.y1 - b.y0;
        opening(frontLeft, frontLeft ? .28f : .72f, std::min(.09f / span, .2f), 0, b.wall > 8 ? .58f : .9f, doorWood, body);
    }
}

// Merlons or sharpened stakes along all four top edges of a flat-topped wall.
void battlements(std::vector<Face>& faces, const Shell& s)
{
    const auto& b = s.b;
    auto body = s.motion.body(b.delay);
    bool stakes = b.trim == Trim::Stakes;
    float rise = stakes ? 7 : 5;
    struct Edge { Point from, to; Rgb color; };
    const Edge edges[] = {
        {{b.x0, b.y0}, {b.x1, b.y0}, b.roofShade}, {{b.x0, b.y0}, {b.x0, b.y1}, b.roofShade},
        {{b.x0, b.y1}, {b.x1, b.y1}, b.wallLit}, {{b.x1, b.y0}, {b.x1, b.y1}, b.wallShade},
    };
    for (const auto& edge : edges) {
        float length = std::hypot(edge.to.x - edge.from.x, edge.to.y - edge.from.y);
        int count = std::max(2, int(length / (stakes ? .12f : .2f)));
        for (int i = 0; i < count; ++i) {
            float t0 = float(i) / count, t1 = t0 + (stakes ? 1.f : .55f) / count;
            auto p = [=](float t, float z) { return s.at(edge.from.x + (edge.to.x - edge.from.x) * t, edge.from.y + (edge.to.y - edge.from.y) * t, z); };
            if (stakes)
                faces.push_back({[=](float f) { float h = s.top(f), r = rise * s.motion.wall(b, f) / std::max(1.f, b.wall); return Polygon{p(t0, h), p(t1, h), p((t0 + t1) / 2, h + r)}; }, edge.color, Face::Style::Outlined, 1.2f, body});
            else
                faces.push_back({[=](float f) { float h = s.top(f), r = rise * s.motion.wall(b, f) / std::max(1.f, b.wall); return Polygon{p(t0, h), p(t1, h), p(t1, h + r), p(t0, h + r)}; }, edge.color, Face::Style::Outlined, 1.2f, body});
        }
    }
}

void ornaments(std::vector<Face>& faces, const Shell& s)
{
    const auto& b = s.b;
    auto keys = s.motion.late(b.delay, 30);
    if (b.ornament == Ornament::Banner) {
        faces.push_back({[=](float f) { auto a = s.summit(f); float k = s.motion.detail(b, f); return Polygon{a, {a.x, a.y - 20 * k, a.depth}}; }, pole, Face::Style::Line, 1.4f, keys});
        faces.push_back({[=](float f) {
            auto a = s.summit(f);
            float k = s.motion.detail(b, f);
            return Polygon{{a.x, a.y - 20 * k, a.depth}, {a.x + 12 * k, a.y - 17 * k, a.depth}, {a.x + 9 * k, a.y - 14.5f * k, a.depth}, {a.x + 12 * k, a.y - 12 * k, a.depth}, {a.x, a.y - 11 * k, a.depth}};
        }, b.accent, Face::Style::Outlined, 1.2f, keys});
    } else if (b.ornament == Ornament::Crystal) {
        // Floating crystal above the peak with a faint halo.
        auto centre = [s, b](float f) { auto a = s.summit(f); return Vertex{a.x, a.y - 16 * s.motion.detail(b, f), a.depth}; };
        faces.push_back({[=](float f) {
            auto c = centre(f);
            float r = 13 * s.motion.detail(b, f);
            Polygon ring;
            for (int i = 0; i < 10; ++i) ring.push_back({c.x + r * std::cos(i * .628f), c.y + r * .8f * std::sin(i * .628f), c.depth});
            return ring;
        }, b.accent, Face::Style::Filled, 1.2f, s.motion.sinking ? keys : OpacityKeys{{s.motion.start + b.delay + 30, 0}, {s.motion.start + b.delay + 36, 22}}});
        for (bool left : {true, false}) {
            faces.push_back({[=](float f) {
                auto c = centre(f);
                float k = s.motion.detail(b, f);
                float side = left ? -5.5f * k : 5.5f * k;
                return Polygon{{c.x, c.y - 10 * k, c.depth}, {c.x + side, c.y, c.depth}, {c.x, c.y + 8 * k, c.depth}};
            }, left ? b.accent : scaled(b.accent, .58f), Face::Style::Outlined, 1.2f, keys});
        }
    }
}

void patchFaces(std::vector<Face>& faces, const Patch& patch, const Motion& motion)
{
    auto keys = motion.body(patch.delay);
    auto grow = [=](float f) { return motion.sinking ? 1.f : gameframework::outCubic((f - motion.start - patch.delay) / 10); };
    auto cx = (patch.x0 + patch.x1) / 2, cy = (patch.y0 + patch.y1) / 2;
    auto at = [=](float x, float y, float k) { return motion.place(cx + (x - cx) * k, cy + (y - cy) * k); };
    faces.push_back({[=](float f) { float k = grow(f); return Polygon{at(patch.x0, patch.y0, k), at(patch.x1, patch.y0, k), at(patch.x1, patch.y1, k), at(patch.x0, patch.y1, k)}; },
                     patch.color, Face::Style::Filled, 1.2f, keys});
    for (int i = 0; i < patch.furrows; ++i) {
        float y = patch.y0 + (patch.y1 - patch.y0) * (i + .5f) / patch.furrows;
        faces.push_back({[=](float f) { float k = grow(f); return Polygon{at(patch.x0 + .05f, y, k), at(patch.x1 - .05f, y, k)}; }, patch.furrow, Face::Style::Line, 1.4f, keys});
    }
}
}  // namespace

Vertex Motion::place(float x, float y, float z) const
{
    float lx = x + offset.x - pivot.x, ly = y + offset.y - pivot.y;
    float c = std::cos(turn), s = std::sin(turn);
    float worldX = pivot.x + lx * c - ly * s, worldY = pivot.y + lx * s + ly * c;
    auto screen = projection.project(worldX, worldY, z);
    return {screen.x, screen.y, worldX + worldY};
}

float Motion::wall(const Block& b, float frame) const
{
    float t = frame - start - b.delay;
    return b.wall * (sinking ? 1 - inCubic(t / 12) : outBack((t - 6) / 14));
}

float Motion::roof(const Block& b, float frame) const
{
    float t = frame - start - b.delay;
    return b.roof * (sinking ? 1 - inCubic(t / 8) : outBack((t - 16) / 12));
}

float Motion::detail(const Block& b, float frame) const
{
    float t = frame - start - b.delay;
    return sinking ? 1 - clamp01(t / 6) : outBack((t - 26) / 10);
}

OpacityKeys Motion::body(float delay) const
{
    float at = start + delay;
    if (sinking) return {{at + 9, 100}, {at + 13, 0}};
    return {{at + 4, 0}, {at + 7, 100}};
}

OpacityKeys Motion::late(float delay, float riseAt) const
{
    float at = start + delay;
    if (sinking) return {{at + 1, 100}, {at + 5, 0}};
    return {{at + riseAt, 0}, {at + riseAt + 6, 100}};
}

void buildingFaces(const Model& model, const Motion& motion, std::vector<Face>& faces)
{
    for (const auto& patch : model.patches) patchFaces(faces, patch, motion);
    for (const auto& block : model.blocks) {
        Shell shell{block, motion};
        std::vector<Face> back, walls, front;
        roofFaces(back, front, shell);
        wallFaces(walls, shell);
        if (block.shape == RoofShape::Flat && block.trim != Trim::None && block.trim != Trim::Timber) battlements(front, shell);
        ornaments(front, shell);
        for (auto* group : {&back, &walls, &front}) faces.insert(faces.end(), group->begin(), group->end());
    }
}
}  // namespace gameframework
