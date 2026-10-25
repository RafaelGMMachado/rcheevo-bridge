-- RetroAchievements ROM hashing through the bundled rcheevos helper (port of backend/ra_hash.py).
local fs = require("fs")
local json = require("json")
local utils = require("utils")
local shortcuts = require("ac_shortcuts")

local M = {}

local MAX_ROM_CANDIDATES = 4
local CACHE_LIMIT = 256
-- A cue or playlist may reference other files whose changes cannot be detected from its own stat.
local UNCACHEABLE_EXTENSIONS = { [".cue"] = true, [".gdi"] = true, [".m3u"] = true }
local MEDIA_READERS = {
  direct = true, ["nintendo-disc"] = true, chd = true, rar = true, playlist = true,
  ["compressed-iso"] = true, archive = true,
}
local MEDIA_READER_STATUSES = {
  ready = true, direct = true, invalid = true, unreadable = true, ["read-failed"] = true,
  ["not-implemented"] = true,
}

local cache, cache_order = {}, {}

local function helper_path()
  return fs.join(fs.parent_path(utils.get_backend_path() or "."), "bin", "ac-rhash.exe")
end

local function valid_reason(value)
  return type(value) == "string" and #value <= 80 and value:match("^[a-z0-9-]+$") ~= nil
end

local function native_hash(path, console_id, reader_info)
  local helper = helper_path()
  if not fs.is_file(helper) then return "error", "native-helper-missing" end
  -- cmd.exe strips the outer pair of quotes, so the whole command is wrapped once more.
  local command = string.format('""%s" %d "%s""', helper, console_id, path)
  local output = utils.exec(command)
  if output == nil then return "error", "native-helper-execution-failed" end
  if #output > 4096 then return "error", "native-helper-malformed-response" end
  local ok, response = pcall(json.decode, output)
  if not ok or type(response) ~= "table" then return "error", "native-helper-malformed-response" end

  if MEDIA_READERS[response.mediaReader] then reader_info.mediaReader = response.mediaReader end
  if MEDIA_READER_STATUSES[response.mediaReaderStatus] then reader_info.mediaReaderStatus = response.mediaReaderStatus end

  if response.status == "resolved" then
    local hash = response.hash
    if type(hash) == "string" and hash:match("^[0-9a-f]+$") and #hash == 32
      and response.consoleId == console_id and response.method == "rcheevos" then
      return "resolved", hash
    end
    return "error", "native-helper-malformed-response"
  end
  if response.status == "unavailable" and valid_reason(response.reason) then return "skipped", response.reason end
  if response.status == "error" and valid_reason(response.reason) then return "error", response.reason end
  return "error", "native-helper-malformed-response"
end

local function remember(key, value)
  if cache[key] == nil then
    table.insert(cache_order, key)
    if #cache_order > CACHE_LIMIT then cache[table.remove(cache_order, 1)] = nil end
  end
  cache[key] = value
end

function M.load(app_id, console_id)
  if type(console_id) ~= "number" or console_id ~= math.floor(console_id) or console_id < 1 or console_id > 65535 then
    return nil
  end
  local discovery = shortcuts.load_rom_path(app_id)
  if discovery == nil then return nil end

  local candidates = discovery.romCandidates
  local base = {
    appId = discovery.appId,
    shortcutRomPathDetected = discovery.shortcutRomPathDetected,
    shortcutRomPathSource = discovery.shortcutRomPathSource,
    candidateCount = discovery.candidateCount,
    candidateRejections = discovery.candidateRejections,
  }
  local function with(fields)
    local result = {}
    for key, value in pairs(base) do result[key] = value end
    for key, value in pairs(fields) do result[key] = value end
    return result
  end

  if #candidates == 0 then
    return with({
      romHashAttempted = false, romHashStatus = "skipped",
      hashResolverSkippedReason = discovery.reason or "rom-path-unavailable",
    })
  end
  if #candidates > MAX_ROM_CANDIDATES then
    return with({
      romHashAttempted = false, romHashStatus = "ambiguous",
      hashResolverSkippedReason = "too-many-game-path-candidates",
    })
  end

  local results, resolved, resolved_count, first_resolved, attempted = {}, {}, 0, nil, false
  for _, candidate in ipairs(candidates) do
    local path, ext = candidate.path, candidate.extension
    local reader_info = {}
    local status, value
    local size = fs.file_size(path)
    if size == nil then
      status, value = "skipped", "rom-file-unreadable"
    elseif ext == ".zip" and console_id ~= 26 and console_id ~= 27 then
      -- The Python backend extracts the single ROM from a ZIP before hashing; Lua has no zlib.
      status, value = "skipped", "archive-unsupported-on-windows"
    else
      local key = table.concat({ path:lower(), tostring(size), tostring(fs.last_write_time(path)), tostring(console_id) }, "|")
      local cached = not UNCACHEABLE_EXTENSIONS[ext] and cache[key] or nil
      if cached ~= nil then
        status, value = "resolved", cached.hash
        reader_info.mediaReader, reader_info.mediaReaderStatus = cached.mediaReader, cached.mediaReaderStatus
      else
        attempted = true
        status, value = native_hash(path, console_id, reader_info)
        if status == "resolved" and not UNCACHEABLE_EXTENSIONS[ext] then
          remember(key, { hash = value, mediaReader = reader_info.mediaReader, mediaReaderStatus = reader_info.mediaReaderStatus })
        end
      end
    end

    local result = { source = candidate.source, extension = ext, status = status,
      mediaReader = reader_info.mediaReader, mediaReaderStatus = reader_info.mediaReaderStatus }
    if status == "resolved" then
      if resolved[value] == nil then
        resolved[value] = result
        resolved_count = resolved_count + 1
        first_resolved = first_resolved or value
      end
    else
      result.reason = value or "rom-hash-unavailable"
    end
    table.insert(results, result)
  end

  base.romHashAttempted = attempted
  base.candidateResults = results
  if resolved_count > 1 then
    return with({
      candidateExtension = results[1].extension, romHashStatus = "ambiguous",
      hashResolverSkippedReason = "ambiguous-rom-hash-candidates",
    })
  end
  if resolved_count == 1 then
    local selected = resolved[first_resolved]
    return with({
      shortcutRomPathSource = selected.source, candidateExtension = selected.extension,
      romHashStatus = "resolved", romHashAlgorithm = "rcheevos", romHash = first_resolved,
    })
  end
  local preferred = results[1]
  for _, result in ipairs(results) do
    if result.status == "error" then
      preferred = result
      break
    end
  end
  return with({
    romHashStatus = preferred.status == "error" and "error" or "skipped",
    candidateExtension = preferred.extension,
    shortcutRomPathSource = preferred.source,
    hashResolverSkippedReason = preferred.reason,
  })
end

return M
