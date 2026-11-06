#pragma once

#include <SDL3/SDL.h>
#include <SDL3/SDL_metal.h>
#include <thorvg.h>
#include <webgpu/webgpu.h>
#include <string>

namespace ui::host
{
class WebGpu
{
public:
    ~WebGpu();
    bool start(SDL_Window* window);
    void poll();
    bool present();
    bool ready() const { return device != nullptr; }
    bool pending() const { return requesting; }
    const std::string& error() const { return failure; }
    tvg::WgCanvas::Context context() const { return {instance, adapter, device}; }
    void* target() const { return surface; }

private:
    void requestDevice();
    WGPUInstance instance = nullptr;
    WGPUAdapter adapter = nullptr;
    WGPUDevice device = nullptr;
    WGPUSurface surface = nullptr;
    SDL_MetalView metal = nullptr;
    bool requesting = false, closing = false;
    std::string failure;
};
}  // namespace ui::host
