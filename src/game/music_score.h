#pragma once

#include <array>
#include <cstdint>
#include <vector>

namespace hearthold
{
// What the music should suit right now.
struct MusicMood
{
    float dark = 0;    // 0 at noon .. 1 at midnight.
    float winter = 0;
    float rain = 0;
    float raid = 0;
};

// A procedural score. A handful of pieces, each with its own mode, tempo, chord progression and
// band; melodies grow from short motifs that repeat, vary and resolve. When a piece ends another
// suited to the hour, season and weather follows, crossfading; a raid cuts straight to war drums.
class Score
{
public:
    enum class Instrument : uint8_t { Lute, Harp, Flute, Strings, Bells, Brass, Drum, Shaker, Tom };

    explicit Score(int rate);
    // Adds one stereo frame of music.
    void render(float& left, float& right, const MusicMood&);
    // The piece now playing, for tests.
    int piece() const { return current; }
    static const char* pieceName(int);
    static bool warlike(int piece);

private:
    struct Tone
    {
        Instrument kind = Instrument::Lute;
        float frequency = 0, gain = 0, pan = 0, length = 0;
        float left = 0, right = 0;  // Constant stereo placement, prepared once per note.
        double start = 0;
        double phase[4] = {};
        float filter = 0;
        std::vector<float> string;  // Plucked instruments: the Karplus-Strong delay line.
        size_t at = 0;
    };
    void choose(const MusicMood&);
    void compose();
    void schedule(double beat);
    void play(Instrument, int semitones, float gain, float beats, float pan);
    float sound(Tone&, double now);
    float noise();
    float pitchOf(int degree) const;  // Scale degree of the current piece to semitones above D3.

    int rate;
    double clock = 0;
    int current = -1, previous = -1;
    double beatAt = 0;      // Clock time of beat 0 of the piece.
    double nextEighth = 0;  // The next eighth note to schedule, counted from the piece's start.
    float fade = 0, fadeTarget = 1;
    bool ending = false;
    double silentUntil = 0;
    int bars = 0;           // Length of this rendition.
    // The tune: two motifs of two bars, in eighths, with a step of the scale for each note.
    struct Motif
    {
        std::array<int, 8> rhythm{};
        std::array<int, 8> steps{};
        int notes = 0;
    };
    std::array<Motif, 2> motifs;
    int degree = 0;  // Where the melody stands.
    std::vector<Tone> tones;
    std::vector<float> roomLeft, roomRight;
    size_t roomAt = 0;
    float roomToneLeft = 0, roomToneRight = 0;
    uint32_t seed = 0x2545f491u;
};
}  // namespace hearthold
