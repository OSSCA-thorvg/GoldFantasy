#include <test/test.h>
#include <test/graphics.h>
#include <GameEngine/GameFramework/building_asset.h>
#include <GameEngine/GameFramework/building_animation.h>
#include <GameEngine/GameFramework/building_faces.h>
#include <GameEngine/GameFramework/building_icon.h>
#include <core/json/json.h>
#include <algorithm>
#include <cmath>
#include <limits>
#include <memory>
#include <stdexcept>

namespace
{
using namespace gameframework;
BuildingAsset sample()
{
    Block b{.1f, .2f, .8f, .9f, 20, 15, RoofShape::GableY, {112,100,86}, {72,64,58}, {92,80,54}, {60,52,38}};
    b.windows = 2; b.door = true; b.trim = Trim::Timber;
    return {"example-building", "Example ★", 1, {{{{0, 0, 1, 1, {62,58,54}, 2, {30,30,30}, 2}}, {b}}}};
}
void loads(const RiseAnimation& rise)
{
    CHECK(std::isfinite(rise.width) && std::isfinite(rise.height));
    CHECK(rise.width > 0 && rise.height > 0);
    CHECK(rise.originX > 0 && rise.originY > 0 && rise.originX < rise.width && rise.originY < rise.height);
    std::unique_ptr<tvg::Animation> animation(tvg::Animation::gen());
    CHECK(animation->picture()->load(rise.json.data(), uint32_t(rise.json.size()), "lottie+json", nullptr, true) == tvg::Result::Success);
    CHECK_EQ(animation->totalFrame(), rise.frames);
}
std::vector<uint32_t> finalPixels(const RiseAnimation& rise, bool beyond)
{
    auto json = rise.json;
    if (beyond) {
        te::json::Value value; std::string error; CHECK(te::json::parse(json,value,error));
        auto& root = std::get<te::json::Value::Object>(value.data);
        root["op"] = rise.frames + 4;
        auto& layers = std::get<te::json::Value::Array>(root["layers"].data);
        std::get<te::json::Value::Object>(layers[0].data)["op"] = rise.frames + 4;
        json = te::json::stringify(value, false);
    }
    std::unique_ptr<tvg::Animation> animation(tvg::Animation::gen());
    CHECK(animation->picture()->load(json.data(),uint32_t(json.size()),"lottie+json",nullptr,true) == tvg::Result::Success);
    float frame = rise.frames - 1 + (beyond ? 2 : 0);
    CHECK(animation->frame(frame) == tvg::Result::Success);
    CHECK_EQ(animation->curFrame(),frame);
    int width = int(rise.width), height = int(rise.height);
    std::vector<uint32_t> pixels(size_t(width)*height);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen(tvg::EngineOption::Default));
    CHECK(canvas->target(pixels.data(),width,width,height,tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
    CHECK(canvas->add(animation->picture()) == tvg::Result::Success);
    CHECK(canvas->draw(true) == tvg::Result::Success); CHECK(canvas->sync() == tvg::Result::Success);
    return pixels;
}

}

TEST(framework_building_asset_roundtrips_every_shape_and_detail)
{
    auto asset = sample();
    asset.variants.clear();
    for (int shape = 0; shape < 4; ++shape) for (int trim = 0; trim < 4; ++trim) {
        auto model = sample().variants[0];
        auto& b = model.blocks[0];
        b.shape = RoofShape(shape); b.trim = Trim(trim); b.ornament = Ornament((shape + trim) % 3);
        b.base = 13.125f; b.delay = 7.25f; b.windows = 8; b.glass = {0,127,255}; b.accent = {1,2,3};
        asset.variants.push_back(model);
    }
    std::string error;
    CHECK(validateBuildingAsset(asset, error));
    auto json = encodeBuildingAsset(asset);
    CHECK(!json.empty() && json.back() == '\n');
    BuildingAsset decoded;
    CHECK(decodeBuildingAsset(json, decoded, error));
    CHECK(decoded == asset);
    CHECK(buildingVariant(decoded, UINT32_MAX) == asset.variants[UINT32_MAX % asset.variants.size()]);
}

TEST(framework_building_asset_rejects_invalid_schema_without_mutating_destination)
{
    auto accepted = sample(), output = accepted;
    auto source = encodeBuildingAsset(accepted);
    te::json::Value root;
    std::string error;
    CHECK(te::json::parse(source, root, error));
    auto rejected = [&](te::json::Value candidate, std::string_view field) {
        CHECK(!decodeBuildingAsset(te::json::stringify(candidate), output, error));
        CHECK(output == accepted);
        CHECK(error.find(field) != std::string::npos);
    };
    auto object = std::get<te::json::Value::Object>(root.data);
    object["surprise"] = true; rejected(object, "surprise");
    object.erase("surprise"); object["version"] = 1.5; rejected(object, "version");
    object["version"] = 1; object["id"] = "Bad Id"; rejected(object, "id");
    object["id"] = "example-building"; object["footprint"] = 0; rejected(object, "footprint");
    auto mutateBlock = [&](const char* key, te::json::Value value) {
        auto candidate = root;
        auto& variants = std::get<te::json::Value::Array>(std::get<te::json::Value::Object>(candidate.data)["variants"].data);
        auto& blocks = std::get<te::json::Value::Array>(std::get<te::json::Value::Object>(variants[0].data)["blocks"].data);
        std::get<te::json::Value::Object>(blocks[0].data)[key] = std::move(value);
        rejected(candidate, key);
    };
    mutateBlock("bounds", te::json::Value::Array{0, 0, 0, 1});
    mutateBlock("windows", 1.5); mutateBlock("windows", 9);
    mutateBlock("door", 1); mutateBlock("shape", "GableX"); mutateBlock("trim", "unknown");
    mutateBlock("glass", te::json::Value::Array{256, 2, 3});
    mutateBlock("accent", te::json::Value::Array{1.25, 2, 3});
    mutateBlock("delay", -1); mutateBlock("delay", 120.00000001); mutateBlock("wall", 256.00000001); mutateBlock("unused", 4);
    CHECK(!decodeBuildingAsset(source + "{}", output, error)); CHECK(output == accepted);
    CHECK(!decodeBuildingAsset(std::string(4 * 1024 * 1024 + 1, ' '), output, error)); CHECK(output == accepted);
}

TEST(framework_building_asset_defaults_and_expansion_limits_are_checked)
{
    const char* minimal = R"({"format":"building-asset","version":1,"id":"minimal","name":"Minimal","footprint":1,"variants":[{"patches":[],"blocks":[{"bounds":[0,0,1,1],"wall":10,"roof":0,"shape":"flat","wallLit":[1,2,3],"wallShade":[1,2,3],"roofLit":[1,2,3],"roofShade":[1,2,3]}]}]})";
    BuildingAsset asset; std::string error;
    CHECK(decodeBuildingAsset(minimal, asset, error));
    const auto& b = asset.variants[0].blocks[0];
    CHECK_EQ(b.delay, 0.f); CHECK_EQ(b.base, 0.f); CHECK_EQ(b.windows, 0); CHECK(!b.door);
    CHECK(b.glass == Rgb({232,162,72})); CHECK(b.accent == Rgb({156,40,46}));
    auto bad = asset; bad.variants[0].blocks[0].wall = std::numeric_limits<float>::quiet_NaN();
    CHECK(!validateBuildingAsset(bad, error)); CHECK(error.find("wall") != std::string::npos);
    bad = asset; bad.name = std::string("\xc0\xaf", 2); CHECK(!validateBuildingAsset(bad, error));
    bad = asset; bad.variants[0].blocks[0].base = 256; bad.variants[0].blocks[0].wall = 256; bad.variants[0].blocks[0].roof = 1;
    CHECK(!validateBuildingAsset(bad, error));
    auto large = asset.variants[0].blocks[0]; large.x1 = large.y1 = 8; large.trim = Trim::Stakes;
    bad = asset; bad.variants[0].blocks.assign(8, large);
    CHECK(!validateBuildingAsset(bad, error)); CHECK(error.find("2048") != std::string::npos);
    bad.variants[0].blocks.resize(7); CHECK(validateBuildingAsset(bad, error));
    std::vector<Face> faces; buildingFaces(bad.variants[0], {}, faces); CHECK(faces.size() <= 2048);
}

TEST(framework_building_geometry_and_animation_preserve_free_angles_and_stage_offsets)
{
    te::test::Graphics runtime(false);
    auto model = sample().variants[0];
    constexpr float quarter = 1.5707963f;
    for (float angle : {0.f, .5f, 2.4f, -1.3f, quarter / 2 - .0001f, quarter / 2 + .0001f, -quarter / 2 - .0001f, quarter * 3}) {
        int turns; float rest; splitAngle(angle, turns, rest);
        CHECK(turns >= 0 && turns <= 3); CHECK(std::abs(rest) <= quarter / 2 + .0001f);
        auto oriented = model; orientModel(oriented, turns, 1);
        Motion motion; motion.turn = rest; motion.pivot = {.5f,.5f};
        std::vector<Face> faces; buildingFaces(oriented, motion, faces);
        for (const auto& face : faces) {
            size_t count = face.shape(0).size();
            for (float frame : {0.f, 6.f, 14.f, 20.f, 30.f, 42.f, 1000.f}) {
                auto polygon = face.shape(frame); CHECK_EQ(polygon.size(), count);
                for (auto point : polygon) CHECK(std::isfinite(point.x) && std::isfinite(point.y));
            }
        }
        loads(buildingRiseAnimation(model, 1, {}, angle));
        std::vector<BuildingStage> old;
        for (auto point : {Point{0,0}, Point{1,0}, Point{0,1}, Point{1,1}}) old.push_back({model,1,point.x,point.y});
        loads(buildingRiseAnimation(model, 2, old, angle));
        auto icon = buildingIcon(model, 1, 96, 96, angle);
        CHECK(icon != nullptr); delete icon;
    }
    auto windows = model; windows.blocks[0].windows = 8; windows.blocks[0].delay = 10;
    CHECK_EQ(buildingRiseAnimation(windows,1).frames,59.f);
    auto late = model; late.blocks[0].delay = 120;
    auto upgrade = buildingRiseAnimation(model,1,{{late,1,0,0}});
    CHECK_EQ(upgrade.frames,134.f); loads(upgrade);
}

TEST(framework_building_sort_freezes_support_depth_before_reordering)
{
    auto a = sample().variants[0].blocks[0]; a.base = 0; a.x0 = a.y0 = 0; a.x1 = a.y1 = 2;
    auto b = a; b.x0 = b.y0 = -1; b.x1 = b.y1 = 1.5f;
    auto upper = a; upper.x0 = upper.y0 = .2f; upper.x1 = upper.y1 = .8f; upper.base = 20;
    auto foreground = a; foreground.x0 = foreground.y0 = .3f; foreground.x1 = foreground.y1 = .9f;
    Model model{{},{a,upper,foreground,b}};
    // The final matching support in the immutable input is b (depth1), then upper, foreground, a.
    sortModel(model);
    CHECK(model.blocks == std::vector<Block>({b,upper,foreground,a}));
}

TEST(framework_building_angle_conversion_handles_huge_and_invalid_inputs)
{
    int turns = -1; float rest = 0;
    splitAngle(std::numeric_limits<float>::max(), turns, rest);
    CHECK(turns >= 0 && turns <= 3); CHECK(std::isfinite(rest)); CHECK(std::abs(rest) <= .785399f);
    auto model = sample().variants[0];
    auto rise = buildingRiseAnimation(model, 1, {}, std::numeric_limits<float>::max());
    CHECK(rise.width > 0 && std::isfinite(rise.width));
    for (auto angle : {std::numeric_limits<float>::infinity(), std::numeric_limits<float>::quiet_NaN()}) {
        bool rejected = false; try { splitAngle(angle, turns, rest); } catch (const std::invalid_argument&) { rejected = true; }
        CHECK(rejected);
        rejected = false; try { buildingRiseAnimation(model, 1, {}, angle); } catch (const std::invalid_argument&) { rejected = true; }
        CHECK(rejected);
        rejected = false; try { buildingIcon(model, 1, 96, 96, angle); } catch (const std::invalid_argument&) { rejected = true; }
        CHECK(rejected);
    }
}

TEST(framework_building_last_playable_frame_finishes_windows_and_replaced_opacity)
{
    te::test::Graphics runtime(false);
    auto model = sample().variants[0]; model.blocks[0].windows = 8; model.blocks[0].delay = 10;
    auto windows = buildingRiseAnimation(model,1);
    auto last = finalPixels(windows,false);
    CHECK(std::any_of(last.begin(),last.end(),[](auto pixel){ return pixel != 0; }));
    CHECK(last == finalPixels(windows,true));
    auto old = model; old.blocks[0].delay = 120;
    auto upgrade = buildingRiseAnimation(sample().variants[0],1,{{old,1,0,0}});
    CHECK(finalPixels(upgrade,false) == finalPixels(upgrade,true));
}

TEST(framework_building_fractional_delays_finish_at_the_last_playable_frame)
{
    te::test::Graphics runtime(false);
    auto model = sample().variants[0]; model.blocks[0].windows = 8; model.blocks[0].delay = 10.25f;
    auto windows = buildingRiseAnimation(model, 1);
    CHECK_EQ(windows.frames, 59.25f);
    auto last = finalPixels(windows, false);
    CHECK(std::any_of(last.begin(), last.end(), [](auto pixel) { return pixel != 0; }));
    CHECK(last == finalPixels(windows, true));
    auto old = model; old.blocks[0].delay = 119.25f;
    auto upgrade = buildingRiseAnimation(sample().variants[0], 1, {{old, 1, 0, 0}});
    CHECK_EQ(upgrade.frames, 133.25f);
    CHECK(finalPixels(upgrade, false) == finalPixels(upgrade, true));
}
