#include "script.h"
extern "C" {
#include <lua.h>
#include <lauxlib.h>
#include <lualib.h>
}
#include <array>
#include <charconv>
#include <cstdlib>
#include <set>
#include <stdexcept>
#include <variant>

namespace ui
{
namespace
{
using Scalar = std::variant<bool, double, std::string>;
using Values = std::map<std::string, Scalar>;
constexpr size_t sourceLimit = 1024 * 1024;

void field(lua_State* state, int table, const char* name)
{
    table = lua_absindex(state, table);
    lua_pushstring(state, name);
    lua_rawget(state, table);
}

std::string string(lua_State* state, int index)
{
    if (lua_type(state, index) != LUA_TSTRING) throw std::runtime_error("expected a string");
    size_t size = 0;
    auto value = lua_tolstring(state, index, &size);
    if (size > 16384) throw std::runtime_error("string exceeds 16 KiB");
    return std::string(value, size);
}

std::string stringField(lua_State* state, int table, const char* name, std::string fallback = {})
{
    field(state, table, name);
    auto result = lua_isnil(state, -1) ? std::move(fallback) : string(state, -1);
    lua_pop(state, 1);
    return result;
}

double numberField(lua_State* state, int table, const char* name, double fallback = 0)
{
    field(state, table, name);
    auto result = fallback;
    if (!lua_isnil(state, -1)) {
        if (lua_type(state, -1) != LUA_TNUMBER || !std::isfinite(lua_tonumber(state, -1)))
            throw std::runtime_error(std::string(name) + " must be a finite number");
        result = lua_tonumber(state, -1);
    }
    lua_pop(state, 1);
    return result;
}

bool booleanField(lua_State* state, int table, const char* name, bool fallback = false)
{
    field(state, table, name);
    auto result = fallback;
    if (!lua_isnil(state, -1)) {
        if (!lua_isboolean(state, -1)) throw std::runtime_error(std::string(name) + " must be a boolean");
        result = lua_toboolean(state, -1);
    }
    lua_pop(state, 1);
    return result;
}

Values values(lua_State* state, int table)
{
    Values result;
    table = lua_absindex(state, table);
    lua_pushnil(state);
    while (lua_next(state, table)) {
        if (result.size() >= 256) throw std::runtime_error("state exceeds 256 values");
        auto key = string(state, -2);
        if (lua_isboolean(state, -1)) result[key] = bool(lua_toboolean(state, -1));
        else if (lua_type(state, -1) == LUA_TNUMBER && std::isfinite(lua_tonumber(state, -1))) result[key] = double(lua_tonumber(state, -1));
        else if (lua_type(state, -1) == LUA_TSTRING) result[key] = string(state, -1);
        else throw std::runtime_error("state values must be booleans, finite numbers, or strings");
        lua_pop(state, 1);
    }
    return result;
}

void push(lua_State* state, const Scalar& value)
{
    std::visit([state](const auto& item) {
        using T = std::decay_t<decltype(item)>;
        if constexpr (std::is_same_v<T, bool>) lua_pushboolean(state, item);
        else if constexpr (std::is_same_v<T, double>) lua_pushnumber(state, item);
        else lua_pushlstring(state, item.data(), item.size());
    }, value);
}

Color colorField(lua_State* state, const char* name, Color fallback, const Theme& theme)
{
    auto value = stringField(state, 1, name);
    if (value.empty()) return fallback;
    static constexpr std::array<std::pair<std::string_view, Color Theme::*>, 10> tokens{{
        {"background", &Theme::background}, {"surface", &Theme::surface}, {"raised", &Theme::raised},
        {"border", &Theme::border}, {"text", &Theme::text}, {"muted", &Theme::muted},
        {"accent", &Theme::accent}, {"accentText", &Theme::accentText}, {"success", &Theme::success}, {"danger", &Theme::danger},
    }};
    for (const auto& [name, member] : tokens) if (name == value) return theme.*member;
    if (value.front() != '#' || (value.size() != 7 && value.size() != 9)) throw std::runtime_error("color must be a theme token or #RRGGBB / #RRGGBBAA");
    uint32_t rgba = 0;
    auto parsed = std::from_chars(value.data() + 1, value.data() + value.size(), rgba, 16);
    if (parsed.ec != std::errc{} || parsed.ptr != value.data() + value.size()) throw std::runtime_error("invalid hex color");
    if (value.size() == 7) rgba = (rgba << 8) | 255;
    return {uint8_t(rgba >> 24), uint8_t(rgba >> 16), uint8_t(rgba >> 8), uint8_t(rgba)};
}
}  // namespace

struct Script::Impl : std::enable_shared_from_this<Impl>
{
    struct Memory
    {
        size_t used = 0;
        bool running = false;
        static void* allocate(void* opaque, void* pointer, size_t before, size_t after)
        {
            auto& self = *static_cast<Memory*>(opaque);
            before = pointer ? before : 0;
            if (!after) { std::free(pointer); self.used -= before; return nullptr; }
            constexpr size_t limit = 32 * 1024 * 1024;
            if (self.running && (after > limit || self.used - before > limit - after)) return nullptr;
            auto next = std::realloc(pointer, after);
            if (next) self.used = self.used - before + after;
            return next;
        }
    } memory;
    lua_State* state = nullptr;
    int stateRef = LUA_NOREF, drawRef = LUA_NOREF, updateRef = LUA_NOREF;
    int budget = 0;
    double elapsed = 0;
    std::string title = "Lua project", error;
    std::vector<Property> properties;
    Values initial;
    Context* context = nullptr;
    Rect viewport;
    std::set<std::string> activated, overrides;
    std::function<void(std::string_view)> onCommand;
    size_t drawings = 0;

