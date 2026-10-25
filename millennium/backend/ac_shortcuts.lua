-- Steam shortcut discovery (port of backend/steam_shortcuts.py for Windows paths).
local fs = require("fs")
local utils = require("utils")

local M = {}

local VDF_MAP, VDF_STRING, VDF_INTEGER, VDF_END = 0x00, 0x01, 0x02, 0x08
local MAX_COMMAND_TOKENS = 64
local MAX_REJECTION_DIAGNOSTICS = 8

local function set_of(list)
  local set = {}
  for _, value in ipairs(list) do set[value] = true end
  return set
end

-- Discovery hints only. This is not a list of formats supported by rcheevos.
M.GAME_PATH_HINT_EXTENSIONS = set_of({
  ".bin", ".chd", ".ciso", ".cso", ".gb", ".gba", ".gbc", ".gen", ".gcm", ".gcz", ".gdi", ".gg",
  ".img", ".iso", ".md", ".nds", ".nes", ".n64", ".pbp", ".pce", ".sfc", ".smc", ".sms", ".cue",
  ".m3u", ".rvz", ".v64", ".wad", ".wia", ".wbfs", ".z64", ".zso", ".zip", ".7z", ".rar",
})
local NON_GAME_ARGUMENT_EXTENSIONS = set_of({
  ".appimage", ".bat", ".cfg", ".cmd", ".conf", ".desktop", ".dll", ".exe", ".ini", ".json",
  ".log", ".pdf", ".py", ".sh", ".so", ".txt", ".xml",
  -- Windows launcher scripts.
  ".ps1", ".vbs", ".lnk",
})

function M.extension(path)
  local ext = path:match("(%.[^.\\/]+)$")
  return ext and ext:lower() or ""
end

local function stem(path)
  local name = path:match("([^\\/]+)$") or path
  return (name:gsub("%.[^.]+$", "")):lower()
end

local function is_absolute(path)
  return path:match("^%a:[\\/]") ~= nil or path:match("^[\\/][\\/]") ~= nil
end

-- Binary VDF ----------------------------------------------------------------------------

local function read_c_string(data, offset)
  local terminator = data:find("\0", offset, true)
  if terminator == nil then error("Binary VDF string terminator is missing.") end
  return data:sub(offset, terminator - 1), terminator + 1
end

local function parse_map(data, offset)
  local result = {}
  while offset <= #data do
    local value_type = data:byte(offset)
    offset = offset + 1
    if value_type == VDF_END then return result, offset end
    local key
    key, offset = read_c_string(data, offset)
    if value_type == VDF_MAP then
      result[key], offset = parse_map(data, offset)
    elseif value_type == VDF_STRING then
      result[key], offset = read_c_string(data, offset)
    elseif value_type == VDF_INTEGER then
      if offset + 3 > #data then error("Binary VDF integer field is truncated.") end
      local b1, b2, b3, b4 = data:byte(offset, offset + 3)
      result[key] = b1 + b2 * 256 + b3 * 65536 + b4 * 16777216
      offset = offset + 4
    else
      error(string.format("Unsupported binary VDF field type: 0x%02x", value_type))
    end
  end
  error("Binary VDF map is missing its end marker.")
end

function M.parse_shortcuts_vdf(data)
  if #data == 0 or data:byte(1) ~= VDF_MAP then error("Steam shortcuts.vdf is missing the root shortcuts map.") end
  local root_key, offset = read_c_string(data, 2)
  if root_key ~= "shortcuts" then error("Steam shortcuts.vdf root key is not shortcuts.") end
  local shortcuts = parse_map(data, offset)
  local normalized = {}
  for key, value in pairs(shortcuts) do
    if type(value) == "table" then normalized[key] = value end
  end
  return normalized
end

-- Steam install discovery ----------------------------------------------------------------

local function steam_userdata_roots()
  local roots, seen = {}, {}
  local function add(path)
    if path ~= nil and not seen[path:lower()] and fs.is_directory(path) then
      seen[path:lower()] = true
      table.insert(roots, path)
    end
  end
  -- The plugin lives somewhere below the Steam install (…\Steam\millennium\plugins\<name>\backend).
  local dir = utils.get_backend_path()
  for _ = 1, 6 do
    if dir == nil or dir == "" then break end
    add(fs.join(dir, "userdata"))
    local parent = fs.parent_path(dir)
    if parent == dir then break end
    dir = parent
  end
  local program_files = utils.getenv("ProgramFiles(x86)") or "C:\\Program Files (x86)"
  add(fs.join(program_files, "Steam", "userdata"))
  return roots
