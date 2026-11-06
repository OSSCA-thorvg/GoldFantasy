#pragma once

#include "person.h"
#include "person_look.h"
#include "traffic.h"
#include "vector_paint.h"
#include "idle_gesture.h"

namespace hearthold
{
// Sprites are authored around the feet at (0, 0), facing screen-right; callers mirror and place them.
tvg::Scene* agentSprite(const Agent&, DungeonKind lair);

// Toggled parts of a person's sprite, all hidden at first.
struct PersonParts
{
    tvg::Paint* ring = nullptr;    // Selection.
    tvg::Paint* alert = nullptr;   // Stress or hunger.
    tvg::Paint* hammer = nullptr;  // Building or laying roads.
    tvg::Paint* axe = nullptr;
    tvg::Paint* pickaxe = nullptr;
    tvg::Paint* sack = nullptr;    // Carrying grain or goods.
    tvg::Paint* logs = nullptr;    // Carrying timber.
    tvg::Paint* stone = nullptr;   // Carrying stone.
    // Swung while walking: arms about their shoulders, feet stepping (back, then front).
    std::array<ArmRig, 2> arms;
    tvg::Paint* feet[2] = {};
};

// A named person by race, calling and look.
tvg::Scene* personSprite(const Person&, PersonParts&);
Point personSpeechAnchor(const Person&);
// A front-facing bust with editable facial proportions, costume and equipment, centred on the head.
tvg::Scene* personCloseup(const Person&, Mood);
// Poses the arms and feet at a point of the walking cycle, or stands them still.
void stridePose(PersonParts&, float stride, bool walking);

// A discovered dungeon entrance: body into `objects`, light into `lights`. The returned paint pulses.
tvg::Paint* dungeonSprite(tvg::Scene* objects, tvg::Scene* lights, const Dungeon&);

// What of a lantern's light wavers: its glow on the ground and the halo round its flame.
struct LanternLight
{
    tvg::Paint* glow;
    tvg::Paint* halo;
    Point flame;  // The halo's centre.
};
// Magical lantern standing at a road end or junction.
LanternLight lantern(tvg::Scene* objects, tvg::Scene* lights, Point base, bool arcane);
}  // namespace hearthold
