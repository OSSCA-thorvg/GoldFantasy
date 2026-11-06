#include "sound_board.h"
#include <algorithm>
#include <cmath>
#include <span>

namespace hearthold
{
namespace
{
constexpr int rate = 44100;
constexpr float tau = 6.2831853f;
float decay(float age, float length) { return age < 0 ? 0 : std::exp(-age / length); }
float effectDuration(Cue cue) { return cue == Cue::Chop ? .18f : cue == Cue::Mine ? .22f : cue == Cue::TreeFall ? .85f : 1.6f; }
constexpr float musicGain = .5f, musicRise = 1.f / (rate * 3.f), musicFall = 1.f / (rate * 2.5f), musicEnding = 6;
// How long a clip may ring: an axe's bite only, so each stroke's sound is done before the next swing lands.
float clipLimit(Cue cue) { return cue == Cue::Chop ? effectDuration(cue) : 1e9f; }
float clipEnd(Cue cue, const Clip& clip, float rate) { return std::min(float(clip.duration()) / rate, clipLimit(cue)); }

// The clips that voice each cue, by the prefixes of their takes; bites, arrows and howls are still drawn from tones
// and noise. A blow rings steel on steel, thuds on a shield or whooshes past.
std::span<const std::string_view> clipsFor(Cue cue)
{
    static constexpr std::string_view place[] = {"ui/rune_"}, demolish[] = {"sfx/collapse_"}, click[] = {"ui/click_"}, notice[] = {"ui/notify_"};
    static constexpr std::string_view alarm[] = {"sfx/horn_"}, order[] = {"ui/confirm_"}, clash[] = {"sfx/clash_", "sfx/block_", "sfx/swing_"};
    static constexpr std::string_view complete[] = {"ui/complete_"}, chop[] = {"sfx/chop_"}, treeFall[] = {"sfx/tree_fall_"}, refuse[] = {"ui/error_"};
    static constexpr std::string_view open[] = {"ui/click_"}, growth[] = {"ui/growth_"}, coins[] = {"sfx/coins_"};
    static constexpr std::string_view raven[] = {"wildlife/raven_"}, crack[] = {"weather/crack_"}, strike[] = {"weather/strike_"};
    static constexpr std::string_view clap[] = {"weather/clap_"}, rumble[] = {"weather/rumble_"}, discover[] = {"sfx/rune_wake_"}, unseal[] = {"sfx/stone_door_"};
    switch (cue) {
    case Cue::Place: return place;
    case Cue::Demolish: return demolish;
    case Cue::Click: return click;
    case Cue::Notice: return notice;
    case Cue::Alarm: return alarm;
    case Cue::Order: return order;
    case Cue::Clash: return clash;
    case Cue::Complete: return complete;
    case Cue::Chop: return chop;
    case Cue::TreeFall: return treeFall;
    case Cue::Refuse: return refuse;
    case Cue::Open: return open;
    case Cue::Growth: return growth;
    case Cue::Coins: return coins;
    case Cue::Raven: return raven;
    case Cue::ThunderCrack: return crack;
    case Cue::ThunderStrike: return strike;
    case Cue::ThunderClap: return clap;
    case Cue::ThunderRumble: return rumble;
    case Cue::Discover: return discover;
    case Cue::Unseal: return unseal;
    default: return {};
    }
}
bool interfaceCue(Cue cue) { return cue == Cue::Click || cue == Cue::Order || cue == Cue::Place || cue == Cue::Refuse || cue == Cue::Open || cue == Cue::Notice; }
// Equal-power stereo placement.
void place(float sample, float pan, float& left, float& right)
{
    float angle = (std::clamp(pan, -1.f, 1.f) + 1) * .7853982f;
    left += sample * std::cos(angle);
    right += sample * std::sin(angle);
}
}  // namespace

SoundBoard::SoundBoard(bool openDevice) : score(rate)
{
    voices.reserve(EffectManager::maxConcurrent);
    active.reserve(EffectManager::maxConcurrent);
    hammer = sounds::clip("sfx/hammer_", 0);
    for (double at : onsets(hammer, .5f, .25))
        if (size_t(strikeCount) < strikes.size()) strikes[size_t(strikeCount++)] = float(at);
    if (!openDevice) return;
    SDL_AudioSpec spec{SDL_AUDIO_F32, 2, rate};
    stream = SDL_OpenAudioDeviceStream(SDL_AUDIO_DEVICE_DEFAULT_PLAYBACK, &spec, feed, this);
    if (stream) SDL_ResumeAudioStreamDevice(stream);
}

SoundBoard::~SoundBoard()
{
    if (stream) SDL_DestroyAudioStream(stream);
}

void SoundBoard::play(const Sound& sound)
{
    if (sound.cue == Cue::Music) {
        // Opening a track reads its headers: done here on the game's thread, never in the audio callback.
        auto track = sound.track.empty() ? nullptr : std::make_unique<MusicStream>(sounds::encoded(sound.track));
        std::lock_guard<std::mutex> guard(lock);
        if (state != Playback::Playing) return;
        silence = !track || !track->valid();
        pending = silence ? nullptr : std::move(track);
        musicOn = musicOn || !silence;
        return;
    }
    // Chosen, and decoded the first time, before taking the lock the audio thread waits on.
    float rate = 1;
    auto clip = sound.cue == Cue::SpeechStop ? Clip{} : pick(sound, rate);
    std::lock_guard<std::mutex> guard(lock);
    if (sound.cue == Cue::SpeechStop) {
        effects.stopSpeech(sound.speaker);
        voices.erase(std::remove_if(voices.begin(), voices.end(), [&](const Voice& voice) {
            return !effects.active(voice.token);
        }), voices.end());
        return;
    }
    if (state != Playback::Playing) return;
    auto token = effects.request(sound);
    if (!token) return;
    voices.erase(std::remove_if(voices.begin(), voices.end(), [&](const Voice& voice) { return !effects.active(voice.token); }), voices.end());
    // A clip can wait its delay out: thunder rolls in after the flash.
    float age = sound.cue == Cue::Speech ? sound.offset - sound.delay : clip.frames ? -std::max(0.f, sound.delay) : 0;
    auto voice = makeVoice(sound, age, token);
    voice.clip = clip;
    voice.rate = rate;
    voices.push_back(voice);
}

Clip SoundBoard::pick(const Sound& sound, float& rate)
{
    if (sound.cue == Cue::Speech) {
        rate = sound.pitch;
        return voiceSample(sound.line, sound.voice, sound.take);
    }
    auto groups = clipsFor(sound.cue);
    if (groups.empty()) return {};
    int take = 0;
    std::string_view group;
    {
        std::lock_guard<std::mutex> guard(lock);
        auto next = [&] {
            picking = picking * 1664525u + 1013904223u;
            return float(picking >> 8) / float(1u << 24);
        };
        group = groups[std::min(groups.size() - 1, size_t(next() * float(groups.size())))];
        int takes = sounds::count(group);
        if (!takes) return {};
        // Never the same take twice running, and each a little higher or lower than the last.
        auto& last = lastTake[uint8_t(sound.cue) % lastTake.size()];
        take = int(next() * float(takes)) % takes;
        if (takes > 1 && take == last) take = (take + 1) % takes;
        last = uint8_t(take);
        float spread = interfaceCue(sound.cue) ? .02f : .05f;
        rate = (1 + (next() * 2 - 1) * spread) * (std::isfinite(sound.pitch) && sound.pitch > 0 ? sound.pitch : 1);
    }
    return sounds::clip(group, take);
}

bool SoundBoard::musicPlaying()
{
    std::lock_guard<std::mutex> guard(lock);
    return musicOn;
}

EffectManager::Statistics SoundBoard::effectStatistics()
{
    std::lock_guard<std::mutex> guard(lock);
    return effects.statistics();
}

void SoundBoard::setAmbience(const Ambience& mix)
{
    std::lock_guard<std::mutex> guard(lock);
    target = mix;
}

void SoundBoard::playback(Playback value)
{
    // SDL holds this lock during feed. Wait for the current buffer before changing
    // generator state, then remove anything already queued for the device.
    if (stream) {
        // Device operations must precede the stream lock (the callback takes
        // the device lock first), otherwise a native audio thread can deadlock.
        if (value != Playback::Playing) SDL_PauseAudioStreamDevice(stream);
        SDL_LockAudioStream(stream);
    }
    {
        std::lock_guard<std::mutex> guard(lock);
        state = value;
        if (value == Playback::Stopped) {
            voices.clear(); effects.clear();
            target = {}; level = {};
            score = Score(rate);
            pending.reset(); music.reset(); fading.reset();
            silence = musicOn = false;
            musicLevel = fadingLevel = 0;
        }
    }
    if (stream) {
        if (value != Playback::Playing) SDL_ClearAudioStream(stream);
        SDL_UnlockAudioStream(stream);
        if (value == Playback::Playing) SDL_ResumeAudioStreamDevice(stream);
    }
}

SoundBoard::Voice SoundBoard::makeVoice(const Sound& sound, float age, uint64_t token)
{
    Voice result{sound, age, token};
    float angle = (std::clamp(sound.pan, -1.f, 1.f) + 1) * .7853982f;
    result.left = std::cos(angle);
    result.right = std::sin(angle);
    return result;
}

void SDLCALL SoundBoard::feed(void* self, SDL_AudioStream* stream, int additional, int)
{
    auto* board = static_cast<SoundBoard*>(self);  // SAFETY: SDL hands back the pointer given at open.
    int frames = additional / int(2 * sizeof(float));
    while (frames > 0) {
        int count = std::min(frames, int(board->samples.size() / 2));
        board->render(board->samples.data(), count);
        SDL_PutAudioStreamData(stream, board->samples.data(), count * int(2 * sizeof(float)));
        frames -= count;
    }
}

float SoundBoard::noise()
{
    seed = seed * 1664525u + 1013904223u;
    return float(seed >> 8) / float(1u << 23) - 1;
}

void SoundBoard::ambient(float& left, float& right)
{
    float t = float(clock);
    // Rain: two uncorrelated hisses, so it surrounds the listener.
    rainLeft += .5f * (noise() - rainLeft);
    rainRight += .5f * (noise() - rainRight);
    left += rainLeft * .06f * level.rain;
    right += rainRight * .06f * level.rain;
    // Wind: a dark rumble that swells and fades, drifting across.
    windTone += .015f * (noise() - windTone);
    place(windTone * 2 * level.wind * .4f * (.6f + .4f * std::sin(t * .37f)), std::sin(t * .11f) * .6f, left, right);
    // Crickets: trains of three short chirps.
    if (level.night > .01f) {
        if (clock > chirpAt + .9) chirpAt = clock + noise() * .2;
        float since = float(clock - chirpAt);
        for (int k = 0; k < 3; ++k) {
            float local = since - k * .07f;
            if (local > 0 && local < .035f) place(std::sin(6.283185307179586 * 4400 * clock) * .014f * level.night * std::sin(local / .035f * 3.14159f), -.4f, left, right);
        }
    }
    // Birds: chirps from here and there.
    if (level.birds > .01f) {
        float since = float(clock - birdAt);
        if (since > 2.5f + 2 * std::abs(noise())) {
            birdAt = clock;
            birdPitch = 2600 + 1200 * std::abs(noise());
            birdPan = noise() * .8f;
            since = 0;
        }
        for (int k = 0; k < 2; ++k) {
            float local = since - k * .16f;
            if (local > 0 && local < .12f) {
                float sweep = birdPitch * (1 + .35f * std::sin(local / .12f * 3.14159f));
                place(std::sin(tau * sweep * local) * .03f * level.birds * std::sin(local / .12f * 3.14159f), birdPan, left, right);
            }
        }
    }
    // Hammers knocking on timber, from where the builders are: each knock one strike of the recording, rung out.
    if (level.hammering > .01f) {
        float since = float(clock - hammerAt);
        if (since > .75f - .35f * level.hammering + .1f * noise()) {
            hammerAt = clock;
            since = 0;
            if (strikeCount) strikeFrom = strikes[size_t(std::abs(noise()) * float(strikeCount)) % size_t(strikeCount)];
        }
        float knock = strikeCount ? hammer.at(strikeFrom + since) * std::clamp((.34f - since) / .06f, 0.f, 1.f)
                                  : (std::sin(tau * 190 * since) * .7f + noise() * .3f) * decay(since, .035f);
        // One builder in earshot is heard plainly, as an axe is; a busy site louder, but not three times so.
        place(knock * .38f * std::sqrt(level.hammering), level.hammerPan, left, right);
    }
    // The campfire: a low, soft murmur only.
    if (level.fire > .01f) {
        fireTone += .01f * (noise() - fireTone);
        place(fireTone * .02f * level.fire, level.firePan, left, right);
    }
    // Water: a shore's slow wash, swelling and falling like waves.
    if (level.water > .01f) {
        float n = noise();
        waveLow += .02f * (n - waveLow);
        waveHigh += .17f * (n - waveHigh);
        waveSoft += .17f * (waveHigh - waveSoft);  // A second pole keeps the hiss off it.
        float swell = .55f + .45f * std::sin(t * .9f + .6f * std::sin(t * .23f));
        place((waveSoft - waveLow) * .15f * level.water * swell * swell, level.waterPan, left, right);
    }
    // Leaves stirring as the wind gusts through the trees about.
    if (level.woods > .01f) {
        float n = noise();
        leafLow += .08f * (n - leafLow);
        leafHigh += .35f * (n - leafHigh);
        leafSoft += .35f * (leafHigh - leafSoft);
        float gust = std::max(0.f, std::sin(t * .53f + 2 * std::sin(t * .17f)));
        place((leafSoft - leafLow) * .1f * level.woods * (.3f + level.wind) * gust * gust, std::sin(t * .07f) * .5f, left, right);
    }
    // Axes biting into trunks: slower and duller than the hammers.
    if (level.chopping > .01f) {
        if (clock - chopAt > 1.1 - .2 * level.chopping) chopAt = clock + .15 * std::abs(noise());
        float since = float(clock - chopAt);
        if (since > 0) {
            float thunk = std::sin(tau * 150 * since) * decay(since, .05f) + .4f * std::sin(tau * 410 * since) * decay(since, .02f) + .5f * noise() * decay(since, .005f);
            place(thunk * .09f * level.chopping, level.chopPan, left, right);
        }
    }
    // An owl in the woods at night: hoo... hoo-hoo, each note sagging a little.
    if (level.night > .3f && level.woods > .1f) {
        float since = float(clock - owlAt);
        if (since > 1.4f) {
            owlAt = clock + 12 + 10 * std::abs(noise());
            owlPitch = 340 + 60 * std::abs(noise());
            owlPan = noise() * .7f;
        } else if (since > 0) {
            constexpr float starts[] = {0, .62f, .86f}, lengths[] = {.34f, .16f, .42f};
            for (int k = 0; k < 3; ++k) {
                float local = since - starts[k];
                if (local <= 0 || local >= lengths[k]) continue;
                float shape = std::sin(local / lengths[k] * 3.14159f);
                float phase = owlPitch * (local - .03f * local * local / lengths[k]);
                float hoot = std::sin(tau * phase) + .15f * std::sin(2 * tau * phase);
                place(hoot * shape * shape * .022f * level.night * level.woods, owlPan, left, right);
            }
        }
    }
    // Now and then a songbird's phrase: a run of quick notes, each lifting a little.
    if (level.birds > .01f) {
        float since = float(clock - songAt);
        if (since > .5f) {
            songAt = clock + 7 + 8 * std::abs(noise());
            for (auto& note : song) note = 2300 + 1400 * std::abs(noise());
            songPan = noise() * .8f;
        } else if (since > 0) {
            int k = int(since / .095f);
            float local = since - k * .095f;
            if (k < int(song.size()) && local < .07f) {
                float shape = std::sin(local / .07f * 3.14159f);
                float phase = song[size_t(k)] * (local + 1.2f * local * local);
                place(std::sin(tau * phase) * shape * .02f * level.birds, songPan, left, right);
            }
        }
    }
}

float SoundBoard::voice(Voice& v)
{
    float a = v.age;
    if (v.clip.frames) {
        if (v.sound.cue != Cue::Speech) {
            // Faded over its last moments, longer where it is cut short, so no clip ends on a click.
            float end = clipEnd(v.sound.cue, v.clip, v.rate), fade = end < float(v.clip.duration()) / v.rate ? .025f : .006f;
            return v.clip.at(a, v.rate) * std::clamp((end - a) / fade, 0.f, 1.f);
        }
        if (a < 0 || a >= v.sound.duration) return 0;
        double local = a;
        // Typed text no clip says is hummed under, over and over.
        if (v.sound.line == VoiceLine::Murmur) local = std::fmod(local, v.clip.duration() / v.rate + .1);
        float envelope = std::clamp(std::min(a / .008f, (v.sound.duration - a) / .02f), 0.f, 1.f);
        return v.clip.at(local, v.rate) * envelope;
    }
    switch (v.sound.cue) {
    case Cue::Place: return (std::sin(tau * 95 * a) * .5f + noise() * decay(a, .02f) * .4f) * decay(a, .18f) * .5f;
    case Cue::Demolish: return (noise() * .6f * decay(a, .25f) + std::sin(tau * 58 * a) * .5f * decay(a, .3f)) * .45f;
    case Cue::Click: return std::sin(tau * 1250 * a) * decay(a, .012f) * .2f;
    case Cue::Order: return std::sin(tau * (620 + 200 * a) * a) * decay(a, .05f) * .18f;
    case Cue::Notice: return (std::sin(tau * 880 * a) + .6f * std::sin(tau * 1320 * (a - .09f)) * (a > .09f)) * decay(a, .35f) * .1f;
    case Cue::Alarm: {
        float vibrato = 1 + .01f * std::sin(tau * 5 * a);
        float saw = 2 * std::fmod(220 * vibrato * a, 1.f) - 1;
        return saw * std::min(1.f, a / .15f) * (a < .9f ? 1 : decay(a - .9f, .25f)) * .12f;
    }
    case Cue::Clash:  // Steel: a few clanging partials over a sharp click.
        return ((std::sin(tau * 1180 * a) + .7f * std::sin(tau * 1730 * a) + .5f * std::sin(tau * 2390 * a)) * decay(a, .12f) * .12f + noise() * decay(a, .008f) * .25f);
    case Cue::Bite:  // A snarl and a thud.
        return (noise() * (.5f + .5f * std::sin(tau * 38 * a)) * decay(a, .12f) * .3f + std::sin(tau * 85 * a) * decay(a, .1f) * .3f);
    case Cue::Arrow:  // A whistle that falls away.
        return std::sin(tau * (1900 - 900 * a) * a) * decay(a, .1f) * .08f + noise() * decay(a, .05f) * .06f;
    case Cue::Chop:
        return (std::sin(tau * 185 * a) * decay(a, .028f) * .35f + noise() * decay(a, .009f) * .22f) * std::clamp((.18f - a) / .025f, 0.f, 1.f);
    case Cue::Mine:
        return ((std::sin(tau * 830 * a) + .5f * std::sin(tau * 1470 * a)) * decay(a, .045f) * .16f + noise() * decay(a, .009f) * .16f) * std::clamp((.22f - a) / .025f, 0.f, 1.f);
    case Cue::TreeFall: {
        float creak = std::sin(tau * (160 - 65 * a) * a) * decay(a, .25f) * .055f;
        float hit = a - .5f;
        float thud = hit < 0 ? 0 : (std::sin(tau * 75 * hit) * .22f + noise() * .12f) * decay(hit, .1f);
        return (creak + thud) * std::clamp((.85f - a) / .1f, 0.f, 1.f);
    }
    case Cue::Complete: {  // Three rising bell notes.
        float bell = 0;
        const float tones[] = {523.25f, 659.25f, 783.99f};
        for (int i = 0; i < 3; ++i) {
            float local = a - i * .12f;
            if (local > 0) bell += std::sin(tau * tones[i] * local) * decay(local, .5f);
        }
        return bell * .07f;
    }
    case Cue::Speech: case Cue::SpeechStop: return 0;
    case Cue::Howl: {  // A pack's long cry and a lower answer, far off in the dark.
        float cry = 0;
        for (int k = 0; k < 2; ++k) {
            float local = a - k * .5f, length = k ? .9f : 1.05f;
            if (local <= 0 || local >= length) continue;
            float low = k ? 270.f : 310.f, high = k ? 440.f : 520.f, sag = std::max(0.f, local - .6f);
            // Rising fast to its pitch, then sagging, with a slight waver: the phase integrates the pitch.
            float phase = high * local - (high - low) * .18f * (1 - std::exp(-local / .18f)) - 120 * sag * sag - 6 / (tau * 5.5f) * std::cos(tau * 5.5f * local);
            float shape = std::min(1.f, local / .15f) * std::min(1.f, (length - local) / .3f);
            cry += (std::sin(tau * phase) + .25f * std::sin(2 * tau * phase)) * shape * (k ? .6f : 1);
        }
        return cry * .07f;
    }
    case Cue::Refuse: case Cue::Open: case Cue::Growth: case Cue::Coins: case Cue::Raven:
    case Cue::ThunderCrack: case Cue::ThunderStrike: case Cue::ThunderClap: case Cue::ThunderRumble: case Cue::Discover: case Cue::Unseal:
    case Cue::Music: return 0;  // Clips only.
    }
    return 0;
}

void SoundBoard::render(float* out, int frames)
{
    if (frames <= 0) return;
    active.clear();
    Ambience goal;
    {
        std::lock_guard<std::mutex> guard(lock);
        if (state != Playback::Playing) {
            std::fill_n(out, frames * 2, 0.f);
            return;
        }
        active.swap(voices);
        goal = target;
        // A new track crossfades over the one playing; quiet lets it fade out.
        if (pending || silence) {
            if (music) {
                fading = std::move(music);
                fadingLevel = musicLevel;
            }
            music = std::move(pending);
            musicLevel = 0;
            silence = false;
        }
    }
    constexpr float glide = 4.f / (rate * .8f);  // Ambience eases over a fraction of a second.
    constexpr float swell = 4.f / (rate * 3.f);  // The score swells in and fades out over seconds.
    auto ease = [&](float& from, float to) { from += (to - from) * glide; };
    // In blocks, so each track decodes into scratch of a fixed size.
    constexpr int block = 1024;
    static_assert(sizeof(tune) == 2 * block * sizeof(float));
    for (int first = 0; first < frames; first += block) {
        int count = std::min(block, frames - first);
        auto decode = [&](std::unique_ptr<MusicStream>& track, std::array<float, 2048>& into, float& ending) {
            int got = track ? track->read(into.data(), count) : 0;
            std::fill(into.begin() + 2 * got, into.begin() + 2 * count, 0.f);
            ending = track ? std::clamp(float(track->duration() - track->played()) / musicEnding, 0.f, 1.f) : 0;
            if (track && got < count) track.reset();  // It has ended.
        };
        float ending = 0, fadingEnding = 0;
        decode(music, tune, ending);
        decode(fading, tuneFading, fadingEnding);
        for (int i = first; i < first + count; ++i) {
            ease(level.rain, goal.rain);
            ease(level.wind, goal.wind);
            ease(level.night, goal.night);
            ease(level.birds, goal.birds);
            constexpr float workGlide = 4.f / (rate * .02f);
            level.hammering += (goal.hammering - level.hammering) * (goal.hammering > 0 ? glide : workGlide);
            ease(level.fire, goal.fire);
            ease(level.hammerPan, goal.hammerPan);
            ease(level.firePan, goal.firePan);
            ease(level.raid, goal.raid);
            ease(level.dark, goal.dark);
            ease(level.winter, goal.winter);
            ease(level.gloom, goal.gloom);
            ease(level.water, goal.water);
            ease(level.waterPan, goal.waterPan);
            ease(level.woods, goal.woods);
            level.chopping += (goal.chopping - level.chopping) * (goal.chopping > 0 ? glide : workGlide);
            ease(level.chopPan, goal.chopPan);
            level.music += (goal.music - level.music) * swell;
            float left = 0, right = 0;
            ambient(left, right);
            // Without a bard the score rests where it was, costing nothing.
            if (goal.music > 0 || level.music > .001f) {
                float tuneLeft = 0, tuneRight = 0;
                score.render(tuneLeft, tuneRight, {level.dark, level.winter, level.gloom, level.raid});
                left += tuneLeft * level.music;
                right += tuneRight * level.music;
            }
            // A track of music swells in, fades over its last seconds, and crossfades into the next.
            musicLevel = std::min(1.f, musicLevel + musicRise);
            fadingLevel = std::max(0.f, fadingLevel - musicFall);
            size_t at = size_t(2 * (i - first));
            float now = musicLevel * ending * musicGain, then = fadingLevel * fadingEnding * musicGain;
            left += tune[at] * now + tuneFading[at] * then;
            right += tune[at + 1] * now + tuneFading[at + 1] * then;
            for (auto& v : active) {
                // End effects at a sample boundary, independent of SDL's requested buffer size. Drawn cues' exponential
                // tails can still be audible at 1.6 s: taper their last 10 ms. Clips end on their own.
                float tail = v.sound.cue == Cue::Speech || v.clip.frames ? 1.f : std::clamp((1.6f - v.age) / .01f, 0.f, 1.f);
                float sample = tail > 0 ? voice(v) * tail * v.sound.gain : 0;
                left += sample * v.left;
                right += sample * v.right;
                v.age += 1.f / rate;
            }
            out[2 * i] = std::clamp(left, -1.f, 1.f);
            out[2 * i + 1] = std::clamp(right, -1.f, 1.f);
            clock += 1.0 / rate;
        }
        if (fading && fadingLevel <= 0) fading.reset();
    }
    // Voices still ringing go back for the next buffer.
    std::lock_guard<std::mutex> guard(lock);
    musicOn = music || fading || pending;
    effects.advance(double(frames) / rate);
    active.erase(std::remove_if(active.begin(), active.end(), [&](const Voice& v) {
        if (!effects.active(v.token)) return true;
        bool ended = v.sound.cue == Cue::Speech ? v.age >= v.sound.duration : v.clip.frames ? v.age >= clipEnd(v.sound.cue, v.clip, v.rate) : v.age > effectDuration(v.sound.cue);
        if (ended) effects.finish(v.token);
        return ended;
    }), active.end());
    voices.insert(voices.begin(), active.begin(), active.end());
}
}  // namespace hearthold
