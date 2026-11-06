#include "ymir_statue.h"
#include "vector_paint.h"
#include <cmath>
#include <initializer_list>

namespace hearthold
{
namespace
{
// Dark granite worn by ages, lit from the west and frosted where the frost giant's cold still clings. Daylight
// lifts the world's darks a long way (sunPassSpecs), so these sit low to read as heavy stone on screen.
constexpr Rgb glint{98, 102, 112}, lit{78, 82, 92}, stone{58, 61, 70}, shade{42, 44, 54}, deep{30, 32, 40}, crevice{18, 20, 26};
constexpr Rgb rimeLit{200, 214, 228}, rimeShade{136, 156, 182}, moss{44, 62, 38}, lichen{120, 126, 74}, snow{232, 238, 244};

Outline mirrored(Outline points)
{
    for (auto& p : points) p.x = -p.x;
    return points;
}

// Hewn faces with straight edges.
tvg::Shape* facet(Point base, const Outline& points, Rgba color)
{
    auto shape = tvg::Shape::gen();
    for (size_t i = 0; i < points.size(); ++i) {
        auto p = base + points[i];
        if (i) shape->lineTo(p.x, p.y);
        else shape->moveTo(p.x, p.y);
    }
    shape->close();
    fill(shape, color);
    return shape;
}
tvg::Shape* facet(Point base, const Outline& points, Rgb color) { return facet(base, points, opaque(color)); }

// A closed outline rounded through every point (Catmull-Rom), like carving worn smooth.
tvg::Shape* worn(Point base, const Outline& points, Rgba color)
{
    auto shape = tvg::Shape::gen();
    size_t n = points.size();
    auto at = [&](size_t i) { return base + points[i % n]; };
    shape->moveTo(at(0).x, at(0).y);
    for (size_t i = 0; i < n; ++i) {
        Point p0 = at(i + n - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
        Point c1 = p1 + (p2 - p0) * (1 / 6.f), c2 = p2 - (p3 - p1) * (1 / 6.f);
        shape->cubicTo(c1.x, c1.y, c2.x, c2.y, p2.x, p2.y);
    }
    shape->close();
    fill(shape, color);
    return shape;
}
tvg::Shape* worn(Point base, const Outline& points, Rgb color) { return worn(base, points, opaque(color)); }

// Stone darkening from its top to its foot, lit from above.
tvg::Shape* weathered(tvg::Shape* shape, Point base, Rgb color, float top, float bottom)
{
    verticalShade(shape, color, base.y + top, base.y + bottom, 1.1f, .82f);
    return shape;
}

// A limb from `a` to `b`, `wa` wide at a and `wb` at b, with rounded ends.
Outline limb(Point a, Point b, float wa, float wb)
{
    auto along = normalized(b - a);
    Point across{-along.y, along.x};
    return {a - along * (wa * .45f), a + across * (wa / 2), b + across * (wb / 2), b + along * (wb * .45f), b - across * (wb / 2), a - across * (wa / 2)};
}

// A line cut into the stone: a dark groove whose lower lip catches the light.
void groove(tvg::Scene* objects, Point base, const Outline& points, float width = 1.6f, uint8_t alpha = 210)
{
    auto cut = tvg::Shape::gen(), lip = tvg::Shape::gen();
    bool first = true;
    for (auto p : points) {
        auto q = base + p;
        if (first) {
            cut->moveTo(q.x, q.y);
            lip->moveTo(q.x + .8f, q.y + 1.2f);
        } else {
            cut->lineTo(q.x, q.y);
            lip->lineTo(q.x + .8f, q.y + 1.2f);
        }
        first = false;
    }
    lip->strokeWidth(width * .7f);
    lip->strokeFill(glint.r, glint.g, glint.b, uint8_t(alpha / 3));
    lip->strokeCap(tvg::StrokeCap::Round);
    cut->strokeWidth(width);
    cut->strokeFill(crevice.r, crevice.g, crevice.b, alpha);
    cut->strokeCap(tvg::StrokeCap::Round);
    cut->strokeJoin(tvg::StrokeJoin::Round);
    objects->add(lip);
    objects->add(cut);
}
void groove(tvg::Scene* objects, Point base, std::initializer_list<Point> points, float width = 1.6f, uint8_t alpha = 210) { groove(objects, base, Outline(points), width, alpha); }

// Rainwater's dark wash down a face.
void stain(tvg::Scene* objects, Point base, Point top, float length, float width)
{
    objects->add(facet(base, {top, {top.x + width, top.y}, {top.x + width * .65f, top.y + length}, {top.x + width * .25f, top.y + length}}, opaque(crevice, 50)));
}

// A tier of hewn granite: an octagon `ax` by `ay` with clipped corners, standing `height` tall on `bottom`.
void tier(tvg::Scene* objects, Point base, float ax, float ay, float corner, float bottom, float height, Rgb top, Rgb west, Rgb south, Rgb east)
{
    const Outline ground{{-ax, -corner / 2}, {-corner, -ay}, {corner, -ay}, {ax, -corner / 2}, {ax, corner / 2}, {corner, ay}, {-corner, ay}, {-ax, corner / 2}};
    auto at = [&](int i, float lift) { return Point{ground[size_t(i)].x, ground[size_t(i)].y - lift}; };
    auto face = [&](int from, int to, Rgb color) { objects->add(facet(base, {at(from, bottom + height), at(to, bottom + height), at(to, bottom), at(from, bottom)}, color)); };
    face(0, 7, west);
    face(7, 6, west);
    face(6, 5, south);
    face(5, 4, east);
    face(4, 3, east);
    Outline cap;
    for (int i = 0; i < 8; ++i) cap.push_back(at(i, bottom + height));
    objects->add(facet(base, cap, top));
}

// A band of runes cut along a face from `from` to `to` (ground corners), `low` to `high` above the ground.
void runes(tvg::Scene* objects, Point base, Point from, Point to, float low, float high, int count)
{
    auto along = normalized(to - from);
    Point lift{0, -1};
    groove(objects, base, {from + lift * high, to + lift * high}, 1.2f, 160);
    groove(objects, base, {from + lift * low, to + lift * low}, 1.2f, 160);
    float mid = (low + high) / 2, half = (high - low) / 2 - 2.5f;
    for (int i = 0; i < count; ++i) {
        auto p = lerp(from, to, (i + .5f) / count) + lift * mid;
        Point top = p + lift * half, bottom = p - lift * half;
        groove(objects, base, {top, bottom}, 1.4f, 190);  // Each stave, and its branches by the rune.
        int kind = (i * 7 + 3) % 5;
        if (kind == 0 || kind == 3) groove(objects, base, {top, top + along * 4.5f + Point{0, 3}}, 1.2f, 180);
        if (kind == 1 || kind == 3) groove(objects, base, {p, p + along * 4.5f - Point{0, 3}}, 1.2f, 180);
        if (kind == 2) groove(objects, base, {top + along * -3.5f + Point{0, 2}, bottom + along * 3.5f - Point{0, 2}}, 1.2f, 180);
        if (kind == 4) groove(objects, base, {p + along * -4.f, p + along * 4.f}, 1.2f, 180);
    }
}
}  // namespace

void lightYmir(tvg::Scene* lights, Point base) { lights->add(glow(base, 210, 105, {150, 190, 235}, 34)); }

YmirLight paintYmir(tvg::Scene* objects, Point base, const Climate& climate, bool inWater)
{
    bool snowy = climate.snow > .3f;
    Rgb frost = snowy ? snow : rimeLit;

    // Rising from the sea: the dark stone shows in the still water before its two front faces, fading away from them.
    if (inWater)
        for (auto [depth, alpha] : {std::pair{34.f, uint8_t(60)}, std::pair{18.f, uint8_t(70)}})
            objects->add(facet(base, {{-172, 6}, {0, 86}, {172, 6}, {172, 6 + depth * .6f}, {0, 86 + depth}, {-172, 6 + depth * .6f}}, opaque(Rgb{10, 16, 24}, alpha)));
    // Two tiers of hewn granite, runes cut round the lower one, moss and lichen where the rain runs off.
    tier(objects, base, 172, 86, 12, 0, 24, {62, 66, 64}, {56, 58, 66}, {44, 46, 56}, {32, 34, 42});
    if (inWater) objects->add(facet(base, {{-172, 6}, {-12, 86}, {12, 86}, {172, 6}, {172, -2}, {12, 78}, {-12, 78}, {-172, -2}}, opaque(crevice, 110)));
    runes(objects, base, {-172, 6}, {-12, 86}, 6, 19, 9);
    runes(objects, base, {12, 86}, {172, 6}, 6, 19, 9);
    tier(objects, base, 140, 70, 10, 24, 20, {68, 72, 70}, {62, 64, 72}, {48, 50, 60}, {36, 38, 46});
    groove(objects, base, {{-140, -29}, {-10, -94}}, 1.2f, 120);
    groove(objects, base, {{10, -94}, {140, -29}}, 1.2f, 120);
    groove(objects, base, {{-140, 5 - 34}, {-10, 70 - 34}, {10, 70 - 34}, {140, 5 - 34}}, 1.4f, 150);
    for (Outline patch : {Outline{{-160, -26}, {-132, -40}, {-112, -30}, {-138, -18}}, Outline{{-40, 46}, {-14, 50}, {-24, 60}, {-48, 56}}, Outline{{96, 32}, {124, 22}, {134, 32}, {110, 40}}})
        objects->add(worn(base, patch, opaque(moss, 200)));
    for (Point dot : {Point{-150, 2}, Point{-136, 12}, Point{-96, 40}, Point{-70, 52}, Point{-120, -36}, Point{-60, -46}})
        objects->add(ellipse(base + dot, 2.6f, 1.6f, opaque(lichen, 160)));

    // His shadow on the upper tier, and the throne behind him: a slab with a ring cut round his head.
    objects->add(facet(base, {{44, -18}, {96, -24}, {130, -52}, {134, -84}, {112, -104}, {66, -70}}, opaque(crevice, 70)));
    objects->add(facet(base, {{-118, -384}, {-130, -378}, {-130, -146}, {-118, -150}}, lit));
    const Outline slab{{-118, -150}, {-118, -384}, {-100, -414}, {-60, -436}, {0, -448}, {60, -436}, {100, -414}, {118, -384}, {118, -150}};
    objects->add(weathered(facet(base, slab, stone), base, stone, -448, -150));
    objects->add(facet(base, {{50, -404}, {100, -414}, {118, -384}, {118, -300}, {96, -318}, {60, -352}}, opaque(crevice, 60)));
    auto ring = tvg::Shape::gen();
    ring->appendCircle(base.x, base.y - 368, 72, 72);
    ring->strokeWidth(5);
    ring->strokeFill(crevice.r, crevice.g, crevice.b, 200);
    objects->add(ring);
    for (int i = 0; i < 16; ++i) {
        float a = i * .3927f;
        Point inner{std::cos(a) * 64, -368 + std::sin(a) * 64}, outer{std::cos(a) * 80, -368 + std::sin(a) * 80};
        groove(objects, base, {inner, outer}, 1.6f, 180);
    }
    objects->add(worn(base, {{-100, -414}, {-60, -436}, {0, -448}, {60, -436}, {100, -414}, {60, -428}, {0, -440}, {-60, -428}}, opaque(frost, 220)));
    stain(objects, base, {-88, -410}, 90, 7);
    stain(objects, base, {74, -400}, 110, 7);
    groove(objects, base, {{92, -424}, {82, -390}, {94, -360}});

    // Arms of the throne, solid blocks at his sides, a spiral cut in each front.
    for (int side : {-1, 1}) {
        bool west = side < 0;
        auto block = [&](Outline points) { return west ? points : mirrored(points); };
        objects->add(facet(base, block({{-164, -258}, {-156, -196}, {-156, -28}, {-164, -92}}), west ? lit : deep));
        objects->add(facet(base, block({{-164, -258}, {-124, -258}, {-118, -196}, {-156, -196}}), west ? glint : stone));
        objects->add(facet(base, block({{-156, -196}, {-118, -196}, {-118, -28}, {-156, -28}}), west ? stone : shade));
        float x = side * 137.f;
        groove(objects, base, {{x, -166}, {x + 6, -170}, {x + 9, -162}, {x + 2, -154}, {x - 8, -158}, {x - 10, -170}, {x - 2, -180}, {x + 10, -178}}, 1.5f, 180);
        objects->add(facet(base, block({{-164, -258}, {-124, -258}, {-122, -250}, {-162, -250}}), opaque(frost, 200)));
    }

    // A fur mantle hangs behind his arms; the body sits upright, belted.
    const Outline drape{{-136, -292}, {-154, -240}, {-152, -196}, {-128, -206}, {-116, -296}};
    objects->add(worn(base, drape, shade));
    objects->add(worn(base, mirrored(drape), deep));
    const Outline torso{{-118, -300}, {-96, -318}, {-50, -330}, {0, -334}, {50, -330}, {96, -318}, {118, -300}, {110, -262}, {98, -222}, {86, -192}, {50, -182}, {-50, -182}, {-86, -192}, {-98, -222}, {-110, -262}};
    objects->add(weathered(worn(base, torso, stone), base, stone, -334, -182));
    objects->add(weathered(worn(base, {{-118, -300}, {-96, -318}, {-50, -330}, {-4, -334}, {-8, -182}, {-50, -182}, {-86, -192}, {-98, -222}, {-110, -262}}, lit), base, lit, -334, -182));
    groove(objects, base, {{-96, -262}, {-70, -252}, {-44, -250}});
    groove(objects, base, {{96, -262}, {70, -252}, {44, -250}});
    objects->add(facet(base, {{-88, -202}, {88, -202}, {86, -186}, {-86, -186}}, deep));
    groove(objects, base, {{-88, -203}, {88, -203}}, 1.2f, 120);
    auto buckle = tvg::Shape::gen();
    buckle->appendCircle(base.x, base.y - 194, 9, 8);
    buckle->strokeWidth(3);
    buckle->strokeFill(glint.r, glint.g, glint.b, 220);
    objects->add(buckle);
    stain(objects, base, {-64, -232}, 40, 5);
    groove(objects, base, {{-44, -310}, {-36, -286}, {-42, -262}});
    objects->add(worn(base, {{-108, -290}, {-90, -298}, {-86, -204}, {-100, -218}}, opaque(crevice, 120)));
    objects->add(worn(base, {{108, -290}, {90, -298}, {86, -204}, {100, -218}}, opaque(crevice, 150)));

    // Upper arms, and the mantle over his shoulders, its fur cut in short strokes.
    const Outline upperArm = limb({-114, -298}, {-134, -212}, 64, 56);
    objects->add(weathered(worn(base, upperArm, lit), base, lit, -330, -184));
    objects->add(weathered(worn(base, mirrored(upperArm), shade), base, shade, -330, -184));
    stain(objects, base, {-124, -280}, 60, 6);
    const Outline mantle{{-140, -290}, {-128, -316}, {-94, -336}, {-50, -348}, {0, -352}, {50, -348}, {94, -336}, {128, -316}, {140, -290}, {118, -298}, {96, -316}, {50, -328}, {0, -332}, {-50, -328}, {-96, -316}, {-118, -298}};
    objects->add(worn(base, mantle, shade));
    objects->add(worn(base, {{-140, -290}, {-128, -316}, {-94, -336}, {-50, -348}, {0, -352}, {0, -332}, {-50, -328}, {-96, -316}, {-118, -298}}, lit));
    for (int i = 0; i <= 12; ++i) {
        float t = i / 12.f, x = -128 + t * 256, y = -316 - std::sin(t * 3.1416f) * 30;
        groove(objects, base, {{x - 3, y + 4}, {x, y + 12}, {x + 3, y + 4}}, 1.2f, 150);
    }
    objects->add(worn(base, {{-140, -292}, {-128, -318}, {-94, -338}, {-50, -350}, {0, -354}, {-50, -346}, {-94, -334}, {-126, -314}}, opaque(frost, snowy ? 230 : 150)));
    objects->add(worn(base, {{140, -292}, {128, -318}, {94, -338}, {50, -350}, {0, -354}, {50, -346}, {94, -334}, {126, -314}}, opaque(snowy ? snow : rimeShade, snowy ? 220 : 120)));

    // Thighs on the seat, the seat's front between the shins, and the feet planted on the dais.
    const Outline thigh{{-104, -150}, {-34, -150}, {-30, -188}, {-100, -192}};
    objects->add(worn(base, thigh, lit));
    objects->add(worn(base, mirrored(thigh), shade));
    objects->add(facet(base, {{-42, -152}, {42, -152}, {42, -44}, {-42, -44}}, deep));
    groove(objects, base, {{-42, -96}, {42, -96}}, 1.2f, 130);
    for (int side : {-1, 1}) objects->add(ellipse(base + Point{side * 70.f, 14}, 44, 7, opaque(crevice, 90)));
    const Outline shin{{-104, -128}, {-38, -128}, {-40, -70}, {-46, -16}, {-92, -16}, {-100, -70}};
    objects->add(weathered(worn(base, shin, lit), base, lit, -128, -16));
    objects->add(weathered(worn(base, {{-58, -128}, {-38, -128}, {-40, -70}, {-46, -16}, {-64, -16}}, stone), base, stone, -128, -16));
    objects->add(weathered(worn(base, mirrored(shin), shade), base, shade, -128, -16));
    stain(objects, base, {70, -112}, 70, 6);
    groove(objects, base, {{-86, -96}, {-74, -70}, {-80, -48}});
    const Outline foot{{-100, -22}, {-40, -22}, {-32, -2}, {-40, 16}, {-96, 16}, {-106, -2}};
    objects->add(worn(base, foot, stone));
    objects->add(worn(base, mirrored(foot), deep));
    for (float x : {-88.f, -74.f, -60.f, -48.f}) {
        groove(objects, base, {{x, 4}, {x + 1, 15}}, 1.3f, 170);
        groove(objects, base, {{-x, 4}, {-x - 1, 15}}, 1.3f, 170);
    }
    objects->add(worn(base, {{-98, -6}, {-80, -12}, {-76, 0}, {-92, 4}}, opaque(moss, 170)));

    // Knees, the forearms laid along the thighs, and the great hands at rest on the knees.
    objects->add(worn(base, {{-104, -140}, {-86, -158}, {-54, -162}, {-36, -148}, {-38, -126}, {-70, -118}, {-100, -124}}, lit));
    objects->add(worn(base, {{104, -140}, {86, -158}, {54, -162}, {36, -148}, {38, -126}, {70, -118}, {100, -124}}, shade));
    const Outline forearm = limb({-134, -214}, {-78, -150}, 54, 46);
    objects->add(weathered(worn(base, forearm, stone), base, stone, -240, -130));
    objects->add(weathered(worn(base, mirrored(forearm), deep), base, deep, -240, -130));
    // Each hand: its back on the knee, a thumb inside, four fingers hanging over the front.
    for (int side : {-1, 1}) {
        bool west = side < 0;
        auto own = [&](Outline points) { return west ? points : mirrored(points); };
        objects->add(worn(base, own({{-112, -170}, {-40, -170}, {-36, -148}, {-110, -146}}), west ? lit : shade));
        objects->add(worn(base, own({{-44, -164}, {-30, -152}, {-32, -134}, {-44, -138}}), west ? stone : deep));
        for (int i = 0; i < 4; ++i) {
            float x = -108 + i * 17.f;
            objects->add(worn(base, own({{x, -150}, {x + 15, -150}, {x + 14, -124}, {x + 7.5f, -116}, {x + 1, -124}}), i % 2 == (west ? 0 : 1) ? (west ? lit : shade) : (west ? stone : deep)));
        }
        groove(objects, base, own({{-108, -149}, {-42, -149}}), 1.4f, 170);
    }
    objects->add(worn(base, {{-112, -170}, {-76, -175}, {-40, -170}, {-76, -167}}, opaque(frost, snowy ? 230 : 110)));

    // The head held high, carved a size up so his face holds at a distance: long hair behind it, the brow
    // heavy over deep sockets and blank stone eyes.
    constexpr Point crown{0, -368};
    constexpr float big = 1.2f;
    auto up = [&](Outline points) {
        for (auto& p : points) p = crown + (p - crown) * big;
        return points;
    };
    const Outline hair{{-50, -396}, {-64, -372}, {-68, -334}, {-58, -312}, {-44, -338}};
    objects->add(worn(base, up(hair), shade));
    objects->add(worn(base, up(mirrored(hair)), deep));
    const Outline head{{-44, -404}, {-24, -416}, {0, -420}, {24, -416}, {44, -404}, {50, -374}, {46, -344}, {34, -326}, {0, -318}, {-34, -326}, {-46, -344}, {-50, -374}};
    objects->add(weathered(worn(base, up(head), stone), base, stone, -430, -308));
    objects->add(worn(base, up({{-44, -404}, {-24, -416}, {0, -420}, {-2, -318}, {-34, -326}, {-46, -344}, {-50, -374}}), lit));
    objects->add(facet(base, up({{-44, -386}, {44, -386}, {40, -372}, {-40, -372}}), shade));
    objects->add(facet(base, up({{-44, -390}, {44, -390}, {44, -386}, {-44, -386}}), glint));
    for (float x : {-17.f, 17.f}) {
        auto socket = crown + (Point{x, -363} - crown) * big;
        objects->add(ellipse(base + socket, 12 * big, 7 * big, opaque(deep)));
        objects->add(ellipse(base + socket + Point{0, 1}, 7 * big, 4 * big, opaque(shade)));
    }
    objects->add(facet(base, up({{-7, -372}, {7, -372}, {11, -340}, {0, -335}, {-11, -340}}), stone));
    objects->add(facet(base, up({{-7, -372}, {0, -372}, {0, -335}, {-11, -340}}), lit));
    objects->add(worn(base, up({{-42, -356}, {-26, -352}, {-24, -342}, {-40, -340}}), opaque(glint, 130)));

    // The beard, full and broad, three braids cut in it with rime at their tips, under a heavy moustache.
    const Outline beard{{-46, -344}, {-42, -320}, {-54, -292}, {-50, -262}, {-34, -232}, {-16, -212}, {0, -204}, {16, -212}, {34, -232}, {50, -262}, {54, -292}, {42, -320}, {46, -344}, {20, -336}, {0, -332}, {-20, -336}};
    objects->add(weathered(worn(base, up(beard), shade), base, shade, -350, -170));
    objects->add(worn(base, up({{-46, -344}, {-42, -320}, {-54, -292}, {-50, -262}, {-34, -232}, {-16, -212}, {0, -204}, {-2, -270}, {0, -332}, {-20, -336}}), stone));
    groove(objects, base, up({{-46, -345}, {-20, -337}, {0, -333}, {20, -337}, {46, -345}}), 2.4f, 230);  // Where the beard leaves the cheeks.
    groove(objects, base, up({{-18, -328}, {-21, -290}, {-17, -250}, {-10, -218}}), 2.2f);
    groove(objects, base, up({{18, -328}, {21, -290}, {17, -250}, {10, -218}}), 2.2f);
    for (float y : {-286.f, -248.f}) {
        groove(objects, base, up({{-44, y}, {-23, y + 2}}));
        groove(objects, base, up({{-14, y + 3}, {14, y + 3}}));
        groove(objects, base, up({{23, y + 2}, {44, y}}));
    }
    for (float x : {-28.f, 0.f, 28.f}) {
        float y = -224 + std::abs(x) * .5f;
        objects->add(worn(base, up({{x - 6, y + 2}, {x + 6, y + 2}, {x, y + 11}}), opaque(frost, snowy ? 230 : 150)));
    }
    objects->add(worn(base, up({{-36, -342}, {-8, -346}, {0, -340}, {8, -346}, {36, -342}, {30, -330}, {0, -334}, {-30, -330}}), lit));
    objects->add(worn(base, up({{0, -340}, {8, -346}, {36, -342}, {30, -330}, {0, -334}}), stone));
    groove(objects, base, up({{-30, -330}, {0, -334}, {30, -330}}), 1.8f, 220);

    // A circlet of stone set with spikes of ice.
    objects->add(facet(base, up({{-48, -398}, {48, -398}, {46, -388}, {-46, -388}}), shade));
    objects->add(facet(base, up({{-48, -398}, {0, -398}, {0, -388}, {-46, -388}}), stone));
    float band = crown.y + (-398 - crown.y) * big;
    for (auto [x, h] : {std::pair{-40.f, 14.f}, std::pair{-27.f, 20.f}, std::pair{-14.f, 26.f}, std::pair{0.f, 32.f}, std::pair{14.f, 26.f}, std::pair{27.f, 20.f}, std::pair{40.f, 14.f}}) {
        float at = x * big;
        objects->add(facet(base, {{at - 6, band}, {at, band}, {at, band - h}}, rimeLit));
        objects->add(facet(base, {{at, band}, {at + 6, band}, {at, band - h}}, rimeShade));
    }
    for (Point dot : {Point{-100, -250}, Point{-84, -226}, Point{-60, -290}, Point{-94, -84}, Point{-78, -40}, Point{-30, -390}})
        objects->add(ellipse(base + dot, 2.4f, 1.8f, opaque(lichen, 150)));
    if (snowy) {
        objects->add(worn(base, up({{-48, -398}, {-24, -418}, {0, -424}, {24, -418}, {48, -398}, {0, -410}}), snow));
        objects->add(worn(base, {{-164, -258}, {-140, -262}, {-124, -258}, {-140, -252}}, snow));
        objects->add(worn(base, {{164, -258}, {140, -262}, {124, -258}, {140, -252}}, snow));
        objects->add(worn(base, {{-140, -44}, {-10, -112}, {10, -112}, {140, -44}, {120, -46}, {10, -104}, {-10, -104}, {-120, -46}}, opaque(snow, 220)));
    }

    // Eyes that catch a cold light only after dark.
    YmirLight light{{base + crown + (Point{-17, -362} - crown) * big, base + crown + (Point{17, -362} - crown) * big}, base};
    for (size_t i = 0; i < 2; ++i) {
        auto* eye = ellipse(light.eyes[i], 5, 2.4f, {176, 214, 255, 255});
        eye->opacity(0);
        objects->add(eye);
        light.glints[i] = eye;
    }
    return light;
}
}  // namespace hearthold
