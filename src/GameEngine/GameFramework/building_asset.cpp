#include "building_asset.h"
#include <core/json/json.h>
#include <core/utf8.h>
#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace gameframework
{
namespace
{
using te::json::Value;
using Array = Value::Array;
using Object = Value::Object;
constexpr const char* shapes[]{"flat", "gable-x", "gable-y", "pyramid"};
constexpr const char* trims[]{"none", "timber", "crenels", "stakes"};
constexpr const char* ornaments[]{"none", "banner", "crystal"};

bool fail(std::string& error, const std::string& path, std::string_view why)
{
    error = path + ": " + std::string(why);
    return false;
}
bool between(float value, float low, float high) { return std::isfinite(value) && value >= low && value <= high; }
bool bounds(float x0, float y0, float x1, float y1, const std::string& path, std::string& error)
{
    if (!between(x0, -8, 16) || !between(y0, -8, 16) || !between(x1, -8, 16) || !between(y1, -8, 16))
        return fail(error, path, "coordinates must be finite and within [-8,16]");
    if (x1 <= x0) return fail(error, path, "x1 must exceed x0");
    if (y1 <= y0) return fail(error, path, "y1 must exceed y0");
    if (x1 - x0 > 8 || y1 - y0 > 8) return fail(error, path, "rectangle spans must not exceed 8");
    return true;
}
bool fields(const Value& value, const std::string& path, std::initializer_list<std::string_view> allowed, std::string& error)
{
    auto object = value.object();
    if (!object) return fail(error, path, "expected an object");
    for (const auto& [key, unused] : *object)
        if (std::find(allowed.begin(), allowed.end(), key) == allowed.end()) return fail(error, path + "." + key, "unknown field");
    return true;
}
bool number(const Value* value, const std::string& path, double& output, std::string& error)
{
    if (!value || !value->number()) return fail(error, path, "expected a number");
    output = *value->number();
    return true;
}
bool scalar(const Value& parent, const char* key, const std::string& path, float& output, bool required, std::string& error)
{
    auto value = parent.find(key);
    if (!value && !required) return true;
    double n;
    if (!number(value, path + "." + key, n, error)) return false;
    double low = std::string_view(key) == "footprint" ? .25 : 0;
    double high = std::string_view(key) == "footprint" ? 8 : std::string_view(key) == "delay" ? 120 : 256;
    if (!std::isfinite(n) || n < low || n > high) return fail(error, path + "." + key, "number outside supported range");
    output = float(n);
    return true;
}
bool integer(const Value& parent, const char* key, const std::string& path, int& output, int low, int high, std::string& error)
{
    auto value = parent.find(key);
    if (!value) return true;
    double n;
    if (!number(value, path + "." + key, n, error)) return false;
    if (!std::isfinite(n) || n < low || n > high || std::floor(n) != n) return fail(error, path + "." + key, "expected an integer in the supported range");
    output = int(n);
    return true;
}
bool rgb(const Value& parent, const char* key, const std::string& path, Rgb& output, bool required, std::string& error)
{
    auto value = parent.find(key);
    if (!value && !required) return true;
    auto list = value ? value->array() : nullptr;
    if (!list || list->size() != 3) return fail(error, path + "." + key, "expected three color channels");
    uint8_t channels[3];
    for (size_t i = 0; i < 3; ++i) {
        double n;
        auto at = path + "." + key + "[" + std::to_string(i) + "]";
        if (!number(&(*list)[i], at, n, error)) return false;
        if (!std::isfinite(n) || n < 0 || n > 255 || std::floor(n) != n) return fail(error, at, "expected an integer in [0,255]");
        channels[i] = uint8_t(n);
    }
    output = {channels[0], channels[1], channels[2]};
    return true;
}
bool rectangle(const Value& parent, const std::string& path, float& x0, float& y0, float& x1, float& y1, std::string& error)
{
    auto value = parent.find("bounds");
    auto list = value ? value->array() : nullptr;
    if (!list || list->size() != 4) return fail(error, path + ".bounds", "expected four coordinates");
    float* coords[]{&x0, &y0, &x1, &y1};
    for (size_t i = 0; i < 4; ++i) {
        double n;
        if (!number(&(*list)[i], path + ".bounds[" + std::to_string(i) + "]", n, error)) return false;
        if (!std::isfinite(n) || n < -8 || n > 16) return fail(error, path + ".bounds", "coordinates must be within [-8,16]");
        *coords[i] = float(n);
    }
    return true;
}
template<typename Enum, size_t N>
bool enumeration(const Value& parent, const char* key, const std::string& path, Enum& output, const char* const (&names)[N], bool required, std::string& error)
{
    auto value = parent.find(key);
    if (!value && !required) return true;
    auto text = value ? value->string() : nullptr;
    if (text) for (size_t i = 0; i < N; ++i) if (*text == names[i]) { output = Enum(i); return true; }
    return fail(error, path + "." + key, "unknown enum value");
}
bool text(const Value& parent, const char* key, std::string& output, std::string& error)
{
    auto value = parent.find(key);
    if (!value || !value->string()) return fail(error, key, "expected a string");
    output = *value->string();
    return true;
}
Value color(Rgb c) { return Array{c.r, c.g, c.b}; }
}  // namespace

bool validateBuildingAsset(const BuildingAsset& asset, std::string& error)
{
    error.clear();
    if (asset.id.empty() || asset.id.size() > 64 || asset.id[0] < 'a' || asset.id[0] > 'z' ||
        std::any_of(asset.id.begin(), asset.id.end(), [](char c) { return !(c >= 'a' && c <= 'z') && !(c >= '0' && c <= '9') && c != '-'; }))
        return fail(error, "id", "expected [a-z][a-z0-9-]{0,63}");
    if (asset.name.empty() || asset.name.size() > 96 ||
        std::none_of(asset.name.begin(), asset.name.end(), [](unsigned char c) { return c > 32; })) return fail(error, "name", "expected 1–96 UTF-8 bytes with non-space text");
    for (size_t i = 0; i < asset.name.size();) {
        auto c = static_cast<unsigned char>(asset.name[i]);
        size_t length = te::utf8::sequenceLength(c);
        if (c < 32 || c == 127 || !length || !te::utf8::validSequence(std::string_view(asset.name).substr(i, length))) return fail(error, "name", "invalid UTF-8 or control character");
        i += length;
    }
    if (!between(asset.footprint, .25f, 8)) return fail(error, "footprint", "expected a finite number in [0.25,8]");
    if (asset.variants.empty() || asset.variants.size() > 32) return fail(error, "variants", "expected 1–32 variants");
    for (size_t v = 0; v < asset.variants.size(); ++v) {
        const auto& model = asset.variants[v];
        auto path = "variants[" + std::to_string(v) + "]";
        if (model.blocks.size() > 64 || model.patches.size() > 32 || (model.blocks.empty() && model.patches.empty())) return fail(error, path, "expected 1–96 primitives, at most 64 blocks and 32 patches");
        size_t faces = 0;
        for (size_t i = 0; i < model.patches.size(); ++i) {
            const auto& p = model.patches[i];
            auto at = path + ".patches[" + std::to_string(i) + "]";
            if (!bounds(p.x0, p.y0, p.x1, p.y1, at + ".bounds", error)) return false;
            if (!between(p.delay, 0, 120)) return fail(error, at + ".delay", "expected a finite number in [0,120]");
            if (p.furrows < 0 || p.furrows > 32) return fail(error, at + ".furrows", "expected an integer in [0,32]");
            faces += 1 + p.furrows;
        }
        for (size_t i = 0; i < model.blocks.size(); ++i) {
            const auto& b = model.blocks[i];
            auto at = path + ".blocks[" + std::to_string(i) + "]";
            if (!bounds(b.x0, b.y0, b.x1, b.y1, at + ".bounds", error)) return false;
            for (auto [value, name] : {std::pair{b.base, "base"}, {b.wall, "wall"}, {b.roof, "roof"}})
                if (!between(value, 0, 256)) return fail(error, at + "." + name, "expected a finite number in [0,256]");
            if (b.base + b.wall + b.roof > 512) return fail(error, at, "combined height exceeds 512");
            if (!between(b.delay, 0, 120)) return fail(error, at + ".delay", "expected a finite number in [0,120]");
            if (b.windows < 0 || b.windows > 8) return fail(error, at + ".windows", "expected an integer in [0,8]");
            if (unsigned(b.shape) > unsigned(RoofShape::Pyramid)) return fail(error, at + ".shape", "unknown enum value");
            if (unsigned(b.trim) > unsigned(Trim::Stakes)) return fail(error, at + ".trim", "unknown enum value");
            if (unsigned(b.ornament) > unsigned(Ornament::Crystal)) return fail(error, at + ".ornament", "unknown enum value");
            faces += 2 + (b.shape == RoofShape::Flat ? 1 : b.shape == RoofShape::Pyramid ? 4 : 2) + b.windows * 2 + unsigned(b.door);
            if (b.trim == Trim::Timber) faces += 8;
            if (b.ornament == Ornament::Banner) faces += 2;
            if (b.ornament == Ornament::Crystal) faces += 3;
            if (b.shape == RoofShape::Flat && (b.trim == Trim::Stakes || b.trim == Trim::Crenels)) {
                float pitch = b.trim == Trim::Stakes ? .12f : .2f;
                faces += 2 * std::max(2, int((b.x1 - b.x0) / pitch)) + 2 * std::max(2, int((b.y1 - b.y0) / pitch));
            }
        }
        if (faces > 2048) return fail(error, path, "decoration expansion exceeds 2048 faces");
    }
    return true;
}

bool decodeBuildingAsset(std::string_view source, BuildingAsset& output, std::string& error)
{
    Value root;
    if (!te::json::parse(source, root, error)) return false;
    if (!fields(root, "asset", {"format", "version", "id", "name", "footprint", "variants"}, error)) return false;
    auto format = root.find("format"), version = root.find("version");
    if (!format || !format->string() || *format->string() != "building-asset") return fail(error, "format", "expected building-asset");
    if (!version || !version->number() || *version->number() != 1) return fail(error, "version", "expected integer 1");
    BuildingAsset asset;
    if (!text(root, "id", asset.id, error) || !text(root, "name", asset.name, error) || !scalar(root, "footprint", "asset", asset.footprint, true, error)) return false;
    auto variantsValue = root.find("variants");
    auto variants = variantsValue ? variantsValue->array() : nullptr;
    if (!variants || variants->empty() || variants->size() > 32) return fail(error, "variants", "expected 1–32 variants");
    for (size_t v = 0; v < variants->size(); ++v) {
        const auto& variant = (*variants)[v];
        auto path = "variants[" + std::to_string(v) + "]";
        if (!fields(variant, path, {"blocks", "patches"}, error)) return false;
        auto blockValue = variant.find("blocks"), patchValue = variant.find("patches");
        auto blocks = blockValue ? blockValue->array() : nullptr, patches = patchValue ? patchValue->array() : nullptr;
        if (!blocks || blocks->size() > 64) return fail(error, path + ".blocks", "expected an array of at most 64 blocks");
        if (!patches || patches->size() > 32) return fail(error, path + ".patches", "expected an array of at most 32 patches");
        Model model;
        for (size_t i = 0; i < patches->size(); ++i) {
            const auto& value = (*patches)[i]; auto at = path + ".patches[" + std::to_string(i) + "]";
            if (!fields(value, at, {"bounds", "color", "furrows", "furrow", "delay"}, error)) return false;
            Patch p{};
            if (!rectangle(value, at, p.x0, p.y0, p.x1, p.y1, error) || !rgb(value, "color", at, p.color, true, error) ||
                !rgb(value, "furrow", at, p.furrow, false, error) || !integer(value, "furrows", at, p.furrows, 0, 32, error) ||
                !scalar(value, "delay", at, p.delay, false, error)) return false;
            model.patches.push_back(p);
        }
        for (size_t i = 0; i < blocks->size(); ++i) {
            const auto& value = (*blocks)[i]; auto at = path + ".blocks[" + std::to_string(i) + "]";
            if (!fields(value, at, {"bounds", "wall", "roof", "shape", "wallLit", "wallShade", "roofLit", "roofShade", "base", "delay", "windows", "door", "trim", "glass", "ornament", "accent"}, error)) return false;
            Block b{};
            if (!rectangle(value, at, b.x0, b.y0, b.x1, b.y1, error) || !scalar(value, "wall", at, b.wall, true, error) || !scalar(value, "roof", at, b.roof, true, error) ||
                !scalar(value, "base", at, b.base, false, error) || !scalar(value, "delay", at, b.delay, false, error) || !integer(value, "windows", at, b.windows, 0, 8, error) ||
                !enumeration(value, "shape", at, b.shape, shapes, true, error) || !enumeration(value, "trim", at, b.trim, trims, false, error) ||
                !enumeration(value, "ornament", at, b.ornament, ornaments, false, error) || !rgb(value, "wallLit", at, b.wallLit, true, error) ||
                !rgb(value, "wallShade", at, b.wallShade, true, error) || !rgb(value, "roofLit", at, b.roofLit, true, error) || !rgb(value, "roofShade", at, b.roofShade, true, error) ||
                !rgb(value, "glass", at, b.glass, false, error) || !rgb(value, "accent", at, b.accent, false, error)) return false;
            if (auto door = value.find("door")) {
                if (!door->boolean()) return fail(error, at + ".door", "expected a boolean");
                b.door = *door->boolean();
            }
            double height = *value.find("wall")->number() + *value.find("roof")->number();
            if (auto base = value.find("base")) height += *base->number();
            if (height > 512) return fail(error, at, "combined height exceeds 512");
            model.blocks.push_back(b);
        }
        asset.variants.push_back(std::move(model));
    }
    if (!validateBuildingAsset(asset, error)) return false;
    output = std::move(asset);
    return true;
}

std::string encodeBuildingAsset(const BuildingAsset& asset)
{
    std::string error;
    if (!validateBuildingAsset(asset, error)) throw std::invalid_argument(error);
    Array variants;
    for (const auto& model : asset.variants) {
        Array blocks, patches;
        for (const auto& p : model.patches) patches.emplace_back(Object{{"bounds", Array{p.x0, p.y0, p.x1, p.y1}}, {"color", color(p.color)}, {"furrows", p.furrows}, {"furrow", color(p.furrow)}, {"delay", p.delay}});
        for (const auto& b : model.blocks) blocks.emplace_back(Object{
            {"bounds", Array{b.x0, b.y0, b.x1, b.y1}}, {"wall", b.wall}, {"roof", b.roof}, {"shape", shapes[unsigned(b.shape)]},
            {"wallLit", color(b.wallLit)}, {"wallShade", color(b.wallShade)}, {"roofLit", color(b.roofLit)}, {"roofShade", color(b.roofShade)},
            {"base", b.base}, {"delay", b.delay}, {"windows", b.windows}, {"door", b.door}, {"trim", trims[unsigned(b.trim)]},
            {"glass", color(b.glass)}, {"ornament", ornaments[unsigned(b.ornament)]}, {"accent", color(b.accent)}});
        variants.emplace_back(Object{{"blocks", std::move(blocks)}, {"patches", std::move(patches)}});
    }
    return te::json::stringify(Object{{"format", "building-asset"}, {"version", 1}, {"id", asset.id}, {"name", asset.name}, {"footprint", asset.footprint}, {"variants", std::move(variants)}});
}

const Model& buildingVariant(const BuildingAsset& asset, uint32_t seed)
{
    if (asset.variants.empty()) throw std::invalid_argument("building asset has no variants");
    return asset.variants[seed % asset.variants.size()];
}
}  // namespace gameframework
