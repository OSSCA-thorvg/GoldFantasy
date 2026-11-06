#include "volcano_painter.h"
#include "vector_paint.h"
#include "world_map.h"
#include <algorithm>
#include <cmath>
#include <tuple>
#include <vector>

namespace hearthold
{
namespace
{
// Basalt sits low for the same reason Ymir's granite does: daylight lifts the world's darks a long way.
constexpr Rgb basaltLit{46, 38, 38}, basalt{28, 23, 25}, scoria{14, 11, 13}, rimLit{74, 60, 56};
constexpr Rgb crust{112, 34, 20}, lava{214, 76, 30}, molten{255, 172, 70}, smoke{70, 66, 70}, smokeLit{116, 110, 112};

}  // namespace

void lightVolcano(tvg::Scene* lights, const VolcanoLight& light) { lights->add(glow(light.crater, 200, 110, {255, 120, 40}, 80)); }

void paintSteam(tvg::Scene* objects, Point at, uint32_t salt)
{
    // Puffs climbing and leaning downwind as they thin, grey beneath and white on their lit west side, like the
    // volcano's smoke but paler.
    for (int i = 0; i < 4; ++i) {
        float t = i / 3.f, r = 12 + 15 * t + 5 * hash01(salt, i, 1, 850);
        Point c{at.x + 16 * t * t + (hash01(salt, i, 2, 850) - .5f) * 8, at.y - 4 - 44 * t};
        auto alpha = uint8_t(150 - 90 * t);
        objects->add(ellipse({c.x + r * .12f, c.y + r * .14f}, r, r * .62f, opaque(Rgb{138, 144, 150}, alpha)));
        objects->add(ellipse({c.x - r * .2f, c.y - r * .14f}, r * .64f, r * .4f, opaque(Rgb{228, 230, 230}, uint8_t(alpha * .8f))));
    }
}

namespace
{
struct Vec
{
    float x, y, z;  // East, up, and towards the viewer across the ground.
};
Vec operator-(Vec a, Vec b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
Vec cross(Vec a, Vec b) { return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x}; }
float dot(Vec a, Vec b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
Vec unit(Vec a)
{
    float n = std::sqrt(dot(a, a));
    return n > 0 ? Vec{a.x / n, a.y / n, a.z / n} : a;
}

// The cone as rings round its axis, lowest first: a broad foot rising in a concave sweep to the crater's lip. Its
// foot lies where the map's lava runs start.
constexpr float footRadius = volcanoFoot * tileHalfWidth * 1.4142f, lipRadius = 98;
constexpr float heights[] = {0, .16f, .36f, .58f, .8f, 1};
constexpr int around = 16;
}  // namespace

VolcanoLight paintVolcano(tvg::Scene* objects, Point b, uint32_t seed)
{
    VolcanoLight light;
    // Where a point of the mountain shows on screen: the ground's depth reads half as tall.
    auto screen = [&](Vec v) { return Point{b.x + v.x, b.y - v.y + v.z * .5f}; };
    auto radius = [](float t) { return lipRadius + (footRadius - lipRadius) * std::pow(1 - t, 1.7f); };
    constexpr int rings = int(std::size(heights));
    Vec mesh[rings][around];
    for (int k = 0; k < rings; ++k)
        for (int j = 0; j < around; ++j) {
            float angle = (j + (k % 2) * .5f) / around * 6.2832f, t = heights[k];
            float rough = k == rings - 1 ? .08f : .16f, r = radius(t) * (1 + (hash01(seed, k, j, 840) - .5f) * rough);
            float lift = (k == 0 || k == rings - 1) ? 0 : (hash01(seed, k, j, 841) - .5f) * 30;
            mesh[k][j] = {std::cos(angle) * r, t * volcanoHeight + lift + (k == rings - 1 ? (hash01(seed, k, j, 842) - .5f) * 14 : 0), std::sin(angle) * r};
        }
    const Vec light3 = unit({-.95f, .42f, .22f}), view = unit({0, .5f, .87f});
    auto shadeOf = [&](Vec a, Vec c, Vec d, float warmth, float grain) {
        auto n = unit(cross(d - a, c - a));  // Outwards: the rings turn eastwards as their index grows.
        float lit = std::clamp(dot(n, light3) + grain, 0.f, 1.f);
        return mix(mix(basalt, scoria, .5f), mix(basaltLit, Rgb{120, 70, 52}, warmth), .04f + .96f * lit);
    };
    // The crater: its far inner wall lit red by the lake, the lake, then the mountain's faces over its near side.
    Vec floor{0, volcanoHeight - 46, 0};
    auto& lip = mesh[rings - 1];
    for (int j = 0; j < around; ++j) {
        Vec a = lip[j], c = lip[(j + 1) % around], low = {a.x * .55f, floor.y, a.z * .55f}, low2 = {c.x * .55f, floor.y, c.z * .55f};
        if (a.z + c.z > 0) continue;  // Only the far side's inner wall faces the viewer.
        objects->add(polygon({screen(a), screen(c), screen(low2), screen(low)}, opaque(mix(scoria, crust, .35f + .3f * hash01(seed, j, 9, 843)))));
    }
    Point lake = screen(floor);
    objects->add(ellipse({lake.x, lake.y + 2}, lipRadius * .5f, lipRadius * .2f, opaque(lava)));
    objects->add(ellipse({lake.x + 4, lake.y + 2}, lipRadius * .26f, lipRadius * .09f, opaque(molten)));
    light.crater = lake;
    // The faces turned to the viewer, back to front, two triangles to each cell of the mesh.
    struct Face
    {
        Point corners[3];
        float depth;
        Rgb color;
    };
    std::vector<Face> faces;
    for (int k = 0; k + 1 < rings; ++k)
        for (int j = 0; j < around; ++j) {
            Vec a = mesh[k][j], c = mesh[k][(j + 1) % around], d = mesh[k + 1][j], e = mesh[k + 1][(j + 1) % around];
            float warmth = .25f * heights[k + 1];  // Scorched redder towards the lip.
            for (auto [p, q, r] : {std::tuple{a, c, d}, std::tuple{c, e, d}}) {
                auto n = unit(cross(r - p, q - p));
                if (dot(n, view) <= 0) continue;
                float grain = (hash01(seed, k * around + j, int(faces.size() % 2), 846) - .5f) * .14f;
                faces.push_back({{screen(p), screen(q), screen(r)}, (p.z + q.z + r.z) / 3, shadeOf(p, q, r, warmth, grain)});
            }
        }
    std::sort(faces.begin(), faces.end(), [](const Face& l, const Face& r) { return l.depth < r.depth; });
    for (const auto& face : faces) {
        auto shape = tvg::Shape::gen();
        appendPolygon(shape, {face.corners[0], face.corners[1], face.corners[2]});
        fill(shape, opaque(face.color));
        shape->strokeWidth(.8f);  // Seals the hairline seams between faces.
        shape->strokeFill(face.color.r, face.color.g, face.color.b, 255);
        objects->add(shape);
    }
    // Three streams spill over the near lip and run right down the face, bending with it and widening as they go,
    // and on out over the ground at its foot into the flows they feed, which run on from there to the sea.
    auto crusts = tvg::Shape::gen(), streams = tvg::Shape::gen(), cores = tvg::Shape::gen();
    constexpr float widths[] = {.85f, 1, .75f};
    constexpr int steps = 18, onCone = steps - 2;  // The last two steps lie out on the ground.
    for (int k = 0; k < 3; ++k) {
        // It reaches the foot at its flow's bearing turned into the cone's own angle; higher up it curls in towards
        // the front of the lip, where the lava spills over, and sways a little between.
        float foot = lavaBearing(seed, k) + .7854f, curl = (1.5708f - foot) * .3f, phase = hash01(seed, k, 5, 845) * 6.2832f;
        std::vector<Point> path;
        for (int i = 0; i <= steps; ++i) {
            float down = float(i) / onCone, slope = std::min(down, 1.f), t = 1 - slope;
            float angle = foot + curl * (1 - slope) + std::sin(down * 4 + phase) * .3f * slope * (1 - slope);
            float r = i <= onCone ? radius(t) * (t > .97f ? .98f : 1.01f) : footRadius * (1.01f + (down - 1) * .8f);
            path.push_back(screen({std::cos(angle) * r, t * volcanoHeight, std::sin(angle) * r}));
        }
        float w = widths[k];
        appendStrip(crusts, path, 9 * w, 72 * w);
        appendStrip(streams, path, 6 * w, 52 * w);
        appendStrip(cores, path, 2.5f * w, 18 * w);
        light.flows[k] = path[10];
    }
    fill(crusts, opaque(crust));
    fill(streams, opaque(lava));
    fill(cores, opaque(molten));
    for (auto* shape : {crusts, streams, cores}) objects->add(shape);
    // Smoke climbing from the crater and bending east on the wind, shadowed beneath and lit on its west.
    for (int i = 0; i < 6; ++i) {
        float t = i / 5.f, r = 36 + 50 * t;
        Point at{lake.x + 12 + 170 * t * t, lake.y - 70 - 220 * t};
        auto alpha = uint8_t(170 - 110 * t);
        objects->add(ellipse({at.x + r * .14f, at.y + r * .16f}, r, r * .6f, opaque(smoke, alpha)));
        objects->add(ellipse({at.x - r * .2f, at.y - r * .12f}, r * .62f, r * .36f, opaque(smokeLit, uint8_t(alpha * .7f))));
    }
    return light;
}
}  // namespace hearthold
