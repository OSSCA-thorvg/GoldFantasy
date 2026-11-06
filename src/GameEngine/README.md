# GameEngine projects

`GameEngine` runs a Lua project without linking the game. Pass `--script path/to/project.lua` to open a project. Pass `--module path/to/libhearthold-project.so` to embed a C++ application; an explicit script can add UI over that application.

GameEngine opens in **Edit** mode. The scene shows the authored map, units, and buildings without the game's HUD, AI, dialogue, audio, or script updates. Click a unit or building to select it, drag it to edit its position, right-drag to pan, and use the wheel to zoom. The inspector's **Scene Objects** list selects real world objects; their editable fields are generated from member metadata. Select **World** to edit the starting time of day. Map Editor, Character Studio, and Buildings remain available for asset authoring.

Use **Play / F5**, **Pause / F6**, and **Stop / F7** above the canvas. Play creates an independent world and Lua VM from the authored scene. Pause freezes runtime updates and audio. Stop discards the runtime copy and returns to the authored scene; changes made during Play do not silently overwrite it. Property fields remain editable; press Enter to apply a typed value.

The time bar below playback shows elapsed simulation seconds. **Step** advances one 1/60-second frame and stays paused; from Edit it first creates a paused runtime copy. The **×** field and its `+`/`-` buttons set the engine time scale from 0.1× to 8× without starting playback. Camera and UI input never advance simulation time.

The game viewport fits a 1280 × 800 scene without stretching its aspect ratio. **Inspector** toggles the property panel; smaller windows hide it by default, and narrow windows show either the viewport or the inspector so controls remain usable.

Drag the **Inspector** header to the left or right edge of the workspace and release on the highlighted docking area. The arrow beside the title also moves the inspector to the opposite side. Escape, losing pointer capture, or dropping outside either edge cancels a move. The chosen side stays in place for the current session, including hiding/showing the panel and Play/Pause/Stop. The viewport and its playback toolbar fit the remaining space automatically.

Drag the divider between the inspector and viewport to resize either side. The cursor changes to a horizontal resize arrow. The inspector keeps at least 240 pixels and leaves at least 360 pixels for the viewport. Escape or losing pointer capture restores the previous width. The chosen width stays for the current session across docking, hiding/showing, playback changes, and window resizing; small windows temporarily fit it to the available space. With the divider focused, Left/Right adjust it by 10 pixels (Shift: 40); Home restores the default width.

Edit the Lua file in your source editor and save it. GameEngine checks for changes every 250 ms. A valid reload keeps declared runtime state and properties changed in the inspector. Unedited properties adopt the new defaults from the source. An invalid reload displays its error and retains the working project. **Reload** or Ctrl/Cmd+R retries immediately.

**Save** and **Load** persist script, camera, and registered scene-object properties to `<project.lua>.properties` (or `engine.properties` without a script). Object IDs must already exist; terrain and source assets are saved in their own authoring tools. Runtime fields can be explicitly saved and later loaded in Edit, but Stop itself never applies them. Property files use version 2; version 1 remains readable. The **Open** field changes the Lua project path.

In the browser, expand **Lua source** below the workspace to edit, upload, apply, or download a script. The source panel reserves its own space instead of covering the viewport. Rendering follows the available workspace size and display pixel density.

## C++ embedding

Build with `-Dtargets=engine -Dengine_mode=library`, or consume this repository as a Meson subproject:

```meson
hearthold = subproject('hearthold', default_options: ['targets=engine', 'engine_mode=library', 'tests=disabled'])
executable('my-application', 'main.cpp', dependencies: hearthold.get_variable('engine_dep'))
```

Include `<GameEngine/engine.h>` and call `engine::create(module, scriptPath)`. Pass an empty module to run a Lua project, or an empty script path to use only the C++ module. Initialize ThorVG and load UI fonts before creating the application. Your host forwards events, calls `render(width, height, seconds)`, and draws `scene()` through `ui::Renderer` or its own ThorVG canvas. The library links GameFramework and UI without SDL or game code.

Modules handle `command("runtime.playback", state)`, with `"stopped"`, `"playing"`, or `"paused"`. GameEngine sends stopped before the first render. Scene-aware modules render authored data in stopped mode, create a runtime copy on Play, preserve it across Pause/Resume, and restore the authored world on Stop. Paused simulation advances only after `command("runtime.step")`; audio stays silent for a manual step. Script errors suspend playback, and closing the engine sends stopped.

`sceneObjects()`, `sceneSelection()`, `selectSceneObject()`, `sceneProperties()`, and `sceneProperty()` expose object identity, type labels, numeric field metadata, and validated edits. `ui::metadata::field` binds numeric members (including nested transforms) to descriptors without duplicating getters/setters. Read-only statistics are displayed but never saved or written. This runtime metadata interface is compatible with C++23; C++26 reflection can generate the same descriptors later. Native module API version 2 requires rebuilding C++ modules with the new header. Legacy modules without scene metadata retain the previous reset/property protocol.

`command("scene.inspect", path)` exports a JSON snapshot of the scene's object types, field schemas, read-only values, and playback clock for tools. `command("scene-select", id)` selects an inspector object. Runtime inspector selection remains separate from the game's player selection.

## Lua module

```lua
return {
    title = "My project",
    properties = {
        { id = "speed", label = "Speed", value = 1, minimum = 0, maximum = 5, step = 0.25 },
    },
    state = { distance = 0 },
    update = function(state, dt, properties)
        state.distance = state.distance + dt * properties.speed
    end,
    draw = function(ui, state, view, properties)
        ui.rect { x = state.distance % view.width, y = 80, width = 30, height = 30, color = "accent" }
        ui.label { x = 20, y = 20, width = 300, height = 30, text = "Live Lua project" }
        ui.number { id = "speed", x = 20, y = 150, width = 240, height = 32 }
        if ui.button { id = "reset-distance", x = 20, y = 200, width = 160, height = 32, text = "Reset distance" } then
            state.distance = 0
        end
    end,
}
```

`draw` is required and should be pure; `update` is optional and runs only during Play or an explicit Step. Edit and paused previews use cached, isolated VM forks, rebuilt on property/source/viewport/time changes. Drawing a preview does not mutate the authored or running VM. Play forks authored state; Stop discards it. `view` contains `width`, `height`, and elapsed simulation `time`. Coordinates are relative to the preview. State is a table of named booleans, finite numbers, or strings. Up to 64 numeric properties and 256 state values are supported.

The UI functions take one specification table:

- `rect`: `x`, `y`, `width`, `height`, `color`, optional `radius`.
- `label`: bounds, `text`, optional `color`, `size`, and `bold`.
- `button`: bounds, unique `id`, `text`, optional `enabled` and `command`. Returns true on the render after activation. `command` routes to the host application.
- `number`: bounds and `id` naming a numeric project property. Renders decrement/increment controls and returns the current value.

Colors accept `#RRGGBB`, `#RRGGBBAA`, or theme tokens: `background`, `surface`, `raised`, `border`, `text`, `muted`, `accent`, `accentText`, `success`, `danger`.

Lua base, math, string, table, and UTF-8 libraries are available. File/system access, dynamic loading, and protected calls are excluded. Project files are limited to 1 MiB; script execution has instruction and memory limits so a broken loop reports an error instead of freezing GameEngine.
