#pragma once

#include "person.h"
#include "person_look.h"
#include "portrait_background.h"
#include <thorvg.h>

namespace hearthold
{
Mood moodOf(const Person&);
const char* moodName(Mood);

// Head and shoulders filling a width x height box at (0, 0), clipped to its rounded frame: the
// static reference-derived head and whole outfit. Mood remains gameplay metadata.
tvg::Scene* personPortrait(const Person&, Mood, float width, float height, const PortraitBackdrop& = portraitBackdrop());
}  // namespace hearthold
