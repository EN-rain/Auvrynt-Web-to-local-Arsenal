local M = {}
local handlers = {}

for _, module_name in ipairs({ "live_drawing", "live_structure", "live_palette_template", "live_selection", "live_animation", "live_analysis", "live_document", "live_effects" }) do
  local module = require(module_name)
  for name, handler in pairs(module.handlers) do handlers[name] = handler end
end

function M.run(sprite, request)
  local command = request.liveCommand
  if type(command) ~= "string" or command == "" then error("liveCommand is required", 0) end
  local handler = handlers[command]
  if not handler then error("Unsupported live command: " .. command, 0) end
  return handler(sprite, request.arguments or {})
end

function M.names()
  local result = {}
  for name in pairs(handlers) do result[#result+1] = name end
  table.sort(result)
  return result
end

return M
