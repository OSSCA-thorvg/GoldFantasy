#include "webgpu.h"
#include <SDL3/SDL_metal.h>
#include <cstring>

namespace ui::host
{
namespace
{
std::string message(WGPUStringView value)
{
    return value.data ? std::string(value.data, value.length == WGPU_STRLEN ? std::strlen(value.data) : value.length) : std::string{};
}
}

WebGpu::~WebGpu()
{
    closing = true;
    if (surface) wgpuSurfaceRelease(surface);
    if (device) wgpuDeviceRelease(device);
    if (adapter) wgpuAdapterRelease(adapter);
    if (instance) wgpuInstanceRelease(instance);
    if (metal) SDL_Metal_DestroyView(metal);
}

bool WebGpu::start(SDL_Window* window)
{
    WGPUInstanceDescriptor descriptor = WGPU_INSTANCE_DESCRIPTOR_INIT;
    instance = wgpuCreateInstance(&descriptor);
    if (!instance) { failure = "WebGPU instance creation failed"; return false; }
    WGPUSurfaceDescriptor surfaceDescriptor = WGPU_SURFACE_DESCRIPTOR_INIT;
#if defined(__EMSCRIPTEN__)
    (void)window;
    WGPUEmscriptenSurfaceSourceCanvasHTMLSelector source = WGPU_EMSCRIPTEN_SURFACE_SOURCE_CANVAS_HTML_SELECTOR_INIT;
    source.selector = {"#canvas", WGPU_STRLEN};
    surfaceDescriptor.nextInChain = &source.chain;
    surface = wgpuInstanceCreateSurface(instance, &surfaceDescriptor);
#elif defined(_WIN32)
    auto properties = SDL_GetWindowProperties(window);
    WGPUSurfaceSourceWindowsHWND source = WGPU_SURFACE_SOURCE_WINDOWS_HWND_INIT;
    source.hinstance = SDL_GetPointerProperty(properties, SDL_PROP_WINDOW_WIN32_INSTANCE_POINTER, nullptr);
    source.hwnd = SDL_GetPointerProperty(properties, SDL_PROP_WINDOW_WIN32_HWND_POINTER, nullptr);
    surfaceDescriptor.nextInChain = &source.chain;
    surface = wgpuInstanceCreateSurface(instance, &surfaceDescriptor);
#elif defined(__APPLE__)
    metal = SDL_Metal_CreateView(window);
    if (!metal) { failure = SDL_GetError(); return false; }
    WGPUSurfaceSourceMetalLayer source = WGPU_SURFACE_SOURCE_METAL_LAYER_INIT;
    source.layer = SDL_Metal_GetLayer(metal);
    surfaceDescriptor.nextInChain = &source.chain;
    surface = wgpuInstanceCreateSurface(instance, &surfaceDescriptor);
#else
    auto properties = SDL_GetWindowProperties(window);
    if (auto display = SDL_GetPointerProperty(properties, SDL_PROP_WINDOW_WAYLAND_DISPLAY_POINTER, nullptr)) {
        WGPUSurfaceSourceWaylandSurface source = WGPU_SURFACE_SOURCE_WAYLAND_SURFACE_INIT;
        source.display = display;
        source.surface = SDL_GetPointerProperty(properties, SDL_PROP_WINDOW_WAYLAND_SURFACE_POINTER, nullptr);
        surfaceDescriptor.nextInChain = &source.chain;
        surface = wgpuInstanceCreateSurface(instance, &surfaceDescriptor);
    } else if (auto display = SDL_GetPointerProperty(properties, SDL_PROP_WINDOW_X11_DISPLAY_POINTER, nullptr)) {
        WGPUSurfaceSourceXlibWindow source = WGPU_SURFACE_SOURCE_XLIB_WINDOW_INIT;
        source.display = display;
        source.window = uint64_t(SDL_GetNumberProperty(properties, SDL_PROP_WINDOW_X11_WINDOW_NUMBER, 0));
        surfaceDescriptor.nextInChain = &source.chain;
        surface = wgpuInstanceCreateSurface(instance, &surfaceDescriptor);
    }
#endif
    if (!surface) { failure = "WebGPU cannot create a surface for this window"; return false; }
    WGPURequestAdapterOptions options = WGPU_REQUEST_ADAPTER_OPTIONS_INIT;
    options.compatibleSurface = surface;
    options.powerPreference = WGPUPowerPreference_HighPerformance;
    WGPURequestAdapterCallbackInfo callback = WGPU_REQUEST_ADAPTER_CALLBACK_INFO_INIT;
    callback.mode = WGPUCallbackMode_AllowProcessEvents;
    callback.userdata1 = this;
    callback.callback = [](WGPURequestAdapterStatus status, WGPUAdapter value, WGPUStringView error, void* data, void*) {
        auto self = static_cast<WebGpu*>(data);
        if (status != WGPURequestAdapterStatus_Success || !value) {
            self->failure = "WebGPU adapter: " + message(error);
            self->requesting = false;
            return;
        }
        self->adapter = value;
        self->requestDevice();
    };
    requesting = true;
    wgpuInstanceRequestAdapter(instance, &options, callback);
    return true;
}

void WebGpu::requestDevice()
{
    WGPUDeviceDescriptor descriptor = WGPU_DEVICE_DESCRIPTOR_INIT;
    descriptor.deviceLostCallbackInfo.mode = WGPUCallbackMode_AllowProcessEvents;
    descriptor.deviceLostCallbackInfo.userdata1 = this;
    descriptor.deviceLostCallbackInfo.callback = [](WGPUDevice const*, WGPUDeviceLostReason, WGPUStringView error, void* data, void*) {
        auto self = static_cast<WebGpu*>(data);
        if (!self->closing) self->failure = "WebGPU device lost: " + message(error);
    };
    descriptor.uncapturedErrorCallbackInfo.userdata1 = this;
    descriptor.uncapturedErrorCallbackInfo.callback = [](WGPUDevice const*, WGPUErrorType, WGPUStringView error, void* data, void*) {
        static_cast<WebGpu*>(data)->failure = "WebGPU validation: " + message(error);
    };
    WGPURequestDeviceCallbackInfo callback = WGPU_REQUEST_DEVICE_CALLBACK_INFO_INIT;
    callback.mode = WGPUCallbackMode_AllowProcessEvents;
    callback.userdata1 = this;
    callback.callback = [](WGPURequestDeviceStatus status, WGPUDevice value, WGPUStringView error, void* data, void*) {
        auto self = static_cast<WebGpu*>(data);
        self->requesting = false;
        if (status != WGPURequestDeviceStatus_Success || !value) self->failure = "WebGPU device: " + message(error);
        else self->device = value;
    };
    wgpuAdapterRequestDevice(adapter, &descriptor, callback);
}

void WebGpu::poll() { if (instance) wgpuInstanceProcessEvents(instance); }

bool WebGpu::present()
{
#ifndef __EMSCRIPTEN__
    if (wgpuSurfacePresent(surface) != WGPUStatus_Success) {
        failure = "WebGPU surface presentation failed";
        return false;
    }
#endif
    return failure.empty();
}
}  // namespace ui::host
