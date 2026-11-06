#include <GameEngine/GameFramework/animation.h>
#include "idle_gesture.h"
#include "world_map.h"
#include <ui/ui.h>
#include <algorithm>
#include <cmath>

namespace hearthold
{
namespace
{
constexpr float pi = 3.14159265f;
float roll(uint32_t seed, uint32_t salt) { return hash01(seed, int(salt), 0, 0xa4f5u); }
float angle(Point v) { return std::atan2(v.y, v.x); }
float shortAngle(float value) { return std::remainder(value, 2 * pi); }
Point rotate(Point p, float radians) { float c = std::cos(radians), s = std::sin(radians); return {c * p.x - s * p.y, s * p.x + c * p.y}; }

void shoulderJoin(const ArmRig& arm, float lift)
{
    float radius = arm.shoulderRadius;
    Point anchor = arm.shoulder + Point{-std::copysign(radius * 1.25f, arm.shoulder.x), 0};
    Point moved = arm.shoulder + Point{0, lift}, delta = moved - anchor;
    float length = std::max(.0001f, std::hypot(delta.x, delta.y));
    Point normal{-delta.y * radius / length, delta.x * radius / length};
    arm.shoulderLink->reset();
    arm.shoulderLink->appendCircle(anchor.x, anchor.y, radius, radius);
    arm.shoulderLink->appendCircle(moved.x, moved.y, radius, radius);
    appendPolygon(arm.shoulderLink, {anchor + normal, anchor - normal, moved - normal, moved + normal});
}

void reach(const ArmRig& rig, Point hand, float bend, float weight, float wrist, float lift)
{
    auto upper = rig.elbow - rig.shoulder, lower = rig.wrist - rig.elbow;
    float a = std::hypot(upper.x, upper.y), b = std::hypot(lower.x, lower.y);
    auto delta = hand - rig.shoulder;
    float d = std::clamp(std::hypot(delta.x, delta.y), std::abs(a - b) + .02f, a + b - .02f);
    float direction = angle(delta);
    float along = (a * a - b * b + d * d) / (2 * d);
    float height = std::sqrt(std::max(0.f, a * a - along * along));
    Point elbow{std::cos(direction) * along - std::sin(direction) * height * bend,
                std::sin(direction) * along + std::cos(direction) * height * bend};
    Point target{std::cos(direction) * d, std::sin(direction) * d};
    float shoulderTurn = shortAngle(angle(elbow) - angle(upper));
    float elbowTurn = shortAngle(angle(target - elbow) - angle(lower) - shoulderTurn);
    poseArm(rig, shoulderTurn * weight, elbowTurn * weight, wrist * weight, lift * weight);
}
}  // namespace

const char* gestureName(IdleGesture kind)
{
    switch (kind) {
    case IdleGesture::Wave: return "Wave";
    case IdleGesture::HairTuck: return "Hair tuck";
    case IdleGesture::ChinRest: return "Thinking";
    case IdleGesture::Collar: return "Collar";
    case IdleGesture::Cuff: return "Cuff";
    case IdleGesture::WristRoll: return "Wrist roll";
    case IdleGesture::PalmRub: return "Palm rub";
    case IdleGesture::Shrug: return "Shrug";
    case IdleGesture::SideStretch: return "Side stretch";
    case IdleGesture::Stretch: return "Stretch";
    case IdleGesture::None: case IdleGesture::Count: return "Auto";
    }
    return "Auto";
}

GesturePose idleGesture(uint32_t seed, Mood mood, double seconds)
{
    if (!std::isfinite(seconds) || mood == Mood::Asleep || mood == Mood::Fierce || mood == Mood::Hurt || mood == Mood::Exhausted) return {};
    double shifted = seconds - (3.5 + roll(seed, 1) * 12);
    if (shifted < 0) return {};
    auto cycle = uint32_t(std::floor(shifted / 12));
    double within = std::fmod(shifted, 12.0);
    double begin = .8 + roll(seed, cycle + 20) * 2.6;
    double duration = 2.4 + roll(seed, cycle + 40) * .8;
    if (within < begin || within >= begin + duration) return {};
    unsigned first = std::min(9u, unsigned(roll(seed, 2) * 10));
    // A coprime stride visits all ten gestures without consecutive repeats.
    auto kind = IdleGesture((first + cycle * (seed % 2 ? 3 : 7)) % 10);
    return {kind, float((within - begin) / duration), roll(seed, cycle + 60) > .5f};
}

bool canIdleGesture(const Person& person)
{
    if (person.moving() || person.crossingDoorway() || person.inside) return false;
    switch (person.activity) {
    case Activity::Idle: case Activity::Holding: case Activity::Relaxing: case Activity::Brooding: case Activity::Guarding: return true;
    default: return false;
    }
}

void connectArm(ArmRig& arm, tvg::Scene* root, Rgb cloth, float width, float cuffInset, Rgb edge, float edgeWidth)
{
    arm.shoulderRadius = width * .5f;
    arm.shoulderLift = 0;
    arm.shoulderLink = tvg::Shape::gen();
    fill(arm.shoulderLink, opaque(cloth));
    shoulderJoin(arm, 0);
    root->add(arm.shoulderLink);
    auto axis = arm.wrist - arm.elbow;
    float length = std::max(.0001f, std::hypot(axis.x, axis.y));
    auto cuff = arm.wrist - axis * (cuffInset / length);
    auto stroke = [&](tvg::Scene* layer, Point from, Point to, Rgb color, float weight) {
        auto path = tvg::Shape::gen();
        path->moveTo(from.x, from.y); path->lineTo(to.x, to.y);
        path->strokeFill(color.r, color.g, color.b);
        path->strokeWidth(weight);
        // No transverse borders across the shoulder, elbow or cuff.
        path->strokeCap(tvg::StrokeCap::Butt);
        layer->add(path);
    };
    float radius = width * .5f;
    if (edgeWidth > 0) {
        arm.upper->add(ellipse(arm.elbow, radius + edgeWidth, radius + edgeWidth, opaque(edge)));
        stroke(arm.upper, arm.shoulder, arm.elbow, edge, width + edgeWidth * 2);
        stroke(arm.forearm, arm.elbow, cuff, edge, width + edgeWidth * 2);
    }
    stroke(arm.upper, arm.shoulder, arm.elbow, cloth, width);
    // The joint's radius matches the sleeve exactly: no bead or wedge appears on a bend.
    arm.forearm->add(ellipse(arm.elbow, radius, radius, opaque(cloth)));
    stroke(arm.forearm, arm.elbow, cuff, cloth, width);
}

void poseArm(const ArmRig& rig, float upper, float elbow, float wrist, float lift, float squash)
{
    if (!rig.upper || !rig.forearm || !rig.hand) return;
    if (rig.shoulderLink && rig.shoulderLift != lift) {
        shoulderJoin(rig, lift);
        rig.shoulderLift = lift;
    }
    float c = std::cos(upper), s = std::sin(upper);
    tvg::Matrix at{c, -s * squash, rig.shoulder.x - c * rig.shoulder.x + s * squash * rig.shoulder.y,
                   s, c * squash, rig.shoulder.y - s * rig.shoulder.x - c * squash * rig.shoulder.y + lift, 0, 0, 1};
    ui::setTransform(rig.upper, at);
    Point movedElbow{at.e11 * rig.elbow.x + at.e12 * rig.elbow.y + at.e13, at.e21 * rig.elbow.x + at.e22 * rig.elbow.y + at.e23};
    float co = std::cos(elbow), si = std::sin(elbow);
    float a = at.e11 * co + at.e12 * si, b = -at.e11 * si + at.e12 * co;
    float d = at.e21 * co + at.e22 * si, e = -at.e21 * si + at.e22 * co;
    ui::setTransform(rig.forearm, {a, b, movedElbow.x - a * rig.elbow.x - b * rig.elbow.y,
                                  d, e, movedElbow.y - d * rig.elbow.x - e * rig.elbow.y, 0, 0, 1});
    auto point = rig.wrist - rotate(rig.wrist, wrist);
    c = std::cos(wrist); s = std::sin(wrist);
    ui::setTransform(rig.hand, {c, -s, point.x, s, c, point.y, 0, 0, 1});
}

void animateGesture(const std::array<ArmRig, 2>& arms, const GesturePose& pose)
{
    if (pose.kind == IdleGesture::None || pose.kind == IdleGesture::Count || !std::isfinite(pose.phase)) {
        for (const auto& arm : arms) poseArm(arm);
        return;
    }
    float phase = std::clamp(pose.phase, 0.f, 1.f);
    float amount = gameframework::smoothstep(phase / .22f) * (1 - gameframework::smoothstep((phase - .72f) / .28f));
    float active = std::clamp((phase - .22f) / .5f, 0.f, 1.f);
    float beat = std::sin(active * 4 * pi), slow = std::sin(active * pi);
    float head = (arms[0].shoulder.y + arms[1].shoulder.y) * .5f - 4;
    float span = (arms[1].shoulder.x - arms[0].shoulder.x) / 5.62f;
    Point target[2]{};
    float wrist[2]{}, bend[2]{1, -1}, lift = 0;
    bool use[2]{};
    int primary = pose.mirrored ? 0 : 1;
    if (!arms[size_t(primary)].free) primary = 1 - primary;
    auto one = [&](Point at, bool outward = false) {
        float side = primary ? 1.f : -1.f;
        target[primary] = {at.x * side, at.y}; use[primary] = true;
        bend[primary] = outward ? side : -side;
    };
    auto both = [&](Point left, Point right, bool outward = false) {
        target[0] = left; target[1] = right;
        use[0] = use[1] = true;
        bend[0] = outward ? -1 : 1; bend[1] = -bend[0];
    };
    switch (pose.kind) {
    case IdleGesture::Wave:
        one({4.7f + .18f * beat, .8f}, true); wrist[primary] = .3f * beat; break;
    case IdleGesture::HairTuck:
        one({3.1f - .4f * gameframework::smoothstep(active), -.2f - .4f * slow}, true); wrist[primary] = -.3f * slow; break;
    case IdleGesture::ChinRest:
        one({1.15f, 3.55f - .1f * slow}); wrist[primary] = -.25f; break;
    case IdleGesture::Collar:
        both({-.95f, 4.3f + .1f * beat}, {.95f, 4.2f - .1f * beat}); wrist[0] = .2f; wrist[1] = -.2f; break;
    case IdleGesture::Cuff:
        both({-.3f, 5.65f}, {.65f + .16f * beat, 5.15f}); wrist[0] = -.35f; wrist[1] = .2f * beat; break;
    case IdleGesture::WristRoll:
        both({-1.65f, 5.35f}, {1.65f, 5.35f}); wrist[0] = .65f * beat; wrist[1] = -.65f * beat; break;
    case IdleGesture::PalmRub:
        both({-.8f + .12f * beat, 4.8f}, {.8f + .12f * beat, 4.65f}); wrist[0] = .2f; wrist[1] = -.2f; break;
    case IdleGesture::Shrug:
        both({-4.4f, 3.5f}, {4.4f, 3.5f}, true); wrist[0] = .5f; wrist[1] = -.5f; lift = -.18f; break;
    case IdleGesture::SideStretch:
        one({4.6f, -1.f - .1f * slow}, true); wrist[primary] = -.3f; break;
    case IdleGesture::Stretch:
        both({-4.7f, -.4f - .12f * slow}, {4.7f, -.4f - .12f * slow}, true); wrist[0] = -.35f; wrist[1] = .35f; lift = -.12f; break;
    case IdleGesture::None: case IdleGesture::Count: break;
    }
    if (use[0] && !use[1]) wrist[0] *= -1;
    if (pose.mirrored && use[0] && use[1]) {
        std::swap(target[0], target[1]); target[0].x *= -1; target[1].x *= -1;
        std::swap(wrist[0], wrist[1]); wrist[0] *= -1; wrist[1] *= -1;
    }
    for (size_t i = 0; i < arms.size(); ++i) {
        if (use[i] && arms[i].free && amount > 0) {
            Point hand{target[i].x * span, head + target[i].y};
            reach(arms[i], hand, bend[i], amount, wrist[i], lift);
        } else poseArm(arms[i]);
    }
}
}  // namespace hearthold
