#include "walk_paths.h"
#include <algorithm>
#include <cmath>
#include <utility>

namespace hearthold
{
namespace
{
constexpr float pavedCost = .3f, roadCost = .4f, forestCost = 1.4f, rockCost = 1.8f;
constexpr size_t searchLimit = 60000;

// Per-thread A* buffers reused across requests; a stamp marks entries this search wrote.
struct Search
{
    std::vector<float> score;
    std::vector<int> parent;
    std::vector<uint32_t> stamp;
    std::vector<std::pair<float, int>> open;
    uint32_t current = 0;

    void begin(size_t cells)
    {
        if (stamp.size() < cells) { score.resize(cells); parent.resize(cells); stamp.resize(cells, 0); }
        if (++current == 0) { std::fill(stamp.begin(), stamp.end(), 0u); current = 1; }
        open.clear();
    }
    float scoreAt(int n) const { return stamp[size_t(n)] == current ? score[size_t(n)] : 1e30f; }
    int parentAt(int n) const { return stamp[size_t(n)] == current ? parent[size_t(n)] : -1; }
    void set(int n, float value, int from) { stamp[size_t(n)] = current; score[size_t(n)] = value; parent[size_t(n)] = from; }
};
thread_local Search search;
}  // namespace

bool WalkGrid::blockedBy(Point p) const
{
    int x = int(std::floor(p.x)), y = int(std::floor(p.y));
    if (x >= 0 && y >= 0 && x < columns && y < rows && !nearObstacle[size_t(y) * columns + x]) return false;
    return std::any_of(obstacles.begin(), obstacles.end(), [&](const Footprint& f) { return f.contains(p, -.08f); });
}

bool WalkGrid::blockedBy(Point a, Point b) const
{
    for (const auto& footprint : obstacles) {
        const float half = footprint.half - .08f;
        const float radius = half * 1.414214f;
        if (std::max(a.x, b.x) < footprint.center.x - radius || std::min(a.x, b.x) > footprint.center.x + radius ||
            std::max(a.y, b.y) < footprint.center.y - radius || std::min(a.y, b.y) > footprint.center.y + radius) continue;
        auto start = rotated(a - footprint.center, -footprint.angle);
        auto end = rotated(b - footprint.center, -footprint.angle);
        float enter = 0, leave = 1;
        auto clips = [&](float origin, float delta) {
            if (std::abs(delta) < 1e-6f) return std::abs(origin) <= half;
            float first = (-half - origin) / delta, last = (half - origin) / delta;
            if (first > last) std::swap(first, last);
            enter = std::max(enter, first);
            leave = std::min(leave, last);
            return enter <= leave;
        };
        if (half > 0 && clips(start.x, end.x - start.x) && clips(start.y, end.y - start.y)) return true;
    }
    return false;
}

void WalkGrid::rebuild(const WorldMap& map, const RoadNetwork& roads, const std::vector<Footprint>& buildings)
{
    // Town rebuilds on any change; most leave the walls and the blocked cells as they were.
    const bool sameShape = columns == map.width() && rows == map.height(), sameWalls = sameShape && obstacles == buildings;
    obstacles = buildings;
    columns = map.width();
    rows = map.height();
    costs.assign(size_t(columns) * rows, 1);
    // Track blocked cells as they are set, so an unchanged layout is found without another pass.
    blocked.assign((costs.size() + 63) / 64, 0);
    auto block = [&](size_t i) { blocked[i / 64] |= uint64_t(1) << (i % 64); };
    for (int y = 0; y < rows; ++y)
        for (int x = 0; x < columns; ++x) {
            const auto& tile = map.at(x, y);
            float& c = costs[size_t(y) * columns + x];
            // Rubble and boulders slow the feet; water, mountain ranges, glaciers and lava stop them.
            if (isWater(tile.terrain) || impassable(tile.terrain)) { c = 0; block(size_t(y) * columns + x); }
            else if (tile.terrain == Terrain::Rock) c = rockCost;
            else if (tile.trees) c = forestCost;
        }
    for (const auto& segment : roads.builtSegments()) {
        const auto* road = roads.road(segment.road);
        float cost = road && road->paved ? pavedCost : roadCost;
        if (road && road->wear >= 1) continue;  // Torn up by monsters: plain ground until mended.
        // Mark every cell the road crosses, not just its ends: a long straight would leave gaps.
        int samples = 1 + int(std::ceil(distance(segment.a, segment.b) / .4f));
        for (int i = 0; i <= samples; ++i) {
            Point p = lerp(segment.a, segment.b, float(i) / float(samples));
            for (int dy = -1; dy <= 1; ++dy)
                for (int dx = -1; dx <= 1; ++dx) {
                    int x = int(std::floor(p.x)) + dx, y = int(std::floor(p.y)) + dy;
                    if (x < 0 || y < 0 || x >= columns || y >= rows) continue;
                    size_t cell = size_t(y) * columns + x;
                    float& c = costs[cell];
                    if (distance({x + .5f, y + .5f}, p) >= .75f) continue;
                    if (c <= 0) blocked[cell / 64] &= ~(uint64_t(1) << (cell % 64));  // Bridges too.
                    c = c > 0 && c < cost ? c : cost;
                }
        }
    }
    // Cells whose middle lies within a building are walls.
    for (const auto& f : obstacles) {
        int x0 = int(std::floor(f.center.x - f.half * 1.5f)), x1 = int(std::floor(f.center.x + f.half * 1.5f));
        int y0 = int(std::floor(f.center.y - f.half * 1.5f)), y1 = int(std::floor(f.center.y + f.half * 1.5f));
        for (int y = std::max(0, y0); y <= std::min(rows - 1, y1); ++y)
            for (int x = std::max(0, x0); x <= std::min(columns - 1, x1); ++x)
                if (f.contains({x + .5f, y + .5f}, .05f)) { costs[size_t(y) * columns + x] = 0; block(size_t(y) * columns + x); }
    }
    if (!sameWalls) {
        // A building's rotated bounds plus one cell: a diagonal step can pass through a third cell.
        nearObstacle.assign(costs.size(), 0);
        for (const auto& f : obstacles) {
            float reach = f.half * 1.415f + 1;
            int x0 = std::max(0, int(std::floor(f.center.x - reach))), x1 = std::min(columns - 1, int(std::floor(f.center.x + reach)));
            int y0 = std::max(0, int(std::floor(f.center.y - reach))), y1 = std::min(rows - 1, int(std::floor(f.center.y + reach)));
            for (int y = y0; y <= y1; ++y)
                for (int x = x0; x <= x1; ++x) nearObstacle[size_t(y) * columns + x] = 1;
        }
    }
    // Regions depend only on which cells are blocked.
    if (sameShape && regions.size() == costs.size() && blocked == labeled) return;
    labeled = blocked;
    // A diagonal step needs both side cells open, so four-way flooding finds every reachable cell.
    regions.assign(costs.size(), -1);
    std::vector<int> pending;
    for (int first = 0, label = 0; first < int(costs.size()); ++first) {
        if (costs[size_t(first)] <= 0 || regions[size_t(first)] >= 0) continue;
        regions[size_t(first)] = label;
        pending.push_back(first);
        while (!pending.empty()) {
            int n = pending.back(), x = n % columns;
            pending.pop_back();
            for (int m : {x > 0 ? n - 1 : -1, x + 1 < columns ? n + 1 : -1, n - columns, n + columns})
                if (m >= 0 && m < int(costs.size()) && costs[size_t(m)] > 0 && regions[size_t(m)] < 0) {
                    regions[size_t(m)] = label;
                    pending.push_back(m);
                }
        }
        ++label;
    }
}

bool WalkGrid::walkable(Point p) const
{
    int x = int(std::floor(p.x)), y = int(std::floor(p.y));
    return x >= 0 && y >= 0 && x < columns && y < rows && cost(x, y) > 0 && !blockedBy(p);
}

float WalkGrid::speedAt(Point p) const
{
    int x = int(std::floor(p.x)), y = int(std::floor(p.y));
    if (x < 0 || y < 0 || x >= columns || y >= rows) return 1.1f;
    float c = cost(x, y);
    return c == pavedCost ? 2.6f : c == roadCost ? 2.1f : c == forestCost ? .85f : c == rockCost ? .75f : 1.1f;
}

Point WalkGrid::nearestWalkable(Point p) const
{
    if (walkable(p)) return p;
    Point nearest = p;
    float gap = 1e30f;
    for (int dy = -4; dy <= 4; ++dy)
        for (int dx = -4; dx <= 4; ++dx) {
            Point q{std::floor(p.x) + dx + .5f, std::floor(p.y) + dy + .5f};
            float candidate = distance(p, q);
            if (candidate < gap && walkable(q)) { nearest = q; gap = candidate; }
        }
    return nearest;
}

bool WalkGrid::clear(Point a, Point b, float limit) const
{
    if (blockedBy(a, b)) return false;
    int steps = std::max(1, int(distance(a, b) / .25f));
    for (int i = 0; i <= steps; ++i) {
        auto p = lerp(a, b, float(i) / steps);
        int x = int(std::floor(p.x)), y = int(std::floor(p.y));
        if (x < 0 || y < 0 || x >= columns || y >= rows) return false;
        float c = cost(x, y);
        if (c <= 0 || c > limit + 1e-4f) return false;
    }
    return true;
}

std::vector<Point> WalkGrid::path(Point from, Point to) const
{
    if (costs.empty()) return {};
    const Point origin = from;
    from = nearestWalkable(from);
    if (!walkable(from) || !walkable(to)) return {};
    int sx = int(std::floor(from.x)), sy = int(std::floor(from.y)), gx = int(std::floor(to.x)), gy = int(std::floor(to.y));
    if (sx < 0 || sy < 0 || sx >= columns || sy >= rows) return {};
    if (sx == gx && sy == gy) {
        if (blockedBy(from, to)) return {};
        return origin == from ? std::vector<Point>{from, to} : std::vector<Point>{origin, from, to};
    }
    auto index = [&](int x, int y) { return y * columns + x; };
    int start = index(sx, sy), goal = index(gx, gy);
    if (regions[size_t(start)] != regions[size_t(goal)]) return {};  // No sequence of steps joins them.
    auto& state = search;
    state.begin(size_t(columns) * rows);
    auto& open = state.open;
    // Same order as std::priority_queue over std::greater: smallest estimate, then lowest cell.
    auto push = [&](float estimate, int n) { open.push_back({estimate, n}); std::push_heap(open.begin(), open.end(), std::greater<>{}); };
    // An unobstructed eight-way walk is a tighter lower bound than Euclidean distance.
    // Keep the cheapest possible ground cost so a detour along paving is still considered.
    auto guess = [&](int x, int y) {
        int dx = std::abs(x - gx), dy = std::abs(y - gy);
        return (float(std::max(dx, dy)) + (1.4142f - 1.f) * float(std::min(dx, dy))) * pavedCost;
    };
    state.set(start, 0, -1);
    push(guess(sx, sy), start);
    size_t expanded = 0;
    while (!open.empty() && expanded < searchLimit) {
        std::pop_heap(open.begin(), open.end(), std::greater<>{});
        auto [f, n] = open.back();
        open.pop_back();
        if (n == goal) break;
        int x = n % columns, y = n / columns;
        float g = state.scoreAt(n);
        if (f - guess(x, y) > g + 1e-3f) continue;
        ++expanded;
        for (int dy = -1; dy <= 1; ++dy)
            for (int dx = -1; dx <= 1; ++dx) {
                if (!dx && !dy) continue;
                int nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= columns || ny >= rows || cost(nx, ny) <= 0) continue;
                if (dx && dy && (cost(x + dx, y) <= 0 || cost(x, y + dy) <= 0)) continue;  // No squeezing past corners.
                int m = index(nx, ny);
                Point a = x == sx && y == sy ? from : Point{x + .5f, y + .5f};
                Point b = nx == gx && ny == gy ? to : Point{nx + .5f, ny + .5f};
                if ((nearObstacle[size_t(n)] || nearObstacle[size_t(m)]) && blockedBy(a, b)) continue;
                float step = (dx && dy ? 1.4142f : 1.f) * (cost(x, y) + cost(nx, ny)) / 2;
                if (g + step < state.scoreAt(m)) {
                    state.set(m, g + step, n);
                    push(g + step + guess(nx, ny), m);
                }
            }
    }
    if (state.parentAt(goal) < 0) return {};
    std::vector<Point> cellsOnPath;
    for (int n = goal; n >= 0; n = state.parentAt(n)) cellsOnPath.push_back({n % columns + .5f, n / columns + .5f});
    std::reverse(cellsOnPath.begin(), cellsOnPath.end());
    cellsOnPath.front() = from;
    cellsOnPath.back() = to;
    // String-pull only within a stretch of one kind of ground, so a leg along a road stays on the
    // road instead of cutting across the fields beside it.
    auto costAt = [&](Point p) { return cost(int(std::floor(p.x)), int(std::floor(p.y))); };
    std::vector<Point> smooth;
    if (!(origin == from)) smooth.push_back(origin);
    smooth.push_back(from);
    size_t i = 0;
    while (i + 1 < cellsOnPath.size()) {
        float ground = costAt(cellsOnPath[i]);
        size_t best = i + 1;
        for (size_t j = i + 1; j < cellsOnPath.size() && j - i <= 24; ++j) {
            if (costAt(cellsOnPath[j]) != ground) break;
            if (clear(cellsOnPath[i], cellsOnPath[j], ground)) best = j;
        }
        smooth.push_back(cellsOnPath[best]);
        i = best;
    }
    return smooth;
}
}  // namespace hearthold
