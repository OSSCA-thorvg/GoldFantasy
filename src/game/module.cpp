#include "application.h"
#ifdef _WIN32
#define MODULE_EXPORT __declspec(dllexport)
#else
#define MODULE_EXPORT __attribute__((visibility("default")))
#endif
extern "C" MODULE_EXPORT unsigned hearthold_module_version() { return ui::moduleApiVersion; }
extern "C" MODULE_EXPORT ui::Application* hearthold_module_create()
{
    try { return hearthold::createApplication().release(); }
    catch (...) { return nullptr; }
}
extern "C" MODULE_EXPORT void hearthold_module_destroy(ui::Application* app) { delete app; }