end

local function shortcuts_files()
  local files = {}
  for _, root in ipairs(steam_userdata_roots()) do
    for _, entry in ipairs(fs.list(root) or {}) do
      if entry.is_directory then
        local path = fs.join(entry.path, "config", "shortcuts.vdf")
        if fs.is_file(path) then table.insert(files, path) end
      end
    end
  end
  return files
end

local function coerce_app_id(value)
  local number = tonumber(value)
  if number == nil or number <= 0 or number ~= math.floor(number) then return nil end
  return number
end

local function pick_string(shortcut, ...)
  for _, key in ipairs({ ... }) do
    local value = shortcut[key]
    if type(value) == "string" then
      local trimmed = value:match("^%s*(.-)%s*$")
      if trimmed ~= "" then return trimmed end
    end
  end
  return nil
end

local function shortcut_tags(shortcut)
  local tags_value = shortcut.tags
  if type(tags_value) ~= "table" then tags_value = shortcut.Tags end
  if type(tags_value) ~= "table" then return {} end
  local keys = {}
  for key in pairs(tags_value) do table.insert(keys, key) end
  table.sort(keys, function(a, b)
    local na, nb = tonumber(a), tonumber(b)
    if na and nb then return na < nb end
    if na or nb then return na ~= nil end
    return tostring(a) < tostring(b)
  end)
  local tags, seen = {}, {}
  for _, key in ipairs(keys) do
    local value = tags_value[key]
    if type(value) == "string" then
      local trimmed = value:match("^%s*(.-)%s*$")
      if trimmed ~= "" and not seen[trimmed] then
        seen[trimmed] = true
        table.insert(tags, trimmed)
      end
    end
  end
  return tags
end

local function matching_shortcuts(app_id)
  local normalized = coerce_app_id(app_id)
  if normalized == nil then return nil, {} end
  local matched = {}
  for _, path in ipairs(shortcuts_files()) do
    local data = utils.read_file(path)
    if data ~= nil then
      local ok, shortcuts = pcall(M.parse_shortcuts_vdf, data)
      if ok then
        for _, shortcut in pairs(shortcuts) do
          if shortcut.appid == normalized then table.insert(matched, shortcut) end
        end
      end
    end
  end
  return normalized, matched
end

function M.list_app_ids()
  local app_ids, seen = {}, {}
  for _, path in ipairs(shortcuts_files()) do
    local data = utils.read_file(path)
    if data ~= nil then
      local ok, shortcuts = pcall(M.parse_shortcuts_vdf, data)
      if ok then
        for _, shortcut in pairs(shortcuts) do
          local app_id = coerce_app_id(shortcut.appid)
          if app_id ~= nil and not seen[app_id] then
            seen[app_id] = true
            table.insert(app_ids, string.format("%d", app_id))
          end
        end
      end
    end
  end
  return app_ids
end

function M.load_metadata(app_id)
  local normalized, matched = matching_shortcuts(app_id)
  if normalized == nil or #matched == 0 then return nil end
  local metadata = { appId = string.format("%d", normalized) }
  local tags, seen = {}, {}
  for _, shortcut in ipairs(matched) do
    metadata.title = metadata.title or pick_string(shortcut, "appname", "AppName", "name", "Name")
    for _, tag in ipairs(shortcut_tags(shortcut)) do
      if not seen[tag] then
        seen[tag] = true
        table.insert(tags, tag)
      end
    end
    metadata.exe = metadata.exe or pick_string(shortcut, "exe", "Exe")
    metadata.startDir = metadata.startDir or pick_string(shortcut, "startdir", "StartDir")
  end
  if #tags > 0 then
    metadata.platformTag = tags[1]
    metadata.platformLabel = tags[1]
    metadata.tags = tags
  end
  return metadata
end

-- ROM path discovery ---------------------------------------------------------------------

