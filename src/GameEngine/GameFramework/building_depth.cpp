#include "building_depth.h"
#include <algorithm>
#include <cmath>
#include <memory>
#include <numeric>
#include <optional>
#include <stdexcept>

namespace gameframework
{
namespace
{
constexpr double epsilon = 1e-5;
constexpr size_t maximumFragments = 65536, maximumWork = 16000000, maximumDepth = 256;

struct Budget
{
    size_t fragments = 0, work = 0;
    void fragment() { if (++fragments > maximumFragments) throw std::length_error("building depth fragment limit exceeded"); }
    void inspect(size_t count) { if ((work += count) > maximumWork) throw std::length_error("building depth work limit exceeded"); }
};
struct Plane
{
    double x, y, z, offset;
    double distance(Vertex v) const { return x * v.x + y * v.y + z * v.depth + offset; }
};
struct Node
{
    Plane plane;
    std::vector<DepthFragment> coplanar;
    std::unique_ptr<Node> back, front;
};

double cross(Vertex a, Vertex b, Vertex c)
{
    return (double(b.x) - a.x) * (double(c.y) - a.y) - (double(b.y) - a.y) * (double(c.x) - a.x);
}
double area(const Polygon& points)
{
    double result = 0;
    for (size_t i = 0; i < points.size(); ++i) {
        const auto& a = points[i]; const auto& b = points[(i + 1) % points.size()];
        result += double(a.x) * b.y - double(a.y) * b.x;
    }
    return result * .5;
}
bool hasArea(const Polygon& points)
{
    if (points.size() < 3) return false;
    float x0 = points[0].x, x1 = x0, y0 = points[0].y, y1 = y0;
    for (auto point : points) { x0 = std::min(x0, point.x); x1 = std::max(x1, point.x); y0 = std::min(y0, point.y); y1 = std::max(y1, point.y); }
    return std::abs(area(points)) > epsilon * std::max(1.f, x1 - x0 + y1 - y0);
}
bool same(Vertex a, Vertex b)
{
    return std::abs(a.x - b.x) < epsilon && std::abs(a.y - b.y) < epsilon && std::abs(a.depth - b.depth) < epsilon;
}
void append(Polygon& points, Vertex point)
{
    if (points.empty() || !same(points.back(), point)) points.push_back(point);
}
void clean(Polygon& points)
{
    if (points.size() > 1 && same(points.front(), points.back())) points.pop_back();
}
Vertex intersection(Vertex a, Vertex b, double da, double db)
{
    auto t = da / (da - db);
    return {float(a.x + (double(b.x) - a.x) * t), float(a.y + (double(b.y) - a.y) * t),
            float(a.depth + (double(b.depth) - a.depth) * t)};
}
std::optional<Plane> plane(const DepthFragment& fragment)
{
    const auto& p = fragment.polygon;
    if (fragment.line) {
        auto a = p.front(), b = p.back();
        double dx = double(b.x) - a.x, dy = double(b.y) - a.y, dd = double(b.depth) - a.depth;
        double length = dx * dx + dy * dy;
        if (length <= epsilon * epsilon) return Plane{0, 0, 1, -std::max(a.depth, b.depth)};
        double x = -dd * dx / length, y = -dd * dy / length;
        double norm = std::sqrt(x * x + y * y + 1);
        return Plane{x / norm, y / norm, 1 / norm, -(x * a.x + y * a.y + a.depth) / norm};
    }
    for (size_t i = 1; i + 1 < p.size(); ++i) {
        double ax = double(p[i].x) - p[0].x, ay = double(p[i].y) - p[0].y, az = double(p[i].depth) - p[0].depth;
        double bx = double(p[i + 1].x) - p[0].x, by = double(p[i + 1].y) - p[0].y, bz = double(p[i + 1].depth) - p[0].depth;
        double x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx;
        if (std::abs(z) <= epsilon) continue;
        double norm = std::sqrt(x * x + y * y + z * z) * (z < 0 ? -1 : 1);
        x /= norm; y /= norm; z /= norm;
        return Plane{x, y, z, -(x * p[0].x + y * p[0].y + z * p[0].depth)};
    }
    return {};
}
int side(const Polygon& points, const Plane& plane, Budget& budget)
{
    budget.inspect(points.size());
    int result = 0;
    for (auto point : points) {
        double distance = plane.distance(point);
        if (distance < -epsilon) result |= 1;
        else if (distance > epsilon) result |= 2;
    }
    return result;
}
std::pair<DepthFragment, DepthFragment> split(const DepthFragment& input, const Plane& plane, Budget& budget)
{
    DepthFragment back{input.source, {}, input.line}, front{input.source, {}, input.line};
    auto& points = input.polygon;
    size_t count = input.line ? points.size() - 1 : points.size();
    for (size_t i = 0; i < count; ++i) {
        auto a = points[i], b = points[(i + 1) % points.size()];
        double da = plane.distance(a), db = plane.distance(b);
        if (da <= epsilon) append(back.polygon, a);
        if (da >= -epsilon) append(front.polygon, a);
        if ((da < -epsilon && db > epsilon) || (da > epsilon && db < -epsilon)) {
            auto point = intersection(a, b, da, db);
            append(back.polygon, point); append(front.polygon, point);
        }
    }
    if (input.line) {
        auto last = points.back(); auto distance = plane.distance(last);
        if (distance <= epsilon) append(back.polygon, last);
        if (distance >= -epsilon) append(front.polygon, last);
    } else { clean(back.polygon); clean(front.polygon); }
    budget.fragment();
    return {std::move(back), std::move(front)};
}
bool valid(const DepthFragment& fragment)
{
    return fragment.line ? fragment.polygon.size() >= 2 && !same(fragment.polygon.front(), fragment.polygon.back())
                         : hasArea(fragment.polygon);
}

std::unique_ptr<Node> partition(std::vector<DepthFragment> fragments, Budget& budget, size_t depth)
{
    if (fragments.empty()) return {};
    if (depth > maximumDepth) throw std::length_error("building depth tree limit exceeded");
    std::optional<Plane> chosen;
    size_t chosenIndex = 0;
    size_t best = size_t(-1);
    // Prefer surface planes; line-only leaves still get a valid camera-facing partition.
    std::vector<size_t> candidates;
    for (size_t i = 0; i < fragments.size(); ++i) if (!fragments[i].line) candidates.push_back(i);
    if (candidates.empty()) { candidates.resize(fragments.size()); std::iota(candidates.begin(), candidates.end(), 0); }
    size_t attempts = std::min<size_t>(8, candidates.size());
    for (size_t sample = 0; sample < attempts; ++sample) {
        size_t index = candidates[sample * candidates.size() / attempts];
        auto candidate = plane(fragments[index]);
        if (!candidate) continue;
        size_t back = 0, front = 0, crossing = 0;
        for (const auto& fragment : fragments) {
            auto classification = side(fragment.polygon, *candidate, budget);
            back += classification == 1; front += classification == 2; crossing += classification == 3;
        }
        size_t score = crossing * 8 + (back > front ? back - front : front - back);
        if (score < best) { best = score; chosen = candidate; chosenIndex = index; }
        if (!score) break;
    }
    if (!chosen) throw std::invalid_argument("building depth geometry has no valid plane");
    auto node = std::make_unique<Node>(); node->plane = *chosen;
    std::vector<DepthFragment> back, front;
    for (size_t i = 0; i < fragments.size(); ++i) {
        auto& fragment = fragments[i];
        // Float projection can move a fourth coplanar vertex by a few ulps.
        switch (i == chosenIndex ? 0 : side(fragment.polygon, node->plane, budget)) {
        case 0: node->coplanar.push_back(std::move(fragment)); break;
        case 1: back.push_back(std::move(fragment)); break;
        case 2: front.push_back(std::move(fragment)); break;
        case 3: {
            auto pieces = split(fragment, node->plane, budget);
            if (valid(pieces.first)) back.push_back(std::move(pieces.first));
            if (valid(pieces.second)) front.push_back(std::move(pieces.second));
            break;
        }
        }
    }
    std::stable_sort(node->coplanar.begin(), node->coplanar.end(), [](const auto& a, const auto& b) {
        return a.source != b.source ? a.source < b.source : a.line < b.line;
    });
    node->back = partition(std::move(back), budget, depth + 1);
    node->front = partition(std::move(front), budget, depth + 1);
    return node;
}
void traverse(Node* node, std::vector<DepthFragment>& output)
{
    if (!node) return;
    traverse(node->back.get(), output);
    for (auto& fragment : node->coplanar) output.push_back(std::move(fragment));
    traverse(node->front.get(), output);
}

void fills(Polygon points, size_t source, std::vector<DepthFragment>& output, Budget& budget)
{
    clean(points);
    if (!hasArea(points)) return;
    auto direction = area(points) > 0 ? 1. : -1.;
    bool convex = true;
    for (size_t i = 0; i < points.size(); ++i)
        if (cross(points[i], points[(i + 1) % points.size()], points[(i + 2) % points.size()]) * direction < -epsilon) convex = false;
    if (convex) { budget.fragment(); output.push_back({source, std::move(points), false}); return; }
    // Only concave outlines need triangulation; source strokes remain separate.
    while (points.size() > 3) {
        bool removed = false;
        for (size_t i = 0; i < points.size(); ++i) {
            size_t prev = (i + points.size() - 1) % points.size(), next = (i + 1) % points.size();
            auto a = points[prev], b = points[i], c = points[next];
            if (cross(a, b, c) * direction <= epsilon) continue;
            bool occupied = false;
            for (size_t j = 0; j < points.size(); ++j) if (j != prev && j != i && j != next) {
                budget.inspect(1);
                auto p = points[j];
                if (cross(a, b, p) * direction >= -epsilon && cross(b, c, p) * direction >= -epsilon && cross(c, a, p) * direction >= -epsilon) { occupied = true; break; }
            }
            if (occupied) continue;
            budget.fragment(); output.push_back({source, {a, b, c}, false});
            points.erase(points.begin() + i); removed = true; break;
        }
        if (!removed) throw std::invalid_argument("building depth face is not a simple polygon");
    }
    budget.fragment(); output.push_back({source, std::move(points), false});
}
float opacity(const Face& face, float frame)
{
    if (face.opacity.empty()) return 100;
    if (frame <= face.opacity.front().first) return face.opacity.front().second;
    for (size_t i = 1; i < face.opacity.size(); ++i) if (frame < face.opacity[i].first) {
        auto [a, first] = face.opacity[i - 1]; auto [b, last] = face.opacity[i];
        return first + (last - first) * (frame - a) / (b - a);
    }
    return face.opacity.back().second;
}

bool halfspace(double a, double b, double& low, double& high)
{
    if (a >= 0 && b >= 0) return true;
    if (a < 0 && b < 0) return false;
    double crossing = a / (a - b);
    if (a < 0) low = std::max(low, crossing);
    else high = std::min(high, crossing);
    return high > low;
}
std::vector<DepthFragment> visibleLines(std::vector<DepthFragment> input, const std::vector<Face>& faces, float frame, Budget& budget)
{
    struct Occluder { Polygon polygon; Plane plane; size_t source; double direction; float x0, y0, x1, y1; };
    std::vector<Occluder> occluders;
    for (const auto& fragment : input) if (!fragment.line && opacity(faces[fragment.source], frame) >= 100 - epsilon) {
        auto surface = plane(fragment);
        if (!surface) continue;
        auto point = fragment.polygon.front();
        Occluder cover{fragment.polygon, *surface, fragment.source, area(fragment.polygon) > 0 ? 1. : -1., point.x, point.y, point.x, point.y};
        for (auto p : fragment.polygon) { cover.x0 = std::min(cover.x0, p.x); cover.y0 = std::min(cover.y0, p.y); cover.x1 = std::max(cover.x1, p.x); cover.y1 = std::max(cover.y1, p.y); }
        occluders.push_back(std::move(cover));
    }
    std::vector<DepthFragment> output;
    for (auto& fragment : input) {
        if (!fragment.line) { output.push_back(std::move(fragment)); continue; }
        auto a = fragment.polygon.front(), b = fragment.polygon.back();
        std::vector<std::pair<double, double>> intervals{{0, 1}};
        for (const auto& cover : occluders) {
            if (cover.source == fragment.source || std::max(a.x, b.x) < cover.x0 || std::min(a.x, b.x) > cover.x1 ||
                std::max(a.y, b.y) < cover.y0 || std::min(a.y, b.y) > cover.y1) continue;
            budget.inspect(cover.polygon.size() + 1);
            double low = 0, high = 1;
            if (!halfspace(-cover.plane.distance(a) - epsilon, -cover.plane.distance(b) - epsilon, low, high)) continue;
            bool intersects = true;
            for (size_t i = 0; i < cover.polygon.size(); ++i) {
                auto p = cover.polygon[i], q = cover.polygon[(i + 1) % cover.polygon.size()];
                if (!halfspace(cross(p, q, a) * cover.direction, cross(p, q, b) * cover.direction, low, high)) { intersects = false; break; }
            }
            if (!intersects || high - low < epsilon) continue;
            std::vector<std::pair<double, double>> kept;
            for (auto [from, to] : intervals) {
                if (high <= from || low >= to) kept.emplace_back(from, to);
                else {
                    if (low > from + epsilon) kept.emplace_back(from, low);
                    if (high < to - epsilon) kept.emplace_back(high, to);
                }
            }
            intervals = std::move(kept);
            if (intervals.empty()) break;
        }
        auto point = [a, b](double t) { return Vertex{float(a.x + (double(b.x) - a.x) * t), float(a.y + (double(b.y) - a.y) * t), float(a.depth + (double(b.depth) - a.depth) * t)}; };
        for (size_t i = 0; i < intervals.size(); ++i) {
            if (i) budget.fragment();
            auto [from, to] = intervals[i];
            output.push_back({fragment.source, {point(from), point(to)}, true});
        }
    }
    return output;
}
}  // namespace

std::vector<DepthFragment> depthOrder(const std::vector<Face>& faces, float frame)
{
    if (!std::isfinite(frame)) throw std::invalid_argument("building depth frame must be finite");
    Budget budget;
    std::vector<DepthFragment> input;
    for (size_t source = 0; source < faces.size(); ++source) {
        const auto& face = faces[source];
        if (opacity(face, frame) <= 0) continue;
        auto points = face.shape(frame);
        budget.inspect(points.size());
        for (auto point : points) if (!std::isfinite(point.x) || !std::isfinite(point.y) || !std::isfinite(point.depth))
            throw std::invalid_argument("building depth vertex must be finite");
        if (face.style != Face::Style::Line) fills(points, source, input, budget);
        if (face.style != Face::Style::Filled && points.size() >= 2) {
            size_t count = face.style == Face::Style::Line ? points.size() - 1 : points.size();
            for (size_t i = 0; i < count; ++i) {
                auto a = points[i], b = points[(i + 1) % points.size()];
                if (!same(a, b)) { budget.fragment(); input.push_back({source, {a, b}, true}); }
            }
        }
    }
    // Opaque surfaces hide strokes geometrically, avoiding leaks through antialiased split edges.
    auto tree = partition(visibleLines(std::move(input), faces, frame, budget), budget, 0);
    std::vector<DepthFragment> output;
    traverse(tree.get(), output);
    return output;
}

std::vector<DepthBatch> depthBatches(const std::vector<Face>& faces, float frame)
{
    auto fragments = depthOrder(faces, frame);
    std::vector<DepthBatch> batches;
    for (auto& fragment : fragments) {
        if (batches.empty() || batches.back().source != fragment.source || batches.back().line != fragment.line)
            batches.push_back({fragment.source, fragment.line, {}});
        batches.back().polygons.push_back(std::move(fragment.polygon));
    }
    return batches;
}
}  // namespace gameframework
