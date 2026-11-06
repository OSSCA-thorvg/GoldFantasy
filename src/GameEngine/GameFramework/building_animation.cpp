#include <GameEngine/GameFramework/animation.h>
#include "building_animation.h"
#include "building_asset.h"
#include "building_faces.h"
#include "building_depth.h"
#include <algorithm>
#include <cmath>
#include <charconv>
#include <array>
#include <limits>
#include <locale>
#include <stdexcept>
#include <sstream>

namespace gameframework
{
namespace
{
constexpr float frameStep = 1;
constexpr float padding = 12;
constexpr Rgb outline{20, 18, 24};
constexpr Rgb soil{40, 34, 28};
constexpr float sinkFrames = 10;  // A replaced stage gets this head start before the new one rises.


class Writer
{
public:
    Writer() { out.imbue(std::locale::classic()); out.precision(std::numeric_limits<float>::max_digits10); }
    std::ostringstream out;

    void color(Rgb c) { out << '[' << c.r / 255.f << ',' << c.g / 255.f << ',' << c.b / 255.f << ",1]"; }
    // Keys are pre-eased, so segments between them stay linear.
    template<typename Emit>
    void keyframes(const std::vector<float>& times, Emit emit)
    {
        out << "{\"a\":1,\"k\":[";
        for (size_t i = 0; i < times.size(); ++i) {
            out << (i ? "," : "") << "{\"t\":" << times[i] << ",\"s\":";
            emit(i);
            out << ",\"o\":{\"x\":[0],\"y\":[0]},\"i\":{\"x\":[1],\"y\":[1]}}";
        }
        out << "]}";
    }
    void opacity(const OpacityKeys& keys)
    {
        if (keys.empty()) out << "{\"a\":0,\"k\":100}";
        else if (keys.size() == 1) out << "{\"a\":0,\"k\":" << keys[0].second << '}';
        else {
            std::vector<float> times;
            for (auto& key : keys) times.push_back(key.first);
            keyframes(times, [&](size_t i) { out << '[' << keys[i].second << ']'; });
        }
    }
    void transform(const OpacityKeys& keys)
    {
        out << "{\"ty\":\"tr\",\"p\":{\"a\":0,\"k\":[0,0]},\"a\":{\"a\":0,\"k\":[0,0]},\"s\":{\"a\":0,\"k\":[100,100]},\"r\":{\"a\":0,\"k\":0},\"o\":";
        opacity(keys);
        out << '}';
    }
    // BSP splits can change topology and paint order; never morph unrelated fragments.
    template<typename Text>
    void sampled(const std::vector<float>& times, const std::vector<Text>& values, bool wrap = false, bool gradientSteps = false)
    {
        if (std::all_of(values.begin(), values.end(), [&](const auto& value) { return value == values.front(); })) {
            out << "{\"a\":0,\"k\":" << values.front() << '}';
            return;
        }
        out << "{\"a\":1,\"k\":[";
        bool first = true;
        float written = -std::numeric_limits<float>::infinity();
        auto key = [&](float time, const Text& value) {
            out << (first ? "" : ",") << "{\"t\":" << time << ",\"s\":";
            if (wrap) out << '[';
            out << value;
            if (wrap) out << ']';
            out << ",\"h\":1}";
            first = false; written = time;
        };
        for (size_t i = 0; i < values.size(); ++i) {
            if (i && values[i] == values[i - 1]) continue;
            // ThorVG 1.2 interpolates gradient stops despite h:1; adjacent float keys enforce the step.
            if (gradientSteps && i) {
                float before = std::nextafter(times[i], -std::numeric_limits<float>::infinity());
                if (before > written) key(before, values[i - 1]);
            }
            key(times[i], values[i]);
        }
        out << "]}";
    }
};

float lastDelay(const Model& model)
{
    float last = 0;
    for (const auto& block : model.blocks) last = std::max(last, block.delay);
    for (const auto& patch : model.patches) last = std::max(last, patch.delay);
    return last;
}

float opacityAt(const Face& face, float frame)
{
    if (face.opacity.empty()) return 100;
    if (frame <= face.opacity.front().first) return face.opacity.front().second;
    for (size_t i = 1; i < face.opacity.size(); ++i) {
        auto [time, value] = face.opacity[i];
        auto [previous, start] = face.opacity[i - 1];
        if (frame <= time) return start + (value - start) * (frame - previous) / (time - previous);
    }
    return face.opacity.back().second;
}

template<typename Emit>
std::string formatted(Emit emit)
{
    std::ostringstream out; out.imbue(std::locale::classic()); out.setf(std::ios::fixed); out.precision(3);
    emit(out); return out.str();
}
void appendNumber(std::string& text, float value)
{
    std::array<char, 48> buffer;
    auto converted = std::to_chars(buffer.data(), buffer.data() + buffer.size(), value, std::chars_format::fixed, 3);
    text.append(buffer.data(), converted.ptr);
}
std::string pathText(const Polygon& polygon, bool closed, Point shift)
{
    std::string text; text.reserve(64 + polygon.size() * 44);
    text += closed ? "{\"c\":true,\"v\":[" : "{\"c\":false,\"v\":[";
    for (size_t i = 0; i < polygon.size(); ++i) {
        if (i) text += ',';
        text += '['; appendNumber(text, polygon[i].x + shift.x); text += ','; appendNumber(text, polygon[i].y + shift.y); text += ']';
    }
    for (auto name : {"],\"i\":[", "],\"o\":["}) {
        text += name;
        for (size_t i = 0; i < polygon.size(); ++i) text += i ? ",[0,0]" : "[0,0]";
    }
    text += "]}";
    return text;
}
}  // namespace

static RiseAnimation buildingAnimation(const Model& source, float size, const std::vector<BuildingStage>& replaced, float angle, BuildingProjection projection, bool still)
{
    std::string error;
    auto valid = [&](const Model& model, float footprint) {
        if (!validateBuildingAsset({"preview", "Preview", footprint, {model}}, error)) throw std::invalid_argument(error);
    };
    valid(source, size);
    if (!std::isfinite(angle) || !std::isfinite(projection.halfWidth) || !std::isfinite(projection.halfHeight) ||
        projection.halfWidth <= 0 || projection.halfWidth > 512 || projection.halfHeight <= 0 || projection.halfHeight > 512 || replaced.size() > 32)
        throw std::invalid_argument("invalid building projection, angle or stage count");
    for (const auto& stage : replaced) {
        valid(stage.model, stage.footprint);
        if (!std::isfinite(stage.dx) || !std::isfinite(stage.dy) || std::abs(stage.dx) > 32 || std::abs(stage.dy) > 32)
            throw std::invalid_argument("invalid replaced stage offset");
    }
    int quarter = 0;
    float turn = 0;
    splitAngle(angle, quarter, turn);
    auto model = source;
    orientModel(model, quarter, size);
    RiseAnimation result;
    Motion rising;
    rising.start = replaced.empty() ? 0 : sinkFrames;
    rising.turn = turn;
    rising.projection = projection;
    rising.pivot = {size / 2, size / 2};
    result.frames = rising.start + lastDelay(model) + 42;
    for (const auto& block : model.blocks)
        result.frames = std::max(result.frames, rising.start + block.delay + 35 + 2 * std::max(0, block.windows - 1));
    for (const auto& stage : replaced) result.frames = std::max(result.frames, lastDelay(stage.model) + 14);

    std::vector<Face> faces;
    float inset = .04f;
    bool fresh = replaced.empty();
    faces.push_back({[=](float f) {
        float s = fresh ? gameframework::outCubic(f / 8) : 1, c = size / 2, r = (size / 2 - inset) * s;
        return Polygon{rising.place(c - r, c - r), rising.place(c + r, c - r), rising.place(c + r, c + r), rising.place(c - r, c + r)};
    }, soil, Face::Style::Filled, 1.2f, {}});
    for (const auto& stage : replaced) {
        // Turn the old stage with the new one: its centre goes round the shared pivot too.
        float half = stage.footprint / 2;
        Point center{stage.dx + half - size / 2, stage.dy + half - size / 2};
        for (int q = 0; q < quarter; ++q) center = {-center.y, center.x};
        Motion sinking = rising;
        sinking.start = 0;
        sinking.sinking = true;
        sinking.offset = {center.x + size / 2 - half, center.y + size / 2 - half};
        auto old = stage.model;
        orientModel(old, quarter, half * 2);
        buildingFaces(old, sinking, faces);
    }
    buildingFaces(model, rising, faces);

    const float finalPose = result.frames;
    std::vector<float> times;
    if (still) { times.push_back(finalPose); result.frames = 1; }
    else {
        for (float t = 0; t < result.frames; t += frameStep) times.push_back(t);
        times.push_back(result.frames - 1);
        times.push_back(result.frames);
    }
    std::sort(times.begin(), times.end());
    times.erase(std::unique(times.begin(), times.end()), times.end());
    std::vector<std::vector<DepthBatch>> samples;
    size_t slots = 0;
    for (auto time : times) {
        samples.push_back(depthBatches(faces, time));
        slots = std::max(slots, samples.back().size());
    }
    float minX = std::numeric_limits<float>::max(), minY = minX, maxX = -minX, maxY = -minX;
    for (size_t i = 0; i < faces.size(); ++i)
        for (auto t : times) {
            for (auto p : faces[i].shape(t)) { minX = std::min(minX, p.x); minY = std::min(minY, p.y); maxX = std::max(maxX, p.x); maxY = std::max(maxY, p.y); }
        }
    auto center = projection.project(size / 2, size / 2);
    float dustRadius = size * projection.halfWidth * 1.25f;
    minX = std::min(minX, center.x - dustRadius);
    maxX = std::max(maxX, center.x + dustRadius);
    maxY = std::max(maxY, center.y + dustRadius / 2);

    Point offset{padding - minX, padding - minY};
    result.width = std::ceil(maxX - minX + padding * 2);
    result.height = std::ceil(maxY - minY + padding * 2);
    result.originX = offset.x;
    result.originY = offset.y;

    Writer w;
    auto& out = w.out;
    out << "{\"v\":\"5.7.0\",\"fr\":" << result.frameRate << ",\"ip\":0,\"op\":" << result.frames << ",\"w\":" << result.width << ",\"h\":" << result.height
        << ",\"nm\":\"rise\",\"ddd\":0,\"assets\":[],\"layers\":[{\"ddd\":0,\"ind\":1,\"ty\":4,\"nm\":\"structure\",\"sr\":1,"
           "\"ks\":{\"o\":{\"a\":0,\"k\":100},\"r\":{\"a\":0,\"k\":0},\"p\":{\"a\":0,\"k\":[0,0,0]},\"a\":{\"a\":0,\"k\":[0,0,0]},\"s\":{\"a\":0,\"k\":[100,100,100]}},"
           "\"ao\":0,\"ip\":0,\"op\":" << result.frames << ",\"st\":0,\"bm\":0,\"shapes\":[";
    struct Finish { std::string gradient, start, end, stroke, width; };
    std::vector<Finish> finishes;
    for (const auto& face : faces) {
        float top = std::numeric_limits<float>::max(), bottom = -top;
        for (auto p : face.shape(finalPose)) { top = std::min(top, p.y); bottom = std::max(bottom, p.y); }
        bool shaded = bottom - top > 2;
        auto color = face.color;
        auto gradient = formatted([&](auto& stream) {
            auto channel = [](uint8_t c, float scale) { return std::min(1.f, c * scale / 255.f); };
            stream << "[0," << channel(color.r, shaded ? 1.18f : 1) << ',' << channel(color.g, shaded ? 1.18f : 1) << ',' << channel(color.b, shaded ? 1.18f : 1)
                << ",1," << channel(color.r, shaded ? .78f : 1) << ',' << channel(color.g, shaded ? .78f : 1) << ',' << channel(color.b, shaded ? .78f : 1) << ']';
        });
        if (face.style == Face::Style::Outlined) color = outline;
        finishes.push_back({std::move(gradient),
            formatted([&](auto& stream) { stream << '[' << offset.x << ',' << top + offset.y << ']'; }),
            formatted([&](auto& stream) { stream << '[' << offset.x << ',' << (shaded ? bottom : top + 1) + offset.y << ']'; }),
            formatted([&](auto& stream) { stream << '[' << color.r / 255.f << ',' << color.g / 255.f << ',' << color.b / 255.f << ",1]"; }),
            formatted([&](auto& stream) { stream << (face.style == Face::Style::Outlined ? 1.2f : face.width); })});
    }
    std::vector<std::vector<std::string>> opacities(faces.size());
    for (size_t source = 0; source < faces.size(); ++source) for (auto time : times) {
        std::string value; appendNumber(value, opacityAt(faces[source], time)); opacities[source].push_back(std::move(value));
    }
    const auto hiddenPath = pathText({{0, 0, 0}}, false, offset);
    // A track is a depth rank, not a block. Its source can change when animated surfaces cross.
    for (size_t n = slots; n-- > 0;) {
        out << "{\"ty\":\"gr\",\"nm\":\"depth" << n << "\",\"it\":[";
        size_t pathsInSlot = 0;
        for (const auto& sample : samples) if (n < sample.size()) pathsInSlot = std::max(pathsInSlot, sample[n].polygons.size());
        for (size_t path = 0; path < pathsInSlot; ++path) {
            std::vector<std::string> storage; storage.reserve(times.size());
            std::vector<std::string_view> paths;
            for (const auto& sample : samples) {
                if (n < sample.size() && path < sample[n].polygons.size()) {
                    storage.push_back(pathText(sample[n].polygons[path], !sample[n].line, offset)); paths.push_back(storage.back());
                } else paths.push_back(hiddenPath);
            }
            out << "{\"ty\":\"sh\",\"ks\":"; w.sampled(times, paths, true); out << "},";
        }
        std::vector<std::string_view> gradients, starts, ends, strokes, widths, fillAlpha, lineAlpha, alpha;
        for (size_t i = 0; i < times.size(); ++i) {
            bool present = n < samples[i].size();
            const auto* batch = present ? &samples[i][n] : nullptr;
            size_t source = present ? batch->source : 0;
            bool line = present && batch->line;
            const auto& finish = finishes[source];
            gradients.push_back(finish.gradient); starts.push_back(finish.start); ends.push_back(finish.end);
            strokes.push_back(finish.stroke); widths.push_back(finish.width);
            fillAlpha.push_back(present && !line ? "100" : "0");
            lineAlpha.push_back(line ? "100" : "0");
            alpha.push_back(present ? std::string_view(opacities[source][i]) : "0");
        }
        out << "{\"ty\":\"gf\",\"r\":1,\"t\":1,\"g\":{\"p\":2,\"k\":";
        w.sampled(times, gradients, false, true);
        out << "},\"s\":"; w.sampled(times, starts);
        out << ",\"e\":"; w.sampled(times, ends);
        out << ",\"o\":"; w.sampled(times, fillAlpha, true);
        out << "},{\"ty\":\"st\",\"c\":"; w.sampled(times, strokes);
        out << ",\"w\":"; w.sampled(times, widths, true);
        out << ",\"o\":"; w.sampled(times, lineAlpha, true);
        out << ",\"lc\":2,\"lj\":2},{\"ty\":\"tr\",\"p\":{\"a\":0,\"k\":[0,0]},\"a\":{\"a\":0,\"k\":[0,0]},\"s\":{\"a\":0,\"k\":[100,100]},\"r\":{\"a\":0,\"k\":0},\"o\":";
        w.sampled(times, alpha, true);
        out << "}]},";
    }
    if (still) {
        auto json = out.str();
        if (json.back() == ',') json.pop_back();
        result.json = std::move(json) + "]}]}";
        return result;
    }
    // Dust ring kicked up by the foundation.
    float x = center.x + offset.x, y = center.y + offset.y, kick = rising.start;
    out << "{\"ty\":\"gr\",\"nm\":\"dust\",\"it\":[{\"ty\":\"el\",\"p\":{\"a\":0,\"k\":[" << x << ',' << y << "]},\"s\":";
    w.keyframes({0, kick + 4, kick + 30}, [&](size_t i) { float r = dustRadius * (i < 2 ? .45f : 1); out << '[' << r * 2 << ',' << r << ']'; });
    out << "},{\"ty\":\"st\",\"c\":{\"a\":0,\"k\":";
    w.color({150, 136, 112});
    out << "},\"o\":";
    w.keyframes({0, kick + 4, kick + 30}, [&](size_t i) { out << '[' << (i == 1 ? 55 : 0) << ']'; });
    out << ",\"w\":{\"a\":0,\"k\":2.5},\"lc\":2,\"lj\":2},";
    w.transform({});
    out << "]}]}]}";
    result.json = out.str();
    return result;
}
RiseAnimation buildingRiseAnimation(const Model& source, float size, const std::vector<BuildingStage>& replaced, float angle, BuildingProjection projection)
{
    return buildingAnimation(source, size, replaced, angle, projection, false);
}
RiseAnimation buildingStillAnimation(const Model& source, float size, float angle, BuildingProjection projection)
{
    return buildingAnimation(source, size, {}, angle, projection, true);
}
}  // namespace gameframework