-- Windows command lines: whitespace separates tokens, double quotes group, backslashes are literal.
local function split_command(text)
  local tokens, current, in_quotes, has_token = {}, {}, false, false
  for char in text:gmatch(".") do
    if char == '"' then
      in_quotes = not in_quotes
      has_token = true
    elseif char:match("%s") and not in_quotes then
      if has_token then table.insert(tokens, table.concat(current)) end
      current, has_token = {}, false
    else
      table.insert(current, char)
      has_token = true
    end
  end
  if has_token then table.insert(tokens, table.concat(current)) end
  -- EmuDeck for Windows wraps the launcher in cmd.exe/PowerShell and passes the ROM as a
  -- single-quoted PowerShell string inside a double-quoted -Command argument.
  local count = #tokens
  for index = 1, count do
    for quoted in tokens[index]:gmatch("'([^']+)'") do table.insert(tokens, quoted) end
  end
  return tokens
end

local function command_path_token(token)
  if token == "%command%" then return nil end
  if token:sub(1, 1) == "-" then
    -- --game=C:\path\file is a file argument; --core=C:\path\core.dll is rejected below.
    local equals = token:find("=", 1, true)
    token = equals and token:sub(equals + 1) or ""
  end
  if token == "" or token == "%command%" then return nil end
  return token
end

local function start_dir_path(shortcut)
  local value = pick_string(shortcut, "startdir", "StartDir")
  if value == nil then return nil end
  local first, last = value:sub(1, 1), value:sub(-1)
  if #value >= 2 and first == last and (first == '"' or first == "'") then value = value:sub(2, -2) end
  return value
end

local function mentions_bios(path)
  for part in path:gmatch("[^\\/]+") do
    local lowered = part:lower()
    if lowered == "bios" or lowered == "firmware" then return true end
  end
  local s = stem(path)
  return s == "bios" or s == "firmware"
end

local function candidates_from_command(text, source, start_dir)
  if text == nil then return {}, {}, false end
  local candidates, rejections, saw_missing_hint = {}, {}, false
  for index, raw in ipairs(split_command(text)) do
    if index > MAX_COMMAND_TOKENS then break end
    local token = command_path_token(raw)
    if token ~= nil then
      local candidate = token
      local usable = true
      if not is_absolute(candidate) then
        if start_dir == nil then usable = false else candidate = fs.join(start_dir, candidate) end
      end
      if usable then
        local ext = M.extension(candidate)
        if NON_GAME_ARGUMENT_EXTENSIONS[ext] or mentions_bios(candidate) then
          table.insert(rejections, { source = source, extension = ext, reason = "non-game-argument" })
        elseif fs.is_file(candidate) then
          table.insert(candidates, { path = fs.absolute(candidate) or candidate, source = source, extension = ext })
        elseif M.GAME_PATH_HINT_EXTENSIONS[ext] then
          saw_missing_hint = true
          table.insert(rejections, { source = source, extension = ext, reason = "file-unreadable" })
        end
      end
    end
  end
  return candidates, rejections, saw_missing_hint
end

function M.load_rom_path(app_id)
  local normalized, matched = matching_shortcuts(app_id)
  if normalized == nil or #matched == 0 then return nil end
  local shortcut = matched[1]
  local start_dir = start_dir_path(shortcut)
  local launch_candidates, launch_rejections, launch_missing = candidates_from_command(
    pick_string(shortcut, "LaunchOptions", "launchoptions", "launchOptions"), "launchoptions", start_dir)
  local exe_candidates, exe_rejections, exe_missing = candidates_from_command(
    pick_string(shortcut, "exe", "Exe"), "exe", start_dir)

  local candidates, seen = {}, {}
  for _, list in ipairs({ launch_candidates, exe_candidates }) do
    for _, candidate in ipairs(list) do
      local key = candidate.path:lower()
      if not seen[key] then
        seen[key] = true
        table.insert(candidates, candidate)
      end
    end
  end
  local rejections = {}
  for _, list in ipairs({ launch_rejections, exe_rejections }) do
    for _, rejection in ipairs(list) do
      if #rejections < MAX_REJECTION_DIAGNOSTICS then table.insert(rejections, rejection) end
    end
  end

  local result = {
    appId = string.format("%d", normalized),
    romCandidates = candidates,
    candidateCount = #candidates,
    candidateRejections = rejections,
  }
  if #candidates > 0 then
    result.shortcutRomPathDetected = true
    result.shortcutRomPathSource = candidates[1].source
  else
    result.shortcutRomPathDetected = launch_missing or exe_missing
    result.reason = result.shortcutRomPathDetected and "rom-file-unreadable" or "rom-path-unavailable"
    for _, rejection in ipairs(rejections) do
      if rejection.reason == "file-unreadable" then
        result.shortcutRomPathSource = rejection.source
        break
      end
    end
  end
  return result
end

return M
