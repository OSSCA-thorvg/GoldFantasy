#pragma once

#include "application.h"
#include "render.h"
#include <memory>
#include <string>

namespace ui
{
struct HostOptions
{
    std::string title;
    int width = 1280, height = 800;
    RenderBackend backend = RenderBackend::OpenGL;
    bool hidden = false;
    unsigned frames = 0;
};

int run(std::function<std::unique_ptr<Application>()> create, const HostOptions& options = {});
}  // namespace ui
