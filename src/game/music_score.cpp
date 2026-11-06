#include "music_score.h"
#include <algorithm>
#include <cmath>

namespace hearthold
{
namespace
{
using Mode = std::array<int, 7>;
constexpr Mode ionian{0, 2, 4, 5, 7, 9, 11}, dorian{0, 2, 3, 5, 7, 9, 10}, phrygian{0, 1, 3, 5, 7, 8, 10}, mixolydian{0, 2, 4, 5, 7, 9, 10}, aeolian{0, 2, 3, 5, 7, 8, 10};
using I = Score::Instrument;

struct Piece
{
    const char* name;
    int root;  // Semitones above D3.
    Mode mode;
    std::array<int, 8> progression;  // The chord of each bar, as a degree of the mode.
    float tempo;                     // Beats a minute.
    I lead, accompaniment;
    bool pad, bass, drum, shaker;
    float dark, winter, rain;  // The hour, season and weather it suits.
    bool war;
};

const Piece pieces[] = {
    {"Hearthfire", 0, dorian, {0, 6, 4, 3, 0, 6, 3, 4}, 76, I::Lute, I::Strings, true, true, false, false, .3f, .4f, .4f, false},
    {"Market Day", 5, mixolydian, {0, 0, 6, 3, 0, 4, 6, 0}, 104, I::Lute, I::Harp, false, true, true, true, 0, 0, 0, false},
    {"Summer Fields", 7, ionian, {0, 3, 4, 0, 5, 3, 4, 4}, 88, I::Flute, I::Harp, true, true, false, true, 0, 0, 0, false},
    {"Pilgrim's Road", 2, dorian, {0, 3, 0, 6, 0, 3, 4, 0}, 84, I::Flute, I::Lute, false, true, true, false, .2f, .2f, .1f, false},
    {"Evening Bells", 2, aeolian, {0, 5, 2, 6, 0, 3, 4, 0}, 66, I::Bells, I::Harp, true, true, false, false, .55f, .4f, .2f, false},
    {"Nocturne", -3, aeolian, {0, 5, 3, 4, 0, 5, 3, 0}, 54, I::Flute, I::Harp, true, false, false, false, 1, .5f, .3f, false},
    {"Moonlit Watch", 5, aeolian, {0, 6, 5, 6, 0, 3, 4, 4}, 58, I::Harp, I::Strings, true, false, false, false, .9f, .3f, .2f, false},
    {"Winter Hearth", 0, aeolian, {0, 5, 6, 0, 3, 5, 4, 4}, 60, I::Bells, I::Strings, true, true, false, false, .5f, 1, .4f, false},
    {"Rain on Thatch", 3, dorian, {0, 3, 0, 6, 0, 3, 4, 4}, 62, I::Lute, I::Strings, true, true, false, false, .4f, .3f, 1, false},
    {"Raiders", 0, phrygian, {0, 1, 0, 6, 0, 1, 5, 4}, 120, I::Brass, I::Tom, true, true, true, false, 0, 0, 0, true},
};
constexpr int pieceTotal = int(sizeof pieces / sizeof pieces[0]);

// One bar of melody rhythm, in eighths.
const std::vector<std::vector<int>> barRhythms = {{2, 2, 2, 2}, {3, 1, 2, 2}, {4, 2, 2}, {2, 2, 4}, {1, 1, 2, 4}, {6, 2}, {2, 1, 1, 2, 2}, {4, 4}, {8}};

// A sine table: the score sounds hundreds of partials a sample.
struct SineTable
{
    static constexpr int size = 4096;
    std::array<float, size + 1> values{};
    SineTable()
    {
        for (int i = 0; i <= size; ++i) values[size_t(i)] = float(std::sin(6.283185307179586 * i / size));
    }
    float operator()(double cycles) const
    {
        double wrapped = cycles - std::floor(cycles);
        double at = wrapped * size;
        int i = int(at);
        float t = float(at - i);
        return values[size_t(i)] + (values[size_t(i) + 1] - values[size_t(i)]) * t;
    }
};
const SineTable sine;

float hz(int semitones) { return 146.83f * std::pow(2.f, float(semitones) / 12); }  // From D3.
}  // namespace

const char* Score::pieceName(int piece) { return piece >= 0 && piece < pieceTotal ? pieces[piece].name : ""; }
bool Score::warlike(int piece) { return piece >= 0 && piece < pieceTotal && pieces[piece].war; }

Score::Score(int rate) : rate(rate), roomLeft(size_t(rate * .031f)), roomRight(size_t(rate * .037f)) { tones.reserve(40); }

float Score::noise()
{
    seed = seed * 1664525u + 1013904223u;
    return float(seed >> 8) / float(1u << 23) - 1;
}

float Score::pitchOf(int scaleDegree) const
{
    const auto& p = pieces[current];
    int octave = int(std::floor(float(scaleDegree) / 7));
    return float(p.root + octave * 12 + p.mode[size_t(scaleDegree - octave * 7)]);
}

void Score::choose(const MusicMood& mood)
{
    // Suited pieces weigh more; the one just heard is skipped, and only a raid gets the war drums.
    bool war = mood.raid > .5f;
    float weights[pieceTotal] = {}, total = 0;
    for (int i = 0; i < pieceTotal; ++i) {
        if (pieces[i].war != war || (i == previous && !war)) continue;
        float distance = std::abs(pieces[i].dark - mood.dark) * 1.2f + std::abs(pieces[i].winter - mood.winter) * .9f + std::abs(pieces[i].rain - mood.rain) * .8f;
        weights[i] = std::exp(-5 * distance);
        total += weights[i];
    }
    float pick = (noise() * .5f + .5f) * total;
    current = 0;
    for (int i = 0; i < pieceTotal; ++i) {
        if (weights[i] <= 0) continue;
        current = i;
        if ((pick -= weights[i]) <= 0) break;
    }
    previous = current;
}

void Score::compose()
{
    const auto& p = pieces[current];
    bars = (3 + int(std::abs(noise()) * 2)) * 8;  // Three or four sections of eight bars.
    // Slow pieces take the longer rhythms.
    bool slow = p.tempo < 70;
    for (auto& motif : motifs) {
        motif = {};
        for (int bar = 0; bar < 2; ++bar) {
            const std::vector<int>* rhythm = nullptr;
            for (int attempt = 0; attempt < 8; ++attempt) {
                const auto& candidate = barRhythms[size_t(std::abs(noise()) * float(barRhythms.size())) % barRhythms.size()];
                if (motif.notes + int(candidate.size()) > 8 || (slow && candidate.size() > 3)) continue;
                rhythm = &candidate;
                break;
            }
            if (!rhythm) rhythm = &barRhythms.back();
            for (int length : *rhythm) {
                motif.rhythm[size_t(motif.notes)] = length;
                // Mostly steps, now and then a leap.
                float r = noise();
                motif.steps[size_t(motif.notes)] = motif.notes == 0 ? 0 : std::abs(r) < .7f ? (r < 0 ? -1 : 1) : (r < 0 ? -2 : 3);
                ++motif.notes;
            }
        }
    }
    degree = 4;
}

void Score::play(Instrument kind, int semitones, float gain, float beats, float pan)
{
    if (tones.size() >= 40) tones.erase(tones.begin());
    Tone tone;
    tone.kind = kind;
    tone.frequency = hz(semitones);
    tone.gain = gain;
    tone.pan = pan;
    float angle = (std::clamp(pan, -1.f, 1.f) + 1) * .7853982f;
    tone.left = std::cos(angle);
    tone.right = std::sin(angle);
    tone.length = beats * 60 / pieces[current].tempo;
    tone.start = clock;
    if (kind == Instrument::Lute || kind == Instrument::Harp) {
        tone.string.resize(std::max<size_t>(2, size_t(float(rate) / tone.frequency)));
        float soft = 0;
        for (auto& v : tone.string) {
            // A lute's burst is darker than a harp's.
            soft += (kind == Instrument::Lute ? .45f : .8f) * (noise() - soft);
            v = soft;
        }
    }
    tones.push_back(std::move(tone));
}

void Score::schedule(double eighth)
{
    const auto& p = pieces[current];
    int index = int(eighth), bar = index / 8, step = index % 8;
    if (bar >= bars) {
        ending = true;
        fadeTarget = 0;
        return;
    }
    int chord = p.progression[size_t(bar % 8)];
    bool lively = p.tempo > 80;
    // Harmony: a pad on each bar, a bass on the downbeat, and the accompaniment's figure.
    if (step == 0 && p.pad)
        for (int t : {0, 2, 4}) play(I::Strings, int(pitchOf(chord + t)) - (p.war ? 12 : 0), .011f, 8.6f, t == 2 ? -.3f : t == 4 ? .3f : 0);
    if (p.bass && (step == 0 || (lively && step == 4))) play(I::Lute, int(pitchOf(chord + (step == 4 ? 4 : 0))) - 12, .07f, 4, -.15f);
    switch (p.accompaniment) {
    case I::Harp: {
        // Rolling arpeggio, every eighth or, slow, every quarter.
        constexpr int figure[8] = {0, 2, 4, 7, 4, 2, 0, 2};
        if (p.tempo >= 70 || step % 2 == 0) play(I::Harp, int(pitchOf(chord + figure[step])), .03f, 2, .35f);
        break;
    }
    case I::Lute:
        if (step == 0 || step == 3 || step == 4 || step == 6) play(I::Lute, int(pitchOf(chord + (step == 3 ? 4 : step == 6 ? 2 : step == 4 ? 4 : 0))), .04f, 2, .3f);
        break;
    case I::Tom:
        if (step != 2 && step != 5) play(I::Tom, 0, step % 4 == 0 ? .16f : .09f, 1, step % 2 ? .2f : -.2f);
        break;
    default: break;
    }
    if (p.drum && (step == 0 || step == 3 || (lively && step == 6))) play(I::Drum, 0, step == 0 ? .14f : .08f, 1, 0);
    if (p.shaker && step % 2 == 1) play(I::Shaker, 0, .022f, 1, .45f);
    // The tune: in each eight bars, a motif, its answer a step higher, the other motif, a cadence.
    int section = bar / 8, pair = (bar % 8) / 2, span = (bar % 2) * 8 + step;
    if (pair == 3) {
        // Cadence: down to the chord, then home.
        if (bar % 2 == 0 && (step == 0 || step == 4)) {
            int target = step == 0 ? chord + 2 : chord;
            play(p.lead, int(pitchOf(target)) + 12, .065f, 4 * .95f, -.1f);
        } else if (bar % 2 == 1 && step == 0) {
            degree = degree > 3 ? 7 : 0;
            play(p.lead, int(pitchOf(degree)) + 12, .065f, 8 * .95f, -.1f);
        }
        return;
    }
    const auto& motif = motifs[size_t((section + (pair == 2 ? 1 : 0)) % 2)];
    int onset = 0;
    for (int n = 0; n < motif.notes; ++n) {
        if (onset == span) {
            degree += motif.steps[size_t(n)] + (pair == 1 && n == 0 ? 1 : 0);
            // Downbeats land on the chord; the line stays in a singing range.
            if (step == 0) {
                int best = degree, bestGap = 99;
                for (int t : {0, 2, 4, 7, 9}) {
                    int candidate = chord + t;
                    for (int shift : {-7, 0, 7})
                        if (std::abs(candidate + shift - degree) < bestGap) bestGap = std::abs(candidate + shift - degree), best = candidate + shift;
                }
                degree = best;
            }
            if (degree > 10) degree -= 7;
            if (degree < -1) degree += 7;
            play(p.lead, int(pitchOf(degree)) + 12, p.lead == I::Brass ? .05f : .065f, float(motif.rhythm[size_t(n)]) / 2 * .95f, -.1f);
            break;
        }
        onset += motif.rhythm[size_t(n)];
    }
}

float Score::sound(Tone& t, double now)
{
    float age = float(now - t.start);
    float release = age > t.length ? age - t.length : 0;
    auto advance = [&](int partial, float frequency) {
        t.phase[partial] += double(frequency) / rate;
        return t.phase[partial];
    };
    switch (t.kind) {
    case I::Lute:
    case I::Harp: {
        size_t next = (t.at + 1) % t.string.size();
        float v = t.string[t.at];
        t.string[t.at] = (t.kind == I::Lute ? .996f : .998f) * .5f * (v + t.string[next]);
        t.at = next;
        return v * (release > 0 ? std::exp(-release / .6f) : 1);
    }
    case I::Flute: {
        float vibrato = 1 + .006f * sine(age * 5.2) * std::clamp((age - .2f) / .3f, 0.f, 1.f);
        double phase = advance(0, t.frequency * vibrato);
        float env = std::min(1.f, age / .08f) * std::exp(-release / .14f);
        t.filter += .08f * (noise() - t.filter);
        return (sine(phase) + .22f * sine(phase * 2) + .06f * sine(phase * 3) + t.filter * .35f) * env;
    }
    case I::Strings: {
        float env = std::min(1.f, age / .7f) * std::exp(-release / .9f), sum = 0;
        for (int voice = 0; voice < 2; ++voice) {
            double phase = advance(voice, t.frequency * (voice ? 1.003f : .997f));
            for (int n = 1; n <= 5; ++n) sum += sine(phase * n) / float(n);
        }
        t.filter += .25f * (sum - t.filter);
        return t.filter * .5f * env;
    }
    case I::Bells: {
        constexpr float ratios[4] = {1, 2.76f, 5.4f, 8.93f}, levels[4] = {1, .5f, .25f, .12f}, lengths[4] = {1.6f, .8f, .35f, .18f};
        float sum = 0;
        for (int k = 0; k < 4; ++k) sum += sine(advance(k, t.frequency * ratios[k])) * levels[k] * std::exp(-age / lengths[k]);
        return sum * .7f;
    }
    case I::Brass: {
        float env = std::min(1.f, age / .05f) * std::exp(-release / .12f), bright = .55f + .4f * env, sum = 0, level = 1;
        double phase = advance(0, t.frequency * (1 + .004f * sine(age * 5.5)));
        for (int n = 1; n <= 8; ++n, level *= bright) sum += sine(phase * n) * level / float(n);
        return sum * env * .6f;
    }
    case I::Drum: {
        double phase = advance(0, 70 + 60 * std::exp(-age / .035f));
        return sine(phase) * std::exp(-age / .28f) + noise() * std::exp(-age / .025f) * .3f;
    }
    case I::Tom: {
        double phase = advance(0, 95 + 70 * std::exp(-age / .05f));
        return sine(phase) * std::exp(-age / .3f) + noise() * std::exp(-age / .02f) * .2f;
    }
    case I::Shaker: {
        float n = noise(), high = n - t.filter;
        t.filter = n;
        return high * std::exp(-age / .045f);
    }
    }
    return 0;
}

void Score::render(float& left, float& right, const MusicMood& mood)
{
    clock += 1.0 / rate;
    if (current < 0) {
        choose(mood);
        compose();
        beatAt = clock;
        fade = 0;
    }
    // A raid cuts in quickly; its end, or the end of a piece, fades out more slowly.
    bool war = mood.raid > .5f;
    if (!ending && warlike(current) != war) {
        ending = true;
        fadeTarget = 0;
    }
    fade += (fadeTarget - fade) / (float(rate) * (war ? .3f : warlike(current) ? .6f : 1.2f));
    if (ending && fade < .01f) {
        tones.clear();
        choose(mood);
        compose();
        silentUntil = clock + (war ? .2 : 1.5);
        beatAt = silentUntil;
        nextEighth = 0;
        ending = false;
        fadeTarget = 1;
    }
    if (!ending && clock >= silentUntil) {
        double eighth = 30.0 / pieces[current].tempo;
        while (clock >= beatAt + nextEighth * eighth && !ending) {
            schedule(nextEighth);
            nextEighth += 1;
        }
    }
    float l = 0, r = 0;
    for (auto& tone : tones) {
        float v = sound(tone, clock) * tone.gain;
        l += v * tone.left;
        r += v * tone.right;
    }
    if (int(clock * rate) % 512 == 0)
        tones.erase(std::remove_if(tones.begin(), tones.end(), [&](const Tone& t) { return clock - t.start > t.length + 3; }), tones.end());
    // A small room: each side echoes faintly into the other.
    float echoLeft = roomLeft[roomAt % roomLeft.size()], echoRight = roomRight[roomAt % roomRight.size()];
    roomToneLeft += .35f * (echoLeft - roomToneLeft);
    roomToneRight += .35f * (echoRight - roomToneRight);
    roomLeft[roomAt % roomLeft.size()] = l + roomToneLeft * .55f;
    roomRight[roomAt % roomRight.size()] = r + roomToneRight * .55f;
    ++roomAt;
    float calm = (1 - .2f * mood.dark) * fade;
    left += (l + roomToneRight * .3f) * calm;
    right += (r + roomToneLeft * .3f) * calm;
}
}  // namespace hearthold
