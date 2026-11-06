#include <test/test.h>
#include <test/graphics.h>
#include <ui/ui.h>
#include <cmath>
#include <limits>

TEST(ui_frame_requests_merge_deadlines_and_clear_between_frames)
{
    ui::FrameRequest frames;
    CHECK(!frames.deadline() && !frames.due(100));
    CHECK_EQ(frames.delay(100), -1);
    frames.requestAt(101);
    frames.requestAt(102);
    frames.requestAt(100.25);
    CHECK_EQ(frames.delay(100), 250);
    CHECK(!frames.due(100.249));
    CHECK(frames.due(100.25) && frames.due(101));
    CHECK_EQ(frames.delay(101), 0);
    for (double value : {-1.0, std::numeric_limits<double>::infinity(), std::numeric_limits<double>::quiet_NaN()}) frames.requestAt(value);
    CHECK_EQ(*frames.deadline(), 100.25);
    frames.clear();
    CHECK_EQ(frames.delay(101), -1);

    te::test::Graphics graphics;
    ui::Context context;
    auto theme = ui::Theme::dark();
    context.begin(theme, {0, 0, 300, 160}, 10);
    context.requestFrameAt(10.5);
    context.requestFrameAt(10.2);
    context.end();
    CHECK_EQ(context.frameRequest().delay(10), 200);
    context.begin(theme, {0, 0, 300, 160}, 10.2);
    context.end();
    CHECK(!context.frameRequest().deadline());
}

TEST(ui_icon_animations_request_frames_until_the_transition_finishes)
{
    te::test::Graphics graphics;
    ui::Context context;
    auto theme = ui::Theme::dark();
    auto draw = [&](double seconds, bool hover) {
        context.begin(theme, {0, 0, 100, 100}, seconds);
        context.icon("icon", {0, 0, 24, 24}, ui::Icon::Folder, theme.text, {hover});
        context.end();
    };
    draw(10, false);
    CHECK(!context.frameRequest().deadline());
    draw(11, true);
    CHECK(context.frameRequest().deadline());
    draw(12, true);
    CHECK(!context.frameRequest().deadline());
}
