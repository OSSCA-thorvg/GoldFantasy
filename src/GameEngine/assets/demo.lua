-- A standalone project. Save this file while playing to see changes immediately.
return {
    title = "Orbital garden",
    properties = {
        { id = "speed", label = "Orbit speed", value = 0.65, minimum = 0, maximum = 3, step = 0.1 },
        { id = "radius", label = "Orbit radius", value = 130, minimum = 40, maximum = 240, step = 10 },
        { id = "count", label = "Satellites", value = 6, minimum = 1, maximum = 12, step = 1 },
        { id = "size", label = "Satellite size", value = 24, minimum = 8, maximum = 60, step = 2 },
    },
    state = { angle = 0, energy = 0 },
    update = function(state, dt, properties)
        state.angle = state.angle + dt * properties.speed
    end,
    draw = function(ui, state, view, properties)
        local compact = view.width < 500
        ui.rect { x = 0, y = 0, width = view.width, height = view.height, color = "background", radius = 8 }
        ui.label { x = 24, y = 20, width = view.width - 48, height = 30, text = "ORBITAL GARDEN", size = 19, bold = true }
        ui.label { x = 24, y = 54, width = view.width - 48, height = 26,
                   text = compact and "A live Lua scene." or "A Lua scene running without a C++ game module.", color = "muted" }
        local cx, cy = view.width / 2, view.height / 2 + 10
        local radius = math.min(properties.radius, math.max(12, math.min(view.width, view.height) / 2 - 75))
        for i = 1, math.floor(properties.count) do
            local angle = state.angle + (i - 1) * math.pi * 2 / properties.count
            local x, y = cx + math.cos(angle) * radius, cy + math.sin(angle) * radius * 0.65
            local size = properties.size
            ui.rect { x = x - size / 2, y = y - size / 2, width = size, height = size, radius = size / 2,
                      color = i % 2 == 0 and "accent" or "success" }
        end
        ui.rect { x = cx - 36, y = cy - 36, width = 72, height = 72, radius = 36, color = "raised" }
        ui.label { x = cx - 22, y = cy - 16, width = 60, height = 30, text = tostring(state.energy), size = 24, bold = true }
        if ui.button { id = "energy", x = 24, y = view.height - 66, width = 164, height = 34, text = "Collect energy +1" } then
            state.energy = state.energy + 1
        end
        if not compact then
            ui.label { x = 204, y = view.height - 66, width = view.width - 228, height = 34,
                       text = "Play, pause, and edit live properties.", color = "muted", size = 12 }
        end
    end,
}
