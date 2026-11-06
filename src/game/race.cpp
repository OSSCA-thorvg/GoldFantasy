#include "race.h"

namespace hearthold
{
const char* raceName(Race race)
{
    switch (race) {
    case Race::Human: return "Human";
    case Race::God: return "God";
    }
    return "";
}
}  // namespace hearthold
