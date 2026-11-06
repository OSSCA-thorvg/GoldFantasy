#pragma once
#include <ui/application.h>
#include <filesystem>
#include <memory>

namespace ui
{
std::shared_ptr<Application> loadModule(const std::filesystem::path&, std::string& error);
}
