#include <ui/host.h>
#include <core/io/path.h>
#include "webgpu.h"
#include <SDL3/SDL.h>
#include <algorithm>
#include <cctype>
#include <filesystem>
#include <iostream>
#include <utility>
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#include <emscripten/html5.h>
#include <emscripten/html5_webgl.h>

EM_JS(void, syncBrowserViewport, (), {
    const canvas = Module['canvas'];
    const bounds = Module['uiViewport'] || canvas.getBoundingClientRect();
    const width = Math.round(bounds.width), height = Math.round(bounds.height);
    const ratio = window.devicePixelRatio || 1;
    const previous = Module['uiHostViewport'];
    if (width <= 0 || height <= 0) return;
    if (previous && previous.width === width && previous.height === height && previous.ratio === ratio) return;
    Module['uiHostViewport'] = {width, height, ratio};
    // SDL updates its logical input coordinates and backing pixels together.
    // CSS container changes and monitor-scale changes need not emit resize.
    window.dispatchEvent(new Event('resize'));
});
#endif

namespace ui
{
namespace
{
#ifdef __EMSCRIPTEN__
Application* browserApplication = nullptr;
#endif
Key key(SDL_Keycode value)
{
    switch (value) {
    case SDLK_TAB: return Key::Tab;
    case SDLK_RETURN: case SDLK_KP_ENTER: return Key::Enter;
    case SDLK_SPACE: return Key::Space;
    case SDLK_ESCAPE: return Key::Escape;
    case SDLK_LEFT: return Key::Left;
    case SDLK_RIGHT: return Key::Right;
    case SDLK_UP: return Key::Up;
    case SDLK_DOWN: return Key::Down;
    case SDLK_HOME: return Key::Home;
    case SDLK_END: return Key::End;
    case SDLK_BACKSPACE: return Key::Backspace;
    case SDLK_DELETE: return Key::Delete;
    default: return Key::Unknown;
    }
}

class Session
{
public:
    explicit Session(HostOptions options) : options(std::move(options)) {}
    ~Session()
    {
#ifdef __EMSCRIPTEN__
        browserApplication = nullptr;
        emscripten_set_blur_callback("#canvas", nullptr, false, nullptr);
#endif
        if (renderer) renderer->clear();
        application.reset();
        renderer.reset();
        gpu.reset();
        for (const auto& path : fonts) tvg::Text::unload(path.c_str());
        if (runtime) tvg::Initializer::term();
        if (gl) SDL_GL_DestroyContext(gl);
        if (window) SDL_DestroyWindow(window);
        for (auto cursor : cursors) if (cursor) SDL_DestroyCursor(cursor);
        SDL_Quit();
    }

    bool open(const std::function<std::unique_ptr<Application>()>& create)
    {
        if (options.backend == RenderBackend::Cpu) return fail("Applications require --renderer gl or --renderer wgpu");
#ifdef __EMSCRIPTEN__
        SDL_SetHint(SDL_HINT_EMSCRIPTEN_KEYBOARD_ELEMENT, "#canvas");
#endif
        if (!SDL_Init(SDL_INIT_VIDEO | SDL_INIT_EVENTS)) return fail(SDL_GetError());
        if (tvg::Initializer::init(0) != tvg::Result::Success) return fail("ThorVG initialization failed");
        runtime = true;
        if (!loadFonts()) return false;
        application = create();
        if (!application) return fail("Application construction failed");
#ifdef __EMSCRIPTEN__
        browserApplication = application.get();
#endif
        auto flags = SDL_WINDOW_RESIZABLE | SDL_WINDOW_HIGH_PIXEL_DENSITY;
        if (options.hidden) flags |= SDL_WINDOW_HIDDEN;
        if (options.backend == RenderBackend::OpenGL) {
#ifdef __EMSCRIPTEN__
            SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_ES);
            SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
            SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 0);
#else
            SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);
            SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
            SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 3);
#endif
            SDL_GL_SetAttribute(SDL_GL_STENCIL_SIZE, 8);
            flags |= SDL_WINDOW_OPENGL;
        }
