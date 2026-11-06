#include "climate.h"
#include <algorithm>
#include <cmath>

namespace hearthold
{
namespace
{
constexpr float tau = 6.2831853f;
float smooth(float t)
{
    t = std::clamp(t, 0.f, 1.f);
    return t * t * (3 - 2 * t);
}
// A season's weight across the year: ramps in over `ramp` before it starts and out after it ends.
float bump(float year, float start, float end, float ramp)
{
    float rise = smooth((year - start + ramp) / ramp), fall = 1 - smooth((year - end) / ramp);
    return std::min(rise, fall);
}
}  // namespace

const char* weatherName(Weather weather)
{
    switch (weather) {
    case Weather::Clear: return "Clear";
    case Weather::Cloudy: return "Cloudy";
    case Weather::Rain: return "Rain";
    case Weather::Storm: return "Storm";
    case Weather::Snow: return "Snow";
    }
    return "";
}

float Sky::random()
{
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return float(state >> 8) / float(1u << 24);
}

void Sky::roll(float year)
{
    // Rain and snow are the exception: summer brings the most rain, winter alone brings snow.
    bool summer = year >= .25f && year < .5f, winter = year >= .75f;
    float wet = summer ? .28f : winter ? .16f : .1f;
    float pick = random();
    if (pick < wet) {
        climate.intensity = .35f + random() * .65f;
        bool stormy = summer && random() < .3f;
        climate.weather = winter ? Weather::Snow : stormy ? Weather::Storm : Weather::Rain;
    } else if (pick < wet + .25f) {
        climate.weather = Weather::Cloudy;
        climate.intensity = 0;
    } else {
        climate.weather = Weather::Clear;
        climate.intensity = 0;
    }
    timer = .35f + random() * .6f;  // Weather holds for a third of a day to a day.
}

void Sky::force(Weather weather, float intensity)
{
    climate.weather = weather;
    climate.intensity = intensity;
    timer = 1;
}

void Sky::advance(double seconds, double secondsPerDay, float year, float day)
{
    float days = float(seconds / secondsPerDay);
    timer -= days;
    if (timer <= 0) roll(year);
    updateClimate(days, year, day);
}

void Sky::previewTime(float year, float day) { updateClimate(0, year, day); }

void Sky::updateClimate(float days, float year, float day)
{
    // Year-round temperature: coldest in mid winter, warmest in mid summer, colder at night.
    // `day` 0 is midnight. Full daylight spans .3 to .7 at the equinoxes, about 6 to 18 o'clock in
    // high summer and 8:20 to 15:40 in deep winter; dusk and dawn ramp around it.
    float daylight = .2f + .055f * std::sin(tau * (year - .125f));
    climate.night = smooth((std::abs(day - .5f) - daylight) / .17f);
    float base = 9 + 13 * std::sin(tau * (year - .05f));
    float weatherChill = climate.precipitating() ? 3 : climate.weather == Weather::Cloudy ? 1 : 0;
    climate.temperature = base - weatherChill - 4 * climate.night;
    // Snow only in winter; a winter thaw turns it to sleeting rain, a cold spell outside winter stays rain.
    bool winter = year >= .75f;
    if (winter && (climate.weather == Weather::Rain || climate.weather == Weather::Storm) && climate.temperature <= .5f) climate.weather = Weather::Snow;
    if (climate.weather == Weather::Snow && (!winter || climate.temperature > 2.5f)) climate.weather = Weather::Rain;
    // Snow builds up only while it falls and melts in the warmth, faster in rain.
    if (climate.weather == Weather::Snow) climate.snow += .9f * climate.intensity * days;
    else if (climate.temperature > 1) climate.snow -= (.35f + .08f * climate.temperature + (climate.precipitating() ? .5f : 0)) * days;
    climate.snow = std::clamp(climate.snow, 0.f, 1.f);
    climate.frost = std::clamp(climate.frost + (climate.temperature < -2 ? .6f : -.8f) * days, 0.f, 1.f);
    // Seasons blend: summer greens from late spring, autumn browns arrive and fade over weeks.
    climate.summer = bump(year, .25f, .5f, .08f);
    climate.autumn = bump(year, .52f, .8f, .1f);
}
}  // namespace hearthold
