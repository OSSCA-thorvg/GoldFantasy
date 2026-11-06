#include "module.h"
#include <core/io/path.h>
#ifdef _WIN32
#include <windows.h>
#elif !defined(__EMSCRIPTEN__)
#include <dlfcn.h>
#endif

namespace ui
{
std::shared_ptr<Application> loadModule(const std::filesystem::path& path, std::string& error)
{
#ifdef __EMSCRIPTEN__
    (void)path;
    error = "Web builds link C++ modules at build time; use a Lua project for live reload.";
    return {};
#else
#ifdef _WIN32
    auto library = LoadLibraryW(std::filesystem::absolute(path).c_str());
    auto close = [](void* p) { FreeLibrary(static_cast<HMODULE>(p)); };
    auto symbol = [library](const char* name) { return GetProcAddress(library, name); };
#else
    auto library = dlopen(std::filesystem::absolute(path).c_str(), RTLD_NOW | RTLD_LOCAL);
    auto close = [](void* p) { dlclose(p); };
    auto symbol = [library](const char* name) { return dlsym(library, name); };
#endif
    if (!library) { error = "Cannot load C++ game module: " + te::io::pathToUtf8(path); return {}; }
    std::shared_ptr<void> handle(library, close);
    auto version = reinterpret_cast<ModuleVersion>(symbol("hearthold_module_version"));
    auto create = reinterpret_cast<ModuleCreate>(symbol("hearthold_module_create"));
    auto destroy = reinterpret_cast<ModuleDestroy>(symbol("hearthold_module_destroy"));
    if (!version || !create || !destroy || version() != moduleApiVersion) {
        error = "Incompatible C++ game module API";
        return {};
    }
    auto app = create();
    if (!app) { error = "C++ game module could not create an application"; return {}; }
    error.clear();
    return {app, [handle, destroy](Application* value) { destroy(value); }};
#endif
}
}  // namespace ui