#if defined(__APPLE__) && !defined(__EMSCRIPTEN__)
        if (options.backend == RenderBackend::WebGPU) flags |= SDL_WINDOW_METAL;
#endif
        auto title = options.title.empty() ? application->title() : options.title;
        window = SDL_CreateWindow(title.c_str(), options.width, options.height, flags);
        if (!window) return fail(SDL_GetError());
        SDL_StartTextInput(window);
#ifdef __EMSCRIPTEN__
        pointerCancelEvent = SDL_RegisterEvents(1);
        if (!pointerCancelEvent) return fail(SDL_GetError());
        // Queue canvas blur alongside SDL input so a later release cannot commit a drag.
        emscripten_set_blur_callback("#canvas", this, false,
            [](int, const EmscriptenFocusEvent*, void* data) {
                SDL_ResetKeyboard();
                SDL_Event event{};
                event.type = static_cast<Session*>(data)->pointerCancelEvent;
                SDL_PushEvent(&event);
                return EM_FALSE;
            });
#endif
        if (options.backend == RenderBackend::OpenGL) {
            gl = SDL_GL_CreateContext(window);
            if (!gl || !SDL_GL_MakeCurrent(window, gl)) return fail(SDL_GetError());
            SDL_GL_SetSwapInterval(options.hidden ? 0 : 1);
        } else {
            gpu = std::make_unique<host::WebGpu>();
            if (!gpu->start(window)) return fail(gpu->error());
        }
        renderer = std::make_unique<Renderer>(options.backend);
        if (!renderer->error().empty()) return fail(renderer->error());
        return true;
    }

    bool tick()
    {
#ifdef __EMSCRIPTEN__
        syncBrowserViewport();
#endif
        if (gpu) {
            gpu->poll();
            if (!gpu->error().empty()) return fail(gpu->error());
        }
        SDL_Event event;
        while (SDL_PollEvent(&event)) dispatch(event);
        if (gpu && gpu->pending()) return true;
        if (stopping) return false;
        if (gpu && !gpu->ready()) return fail("WebGPU device initialization did not complete");
        int width = 0, height = 0, logicalWidth = 0, logicalHeight = 0;
        SDL_GetWindowSizeInPixels(window, &width, &height);
        SDL_GetWindowSize(window, &logicalWidth, &logicalHeight);
        if (width <= 0 || height <= 0 || logicalWidth <= 0 || logicalHeight <= 0) return true;
        if (!renderer->sync()) return fail(renderer->error());
        if (width != pixelWidth || height != pixelHeight) {
            bool ready;
            if (gpu) ready = renderer->targetWebGpu(gpu->context(), gpu->target(), unsigned(width), unsigned(height));
            else {
                void* context = gl;
#ifdef __EMSCRIPTEN__
                context = reinterpret_cast<void*>(intptr_t(emscripten_webgl_get_current_context()));
#endif
                ready = renderer->targetGl(context, unsigned(width), unsigned(height));
            }
            if (!ready) return fail(renderer->error());
            pixelWidth = width;
            pixelHeight = height;
        }
        application->render(float(logicalWidth), float(logicalHeight), frameTime());
        updateCursor();
        updateTextInput();
        auto scene = application->scene();
        if (scene != attached) {
            renderer->clear();
            if (!renderer->attach(scene)) return fail(renderer->error());
            attached = scene;
        }
        setTransform(scene, {float(width) / logicalWidth, 0, 0, 0, float(height) / logicalHeight, 0, 0, 0, 1});
        if (!renderer->draw()) return fail(renderer->error());
        if (gpu) { if (!gpu->present()) return fail(gpu->error()); }
        else if (!SDL_GL_SwapWindow(window)) return fail(SDL_GetError());
        auto title = options.title.empty() ? application->title() : options.title;
        SDL_SetWindowTitle(window, title.c_str());
        ++frames;
#ifdef __EMSCRIPTEN__
        EM_ASM({
            const data = document.body.dataset;
            data.frames = $0; data.renderer = $1 ? 'wgpu' : 'gl';
            data.logicalSize = $2 + 'x' + $3; data.pixelSize = $4 + 'x' + $5;
        }, frames, gpu != nullptr, logicalWidth, logicalHeight, width, height);
#endif
        if (options.frames && frames >= options.frames) return false;
        return true;
    }

    int status = 0;

