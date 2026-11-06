#pragma once

#include "person.h"
#include "vector_paint.h"

namespace hearthold
{
Appearance appearanceOf(const Person&);
// Curated asset-pool tag, independent of a character's explicitly chosen gender.
BodyType headBody(int head);

// The face a person pulls, read from how they are doing.
enum class Mood : uint8_t { Content, Cheerful, Tired, Exhausted, Hungry, Stressed, Hurt, Asleep, Fierce };
enum class Injury : uint8_t { None, Scratched, Bruised, Bandaged };
Injury injuryOf(const Person&);
}  // namespace hearthold
