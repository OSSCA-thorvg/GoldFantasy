#pragma once

#include "building_catalog.h"
#include "iso_projection.h"
#include <initializer_list>
#include <span>

namespace hearthold
{
struct Rgba
{
    uint8_t r, g, b, a = 255;
};

inline Rgba opaque(Rgb c, uint8_t a = 255) { return {c.r, c.g, c.b, a}; }

// Full sun over the world: a near-white soft light for contrast, then a small
// additive lift that brightens without the milky haze a screen pass leaves.
struct SunPass
{
    tvg::BlendMethod method;
    uint8_t r, g, b, alpha;
};
constexpr SunPass sunPassSpecs[2] = {{tvg::BlendMethod::SoftLight, 255, 246, 228, 255}, {tvg::BlendMethod::Add, 34, 30, 22, 255}};
// How that sun shows on figures in the street at noon, as measured there: about in * k + lift, which
// the passes above do not give over a sprite alone. The editor's world preview wears this light.
constexpr SunPass figureLight[2] = {{tvg::BlendMethod::Multiply, 165, 199, 210, 255}, {tvg::BlendMethod::Add, 91, 70, 57, 255}};
Rgb mix(Rgb a, Rgb b, float t);
Rgb scale(Rgb c, float k);

// Blend after clipping the source, so clipped GPU paints keep their custom blend mode.
tvg::Scene* blendLayer(tvg::Paint*, tvg::BlendMethod);
void fill(tvg::Shape*, Rgba);
tvg::Shape* polygon(std::initializer_list<Point>, Rgba);
void appendPolygon(tvg::Shape*, std::initializer_list<Point>);
// A ribbon along `path`, `wide` across at its start narrowing (or widening) to `narrow` at its end.
void appendStrip(tvg::Shape*, std::span<const Point> path, float wide, float narrow);
tvg::Shape* ellipse(Point center, float rx, float ry, Rgba);
tvg::Shape* line(Point a, Point b, float width, Rgba);
// A circle of light fading smoothly from a bright core to nothing at `radius`, around (0, 0).
tvg::Shape* softDisc(float radius, Rgb color, uint8_t alpha);
// A white disc, solid to 70% of its radius then fading out: one patch of sight in a vision mask.
tvg::Shape* sightDisc(float radius);
// A soft elliptical pool of light on the ground. Gradients are safe with GL; the CPU fallback
// redraws whole frames because partial redraws accumulate them.
tvg::Scene* glow(Point center, float rx, float ry, Rgb color, uint8_t alpha);
// Fills with the colour lit from above: `lift` times brighter at y = top, `sink` times at y = bottom.
void verticalShade(tvg::Shape*, Rgb color, float top, float bottom, float lift, float sink);
// ThorVG damages a removed paint only while another reference keeps it alive.
void clear(tvg::Scene*);
// Removes one paint the caller keeps referenced, so its old area repaints.
void detach(tvg::Scene*, tvg::Paint*);
}  // namespace hearthold