private:
    void updateCursor()
    {
        unsigned index = application->command("ui.cursor", "resize-horizontal") ? 1 :
                         application->command("ui.cursor", "resize-vertical") ? 2 :
                         application->command("ui.cursor", "text") ? 3 :
                         application->command("ui.cursor", "crosshair") ? 4 : 0;
        if (index == cursorIndex) return;
        SDL_Cursor* cursor = SDL_GetDefaultCursor();
        if (index) {
            constexpr SDL_SystemCursor shapes[]{SDL_SYSTEM_CURSOR_DEFAULT, SDL_SYSTEM_CURSOR_EW_RESIZE, SDL_SYSTEM_CURSOR_NS_RESIZE, SDL_SYSTEM_CURSOR_TEXT, SDL_SYSTEM_CURSOR_CROSSHAIR};
            if (!cursors[index]) cursors[index] = SDL_CreateSystemCursor(shapes[index]);
            cursor = cursors[index];
        }
        if (cursor && SDL_SetCursor(cursor)) cursorIndex = index;
    }

    // Text input, and so any input method, only while the application takes typing: an input method composing
    // swallows key presses. An application that does not say keeps it on.
    void updateTextInput()
    {
        bool wanted = !application->command("ui.text-input", "off");
        if (wanted == SDL_TextInputActive(window)) return;
        if (wanted) SDL_StartTextInput(window);
        else SDL_StopTextInput(window);
    }

    bool fail(const std::string& error)
    {
        std::cerr << "UI host: " << error << '\n';
#ifdef __EMSCRIPTEN__
        EM_ASM({ document.body.dataset.error = UTF8ToString($0); }, error.c_str());
#endif
        status = 1;
        return false;
    }

    bool loadFonts()
    {
        const char* filenames[]{"DejaVuSans.ttf", "DejaVuSans-Bold.ttf"};
#ifndef __EMSCRIPTEN__
        const char* source[]{UI_FONT_PATH, UI_BOLD_FONT_PATH};
#endif
        for (unsigned i = 0; i < 2; ++i) {
            std::vector<std::filesystem::path> candidates;
#ifdef __EMSCRIPTEN__
            candidates.emplace_back(std::filesystem::path("/fonts") / filenames[i]);
#else
            if (auto base = SDL_GetBasePath()) candidates.emplace_back(te::io::pathFromUtf8(base) / ".." / "share" / "hearthold" / "fonts" / filenames[i]);
            candidates.emplace_back(te::io::pathFromUtf8(source[i]));
#endif
            bool loaded = false;
            for (const auto& candidate : candidates) {
                std::error_code error;
                if (!std::filesystem::is_regular_file(candidate, error)) continue;
                auto path = te::io::pathToUtf8(candidate);
                if (tvg::Text::load(path.c_str()) == tvg::Result::Success) { fonts.push_back(std::move(path)); loaded = true; break; }
            }
            if (!loaded) return fail(std::string("Cannot load font ") + filenames[i]);
        }
        return true;
    }

    void dispatch(const SDL_Event& event)
    {
        AppEvent converted{};
#ifdef __EMSCRIPTEN__
        if (event.type == pointerCancelEvent) {
            converted.type = AppEvent::Type::PointerCancel;
            application->event(converted);
            return;
        }
#endif
        switch (event.type) {
        case SDL_EVENT_QUIT: stopping = true; return;
        case SDL_EVENT_WINDOW_FOCUS_LOST:
            converted.type = AppEvent::Type::PointerCancel;
            SDL_CaptureMouse(false);
            break;
        case SDL_EVENT_MOUSE_BUTTON_DOWN: case SDL_EVENT_MOUSE_BUTTON_UP:
            converted.type = event.type == SDL_EVENT_MOUSE_BUTTON_DOWN ? AppEvent::Type::PointerDown : AppEvent::Type::PointerUp;
            converted.x = event.button.x; converted.y = event.button.y; converted.button = event.button.button;
            if (event.button.button == SDL_BUTTON_LEFT) SDL_CaptureMouse(event.type == SDL_EVENT_MOUSE_BUTTON_DOWN);
            break;
        case SDL_EVENT_MOUSE_MOTION:
            converted.type = AppEvent::Type::PointerMove; converted.x = event.motion.x; converted.y = event.motion.y; break;
        case SDL_EVENT_MOUSE_WHEEL:
            converted.type = AppEvent::Type::Wheel; converted.x = event.wheel.mouse_x; converted.y = event.wheel.mouse_y; converted.delta = event.wheel.y; break;
        case SDL_EVENT_TEXT_INPUT:
            converted.type = AppEvent::Type::Text; converted.text = event.text.text; break;
        case SDL_EVENT_KEY_DOWN: case SDL_EVENT_KEY_UP:
            converted.type = event.type == SDL_EVENT_KEY_DOWN ? AppEvent::Type::KeyDown : AppEvent::Type::KeyUp;
            converted.key = key(event.key.key);
            converted.text = SDL_GetKeyName(event.key.key);
            std::transform(converted.text.begin(), converted.text.end(), converted.text.begin(), [](unsigned char c) { return char(std::tolower(c)); });
            converted.shift = event.key.mod & SDL_KMOD_SHIFT; converted.control = event.key.mod & SDL_KMOD_CTRL;
            converted.alt = event.key.mod & SDL_KMOD_ALT; converted.meta = event.key.mod & SDL_KMOD_GUI;
            break;
        default: return;
        }
        application->event(converted);
        updateCursor();
        updateTextInput();
    }

    HostOptions options;
    std::array<SDL_Cursor*, 5> cursors{};
    unsigned cursorIndex = 0;
    std::unique_ptr<Application> application;
    std::unique_ptr<Renderer> renderer;
    std::unique_ptr<host::WebGpu> gpu;
    SDL_Window* window = nullptr;
    SDL_GLContext gl = nullptr;
#ifdef __EMSCRIPTEN__
    Uint32 pointerCancelEvent = 0;
#endif
    tvg::Scene* attached = nullptr;
    std::vector<std::string> fonts;
    unsigned frames = 0;
    int pixelWidth = 0, pixelHeight = 0;
    bool runtime = false, stopping = false;
};
}

#ifdef __EMSCRIPTEN__
extern "C" EMSCRIPTEN_KEEPALIVE int ui_host_command(const char* name, const char* argument)
{
    return browserApplication && name && browserApplication->command(name, argument ? argument : "");
}
#endif

int run(std::function<std::unique_ptr<Application>()> create, const HostOptions& options)
{
    auto session = std::make_unique<Session>(options);
    if (!session->open(create)) return 1;
#ifdef __EMSCRIPTEN__
    emscripten_set_main_loop_arg([](void* data) {
        auto state = static_cast<Session*>(data);
        if (!state->tick()) {
            int result = state->status;
            emscripten_cancel_main_loop();
            delete state;
            EM_ASM({ document.body.dataset.exit = $0; }, result);
        }
    }, session.release(), 0, true);
    return 0;
#else
    while (session->tick()) SDL_Delay(1);
    return session->status;
#endif
}
}  // namespace ui
