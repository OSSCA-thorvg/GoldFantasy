#include <test/test.h>
#include <test/graphics.h>
#include <ui/ui.h>
#include <algorithm>
#include <cmath>
#include <limits>
#include <memory>

namespace
{
ui::IconAsset motion(std::string name = "motion", bool overshoot = false)
{
    std::string data = R"({"v":"5.7.4","fr":60,"ip":0,"op":81,"w":64,"h":64,"assets":[],"layers":[{"ty":4,"ind":1,"ip":0,"op":81,"st":0,"sr":1,"ks":{"o":{"a":0,"k":100},"r":{"a":0,"k":0},"p":{"a":0,"k":[0,0]},"a":{"a":0,"k":[0,0]},"s":{"a":0,"k":[100,100]}},"shapes":[{"ty":"rc","s":{"a":0,"k":[8,8]},"r":{"a":0,"k":0},"p":{"a":1,"k":[)";
    const int centers[]{16, 48, 24, 40, 32, 20, 56, 46, 22};
    const char* names[]{"idle", "hover", "pressed", "active", "disabled", "focused",
        "hover-overshoot", "active-overshoot", "focused-overshoot"};
    auto count = overshoot ? 9u : 6u;
    for (unsigned i = 0; i < count; ++i) {
        if (i) data += ',';
        data += "{\"t\":" + std::to_string(i * 10) + ",\"s\":[" + std::to_string(centers[i]) + ",32],\"h\":1}";
    }
    data += R"(]}},{"ty":"fl","c":{"a":0,"k":[1,1,1],"sid":"icon-ink"},"o":{"a":0,"k":100},"r":1}]}],"markers":[)";
    for (unsigned i = 0; i < count; ++i) {
        if (i) data += ',';
        data += "{\"tm\":" + std::to_string(i * 10) + ",\"dr\":0,\"cm\":\"" + names[i] + "\"}";
    }
    data += "]}";
    return {std::move(name), std::move(data), "json"};
}

struct Software
{
    static constexpr unsigned width = 64;
    std::vector<uint32_t> pixels = std::vector<uint32_t>(width * width);
    std::unique_ptr<tvg::SwCanvas> canvas{tvg::SwCanvas::gen()};

