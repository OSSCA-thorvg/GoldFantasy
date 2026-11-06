#pragma once

#include "game_app.h"
#include "music_score.h"
#include "effect_manager.h"
#include "sound_library.h"
#include <SDL3/SDL.h>
#include <array>
#include <memory>
#include <mutex>
#include <vector>

namespace hearthold
{
// Stereo sound: weather, birds, crickets and owls, water, leaves, hammers, axes and the campfire drawn as
// ambience; cues placed where they happen, played from the embedded clips (a few still drawn from tones and
// noise); people's voices; a score while a bard is in town; and now and then a track of music.
class SoundBoard
{
public:
    enum class Playback { Playing, Paused, Stopped };
    explicit SoundBoard(bool openDevice = true);
    ~SoundBoard();
    SoundBoard(const SoundBoard&) = delete;
    SoundBoard& operator=(const SoundBoard&) = delete;

    void play(const Sound&);
    void setAmbience(const Ambience&);
    // Whether a track of music is playing or fading out.
    bool musicPlaying();
    // Pause freezes the mixer; stop also discards voices and buffered device audio.
    void playback(Playback);
    // The SDL callback and offline audio export use this same mixer on one audio thread.
    void render(float* out, int frames);
    EffectManager::Statistics effectStatistics();

private:
    struct Voice
    {
        Sound sound;
        float age = 0;  // Seconds since it started.
        uint64_t token = 0;
        float left = 0, right = 0;
        Clip clip = {};  // What it plays; none for cues still drawn from tones and noise.
        float rate = 1;  // How fast the clip plays.
    };
    static Voice makeVoice(const Sound&, float age = 0, uint64_t token = 0);
    // The clip to play for a cue, a different take from last time where there is more than one.
    Clip pick(const Sound&, float& rate);
    static void SDLCALL feed(void* self, SDL_AudioStream*, int additional, int total);
    float noise();
    void ambient(float& left, float& right);
    float voice(Voice&);

    SDL_AudioStream* stream = nullptr;
    std::mutex lock;
    Playback state = Playback::Playing;
    std::vector<Voice> voices, active;
    EffectManager effects;
    std::array<float, 2048> samples{};  // Callback scratch: 1024 stereo frames, reused without allocating.
    // Music: the track playing and the one fading out under it, both owned by the audio thread once started;
    // a track asked for waits in `pending` (or `silence` asks for quiet) until the next buffer takes it.
    std::unique_ptr<MusicStream> pending, music, fading;
    bool silence = false, musicOn = false;
    float musicLevel = 0, fadingLevel = 0;
    std::array<float, 2048> tune{}, tuneFading{};
    std::array<uint8_t, 64> lastTake{};
    uint32_t picking = 0x2545f491;  // Chooses takes on the game's thread, apart from the audio thread's noise.
    Ambience target, level;
    // Generator state, touched only on the audio thread.
    uint32_t seed = 22695477;
    float rainLeft = 0, rainRight = 0, windTone = 0, fireTone = 0;
    float waveLow = 0, waveHigh = 0, waveSoft = 0, leafLow = 0, leafHigh = 0, leafSoft = 0;
    double clock = 0;
    double chirpAt = 0, birdAt = 1, hammerAt = .5, chopAt = .3, owlAt = 4, songAt = 3;
    // The construction recording, and where each of its strikes begins: a knock plays one of them.
    Clip hammer = {};
    std::array<float, 4> strikes{};
    int strikeCount = 0;
    float strikeFrom = 0;
    float birdPitch = 3000, birdPan = 0, owlPitch = 380, owlPan = 0, songPan = 0;
    std::array<float, 5> song{};  // The pitches of a songbird's phrase.
    Score score;
};
}  // namespace hearthold