    Impl()
    {
#if LUA_VERSION_NUM >= 505
        state = lua_newstate(Memory::allocate, &memory, 0);
#else
        state = lua_newstate(Memory::allocate, &memory);
#endif
        if (!state) throw std::runtime_error("cannot create Lua state");
        *static_cast<Impl**>(lua_getextraspace(state)) = this;
        for (const auto& [name, open] : std::initializer_list<std::pair<const char*, lua_CFunction>>{
            {"_G", luaopen_base}, {LUA_TABLIBNAME, luaopen_table}, {LUA_STRLIBNAME, luaopen_string},
            {LUA_MATHLIBNAME, luaopen_math}, {LUA_UTF8LIBNAME, luaopen_utf8}}) {
            luaL_requiref(state, name, open, 1);
            lua_pop(state, 1);
        }
        for (auto name : {"dofile", "loadfile", "load", "pcall", "xpcall"}) { lua_pushnil(state); lua_setglobal(state, name); }
    }
    ~Impl() { if (state) lua_close(state); }

    static void limit(lua_State* state, lua_Debug*)
    {
        auto self = *static_cast<Impl**>(lua_getextraspace(state));
        if (--self->budget > 0) return;
        luaL_error(state, "Lua instruction budget exceeded");
    }
    bool call(int args, int results)
    {
        budget = 200;
        lua_sethook(state, limit, LUA_MASKCOUNT, 1000);
        memory.running = true;
        auto result = lua_pcall(state, args, results, 0);
        memory.running = false;
        lua_sethook(state, nullptr, 0, 0);
        if (result == LUA_OK) { error.clear(); return true; }
        auto message = lua_tostring(state, -1);
        error = message ? message : "Lua raised a non-string error";
        lua_pop(state, 1);
        return false;
    }
    int reference(const char* key, bool required)
    {
        field(state, 1, key);
        if (lua_isnil(state, -1) && !required) { lua_pop(state, 1); return LUA_NOREF; }
        if (!lua_isfunction(state, -1)) throw std::runtime_error(std::string(key) + " must be a function");
        return luaL_ref(state, LUA_REGISTRYINDEX);
    }
    bool load(std::string_view source, const std::string& name)
    {
        memory.running = true;
        auto result = luaL_loadbufferx(state, source.data(), source.size(), name.c_str(), "t");
        memory.running = false;
        if (result != LUA_OK) { error = lua_tostring(state, -1); lua_pop(state, 1); return false; }
        if (!call(0, 1)) return false;
        if (!lua_istable(state, 1)) throw std::runtime_error("project must return a table");
        title = stringField(state, 1, "title", title);
        drawRef = reference("draw", true);
        updateRef = reference("update", false);
        field(state, 1, "state");
        if (lua_isnil(state, -1)) { lua_pop(state, 1); lua_newtable(state); }
        if (!lua_istable(state, -1)) throw std::runtime_error("state must be a table");
        initial = values(state, -1);
        stateRef = luaL_ref(state, LUA_REGISTRYINDEX);
        field(state, 1, "properties");
        if (!lua_isnil(state, -1)) {
            if (!lua_istable(state, -1) || lua_rawlen(state, -1) > 64) throw std::runtime_error("properties must be an array of at most 64 entries");
            auto count = lua_rawlen(state, -1);
            std::set<std::string> ids;
            for (size_t i = 1; i <= count; ++i) {
                lua_rawgeti(state, -1, lua_Integer(i));
                if (!lua_istable(state, -1)) throw std::runtime_error("property must be a table");
                auto index = lua_gettop(state);
                Property item;
                item.id = stringField(state, index, "id");
                item.label = stringField(state, index, "label", item.id);
                item.minimum = numberField(state, index, "minimum", 0);
                item.maximum = numberField(state, index, "maximum", 100);
                item.step = numberField(state, index, "step", 1);
                item.value = numberField(state, index, "value");
                if (item.id.empty() || item.id.size() > 128 || item.id.find('\0') != std::string::npos || !ids.insert(item.id).second ||
                    item.minimum > item.maximum || item.step <= 0) throw std::runtime_error("invalid or duplicate property");
                item.value = std::clamp(item.value, item.minimum, item.maximum);
                properties.push_back(std::move(item));
                lua_pop(state, 1);
            }
        }
        lua_settop(state, 0);
        return true;
    }
    void pushProperties()
    {
        lua_createtable(state, 0, int(properties.size()));
        for (const auto& item : properties) { lua_pushnumber(state, item.value); lua_setfield(state, -2, item.id.c_str()); }
    }
    void restore(const Values& saved)
    {
        lua_rawgeti(state, LUA_REGISTRYINDEX, stateRef);
        for (const auto& [key, value] : saved) {
            if (!initial.contains(key)) continue;
            push(state, value); lua_setfield(state, -2, key.c_str());
        }
        lua_pop(state, 1);
    }
    Rect bounds()
    {
        Rect rect{float(numberField(state, 1, "x")), float(numberField(state, 1, "y")),
                  float(numberField(state, 1, "width", 160)), float(numberField(state, 1, "height", 32))};
        for (auto value : {rect.x, rect.y, rect.w, rect.h}) if (!std::isfinite(value) || std::abs(value) > 1e6f)
            throw std::runtime_error("drawing bounds exceed range");
        rect.x += viewport.x; rect.y += viewport.y;
        rect.w = std::max(0.f, rect.w); rect.h = std::max(0.f, rect.h);
        return rect;
    }
    int draw(int operation)
    {
        if (!context || !lua_istable(state, 1)) throw std::runtime_error("UI drawing expects a specification table during draw()");
        if (++drawings > 2048) throw std::runtime_error("frame exceeds 2048 UI elements");
        auto rect = bounds();
        auto& theme = context->theme();
        if (operation == 0) {
            auto color = colorField(state, "color", theme.raised, theme);
            auto radius = std::clamp(float(numberField(state, 1, "radius", theme.radius)), 0.f, 1000.f);
            context->rect(rect, color, radius);
            return 0;
        }
        if (operation == 1) {
            auto text = stringField(state, 1, "text");
            auto color = colorField(state, "color", theme.text, theme);
            auto size = std::clamp(float(numberField(state, 1, "size", theme.fontSize)), 1.f, 256.f);
            auto bold = booleanField(state, 1, "bold");
            context->text(rect, text, color, size, bold);
            return 0;
        }
        auto id = stringField(state, 1, "id");
        if (id.empty() || id.size() > 128) throw std::runtime_error("interactive UI element requires an id");
        auto weak = weak_from_this();
        if (operation == 2) {
            auto text = stringField(state, 1, "text", id);
            auto enabled = booleanField(state, 1, "enabled", true);
            auto command = stringField(state, 1, "command");
            button(*context, "script/" + id, rect, text, [weak, id, command] {
                if (auto self = weak.lock()) {
                    self->activated.insert(id);
                    if (!command.empty() && self->onCommand) self->onCommand(command);
                }
            }, ButtonStyle::Default, enabled);
            lua_pushboolean(state, activated.erase(id) != 0);
            return 1;
        }
        auto found = std::find_if(properties.begin(), properties.end(), [&](const auto& item) { return item.id == id; });
        if (found == properties.end()) throw std::runtime_error("ui.number id must name a project property");
        const auto item = *found;
        auto width = std::min(28.f, rect.w / 3);
        auto change = [weak, id](double delta) {
            if (auto self = weak.lock()) for (auto& value : self->properties) if (value.id == id) {
                value.value = std::clamp(value.value + delta, value.minimum, value.maximum);
                self->overrides.insert(id);
            }
        };
        button(*context, "script/" + id + "/minus", {rect.x, rect.y, width, rect.h}, "-", [change, item] { change(-item.step); });
        button(*context, "script/" + id + "/plus", {rect.x + rect.w - width, rect.y, width, rect.h}, "+", [change, item] { change(item.step); });
        context->text({rect.x + width + 6, rect.y, std::max(0.f, rect.w - 2 * width - 12), rect.h}, item.label + ": " + std::to_string(item.value), theme.text);
        lua_pushnumber(state, item.value);
        return 1;
    }
    static int dispatch(lua_State* state)
    {
        auto self = static_cast<Impl*>(lua_touserdata(state, lua_upvalueindex(1)));
        int result = -1;
        try { result = self->draw(int(lua_tointeger(state, lua_upvalueindex(2)))); }
        catch (const std::exception& exception) { self->error = exception.what(); }
        if (result >= 0) return result;
        lua_pushlstring(state, self->error.data(), self->error.size());
        return lua_error(state);
    }
    void pushUi()
    {
        lua_newtable(state);
        int operation = 0;
        for (auto name : {"rect", "label", "button", "number"}) {
            lua_pushlightuserdata(state, this); lua_pushinteger(state, operation++); lua_pushcclosure(state, dispatch, 2); lua_setfield(state, -2, name);
        }
    }
};

Script::Script() = default;
Script::~Script() = default;

bool Script::load(std::string_view text, const std::string& filename, bool preserve)
{
    try {
        if (text.size() > sourceLimit) throw std::runtime_error("project exceeds 1 MiB");
        auto next = std::make_shared<Impl>();
        if (!next->load(text, filename)) { message = next->error; return false; }
        if (impl && preserve) {
            lua_rawgeti(impl->state, LUA_REGISTRYINDEX, impl->stateRef);
            auto saved = values(impl->state, -1);
            lua_pop(impl->state, 1);
            next->restore(saved);
            next->elapsed = impl->elapsed;
            for (auto& item : next->properties) for (const auto& old : impl->properties) if (old.id == item.id && impl->overrides.contains(item.id)) {
                item.value = std::clamp(old.value, item.minimum, item.maximum);
                next->overrides.insert(item.id);
            }
        }
        impl = std::move(next);
        source = text; name = filename; message.clear();
        return true;
    } catch (const std::exception& exception) {
        if (impl) lua_settop(impl->state, 0);
        message = exception.what();
        return false;
    }
}

bool Script::reset()
{
    auto previous = impl;
    if (!load(source, name, false)) return false;
    if (previous) for (const auto& item : previous->properties) if (previous->overrides.contains(item.id)) property(item.id, item.value);
    return true;
}

std::unique_ptr<Script> Script::fork() const
{
    try {
    auto copy = std::make_unique<Script>();
    if (!impl || !copy->load(source, name, false)) return {};
    lua_rawgeti(impl->state, LUA_REGISTRYINDEX, impl->stateRef);
    auto saved = values(impl->state, -1);
    lua_pop(impl->state, 1);
    copy->impl->restore(saved);
    copy->impl->elapsed = impl->elapsed;
    for (const auto& item : impl->properties) copy->property(item.id, item.value);
    return copy;
    } catch (const std::exception&) {
        if (impl) lua_settop(impl->state, 0);
        return {};
    }
}

bool Script::update(double seconds)
{
    if (!impl || !std::isfinite(seconds) || seconds < 0) return false;
    impl->elapsed += seconds;
    if (impl->updateRef == LUA_NOREF) return true;
    lua_rawgeti(impl->state, LUA_REGISTRYINDEX, impl->updateRef);
    lua_rawgeti(impl->state, LUA_REGISTRYINDEX, impl->stateRef);
    lua_pushnumber(impl->state, seconds);
    impl->pushProperties();
    if (impl->call(3, 0)) return true;
    message = impl->error;
    return false;
}

bool Script::render(Context& context, Rect viewport)
{
    if (!impl) return false;
    impl->context = &context; impl->viewport = viewport; impl->drawings = 0; impl->onCommand = onCommand;
    auto state = impl->state;
    lua_rawgeti(state, LUA_REGISTRYINDEX, impl->drawRef);
    impl->pushUi();
    lua_rawgeti(state, LUA_REGISTRYINDEX, impl->stateRef);
    lua_createtable(state, 0, 3);
    lua_pushnumber(state, viewport.w); lua_setfield(state, -2, "width");
    lua_pushnumber(state, viewport.h); lua_setfield(state, -2, "height");
    lua_pushnumber(state, impl->elapsed); lua_setfield(state, -2, "time");
    impl->pushProperties();
    bool ok = false;
    context.clip(viewport, [&] { ok = impl->call(4, 0); });
    impl->context = nullptr;
    impl->activated.clear();
    if (!ok) message = impl->error;
    return ok;
}

std::string Script::title() const { return impl ? impl->title : "Lua project"; }
std::vector<Property> Script::properties() const { return impl ? impl->properties : std::vector<Property>{}; }
bool Script::property(std::string_view id, double value)
{
    if (!impl || !std::isfinite(value)) return false;
    for (auto& item : impl->properties) if (item.id == id) {
        item.value = std::clamp(value, item.minimum, item.maximum);
        impl->overrides.insert(item.id);
        return true;
    }
    return false;
}
}  // namespace ui
