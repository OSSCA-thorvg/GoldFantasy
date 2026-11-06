#pragma once

#include <cstdint>

namespace hearthold
{
enum class Weather : uint8_t { Clear, Cloudy, Rain, Storm, Snow };
const char* weatherName(Weather);

// What the sky and the ground look like right now. Seasons blend over weeks; snow only lies where it fell.
struct Climate
{
    Weather weather = Weather::Clear;
    float intensity = 0;    // 0..1 strength of rain or snowfall.
    float temperature = 10;  // Degrees Celsius.
    float snow = 0;          // 0..1 snow lying on the ground.
    float summer = 0, autumn = 0;  // 0..1 blend weights of the season's colours.
    float frost = 0;         // 0..1 ice on still water in deep cold.
    float night = 0;         // 0 at noon .. 1 at midnight.
    bool precipitating() const { return weather == Weather::Rain || weather == Weather::Storm || weather == Weather::Snow; }
};

// Weather that rolls over a few hours at a time, its odds and temperature following the year.
class Sky
{
public:
    explicit Sky(uint32_t seed) : state(seed * 747796405u + 2891336453u) {}
    // `year` is the fraction of the year (0 = first day of spring), `day` the fraction of the day (0 = midnight).
    void advance(double seconds, double secondsPerDay, float year, float day);
    const Climate& now() const { return climate; }
    // For tests and the demo.
    void force(Weather, float intensity);
    void previewTime(float year, float day);

private:
    friend class SaveArchive;
    void updateClimate(float days, float year, float day);
    float random();
    void roll(float year);

    Climate climate;
    float timer = 0;  // Days until the weather changes.
    uint32_t state;
};
}  // namespace hearthold
