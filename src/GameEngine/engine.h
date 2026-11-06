#pragma once

#include <ui/application.h>
#include <filesystem>

namespace engine
{
std::unique_ptr<ui::Application> create(std::shared_ptr<ui::Application> module, std::filesystem::path script, std::filesystem::path buildingExample = {});
}  // namespace engine
