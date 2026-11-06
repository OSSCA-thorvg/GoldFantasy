#include "world_map.h"
#include <algorithm>
#include <cmath>
#include <iterator>
#include <limits>

namespace hearthold
{
Point treePosition(const WorldMap& map, int x, int y, int index)
{
    return {x + .2f + hash01(map.seed(), x, y, 30 + index) * .6f,
            y + .2f + hash01(map.seed(), x, y, 40 + index) * .6f};
}

namespace
{
float smooth(float t) { return t * t * (3 - 2 * t); }

float valueNoise(uint32_t seed, float x, float y)
{
    int ix = int(std::floor(x)), iy = int(std::floor(y));
    float fx = smooth(x - ix), fy = smooth(y - iy);
    float a = hash01(seed, ix, iy), b = hash01(seed, ix + 1, iy);
    float c = hash01(seed, ix, iy + 1), d = hash01(seed, ix + 1, iy + 1);
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}
}  // namespace

float fractalNoise(uint32_t seed, float x, float y)
{
    float sum = 0, amplitude = .5f, total = 0;
    for (int octave = 0; octave < 4; ++octave) {
        sum += valueNoise(seed + octave * 101, x, y) * amplitude;
        total += amplitude;
        x *= 2.03f;
        y *= 2.03f;
        amplitude *= .5f;
    }
    return sum / total;
}

namespace
{
// The world's upright frame: u runs east and v south across the screen, the map's diamond is
// |u| + |v| <= 1, and a step on the ground is as long in every direction, so shapes drawn here keep
// their proportions at any map size.
Point screenOf(Point p, int width, int height)
{
    float u = p.x / width, v = p.y / height;
    return {u - v, u + v - 1};
}
Point mapOf(Point s, int width, int height) { return {width * (s.x + s.y + 1) / 2, height * (s.y - s.x + 1) / 2}; }
// One tile of ground in upright units.
float tileSpan(int width, int height) { return 2.8284271f / float(width + height); }

// Midgard is drawn on the ThorVG bolt, in the logo's own units (x east, y south, 172 by 185): a top stroke,
// a middle stroke and a blade stepping down to the south-west. Under the top stroke's curved eastern end
// lies the crescent bay where Ymir stands in the sea.
// Upright units per logo unit east-west; north-south the bolt is drawn longer, because the isometric screen
// halves ground distances that way and the bolt should keep near its own proportions there.
constexpr float boltScale = .0043f, boltStretch = 1.7f;
// Set south of the map's middle, so the top stroke's eastern tip clears the map's north-east edge.
constexpr Point boltCentre{86.16f, 92.5f}, boltShift{0, .1455f};
Point fromLogo(Point p) { return {(p.x - boltCentre.x) * boltScale + boltShift.x, (p.y - boltCentre.y) * boltScale * boltStretch + boltShift.y}; }

// Landmarks, in logo units: the spring Hvergelmir in the top stroke, the fire mountain in the blade, and
// Ymir in the crescent bay.
constexpr Point springLogo{72, 24}, fireLogo{89, 142};
// Where the bay's southern shore runs below Ymir; he stands a few tiles off it.
constexpr Point ymirShoreLogo{140, 52.9f};
// The ranges a region always keeps, along its stroke: one across Midgard's west, and a volcanic arc through
// the volcano down the blade. Passes break them so no region is walled off.
constexpr Point spines[][3] = {{{96, 71}, {80, 86}, {58, 101}}, {{130, 110}, {89, 142}, {70, 172}}};  // Clear of the neck to the north.
// A point well inside each region; the middle one, west of the bay, is where Midgard's name is lettered.
constexpr Point centreLogos[size_t(Region::Count)] = {{110, 20}, {95, 80}, {88, 152}};

Point bezier(Point a, Point b, Point c, Point d, float t)
{
    float r = 1 - t;
    return a * (r * r * r) + b * (3 * r * r * t) + c * (3 * r * t * t) + d * (t * t * t);
}

// The bolt's outline and its crescent bay, in upright units.
struct Bolt
{
    std::vector<Point> outline, bay;
};

const Bolt& bolt()
{
    static const Bolt shape = [] {
        Bolt b;
        auto curve = [](std::vector<Point>& out, Point p0, Point p1, Point p2, Point p3) {
            for (int i = 0; i <= 8; ++i) out.push_back(fromLogo(bezier(p0, p1, p2, p3, i / 8.f)));
        };
        Point tip{164.743f, 10.156f}, bend1{144.373f, 37.052f}, bend2{112.597f, 52.868f}, end{78.863f, 52.909f};
        curve(b.outline, tip, bend1, bend2, end);
        for (Point p : {Point{160.583f, 52.909f}, Point{122.846f, 105.667f}, Point{146.915f, 105.667f}, Point{67.481f, 184.849f}}) b.outline.push_back(fromLogo(p));
        curve(b.outline, {67.481f, 146.468f}, {67.481f, 123.935f}, {85.748f, 105.668f}, {108.281f, 105.667f});
        for (Point p : {Point{39.202f, 105.667f}, Point{69.953f, 52.91f}, Point{0, 52.91f}, Point{34.3f, .151f}, Point{172.32f, .151f}}) b.outline.push_back(fromLogo(p));
        // Under the crescent and over the middle stroke, open to the eastern sea.
        curve(b.bay, tip, bend1, bend2, end);
        for (Point p : {Point{160.583f, 52.909f}, Point{210, 52.909f}, Point{210, 10.156f}}) b.bay.push_back(fromLogo(p));
        return b;
    }();
    return shape;
}

// Distance to a polygon's edge, positive inside.
float signedDistance(Point p, const std::vector<Point>& polygon)
{
    float nearest = std::numeric_limits<float>::max();
    bool inside = false;
    for (size_t i = 0, j = polygon.size() - 1; i < polygon.size(); j = i++) {
        Point a = polygon[j], b = polygon[i];
        nearest = std::min(nearest, segmentDistance(p, a, b));
        if ((a.y > p.y) != (b.y > p.y) && p.x < a.x + (p.y - a.y) / (b.y - a.y) * (b.x - a.x)) inside = !inside;
    }
    return inside ? nearest : -nearest;
}

// The founders' ground stays open, level and grassy this many tiles round its middle; small maps keep less.
float clearingRadius(int width, int height) { return std::clamp((width + height) * .055f, 11.f, 15.f); }

// The north's border (north) or the south's, as v along u: across the crescent bay and where the blade leaves
// the middle stroke. Each sways with the seed and is ragged, so neither reads as a ruled line.
float border(uint32_t seed, float u, bool north)
{
    uint32_t salt = seed + (north ? 710u : 720u);
    float line = fromLogo({0, north ? 36.f : 105.7f}).y;
    float sway = (fractalNoise(salt, u * 2.5f + 20, north ? 3.f : 9.f) - .5f) * .08f;
    return line + sway + (fractalNoise(salt + 5, u * 14 + 3, north ? 3.f : 9.f) - .5f) * .06f;
}

// How deep a point lies inside the north and inside the south, in upright units; negative outside.
struct Depth
{
    float north, south;
};
Depth depthOf(uint32_t seed, Point s) { return {border(seed, s.x, true) - s.y, s.y - border(seed, s.x, false)}; }

// A region's own climate across its border: a seam .04 wide centred on the line.
float seam(float depth) { return smooth(std::clamp(depth / .04f + .5f, 0.f, 1.f)); }

// 1 within `radius`, easing to 0 over `soft` beyond it.
float within(float gap, float radius, float soft) { return smooth(std::clamp((radius + soft - gap) / soft, 0.f, 1.f)); }

// The bolt thickened into a continent, more in some places than others, its strokes bent into gulfs and
// headlands and its shore roughened by tile-sized noise; the bay stays open and the map's edges are sea.
float landMask(uint32_t seed, float x, float y, int width, int height)
{
    auto s = screenOf({x, y}, width, height);
    // Bent at three scales, so no stroke of the bolt runs on as a straight shore.
    Point bent{s.x + (fractalNoise(seed + 310, s.x * 3 + 10, s.y * 3 + 10) - .5f) * .08f + (fractalNoise(seed + 312, s.x * 7 + 3, s.y * 7 + 3) - .5f) * .04f +
                   (fractalNoise(seed + 314, s.x * 14 + 7, s.y * 14 + 7) - .5f) * .035f,
               s.y + (fractalNoise(seed + 311, s.x * 3 + 40, s.y * 3 + 40) - .5f) * .08f + (fractalNoise(seed + 313, s.x * 7 + 9, s.y * 7 + 9) - .5f) * .04f +
                   (fractalNoise(seed + 315, s.x * 14 + 2, s.y * 14 + 2) - .5f) * .035f};
    const auto& shape = bolt();
    float spread = .075f + (fractalNoise(seed + 300, s.x * 2.5f + 5, s.y * 2.5f + 5) - .5f) * .06f;
    // The bay bends far less than the coasts, so it stays the logo's crescent and open to the east.
    float body = signedDistance(bent, shape.outline) + spread, open = -signedDistance(lerp(s, bent, .3f), shape.bay);
    float edge = (body + open - std::sqrt((body - open) * (body - open) + .0004f)) / 2;  // A smooth minimum: the bay cut from the land.
    float value = edge * 5 + (fractalNoise(seed + 320, x * .06f, y * .06f) - .5f) * .5f + (fractalNoise(seed + 321, x * .15f, y * .15f) - .5f) * .2f;
    // Islets rise from the shallows off the coast, and in the north fjords cut long and narrow into it.
    value += std::max(0.f, fractalNoise(seed + 330, x * .13f, y * .13f) - .68f) * 9 * within(-edge, .045f, .04f);
    float fjord = std::max(0.f, 1 - std::abs(2 * fractalNoise(seed + 331, s.x * 9 + 4, s.y * 9 + 4) - 1) - .86f) * 7;
    float northShore = smooth(std::clamp((fromLogo({0, 30}).y - s.y) * 12 + .5f, 0.f, 1.f)) * smooth(std::clamp((fromLogo({145, 0}).x - s.x) * 12 + .5f, 0.f, 1.f));
    value -= fjord * 3 * northShore * within(edge, .03f, .05f);  // West of the top stroke's tip, which keeps the bolt's corner.
    // Sunk towards the map's edges, and sea at the very edge whatever the headlands reach for.
    float rim = std::min({x, y, width - x, height - y}) / (width * .1f);
    if (rim < 1) value -= (1 - rim) * 1.6f;
    if (rim < .25f) value = std::min(value, (rim - .25f) * 8);
    return value;
}

// Ridged noise peaks along long winding lines; a slower mask breaks them into ranges.
float ridged(uint32_t seed, float x, float y)
{
    float ridge = 1 - std::abs(2 * fractalNoise(seed + 500, x * .032f, y * .032f) - 1);
    float range = fractalNoise(seed + 510, x * .022f + 7, y * .022f);
    return ridge - .86f + (range - .5f) * .35f;
}

// The Elivagar: from Hvergelmir one river runs west along the top stroke to the sea and one east. A point of
// zero width keeps them apart; points lie under half a tile apart.
River elivagar(uint32_t seed, int width, int height)
{
    River river;
    for (float side : {-1.f, 1.f}) {
        if (!river.path.empty()) {
            river.path.push_back(river.path.back());
            river.width.push_back(0);
        }
        Point a = fromLogo(springLogo + Point{side * 3, 0});
        // The mouths lie well out to sea, past any islet off the coast.
        Point b = fromLogo(side < 0 ? Point{50, 30} : Point{100, 20}), c = fromLogo(side < 0 ? Point{24, 37} : Point{136, 13}), d = fromLogo(side < 0 ? Point{-60, 44} : Point{235, 2});
        uint32_t own = seed + (side < 0 ? 900u : 950u);
        Point last{-1e9f, -1e9f};
        for (int step = 0; step <= 4000; ++step) {
            float t = step / 4000.f, r = 1 - t;
            Point at = a * (r * r * r) + b * (3 * r * r * t) + c * (3 * r * t * t) + d * (t * t * t);
            Point along = normalized((b - a) * (3 * r * r) + (c - b) * (6 * r * t) + (d - c) * (3 * t * t));
            // Meanders swell from nothing at the spring.
            float swing = (fractalNoise(own, t * 7, 0) - .5f) * .07f * std::min(1.f, t * 6);
            auto p = mapOf(at + Point{-along.y, along.x} * swing, width, height);
            if (p.x < 0 || p.y < 0 || p.x > width || p.y > height || distance(p, last) < .4f) continue;
            last = p;
            river.path.push_back(p);
            river.width.push_back(.9f + valueNoise(own + 1, t * 30, 3) * 1.3f);
        }
    }
    return river;
}

bool clearing(const WorldMap& map, int cx, int cy, int radius)
{
    for (int y = cy - radius; y <= cy + radius; ++y)
        for (int x = cx - radius; x <= cx + radius; ++x) {
            if (!map.inside(x, y)) return false;
            auto terrain = map.at(x, y).terrain;
            if (isWater(terrain) || isStone(terrain) || impassable(terrain)) return false;
        }
    return true;
}

}  // namespace

void placeDungeons(WorldMap& map, std::vector<Dungeon>& sites, TileCoord start);

WorldMap WorldMap::generate(uint32_t seed, int width, int height)
{
    WorldMap map;
    map.columns = width;
    map.rows = height;
    map.mapSeed = seed;
    map.tiles.resize(size_t(width) * height);
    size_t stride = size_t(width * resolution + 1);
    for (auto& grid : map.layers) grid.resize(stride * size_t(height * resolution + 1));
    auto layer = [&](Layer l) -> std::vector<float>& { return map.layers[size_t(l)]; };
    float tile = tileSpan(width, height), clear = clearingRadius(width, height);
    // Seven tiles off the shore at any size, so the founders always wake at his feet.
    auto stone = mapOf(fromLogo(ymirShoreLogo) + Point{0, -7 * tile}, width, height);
    map.ymir = Giant{{int(std::lround(stone.x)) - Giant::size / 2, int(std::lround(stone.y)) - Giant::size / 2}};
    auto heart = map.ymir->center();
    auto spring = mapOf(fromLogo(springLogo), width, height), fire = mapOf(fromLogo(fireLogo), width, height);
    float lake = std::max(2.5f, .045f / tile);
    map.fire = Volcano::around(fire);
    // The mere, in tiles from his centre: across, before him, and behind him (shorter on small maps).
    float mereWide = 6, mereFront = 5.5f, mereBack = std::clamp((width + height) * .037f, 8.5f, 13.f);
    for (int j = 0; j <= height * resolution; ++j)
        for (int i = 0; i <= width * resolution; ++i) {
            float x = float(i) / resolution, y = float(j) / resolution;
            auto depth = depthOf(seed, screenOf({x, y}, width, height));
            float cold = seam(depth.north), hot = seam(depth.south), mild = (1 - cold) * (1 - hot);
            float north = std::max(0.f, depth.north), south = std::max(0.f, depth.south);
            // Mild as windless air in the middle; in the north a frost belt, then glaciers growing northwards as
            // on Greenland; in the south ash, never hot enough for lava but where the volcano's own runs.
            float n = fractalNoise(seed + 600, x * .05f, y * .05f) - .5f;
            float heat = (.45f + n * .12f) * mild + (.245f - north * .5f + n * .03f) * cold + std::min(.7f + south * .9f + n * .1f, lavaFloor - .025f) * hot;
            float elevation = fractalNoise(seed, x * .07f, y * .07f) + cold * std::max(0.f, north - .08f) * 1.3f + mild * .03f;
            elevation += hot * std::max(0.f, .34f - elevation);  // No lakes in the burning south: its hollows hold ash.
            float moisture = fractalNoise(seed + 77, x * .09f + 40, y * .09f + 40) - hot * .3f;
            float ridge = ridged(seed, x, y) - .16f * mild - .06f * cold - .1f * hot;
            auto here = screenOf({x, y}, width, height);
            for (const auto& spine : spines) {
                float gap = std::min(segmentDistance(here, fromLogo(spine[0]), fromLogo(spine[1])), segmentDistance(here, fromLogo(spine[1]), fromLogo(spine[2])));
                float pass = smooth(std::clamp((fractalNoise(seed + 850, x * .09f, y * .09f) - .3f) * 6, 0.f, 1.f));
                float crest = .04f + .16f * fractalNoise(seed + 860, x * .15f, y * .15f);
                ridge += (crest - ridge) * within(gap, .016f, .022f) * pass;
            }
            elevation += std::max(0.f, ridge + .3f) * .55f;  // The land climbs to its ranges: foothills, then rock.
            float beach = fractalNoise(seed + 330, x * .1f, y * .1f) - (cold + hot) * .6f;  // Sand only on the gap's shores.
            float land = landMask(seed, x, y, width, height);

            auto wobble = [&](Point from, uint32_t salt) {
                float angle = std::atan2(y - from.y, x - from.x);
                return .8f + .4f * fractalNoise(seed + salt, std::cos(angle) * 1.5f + 5, std::sin(angle) * 1.5f + 5);
            };
            // Hvergelmir: a spring too deep and warm to freeze, welling up at the bottom of a great rift in the ice,
            // drawn out across the screen along the icy stroke and ragged at its lip, with frost round it.
            float rift = std::hypot((x - spring.x - y + spring.y) * .7071f / 1.45f, (x - spring.x + y - spring.y) * .7071f);
            float lip = std::atan2(y - spring.y, x - spring.x);
            float ragged = wobble(spring, 730) + .16f * (fractalNoise(seed + 731, std::cos(lip) * 4 + 9, std::sin(lip) * 4 + 9) - .5f);
            float pool = within(rift, lake * ragged, 1.5f);
            land += std::max(0.f, .8f - land) * within(distance({x, y}, spring), lake * 1.45f + 6, 4);  // However the coast bends, the spring stays inland.
            elevation += (.1f - elevation) * pool;
            heat += (.3f - heat) * within(rift, lake * ragged - .4f, .9f);  // Warm only in its open water: frost reaches its lip.
            ridge += (-.5f - ridge) * within(rift, lake + 3, 2);
            // The volcano stands on a massif, and its lava has run down every side in broad tongues, as far as
            // the slopes carried it, round islands of older rock.
            float gap = distance({x, y}, fire), cone = Volcano::size * .5f;
            float heading = std::atan2(y - fire.y, x - fire.x);
            float reach = std::clamp(float(width + height) / 352, .5f, 1.f), burning = hot * hot;  // Shorter on small maps, and kept south.
            float tongue = cone + (6 + 14 * fractalNoise(seed + 795, std::cos(heading) * 2.2f + 5, std::sin(heading) * 2.2f + 5)) * reach;
            float apron = within(gap, tongue, 3) * burning, older = smooth(std::clamp((fractalNoise(seed + 796, x * .22f, y * .22f) - .62f) * 8, 0.f, 1.f));
            land += std::max(0.f, .8f - land) * within(gap, cone + 14, 4);
            heat += (std::max(heat, 1.f) - heat) * within(gap, tongue + 2, 3) * burning;
            // Crusted over for the most part, brightest in the channels still running out from its foot behind it;
            // the flows before it run on to the sea, laid below once the land is known.
            float channels = 0;
            for (int k = 3; k < 5; ++k) {
                float aim = 3.9f + (k - 3) * 1.2f + (hash01(seed, k, 11, 780) - .5f) * .8f;
                aim += (fractalNoise(seed + 790 + k, gap * .12f, 3) - .5f) * .9f;
                channels = std::max(channels, within(std::abs(std::remainder(heading - aim, 6.2832f)) * gap, .9f, 1.2f));
            }
            ridge += (.025f + .03f * channels - ridge) * apron * (1 - older);
            ridge += (-.4f - ridge) * apron * older;
            elevation += (.85f - elevation) * within(gap, cone + 2, 16);
            // The founders' ground on the shore before him: level, mild and grassy, so they always have room.
            float front = (x - heart.x + y - heart.y) * .7071f;
            float near = within(distance({x, y}, heart) / wobble(heart, 750), clear, 4) * smooth(std::clamp(front / 4 + .5f, 0.f, 1.f));
            elevation += (.48f - elevation) * near;
            moisture += (.44f - moisture) * near;
            ridge += (-.6f - ridge) * near;
            heat += (.45f - heat) * near;
            // And a stand of trees beside their camp along the shore, for their first timber.
            float grove = within(distance({x, y}, heart + Point{3, 12}) / wobble(heart, 770), 3.5f, 1.5f);
            moisture += (.78f - moisture) * grove;
            // Ymir's water: sea all round his stone so no one walks up to him, reaching far behind him where he
            // hides the land from view, and only a moat's width before him.
            float behind = -(x - heart.x + y - heart.y) * .7071f, across = (x - heart.x - y + heart.y) * .7071f;
            float bearing = std::atan2(y - heart.y, x - heart.x), shore = .93f + .14f * fractalNoise(seed + 760, std::cos(bearing) * 1.8f + 5, std::sin(bearing) * 1.8f + 5);
            float mere = within(std::hypot(across / mereWide, (behind - (mereBack - mereFront) / 2) / ((mereBack + mereFront) / 2)) / shore, 1, .15f);
            land -= mere * (land + .4f);
            ridge += (-.6f - ridge) * mere;

            size_t at = size_t(j) * stride + i;
            layer(Layer::Land)[at] = land;
            layer(Layer::Elevation)[at] = elevation;
            layer(Layer::Moisture)[at] = moisture;
            layer(Layer::Shade)[at] = fractalNoise(seed + 5, x * .3f, y * .3f);
            layer(Layer::Beach)[at] = beach;
            layer(Layer::Ridge)[at] = ridge;
            layer(Layer::Heat)[at] = heat;
        }
    map.stream = elivagar(seed, width, height);
    // The volcano's lava runs on from the foot of its cone as far as the land falls, into the sea: each flow keeps
    // to its bearing over the massif, wandering a little, then bends downhill to the nearest shore. Where it crosses
    // open ground it runs for a stretch under a crust that bears a walker.
    if (map.fire) {
        auto landAt = [&](Point p) { return map.value(Layer::Land, p); };
        auto foot = map.fire->center();
        for (int k = 0; k < 3; ++k) {
            float bearing = lavaBearing(seed, k);
            Point heading{std::cos(bearing), std::sin(bearing)};
            std::vector<Point> run{foot + heading * (volcanoFoot - 1)};
            while (run.size() < 240 && map.inside(run.back()) && landAt(run.back()) > -.04f) {
                auto at = run.back();
                Point downhill{landAt(at - Point{.6f, 0}) - landAt(at + Point{.6f, 0}), landAt(at - Point{0, .6f}) - landAt(at + Point{0, .6f})};
                float steep = std::min(1.f, length(downhill) * 12) * .8f;
                float wander = bearing + (fractalNoise(seed + 900 + uint32_t(k), at.x * .12f, at.y * .12f) - .5f) * 1.4f;
                Point want = Point{std::cos(wander), std::sin(wander)} * (1 - steep) + (steep > 0 ? normalized(downhill) * steep : Point{});
                heading = normalized(heading * .75f + normalized(want) * .25f);
                run.push_back(at + heading * .5f);
            }
            std::vector<float> along{0};
            for (size_t i = 1; i < run.size(); ++i) along.push_back(along.back() + distance(run[i - 1], run[i]));
            // Over open land, between the volcano's own lava and the shore, it runs under a crust halfway along, so a
            // walker can cross between its molten ends (each reaches 1.25 tiles past the crust). Where that stretch is
            // too short to leave a way across, it has cooled and crusted over the whole way from the volcano's lava
            // to the sea, so it never seals the passage between them.
            size_t open = 0, shore;
            while (open < run.size() && map.value(Layer::Heat, run[open]) > .9f) ++open;
            for (shore = open; shore < run.size() && landAt(run[shore]) > .02f; ++shore) {}
            float stretch = open < run.size() ? along[std::min(shore, run.size() - 1)] - along[open] : 0;
            constexpr float reach = 2.4f;
            bool roofed = open < run.size();
            float roof = 0, roofHalf = 0;
            if (stretch >= 3.8f) {
                roofHalf = std::min(2.4f, stretch / 2);
                roof = along[open] + stretch / 2;
            } else if (roofed) {
                roofHalf = (along.back() - along[open] + 1.3f) / 2;
                roof = along.back() - roofHalf;
            }
            Point low = run[0], high = run[0];
            for (auto p : run) { low = {std::min(low.x, p.x), std::min(low.y, p.y)}; high = {std::max(high.x, p.x), std::max(high.y, p.y)}; }
            int i0 = std::max(0, int((low.x - reach) * resolution)), i1 = std::min(width * resolution, int((high.x + reach) * resolution) + 1);
            int j0 = std::max(0, int((low.y - reach) * resolution)), j1 = std::min(height * resolution, int((high.y + reach) * resolution) + 1);
            int span = i1 - i0 + 1;
            // How near each sample lies to the open lava and to the crusted stretch.
            std::vector<float> molten(size_t(span) * size_t(j1 - j0 + 1), 1e9f), crusted(molten);
            // Where it meets the sea it fans out over the shore.
            float mouth = along[std::min(shore, run.size() - 1)];
            for (size_t s = 1; s < run.size(); ++s) {
                bool roofs = roofed && std::abs((along[s - 1] + along[s]) / 2 - roof) < roofHalf;
                auto& near = roofs ? crusted : molten;
                float fan = roofs ? 0 : .9f * smooth(std::clamp((along[s] - mouth + 3) / 3, 0.f, 1.f));
                int a0 = std::max(i0, int(std::floor((std::min(run[s - 1].x, run[s].x) - reach) * resolution)));
                int a1 = std::min(i1, int(std::ceil((std::max(run[s - 1].x, run[s].x) + reach) * resolution)));
                int b0 = std::max(j0, int(std::floor((std::min(run[s - 1].y, run[s].y) - reach) * resolution)));
                int b1 = std::min(j1, int(std::ceil((std::max(run[s - 1].y, run[s].y) + reach) * resolution)));
                for (int j = b0; j <= b1; ++j)
                    for (int i = a0; i <= a1; ++i) {
                        auto& gap = near[size_t(j - j0) * size_t(span) + size_t(i - i0)];
                        gap = std::min(gap, segmentDistance({float(i) / resolution, float(j) / resolution}, run[s - 1], run[s]) - fan);
                    }
            }
            for (int j = j0; j <= j1; ++j)
                for (int i = i0; i <= i1; ++i) {
                    size_t cell = size_t(j - j0) * size_t(span) + size_t(i - i0), at = size_t(j) * stride + size_t(i);
                    float& heat = layer(Layer::Heat)[at];
                    float& ridge = layer(Layer::Ridge)[at];
                    // Hot only close by, so it keeps to its own banks, and brightest down its raised middle; under
                    // the crust no hotter than scorched rock.
                    float warm = std::max(within(molten[cell], .6f, .7f), within(crusted[cell], .6f, .7f)), core = within(molten[cell], .3f, 1);
                    heat = std::max(heat, heat + (2 - heat) * warm);
                    ridge = std::max(ridge, ridge + (.07f - ridge) * core);
                    ridge += (-.13f - ridge) * within(crusted[cell], 1.4f, .8f) * (1 - core);
                }
        }
    }
    for (int y = 0; y < height; ++y)
        for (int x = 0; x < width; ++x) {
            Point center{x + .5f, y + .5f};
            Tile tile;
            tile.terrain = map.terrainAt(center);
            tile.shade = uint8_t(std::min(3.f, map.value(Layer::Shade, center) * 4));
            map.at(x, y) = tile;
            map.at(x, y).wild = map.at(x, y).trees = wildTrees(map, x, y);
        }

    // Ground a settlement can spread over and farm: dry, level, passable and neither ash nor frost.
    auto settleable = [](Terrain terrain) { return !isWater(terrain) && !isStone(terrain) && !impassable(terrain) && terrain != Terrain::Ash && terrain != Terrain::Frost; };
    // Square counts in constant time: ground a settlement can use, and ground at all (not sea).
    std::vector<int> open(size_t(width + 1) * (height + 1), 0), dry(open.size(), 0);
    for (int y = 0; y < height; ++y)
        for (int x = 0; x < width; ++x) {
            size_t at = size_t(y + 1) * (width + 1) + x + 1, up = size_t(y) * (width + 1) + x + 1, left = at - 1, corner = up - 1;
            open[at] = settleable(map.at(x, y).terrain) + open[up] + open[left] - open[corner];
            dry[at] = (map.at(x, y).terrain != Terrain::Sea) + dry[up] + dry[left] - dry[corner];
        }
    auto count = [&](const std::vector<int>& sums, int cx, int cy, int r) {
        int x0 = std::max(0, cx - r), y0 = std::max(0, cy - r), x1 = std::min(width, cx + r + 1), y1 = std::min(height, cy + r + 1);
        return sums[size_t(y1) * (width + 1) + x1] - sums[size_t(y0) * (width + 1) + x1] - sums[size_t(y1) * (width + 1) + x0] + sums[size_t(y0) * (width + 1) + x0];
    };
    auto openShare = [&](int cx, int cy, int r) { int land = count(dry, cx, cy, r); return land ? float(count(open, cx, cy, r)) / float(land) : 0.f; };
    auto landShare = [&](int cx, int cy, int r) { return float(count(dry, cx, cy, r)) / float((2 * r + 1) * (2 * r + 1)); };
    // The founders wake at Ymir's feet, on the widest open ground on the bay's shore before him, with land
    // about them to grow over; maps too small to give that room are asked for less.
    TileCoord best{width / 2, height / 2};
    Point feet{heart.x + 7, heart.y + 7};
    // The camp's own ground, sampled finer than tile centres: rock or a range can reach into a clear tile.
    auto level = [&](int x, int y) {
        for (float dy = -.25f; dy <= 1.25f; dy += .25f)
            for (float dx = -.25f; dx <= 1.25f; dx += .25f)
                if (!settleable(map.terrainAt({x + dx, y + dy}))) return false;
        return true;
    };
    // Asking for less clearing and less room in turn, down to a single good tile; first on the shore before him
    // within a stone's throw, with room for a camp, and only then anywhere.
    bool found = false;
    for (bool near : {true, false})
        for (auto [clear, room] : {std::pair{3, 9}, std::pair{3, 6}, std::pair{3, 3}, std::pair{2, 3}, std::pair{1, 1}, std::pair{0, 0}}) {
            if (found || (near && clear < 2)) continue;
            float nearest = std::numeric_limits<float>::max();
            int margin = std::min(10, clear + 2);
            for (int y = margin; y < height - margin; ++y)
                for (int x = margin; x < width - margin; ++x) {
                    bool before = distance({x + .5f, y + .5f}, heart) <= 13 && x + y + 1 - heart.x - heart.y > 4;
                    if ((near && !before) || !clearing(map, x, y, clear) || landShare(x, y, room) < .5f) continue;
                    // Each tenth of the land nearby that is blocked weighs as much as walking 4 tiles further.
                    float gap = distance({x + .5f, y + .5f}, feet) + (1 - openShare(x, y, 10)) * 40 + hash01(seed, x, y, 23) * .5f;
                    if (gap < nearest && level(x, y)) { nearest = gap; best = {x, y}; }
                }
            found = nearest < std::numeric_limits<float>::max();
        }
    map.origin = best;
    for (int y = best.y - 2; y <= best.y + 2; ++y)
        for (int x = best.x - 2; x <= best.x + 2; ++x)
            if (map.inside(x, y)) map.at(x, y).trees = map.at(x, y).wild = 0;
    for (int y = map.ymir->origin.y - 3; y < map.ymir->origin.y + Giant::size + 3; ++y)
        for (int x = map.ymir->origin.x - 3; x < map.ymir->origin.x + Giant::size + 3; ++x)
            if (map.inside(x, y)) map.at(x, y).trees = map.at(x, y).wild = 0;
    placeDungeons(map, map.sites, best);
    // The founders see only what is around them and the giant they were born of; the nearest dungeon is known but unseen.
    map.revealStart();
    if (!map.sites.empty()) map.sites.front().discovered = true;
    map.discover();
    return map;
}

float lavaBearing(uint32_t seed, int k) { return .785f + float(k - 1) * .5f + (hash01(seed, k, 12, 781) - .5f) * .2f; }

uint8_t wildTrees(const WorldMap& map, int x, int y)
{
    float pick = hash01(map.seed(), x, y, 11), moisture = map.value(Layer::Moisture, {x + .5f, y + .5f});
    switch (map.at(x, y).terrain) {
    case Terrain::Forest: return uint8_t(1 + int(pick * 3));
    case Terrain::Frost: return moisture > .6f ? uint8_t(1 + int(pick * 3)) : uint8_t(moisture > .4f && pick < .16f);
    case Terrain::Ash: return moisture > .2f && pick < .2f ? uint8_t(1 + (pick < .06f)) : 0;
    default: return 0;
    }
}

Region WorldMap::regionAt(Point p) const
{
    if (!columns || !rows) return Region::Middle;
    auto depth = depthOf(mapSeed, screenOf(p, columns, rows));
    return depth.north > 0 ? Region::North : depth.south > 0 ? Region::South : Region::Middle;
}

Point WorldMap::regionCenter(Region region) const { return mapOf(fromLogo(centreLogos[size_t(region)]), columns, rows); }
Point WorldMap::hvergelmir() const { return mapOf(fromLogo(springLogo), columns, rows); }
Point WorldMap::fireMountain() const { return mapOf(fromLogo(fireLogo), columns, rows); }

std::optional<Point> WorldMap::nameLabel() const
{
    if (!laidOut || !columns || !rows) return std::nullopt;
    auto anchor = regionCenter(Region::Middle);
    std::optional<Point> best;
    float nearest = 10.75f;
    int cx = int(std::floor(anchor.x)), cy = int(std::floor(anchor.y));
    for (int y = cy - 10; y <= cy + 10; ++y)
        for (int x = cx - 10; x <= cx + 10; ++x) {
            if (!inside(x, y) || at(x, y).terrain == Terrain::Sea) continue;
            Point center{x + .5f, y + .5f};
            if (float gap = distance(center, anchor); gap < nearest) { nearest = gap; best = center; }
        }
    return best;
}

World WorldMap::destination(const Dungeon& site) const
{
    auto region = regionAt({site.origin.x + 1.f, site.origin.y + 1.f});
    switch (site.kind) {
    case DungeonKind::Cave: return region == Region::South ? World::Svartalfheim : World::Jotunheim;
    case DungeonKind::Crypt: return World::Helheim;
    case DungeonKind::Portal:
        if (region == Region::North) return World::Niflheim;
        return hash01(mapSeed, site.origin.x, site.origin.y, 97) < .5f ? World::Alfheim : World::Vanaheim;
    case DungeonKind::Ruin: return region == Region::South ? World::Muspelheim : World::Asgard;
    }
    return World::Jotunheim;
}

const char* worldName(World world)
{
    constexpr const char* names[] = {"Asgard", "Vanaheim", "Alfheim", "Jotunheim", "Svartalfheim", "Niflheim", "Muspelheim", "Helheim"};
    return world < World::Count ? names[size_t(world)] : "";
}

const Tile* WorldMap::cell(Point p) const
{
    int x = int(std::floor(p.x)), y = int(std::floor(p.y));
    return inside(x, y) ? &at(x, y) : nullptr;
}

float WorldMap::value(Layer layer, Point p) const noexcept
{
    float u = p.x * resolution, v = p.y * resolution;
    int i = int(std::floor(u)), j = int(std::floor(v));
    float fx = u - i, fy = v - j;
    float a = sample(layer, i, j), b = sample(layer, i + 1, j), c = sample(layer, i, j + 1), d = sample(layer, i + 1, j + 1);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

Terrain WorldMap::terrainAt(Point p) const
{
    // Ymir's stone, whatever the layers under him say: nothing crosses or builds on him.
    if ((ymir && ymir->covers(p)) || (fire && fire->covers(p))) return Terrain::Mountain;
    float land = value(Layer::Land, p);
    if (land < 0) return Terrain::Sea;
    for (size_t i = 1; i < stream.path.size(); ++i)
        if (stream.width[i - 1] > 0 && stream.width[i] > 0 && std::abs(stream.path[i].x - p.x) < 2 && segmentDistance(p, stream.path[i - 1], stream.path[i]) < stream.width[i] / 2) return Terrain::Water;
    float elevation = value(Layer::Elevation, p), moisture = value(Layer::Moisture, p), heat = value(Layer::Heat, p);
    if (land < .05f && value(Layer::Beach, p) > .45f) return Terrain::Sand;
    if (elevation < .3f && land > .12f) return heat < .2f ? Terrain::Ice : Terrain::Water;  // Lakes freeze in the far cold.
    float ridge = value(Layer::Ridge, p);
    // Where the land burns, a range's crest stands as volcanic rock and lava pours down its flanks.
    if (volcanicCrest(land, heat, ridge)) return Terrain::Mountain;
    if (lavaLevel(land, heat, ridge) > 0) return Terrain::Lava;
    if (land > .1f && ridge > 0) return Terrain::Mountain;
    if (heat < .2f && elevation > .55f) return Terrain::Ice;  // Glaciers on the cold heights.
    if (elevation > .7f) return Terrain::Rock;
    // Hot, dry country is ash and cold country frost: no crops grow there, and few trees.
    if (heat > .62f && moisture < .5f) return Terrain::Ash;
    if (heat < .25f) return Terrain::Frost;
    if (moisture > .54f) return Terrain::Forest;
    return moisture < .38f ? Terrain::Meadow : Terrain::Grass;
}

bool WorldMap::reveal(float cx, float cy, float radius)
{
    bool covered = std::any_of(seen.begin(), seen.end(), [&](const Sight& s) { return std::hypot(s.center.x - cx, s.center.y - cy) + radius <= s.radius; });
    if (covered) return false;
    seen.push_back({{cx, cy}, radius});
    for (int y = int(cy - radius) - 1; y <= int(cy + radius) + 1; ++y)
        for (int x = int(cx - radius) - 1; x <= int(cx + radius) + 1; ++x)
            if (inside(x, y) && std::hypot(x + .5f - cx, y + .5f - cy) <= radius) at(x, y).revealed = true;
    // Whoever sees the volcano sees all of it, towering over the land behind it.
    if (fire && distance({cx, cy}, fire->center()) <= radius)
        for (auto sight : fire->sights())
            if (!revealedWithin(sight.center, sight.radius)) reveal(sight.center.x, sight.center.y, sight.radius);
    return true;
}

void WorldMap::revealStart()
{
    reveal(camp().x, camp().y, 7);
    // The founders wake at Ymir's feet and know the land round him; known is not seen, so it stays in memory.
    if (ymir)
        for (auto sight : ymir->sights()) reveal(sight.center.x, sight.center.y, sight.radius);
}

bool WorldMap::revealedWithin(Point p, float margin) const
{
    return std::any_of(seen.begin(), seen.end(), [&](const Sight& s) { return distance(s.center, p) + margin <= s.radius; });
}

bool WorldMap::revealed(Point p) const
{
    return std::any_of(seen.begin(), seen.end(), [&](const Sight& s) { return distance(s.center, p) <= s.radius; });
}
}  // namespace hearthold
