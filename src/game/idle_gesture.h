#pragma once

#include "person_look.h"
#include <array>

namespace hearthold
{
enum class IdleGesture : int8_t { None = -1, Wave, HairTuck, ChinRest, Collar, Cuff, WristRoll, PalmRub, Shrug, SideStretch, Stretch, Count };
const char* gestureName(IdleGesture);

struct GesturePose
{
    IdleGesture kind = IdleGesture::None;
    float phase = 0;
    bool mirrored = false;
};

struct ArmRig
{
    tvg::Scene* upper = nullptr;
    tvg::Scene* forearm = nullptr;
    tvg::Scene* hand = nullptr;
    Point shoulder, elbow, wrist;
    bool free = true;
    tvg::Shape* shoulderLink = nullptr;
    float shoulderRadius = 0;
    mutable float shoulderLift = 0;
};

GesturePose idleGesture(uint32_t seed, Mood, double seconds);
bool canIdleGesture(const Person&);
void poseArm(const ArmRig&, float upper = 0, float elbow = 0, float wrist = 0, float lift = 0, float squash = 1);
// Centred sleeves share their width and elbow surface, retaining upper/forearm depth order.
void connectArm(ArmRig&, tvg::Scene* shoulderLayer, Rgb cloth, float width, float cuffInset, Rgb edge = {}, float edgeWidth = 0);
void animateGesture(const std::array<ArmRig, 2>&, const GesturePose&);
}  // namespace hearthold
