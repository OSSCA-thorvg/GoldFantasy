#pragma once

#include <ui/application.h>

namespace ui
{
// A Lua project owns its state; drawing and input use the same native controls as C++ applications.
class Script
{
public:
    Script();
    ~Script();
    Script(const Script&) = delete;
    Script& operator=(const Script&) = delete;
    bool load(std::string_view source, const std::string& name, bool preserve = true);
    bool reset();
    std::unique_ptr<Script> fork() const;
    bool update(double seconds);
    bool render(Context&, Rect viewport);
    std::string title() const;
    std::vector<Property> properties() const;
    bool property(std::string_view id, double value);
    std::function<void(std::string_view)> onCommand;
    const std::string& error() const { return message; }
    bool ready() const { return bool(impl); }

private:
    struct Impl;
    std::shared_ptr<Impl> impl;
    std::string source, name, message;
};
}  // namespace ui