    Software()
    {
        CHECK(canvas->target(pixels.data(), width, width, width, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
    }

    std::vector<uint32_t> render(tvg::Picture* picture, float size = 64)
    {
        CHECK(picture);
        if (!picture) return {};
        CHECK(canvas->sync() == tvg::Result::Success);
        CHECK(canvas->remove() == tvg::Result::Success);
        picture->transform({1, 0, 0, 0, 1, 0, 0, 0, 1});
        picture->size(size, size);
        CHECK(canvas->add(picture) == tvg::Result::Success);
        CHECK(canvas->update() == tvg::Result::Success);
        CHECK(canvas->draw(true) == tvg::Result::Success);
        CHECK(canvas->sync() == tvg::Result::Success);
        auto result = pixels;
        CHECK(canvas->remove() == tvg::Result::Success);
        return result;
    }
};

double center(const std::vector<uint32_t>& pixels)
{
    double mass = 0, position = 0;
    for (size_t i = 0; i < pixels.size(); ++i) {
        auto alpha = pixels[i] >> 24;
        mass += alpha;
        position += (i % Software::width + .5) * alpha;
    }
    CHECK(mass > 0);
    return mass ? position / mass : 0;
}

bool ink(const std::vector<uint32_t>& pixels)
{
    return std::any_of(pixels.begin(), pixels.end(), [](uint32_t pixel) { return pixel >> 24; });
}

tvg::Picture* frame(ui::Icons& icons, double time, ui::IconState state = {}, ui::Color color = {255, 255, 255})
{
    icons.begin(time);
    auto picture = icons.picture("button", "motion", state, color);
    icons.end();
    return picture;
}
}  // namespace

TEST(icons_dynamic_retarget_preserves_the_current_rendered_blend)
{
    te::test::Graphics graphics(false);
    ui::Icons icons;
    Software software;
    std::string error;
    CHECK(icons.replace({motion()}, error));
    CHECK(std::abs(center(software.render(frame(icons, 0))) - 16) < .05);
    ui::IconState hover;
    hover.hovered = true;
    software.render(frame(icons, 1, hover));
    auto halfway = software.render(frame(icons, 1.08, hover));
    CHECK(std::abs(center(halfway) - 32) < .1);
    ui::IconState pressed = hover;
    pressed.pressed = true;
    auto interrupted = software.render(frame(icons, 1.08, pressed));
    CHECK(interrupted == halfway);
    auto continued = software.render(frame(icons, 1.14, pressed));
    CHECK(std::abs(center(continued) - 28) < .15);
    auto settled = software.render(frame(icons, 1.21, pressed));
    CHECK(std::abs(center(settled) - 24) < .05);
    CHECK(!icons.animating());
    CHECK(software.render(frame(icons, 5, pressed)) == settled);
    CHECK(!icons.animating());
}

TEST(icons_authored_overshoot_visits_each_peak_and_settles_at_its_state_pose)
{
    te::test::Graphics graphics(false);
    std::array<ui::IconState, 3> states{};
    states[0].hovered = true;
    states[1].active = true;
    states[2].focused = true;
    constexpr double durations[]{.28, .32, .24};
    constexpr double peaks[]{56, 46, 22}, targets[]{48, 40, 20};
    Software software;
    for (size_t i = 0; i < states.size(); ++i) {
        ui::Icons icons;
        std::string error;
        CHECK(icons.replace({motion("motion", true)}, error));
        auto idle = software.render(frame(icons, 0));
        CHECK(software.render(frame(icons, 1, states[i])) == idle);
        CHECK(icons.animating());
        auto peak = center(software.render(frame(icons, 1 + durations[i] * .55 + .000001, states[i])));
        CHECK(std::abs(peak - peaks[i]) < .05);
        CHECK(icons.animating());
        auto settling = center(software.render(frame(icons, 1 + durations[i] * .775, states[i])));
        CHECK(settling > targets[i] + .1 && settling < peaks[i] - .1);
        auto settled = software.render(frame(icons, 1 + durations[i] + .000001, states[i]));
        CHECK(std::abs(center(settled) - targets[i]) < .05);
        CHECK(!icons.animating());
        CHECK(software.render(frame(icons, 10, states[i])) == settled);
        CHECK(!icons.animating());
    }
}

TEST(icons_overshoot_interruptions_preserve_ink_during_rise_boundary_and_settle)
{
    te::test::Graphics graphics(false);
    Software software;
    ui::IconState hovered, pressed;
    hovered.hovered = true;
    pressed.hovered = pressed.pressed = true;
    for (auto interruptedAt : {1.06, 1 + .28 * .55, 1.22}) {
        ui::Icons icons;
        std::string error;
        CHECK(icons.replace({motion("motion", true)}, error));
        frame(icons, 0);
        frame(icons, 1, hovered);
        auto visible = software.render(frame(icons, interruptedAt, hovered));
        auto priorCenter = center(visible);
        CHECK(software.render(frame(icons, interruptedAt, pressed)) == visible);
        CHECK(icons.animating());
        auto continuing = center(software.render(frame(icons, interruptedAt + .06, pressed)));
        CHECK(continuing > 24.5 && continuing < priorCenter - .5);
        auto settled = software.render(frame(icons, interruptedAt + .13, pressed));
        CHECK(std::abs(center(settled) - 24) < .05);
        CHECK(!icons.animating());
        CHECK(software.render(frame(icons, 10, pressed)) == settled);
        CHECK(!icons.animating());
    }
}

TEST(icons_overshoot_completes_both_phases_after_a_long_clock_jump)
{
    te::test::Graphics graphics(false);
    ui::Icons icons;
    Software software;
    std::string error;
    CHECK(icons.replace({motion("motion", true)}, error));
    frame(icons, 0);
    ui::IconState state;
    state.hovered = true;
    frame(icons, 1, state);
    CHECK(icons.animating());
    CHECK(std::abs(center(software.render(frame(icons, 100, state))) - 48) < .05);
    CHECK(!icons.animating());
    state.active = true;
    frame(icons, 101, state);
    CHECK(icons.animating());
    CHECK(std::abs(center(software.render(frame(icons, 1000, state))) - 40) < .05);
    CHECK(!icons.animating());
}

TEST(icons_state_priority_and_zero_duration_match_authored_pose_anchors)
{
    te::test::Graphics graphics(false);
    ui::Icons icons;
    Software software;
    auto asset = motion();
    asset.duration = 0;
    std::string error;
    CHECK(icons.replace({asset}, error));
    ui::IconState state;
    state.hovered = state.pressed = state.active = state.focused = true;
    state.enabled = false;
    CHECK(std::abs(center(software.render(frame(icons, 0, state))) - 32) < .05);
    state.enabled = true;
    CHECK(std::abs(center(software.render(frame(icons, 1, state))) - 24) < .05);
    state.pressed = false;
    CHECK(std::abs(center(software.render(frame(icons, 2, state))) - 40) < .05);
    state.active = false;
    CHECK(std::abs(center(software.render(frame(icons, 3, state))) - 48) < .05);
    state.hovered = false;
    CHECK(std::abs(center(software.render(frame(icons, 4, state))) - 20) < .05);
    state.focused = false;
    CHECK(std::abs(center(software.render(frame(icons, 5, state))) - 16) < .05);
    CHECK(!icons.animating());
}

TEST(icons_replace_is_atomic_and_preserves_builtin_fallbacks)
{
    te::test::Graphics graphics(false);
    ui::Icons icons;
    Software software;
    std::string error;
    CHECK(icons.contains("folder"));
    CHECK(icons.replace({motion()}, error));
    auto original = frame(icons, 0);
    auto baseline = software.render(original);
    auto invalid = motion("broken");
    invalid.data = "{\"w\":64,\"h\":64,\"layers\":[";
    CHECK(!icons.replace({motion("replacement"), invalid}, error));
    CHECK(!error.empty());
    CHECK(icons.contains("motion"));
    CHECK(!icons.contains("replacement"));
    CHECK(frame(icons, 1) == original);
    CHECK(software.render(original) == baseline);
    CHECK(!icons.replace({motion("same"), motion("same")}, error));
    CHECK(icons.contains("motion"));
    CHECK(icons.replace({}, error));
    CHECK(error.empty());
    CHECK(!icons.contains("motion"));
    CHECK(icons.contains("folder"));
    CHECK(!icons.contains("missing"));
    icons.begin(2);
    CHECK(!icons.picture("button", "missing", {}, {255, 255, 255}));
    icons.end();
}

TEST(icons_public_names_and_asset_aliases_share_user_overrides)
{
    te::test::Graphics graphics(false);
    struct Alias { ui::Icon icon; const char* name; const char* asset; };
    constexpr Alias aliases[]{
        {ui::Icon::Chevron, "chevron", "chevron-right"},
    };
    Software software;
    for (const auto& alias : aliases) {
        ui::Icons icons;
        std::string error;
        ui::Icon parsed = ui::Icon::None;
        CHECK_EQ(std::string(ui::iconName(alias.icon)), std::string(alias.name));
        CHECK(ui::iconFromName(alias.name, parsed) && parsed == alias.icon);
        CHECK(ui::iconFromName(alias.asset, parsed) && parsed == alias.icon);
        CHECK(icons.contains(alias.name) && icons.contains(alias.asset));
        CHECK(icons.replace({motion(alias.name)}, error));
        icons.begin(0);
        auto picture = icons.picture("alias", alias.name, {}, {255, 255, 255});
        CHECK(picture == icons.picture("alias", alias.asset, {}, {255, 255, 255}));
        icons.end();
        CHECK(std::abs(center(software.render(picture)) - 16) < .05);
        CHECK(icons.replace({motion(alias.asset)}, error));
        icons.begin(1);
        CHECK(icons.picture("alias", alias.name, {}, {255, 255, 255}) == picture);
        icons.end();
        CHECK(!icons.replace({motion(alias.name), motion(alias.asset)}, error));
        CHECK(!error.empty());
        CHECK(icons.contains(alias.name) && icons.contains(alias.asset));
    }
    ui::Icon parsed = ui::Icon::None;
    CHECK(ui::iconFromName("folder", parsed) && parsed == ui::Icon::Folder);
    CHECK(!ui::iconFromName("unregistered", parsed));
    CHECK(!ui::iconFromName("", parsed));
}

TEST(icons_validate_aliases_and_static_svg_with_tint_and_original_colors)
{
    te::test::Graphics graphics(false);
    std::string error;
    auto asset = motion();
    asset.markers[1] = "typo";
    CHECK(!ui::validateIcon(asset, error));
    CHECK(error.find("typo") != std::string::npos);
    asset.markers[1] = "active";
    CHECK(ui::validateIcon(asset, error));
    asset.duration = std::numeric_limits<float>::quiet_NaN();
    CHECK(!ui::validateIcon(asset, error));
    ui::IconAsset svg{"svg", R"(<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect x="12" y="28" width="8" height="8" fill="#ff0000"/></svg>)", "svg"};
    CHECK(ui::validateIcon(svg, error));
    ui::Icons icons;
    Software software;
    CHECK(icons.replace({svg}, error));
    icons.begin(0);
    auto picture = icons.picture("svg-instance", "svg", {}, {0, 0, 255, 128});
    icons.end();
    auto tinted = software.render(picture);
    auto pixel = tinted[32 * Software::width + 16];
    CHECK((pixel & 255) > 100);
    CHECK(((pixel >> 16) & 255) == 0);
    CHECK((pixel >> 24) >= 127 && (pixel >> 24) <= 128);
    CHECK(!icons.animating());
    svg.tint = false;
    CHECK(icons.replace({svg}, error));
    icons.begin(1);
    picture = icons.picture("svg-instance", "svg", {}, {0, 0, 255, 128});
    icons.end();
    pixel = software.render(picture)[32 * Software::width + 16];
    CHECK(((pixel >> 16) & 255) == 255);
    CHECK((pixel & 255) == 0);
    CHECK((pixel >> 24) == 255);
}

TEST(icons_tint_replacement_does_not_reset_the_new_slot)
{
    te::test::Graphics graphics(false);
    ui::Icons icons;
    Software software;
    std::string error;
    CHECK(icons.replace({motion()}, error));
    auto red = software.render(frame(icons, 0, {}, {255, 0, 0}));
    auto blue = software.render(frame(icons, 1, {}, {0, 0, 255}));
    auto pixel = blue[32 * Software::width + 16];
    CHECK((pixel & 255) == 255);
    CHECK(((pixel >> 16) & 255) == 0);
    CHECK(blue != red);
    CHECK(!icons.animating());
}

TEST(icons_missing_standard_markers_remain_a_static_idle_pose)
{
    te::test::Graphics graphics(false);
    ui::Icons icons;
    Software software;
    auto asset = motion();
    asset.data.resize(asset.data.find(",\"markers\":"));
    asset.data += '}';
    std::string error;
    CHECK(icons.replace({asset}, error));
    auto idle = software.render(frame(icons, 0));
    ui::IconState state;
    state.hovered = state.pressed = state.focused = state.active = true;
    state.enabled = false;
    CHECK(software.render(frame(icons, 1, state)) == idle);
    CHECK(!icons.animating());
    asset.markers[1] = "explicit-missing";
    CHECK(!ui::validateIcon(asset, error));
}

TEST(icons_unchanged_assets_keep_instance_and_transition_during_registry_reload)
{
    te::test::Graphics graphics(false);
    ui::Icons icons;
    Software software;
    std::string error;
    CHECK(icons.replace({motion()}, error));
    frame(icons, 0);
    ui::IconState hovered;
    hovered.hovered = true;
    frame(icons, 1, hovered);
    auto picture = frame(icons, 1.08, hovered);
    auto half = software.render(picture);
    CHECK(icons.replace({motion(), motion("another")}, error));
    CHECK(frame(icons, 1.08, hovered) == picture);
    CHECK(software.render(picture) == half);
    CHECK(icons.animating());
    CHECK(std::abs(center(software.render(frame(icons, 1.2, hovered))) - 48) < .05);
}

TEST(icons_validation_waits_for_asynchronous_lottie_parsing)
{
    CHECK(tvg::Initializer::init(2) == tvg::Result::Success);
    {
        std::string error;
        auto asset = motion();
        CHECK(ui::validateIcon(asset, error));
        asset.data = R"({"w":64,"h":64,"fr":60,"ip":0,"op":61,"layers":[)";
        CHECK(!ui::validateIcon(asset, error));
        CHECK(!error.empty());
    }
    CHECK(tvg::Initializer::term() == tvg::Result::Success);
}

TEST(icons_lottie_requires_zero_root_in_point_without_matching_nested_or_escaped_text)
{
    te::test::Graphics graphics(false);
    std::string error;
    auto withRoot = [](const char* field) {
        auto asset = motion();
        auto at = asset.data.find("\"ip\":0");
        asset.data.replace(at, 6, field);
        return asset;
    };
    for (auto field : {"\"ip\":5", "\"ip\":-5", R"("\u0069p":5)", R"("i\u0070":5)",
        R"("\u0069\u0070":5)", R"("ip\u0000suffix":5)", "\"ip\":0.00001", "\"ip\":\"0\""}) {
        auto asset = withRoot(field);
        CHECK(!ui::validateIcon(asset, error));
        CHECK(!error.empty());
    }
    auto nonzero = withRoot("\"ip\":5");
    CHECK(!ui::validateIcon(nonzero, error));
    CHECK(error.find("root ip") != std::string::npos);
    for (auto field : {"\"ip\":0", "\"ip\":-0", "\"ip\":0.000", "\"ip\":0e+5", R"("\u0069p":0)"})
        CHECK(ui::validateIcon(withRoot(field), error));
    auto missing = motion();
    missing.data.erase(missing.data.find("\"ip\":0,"), 7);
    CHECK(ui::validateIcon(missing, error));
    auto nested = motion();
    auto layer = nested.data.find("\"ip\":0", nested.data.find("\"layers\""));
    nested.data.replace(layer, 6, "\"ip\":5");
    CHECK(ui::validateIcon(nested, error));
    auto text = motion();
    text.data.insert(1, R"("nm":"text with \"ip\":5 and {braces} \\u0069p",)" );
    CHECK(ui::validateIcon(text, error));
    auto escapedLiteral = motion();
    escapedLiteral.data.insert(1, R"("\\u0069p":5,)" );
    CHECK(ui::validateIcon(escapedLiteral, error));
}

TEST(icons_all_builtin_assets_load_render_and_cross_every_named_pose)
{
    te::test::Graphics graphics(false);
    ui::Icons icons;
    Software software;
    std::array<ui::IconState, 6> states{};
    states[1].hovered = true;
    states[2].pressed = true;
    states[3].active = true;
    states[4].enabled = false;
    states[5].focused = true;
    double time = 0;
    for (unsigned i = unsigned(ui::Icon::Folder); i < unsigned(ui::Icon::Count); ++i) {
        auto name = ui::iconName(static_cast<ui::Icon>(i));
        CHECK(icons.contains(name));
        for (size_t from = 0; from < states.size(); ++from) {
            for (size_t to = 0; to < states.size(); ++to) {
                auto instance = std::string(name) + '/' + std::to_string(from) + '/' + std::to_string(to);
                icons.begin(time);
                auto picture = icons.picture(instance, name, states[from], {245, 245, 245});
                icons.end();
                CHECK(ink(software.render(picture, 64)));
                time += 1;
                icons.begin(time);
                CHECK(icons.picture(instance, name, states[to], {245, 245, 245}) == picture);
                icons.end();
                time += .08;
                icons.begin(time);
                CHECK(icons.picture(instance, name, states[to], {245, 245, 245}) == picture);
                icons.end();
                CHECK(ink(software.render(picture, 64)));
                time += 1;
                icons.begin(time);
                CHECK(icons.picture(instance, name, states[to], {245, 245, 245}) == picture);
                icons.end();
                CHECK(ink(software.render(picture, 64)));
                CHECK(!icons.animating());
                time += 1;
            }
        }
    }
}
