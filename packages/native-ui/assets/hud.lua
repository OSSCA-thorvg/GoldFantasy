return {
    title = "Game controls",
    properties = {
        { id = "x", label = "Toolbar X", value = 16, minimum = 0, maximum = 1200, step = 8 },
        { id = "y", label = "Toolbar Y", value = 210, minimum = 0, maximum = 800, step = 8 }
    },
    draw = function(ui, state, view, p)
        ui.button { id = "pause", x = p.x, y = p.y, width = 90, height = 30, text = "Pause", command = "pause" }
        ui.button { id = "speed", x = p.x + 98, y = p.y, width = 90, height = 30, text = "Speed", command = "speed" }
    end
}
