#pragma once

#include <thorvg.h>
#include <memory>
#include <span>
#include <string>

namespace ui
{
enum class RenderBackend { Cpu, OpenGL, WebGPU };

class Renderer
{
public:
    // ThorVG must be initialized before construction and outlive this renderer.
    explicit Renderer(RenderBackend backend);
    ~Renderer();
    bool target(std::span<uint32_t> pixels, unsigned width, unsigned height);
    bool targetGl(void* context, unsigned width, unsigned height);
    bool targetWebGpu(const tvg::WgCanvas::Context&, void* surface, unsigned width, unsigned height);
    // The canvas retains a reference; an application may keep its own reference.
    bool attach(tvg::Scene* scene);
    bool draw();
    bool sync();
    void clear();
    const std::string& error() const { return failure; }
    RenderBackend backend() const { return kind; }

private:
    bool checked(tvg::Result result, const char* operation);
    RenderBackend kind;
    std::unique_ptr<tvg::Canvas> canvas;
    std::string failure;
};
}  // namespace ui
