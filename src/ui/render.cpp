#include "render.h"

namespace ui
{
Renderer::Renderer(RenderBackend backend) : kind(backend)
{
    switch (kind) {
    case RenderBackend::Cpu: canvas.reset(tvg::SwCanvas::gen()); break;
    case RenderBackend::OpenGL: canvas.reset(tvg::GlCanvas::gen()); break;
    case RenderBackend::WebGPU: canvas.reset(tvg::WgCanvas::gen()); break;
    }
    if (!canvas) failure = "The requested ThorVG renderer is unavailable";
}

Renderer::~Renderer() { clear(); }

bool Renderer::checked(tvg::Result result, const char* operation)
{
    if (result == tvg::Result::Success) return true;
    failure = std::string(operation) + " failed (ThorVG result " + std::to_string(unsigned(result)) + ")";
    return false;
}

bool Renderer::target(std::span<uint32_t> pixels, unsigned width, unsigned height)
{
    if (kind != RenderBackend::Cpu || !canvas || !width || !height || pixels.size() / width < height) {
        failure = "Invalid CPU render target";
        return false;
    }
    return checked(static_cast<tvg::SwCanvas*>(canvas.get())->target(pixels.data(), width, width, height, tvg::ColorSpace::ARGB8888), "CPU target");
}

bool Renderer::targetGl(void* context, unsigned width, unsigned height)
{
    if (kind != RenderBackend::OpenGL || !canvas || !context || !width || !height) {
        failure = "Invalid OpenGL render target";
        return false;
    }
    return checked(static_cast<tvg::GlCanvas*>(canvas.get())->target(nullptr, nullptr, context, 0, width, height, tvg::ColorSpace::ABGR8888S), "OpenGL target");
}

bool Renderer::targetWebGpu(const tvg::WgCanvas::Context& context, void* surface, unsigned width, unsigned height)
{
    if (kind != RenderBackend::WebGPU || !canvas || !context.instance || !context.device || !surface || !width || !height) {
        failure = "Invalid WebGPU render target";
        return false;
    }
    return checked(static_cast<tvg::WgCanvas*>(canvas.get())->target(context, surface, width, height, tvg::ColorSpace::XBGR8888), "WebGPU target");
}

bool Renderer::attach(tvg::Scene* scene)
{
    if (!canvas || !scene) { failure = "Invalid scene attachment"; return false; }
    return checked(canvas->add(scene), "Scene attachment");
}

bool Renderer::draw()
{
    return canvas && checked(canvas->update(), "Scene update") && checked(canvas->draw(true), "Drawing") && sync();
}

bool Renderer::sync() { return canvas && checked(canvas->sync(), "Renderer synchronization"); }

void Renderer::clear()
{
    if (canvas) { canvas->sync(); canvas->remove(); }
}
}  // namespace ui
