#include "portrait_background.h"
#include "terrain_painter.h"
#include <algorithm>
#include <cmath>

namespace hearthold
{
namespace
{
Rgb groundTone(Terrain terrain, uint8_t shade, const Climate& climate)
{
    return mix(groundColor(terrain, shade, climate), {17, 24, 36}, std::clamp(climate.night, 0.f, 1.f) * .45f);
}
}  // namespace

PortraitBackdrop portraitBackdrop() { return portraitBackdrop(Terrain::Grass); }

PortraitBackdrop portraitBackdrop(Terrain terrain, const Climate& climate)
{
    return {groundTone(terrain, 1, climate), groundTone(terrain, 2, climate),
            groundTone(terrain, 0, climate), groundTone(terrain, 1, climate)};
}

PortraitBackdrop portraitBackdrop(const WorldMap& map, Point position, const Climate& climate)
{
    auto sample = [&](Point p) {
        auto tile = map.cell(p);
        return groundTone(map.terrainAt(p), tile ? tile->shade : 1, climate);
    };
    auto ground = sample(position);
    // Anchor the surroundings to the cell, rather than rebuilding a face for every walking subpixel.
    Point center{std::floor(position.x) + .5f, std::floor(position.y) + .5f};
    auto left = sample({center.x - 2, center.y + 2});
    auto right = sample({center.x + 2, center.y - 2});
    auto distant = sample({center.x - 2, center.y - 2});
    return {ground, mix(ground, left, .65f), mix(ground, right, .65f), mix(ground, distant, .5f)};
}

tvg::Scene* portraitBackground(const PortraitBackdrop& backdrop, float width, float height)
{
    auto scene = tvg::Scene::gen();
    auto ground = tvg::Shape::gen();
    ground->appendRect(0, 0, width, height);
    // A quiet lift behind the hair, with the actual terrain colour at the foot of the card.
    verticalShade(ground, backdrop.distant, 0, height, 1.48f, .8f);
    scene->add(ground);
    auto left = tvg::Shape::gen();
    left->moveTo(0, height * .48f);
    left->cubicTo(width * .18f, height * .36f, width * .38f, height * .6f, width, height * .71f);
    left->lineTo(width, height); left->lineTo(0, height); left->close();
    fill(left, opaque(scale(backdrop.left, 1.13f)));
    scene->add(left);
    auto right = tvg::Shape::gen();
    right->moveTo(width, height * .49f);
    right->cubicTo(width * .76f, height * .37f, width * .56f, height * .6f, 0, height * .77f);
    right->lineTo(0, height); right->lineTo(width, height); right->close();
    fill(right, opaque(backdrop.right));
    scene->add(right);
    auto near = tvg::Shape::gen();
    near->moveTo(0, height * .86f);
    near->cubicTo(width * .3f, height * .72f, width * .68f, height * .91f, width, height * .8f);
    near->lineTo(width, height); near->lineTo(0, height); near->close();
    fill(near, opaque(backdrop.ground));
    scene->add(near);
    return scene;
}
}  // namespace hearthold
