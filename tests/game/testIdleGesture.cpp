#include <test/test.h>
#include <test/graphics.h>
#include <game/game_app.h>
#include <game/person_portrait.h>
#include <game/character_preset.h>
#include <algorithm>
#include <cmath>
#include <limits>
#include <memory>

namespace
{
using namespace hearthold;

Person owner(Calling calling = Calling::Settler) { return {7, "Rowan", Role::Resident, calling, Race::Human, 4242, {}, {}}; }

Point mapped(const tvg::Matrix& m, Point p) { return {m.e11 * p.x + m.e12 * p.y + m.e13, m.e21 * p.x + m.e22 * p.y + m.e23}; }

struct Surface
{
    std::vector<uint32_t> pixels = std::vector<uint32_t>(360 * 360);
    std::unique_ptr<tvg::SwCanvas> canvas{tvg::SwCanvas::gen(tvg::EngineOption::Default)};
    explicit Surface(tvg::Paint* paint)
    {
        CHECK(canvas->target(pixels.data(), 360, 360, 360, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
        CHECK(canvas->add(paint) == tvg::Result::Success);
    }
    std::vector<uint32_t> draw()
    {
        CHECK(canvas->update() == tvg::Result::Success);
        CHECK(canvas->draw(true) == tvg::Result::Success);
        CHECK(canvas->sync() == tvg::Result::Success);
        return pixels;
    }
};

bool containsText(const tvg::Paint* paint, const std::string& text)
{
    if (paint->type() == tvg::Type::Text) {
        auto words = static_cast<const tvg::Text*>(paint)->text();
        return words && text == words;
    }
    if (paint->type() == tvg::Type::Scene)
        for (auto child : static_cast<const tvg::Scene*>(paint)->paints())
            if (containsText(child, text)) return true;
    return false;
}

bool armConnected(const std::vector<uint32_t>& pixels, Point torso, const std::vector<Point>& joints)
{
    constexpr int width = 360;
    auto index = [](Point p) { return int(std::lround(p.y)) * width + int(std::lround(p.x)); };
    auto valid = [&](Point p) { return p.x >= 1 && p.y >= 1 && p.x < width - 1 && p.y < width - 1; };
    if (!valid(torso)) return false;
    int first = index(torso);
    if ((pixels[size_t(first)] >> 24) < 128) return false;
    std::vector<uint8_t> reached(pixels.size());
    std::vector<int> pending{first}; reached[size_t(first)] = 1;
    for (size_t i = 0; i < pending.size(); ++i) {
        int at = pending[i], x = at % width, y = at / width;
        for (int next : {x > 0 ? at - 1 : -1, x + 1 < width ? at + 1 : -1,
                         y > 0 ? at - width : -1, y + 1 < width ? at + width : -1}) {
            if (next < 0 || reached[size_t(next)] || (pixels[size_t(next)] >> 24) < 128) continue;
            reached[size_t(next)] = 1; pending.push_back(next);
        }
    }
    return std::all_of(joints.begin(), joints.end(), [&](Point p) { return valid(p) && reached[size_t(index(p))]; });
}
}  // namespace

TEST(game_idle_gestures_visit_all_ten_with_quiet_gaps_and_different_character_timing)
{
    for (uint32_t seed : {0u, 1u, 4242u}) {
        std::array<bool, 10> seen{};
        IdleGesture previous = IdleGesture::None, last = IdleGesture::None;
        double ended = -100;
        int active = 0, distinct = 0;
        for (int frame = 0; frame < 3600; ++frame) {
            double t = frame / 20.0;
            auto pose = idleGesture(seed, Mood::Content, t);
            CHECK(pose.phase >= 0 && pose.phase <= 1);
            if (pose.kind != IdleGesture::None) {
                seen[size_t(pose.kind)] = true;
                ++active;
                if (previous == IdleGesture::None) {
                    CHECK(pose.kind != last);
                    CHECK(t - ended > 4);
                }
                last = pose.kind;
            } else if (previous != IdleGesture::None) ended = t;
            distinct += pose.kind != idleGesture(seed + 17, Mood::Content, t).kind;
            previous = pose.kind;
        }
        CHECK(std::all_of(seen.begin(), seen.end(), [](bool value) { return value; }));
        CHECK(active > 500 && active < 1100);
        CHECK(distinct > 300);
    }
    for (auto mood : {Mood::Asleep, Mood::Fierce, Mood::Hurt, Mood::Exhausted})
        for (int t = 0; t < 140; ++t) CHECK(idleGesture(4242, mood, t).kind == IdleGesture::None);
    for (double t : {-1.0, std::numeric_limits<double>::infinity(), std::numeric_limits<double>::quiet_NaN()})
        CHECK(idleGesture(4242, Mood::Content, t).kind == IdleGesture::None);
}

TEST(game_idle_gestures_wait_while_moving_working_fighting_or_sleeping)
{
    auto person = owner();
    for (auto activity : {Activity::Idle, Activity::Holding, Activity::Relaxing, Activity::Brooding, Activity::Guarding}) {
        person.activity = activity;
        CHECK(canIdleGesture(person));
    }
    for (auto activity : {Activity::Moving, Activity::Building, Activity::Roadwork, Activity::Working, Activity::Eating, Activity::Sleeping, Activity::Fighting, Activity::Hauling, Activity::Felling}) {
        person.activity = activity;
        CHECK(!canIdleGesture(person));
    }
    person.activity = Activity::Idle;
    person.path.push_back({1, 1});
    CHECK(!canIdleGesture(person));
    person.path.clear();
    person.inside = true;
    CHECK(!canIdleGesture(person));
}

TEST(game_idle_gestures_spread_a_crowds_first_actions_across_the_idle_cycle)
{
    int peak = 0;
    for (int frame = 0; frame < 2400; ++frame) {
        int active = 0;
        for (uint32_t id = 0; id < 20; ++id)
            active += idleGesture(4242u ^ (id * 7919u), Mood::Content, frame / 20.0).kind != IdleGesture::None;
        peak = std::max(peak, active);
    }
    if (peak > 12) std::cerr << "Crowd gesture overlap: " << peak << " / 20\n";
    CHECK(peak <= 12);
}

TEST(game_idle_gestures_world_poses_restore_the_retained_walking_rig)
{
    te::test::Graphics graphics;PersonParts parts;auto figure=personSprite(owner(),parts);figure->scale(12);figure->translate(180,326);Surface surface(figure);
    auto rest=surface.draw();std::vector<std::vector<uint32_t>> seen;
    for(int kind=0;kind<int(IdleGesture::Count);++kind){
        animateGesture(parts.arms,{IdleGesture(kind),.48f,false});auto image=surface.draw();CHECK(image!=rest);
        for(auto& previous:seen)CHECK(previous!=image);
        seen.push_back(std::move(image));
        for(const auto& arm:parts.arms)CHECK(distance(mapped(arm.upper->transform(),arm.elbow),mapped(arm.forearm->transform(),arm.elbow))<.001f);
        animateGesture(parts.arms,{});CHECK(surface.draw()==rest);
    }
}

TEST(game_idle_gestures_world_shoulders_elbows_and_wrists_remain_connected)
{
    te::test::Graphics graphics;
    for(int race=0;race<raceCount;++race)for(int body=0;body<2;++body)for(int side=0;side<2;++side){
        auto person=owner();person.race=Race(race);auto preset=characterPreset(person);preset.look.hairAsset=19;
        preset.look.bodyType=BodyType(body);preset.look.bodyHeight=body?1.15f:.85f;preset.look.bodyWidth=body?.85f:1.15f;CHECK(applyCharacter(person,preset));
        PersonParts parts;auto figure=personSprite(person,parts);auto& hidden=parts.arms[size_t(1-side)];hidden.upper->opacity(0);hidden.forearm->opacity(0);hidden.shoulderLink->opacity(0);
        figure->transform({10,0,180,0,10,320,0,0,1});Surface surface(figure);
        auto pixel=[](Point p){return Point{180+p.x*10,320+p.y*10};};
        auto center=(parts.arms[0].shoulder+parts.arms[1].shoulder)*.5f+Point{0,2};
        auto check=[&]{const auto& arm=parts.arms[size_t(side)];auto upper=arm.upper->transform(),lower=arm.forearm->transform();
            std::vector<Point> joints{pixel(mapped(upper,arm.shoulder)),pixel(mapped(upper,arm.elbow)),pixel(mapped(lower,arm.wrist)),pixel(mapped(lower,mapped(arm.hand->transform(),arm.wrist+Point{0,.2f})))};
            CHECK(armConnected(surface.draw(),pixel(center),joints));};
        for(int kind=0;kind<int(IdleGesture::Count);++kind)for(float phase:{.35f,.65f}){animateGesture(parts.arms,{IdleGesture(kind),phase,side==0});check();}
        poseArm(parts.arms[size_t(side)],.5f,-1.5f,.75f,-.35f,.75f);check();
    }
}

TEST(game_idle_gestures_held_world_equipment_is_still_and_walking_resets_elbows)
{
    te::test::Graphics graphics;
    for(auto calling:{Calling::Mage,Calling::Warrior,Calling::Cleric}){
        PersonParts parts;auto figure=personSprite(owner(calling),parts);animateGesture(parts.arms,{IdleGesture::Wave,.5f,false});
        for(const auto& arm:parts.arms)if(!arm.free){auto m=arm.upper->transform();CHECK_EQ(m.e11,1.f);CHECK_EQ(m.e13,0.f);}
        stridePose(parts,.7f,true);
        for(const auto& arm:parts.arms){auto a=arm.upper->transform(),b=arm.forearm->transform();CHECK(std::abs(a.e11-b.e11)<.0001f);CHECK(std::abs(a.e13-b.e13)<.0001f);}
        tvg::Paint::rel(figure);
    }
}
