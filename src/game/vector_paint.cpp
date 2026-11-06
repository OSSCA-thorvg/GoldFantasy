#include "vector_paint.h"
#include <ui/ui.h>
#include <vector>

namespace hearthold
{
tvg::Scene* blendLayer(tvg::Paint* paint, tvg::BlendMethod method)
{
    auto layer = tvg::Scene::gen();
    layer->add(paint);
    layer->blend(method);
    return layer;
}

Rgb mix(Rgb a, Rgb b, float t)
{
    return {uint8_t(a.r + (b.r - a.r) * t), uint8_t(a.g + (b.g - a.g) * t), uint8_t(a.b + (b.b - a.b) * t)};
}

Rgb scale(Rgb c, float k) { return {uint8_t(std::min(255.f, c.r * k)), uint8_t(std::min(255.f, c.g * k)), uint8_t(std::min(255.f, c.b * k))}; }

void fill(tvg::Shape* shape, Rgba c) { shape->fill(c.r, c.g, c.b, c.a); }

void appendStrip(tvg::Shape* shape, std::span<const Point> path, float wide, float narrow)
{
    if (path.size() < 2) return;
    std::vector<Point> left, right;
    for (size_t i = 0; i < path.size(); ++i) {
        auto along = normalized(path[std::min(i + 1, path.size() - 1)] - path[i > 0 ? i - 1 : 0]);
        float half = (wide + (narrow - wide) * float(i) / float(path.size() - 1)) / 2;
        left.push_back(path[i] + Point{-along.y, along.x} * half);
        right.push_back(path[i] - Point{-along.y, along.x} * half);
    }
    shape->moveTo(left[0].x, left[0].y);
    for (size_t i = 1; i < left.size(); ++i) shape->lineTo(left[i].x, left[i].y);
    for (size_t i = right.size(); i-- > 0;) shape->lineTo(right[i].x, right[i].y);
    shape->close();
}

void appendPolygon(tvg::Shape* shape, std::initializer_list<Point> points)
{
    bool first = true;
    for (auto p : points) {
        if (first) shape->moveTo(p.x, p.y);
        else shape->lineTo(p.x, p.y);
        first = false;
    }
    shape->close();
}

tvg::Shape* polygon(std::initializer_list<Point> points, Rgba color)
{
    auto shape = tvg::Shape::gen();
    appendPolygon(shape, points);
    fill(shape, color);
    return shape;
}

tvg::Shape* ellipse(Point center, float rx, float ry, Rgba color)
{
    auto shape = tvg::Shape::gen();
    shape->appendCircle(center.x, center.y, rx, ry);
    fill(shape, color);
    return shape;
}

tvg::Shape* line(Point a, Point b, float width, Rgba color)
{
    auto shape = tvg::Shape::gen();
    shape->moveTo(a.x, a.y);
    shape->lineTo(b.x, b.y);
    shape->strokeWidth(width);
    shape->strokeCap(tvg::StrokeCap::Round);
    shape->strokeFill(color.r, color.g, color.b, color.a);
    return shape;
}

tvg::Shape* sightDisc(float radius)
{
    auto disc = tvg::Shape::gen();
    disc->appendCircle(0, 0, radius, radius);
    auto falloff = tvg::RadialGradient::gen();
    falloff->radial(0, 0, radius, 0, 0, 0);
    tvg::Fill::ColorStop stops[] = {{0, 255, 255, 255, 255}, {.7f, 255, 255, 255, 255}, {.86f, 255, 255, 255, 110}, {1, 255, 255, 255, 0}};
    falloff->colorStops(stops, 4);
    disc->fill(falloff);
    return disc;
}

tvg::Shape* softDisc(float radius, Rgb color, uint8_t alpha)
{
    auto disc = tvg::Shape::gen();
    disc->appendCircle(0, 0, radius, radius);
    auto falloff = tvg::RadialGradient::gen();
    falloff->radial(0, 0, radius, 0, 0, 0);
    // Bright core, long gentle tail, as light thins with distance.
    tvg::Fill::ColorStop stops[] = {
        {0, color.r, color.g, color.b, alpha},
        {.3f, color.r, color.g, color.b, uint8_t(alpha * .55f)},
        {.65f, color.r, color.g, color.b, uint8_t(alpha * .18f)},
        {1, color.r, color.g, color.b, 0},
    };
    falloff->colorStops(stops, 4);
    disc->fill(falloff);
    return disc;
}

tvg::Scene* glow(Point center, float rx, float ry, Rgb color, uint8_t alpha)
{
    auto pool = tvg::Scene::gen();
    pool->add(softDisc(rx, color, alpha));
    ui::setTransform(pool, {1, 0, center.x, 0, ry / rx, center.y, 0, 0, 1});
    return pool;
}

void verticalShade(tvg::Shape* shape, Rgb color, float top, float bottom, float lift, float sink)
{
    auto shade = tvg::LinearGradient::gen();
    shade->linear(0, top, 0, bottom);
    auto high = scale(color, lift), low = scale(color, sink);
    tvg::Fill::ColorStop stops[] = {{0, high.r, high.g, high.b, 255}, {1, low.r, low.g, low.b, 255}};
    shade->colorStops(stops, 2);
    shape->fill(shade);
}

void clear(tvg::Scene* scene)
{
    std::vector<tvg::Paint*> children(scene->paints().begin(), scene->paints().end());
    for (auto* child : children) child->ref();
    scene->remove();
    for (auto* child : children) child->unref();
}

void detach(tvg::Scene* scene, tvg::Paint* paint)
{
    paint->ref();
    scene->remove(paint);
    paint->unref(false);
}
}  // namespace hearthold
