-- Rcheevo Bridge backend for Millennium (Windows desktop).
-- Mirrors the subset of main.py that the RetroAchievements native-achievement view needs.
-- Every method takes one JSON string argument ("payload") and returns a JSON string;
-- failures are returned as {"__error": {...}} and rethrown by the frontend bridge.
local fs = require("fs")
local http = require("http")
local json = require("json")
local logger = require("logger")
local millennium = require("millennium")
local utils = require("utils")

-- A failing module must not keep Millennium waiting for millennium.ready(); RPCs report it instead.
local storage, shortcuts, rom_hash
local modules_loaded, modules_error = pcall(function()
  storage = require("ac_storage")
  shortcuts = require("ac_shortcuts")
  rom_hash = require("ac_rom_hash")
end)

local PLUGIN_VERSION = "0.1.0"
local REQUEST_TIMEOUT_SECONDS = 20
local SLOW_REQUEST_LOG_THRESHOLD_MS = 2000
-- Disk cache TTLs for endpoints whose answers carry no data about the signed-in account. The
-- catalogue spares the multi-megabyte hash list (API_GetGameList with h=1) on every Steam start;
-- community stats and other players' profiles are most of a game page's requests.
local HOUR = 60 * 60
local RA_DISK_CACHE_TTL_SECONDS = {
  ["API_GetConsoleIDs.php"] = 24 * HOUR,
  ["API_GetGameList.php"] = 24 * HOUR,
  ["API_GetAchievementDistribution.php"] = 6 * HOUR,
  ["API_GetGameProgression.php"] = 6 * HOUR,
  ["API_GetGameRankAndScore.php"] = 6 * HOUR,
  -- Only other players' profiles (latest masters' avatars); see disk_cache_ttl.
  ["API_GetUserProfile.php"] = 7 * 24 * HOUR,
}
local CURL_PATH = (utils.getenv("SystemRoot") or "C:\\Windows") .. "\\System32\\curl.exe"
local CURL_PARALLEL_MAX = 8
local USER_AGENT = "Rcheevo Bridge (Millennium plugin)"
local RA_BASE_URL = "https://retroachievements.org/API/"
local RA_API_PATHS = {
  ["API_GetUserProfile.php"] = true,
  ["API_GetUserSummary.php"] = true,
  ["API_GetConsoleIDs.php"] = true,
  ["API_GetGameList.php"] = true,
  ["API_GetGameExtended.php"] = true,
  ["API_GetUserProgress.php"] = true,
  ["API_GetUserCompletionProgress.php"] = true,
  ["API_GetAchievementsEarnedBetween.php"] = true,
  ["API_GetUserRecentAchievements.php"] = true,
  ["API_GetUserRecentlyPlayedGames.php"] = true,
  ["API_GetGameInfoAndUserProgress.php"] = true,
  ["API_GetAchievementDistribution.php"] = true,
  ["API_GetGameProgression.php"] = true,
  ["API_GetGameRankAndScore.php"] = true,
}

local ProviderError = {}
ProviderError.__index = ProviderError

local function provider_error(category, message, status_code)
  return setmetatable({ category = category, message = message, statusCode = status_code }, ProviderError)
end

local function decode_payload(payload)
  if type(payload) ~= "string" or payload == "" then return {} end
  local ok, value = pcall(json.decode, payload)
  if ok and type(value) == "table" then return value end
  return {}
end

local function is_null(value)
  return value == nil or value == json.null
end

-- Runs one RPC method and converts its result (or failure) to the JSON string Millennium returns.
local function rpc(name, handler)
  _G[name] = function(payload)
    if not modules_loaded then
      return json.encode({ __error = { message = "Backend modules failed to load: " .. tostring(modules_error) } })
    end
    local ok, result = pcall(handler, decode_payload(payload))
    if ok then
      if result == nil then return "null" end
      if type(result) == "string" then return result end
      return json.encode(result)
    end
    if getmetatable(result) == ProviderError then
      return json.encode({ __error = { category = result.category, message = result.message, statusCode = result.statusCode } })
    end
    logger:error(name .. " failed: " .. tostring(result))
    return json.encode({ __error = { message = tostring(result) } })
  end
end

local function build_query(query, auth_query)
  local parts = {}
  local function add(source)
    if type(source) ~= "table" then return end
    for key, value in pairs(source) do
      if not is_null(value) then
        table.insert(parts, utils.url_encode(tostring(key)) .. "=" .. utils.url_encode(tostring(value)))
      end
    end
  end
  add(query)
  add(auth_query)
  -- Stable order, so the same request always maps to the same disk cache entry.
  table.sort(parts)
  return table.concat(parts, "&")
end

local function build_url(path, query, auth_query)
  local query_text = build_query(query, auth_query)
  return RA_BASE_URL .. path .. (query_text ~= "" and ("?" .. query_text) or "")
end

-- Turns one HTTP outcome into the raw JSON body, or a handledHttpError object for the given
-- statuses (as main.py does). status 0 means no response.
local function interpret_response(label, path, status, body, duration_ms, handled_statuses, retry_after)
  if status == 0 then
    logger:warn(label .. " request failed: network error (" .. path .. ")")
    error(provider_error("network_error", label .. " request failed due to a network error.", nil))
  end
  if status < 200 or status >= 300 then
    if handled_statuses[status] then
      local trimmed = (body or ""):match("^%s*(.-)%s*$")
      return {
        handledHttpError = true,
        status = status,
        statusText = "",
        message = trimmed ~= "" and trimmed or ("HTTP " .. status),
        durationMs = duration_ms,
        retryAfterMs = retry_after and math.max(0, math.floor(retry_after * 1000)) or nil,
      }
    end
    logger:warn(label .. " request failed: HTTP " .. status .. " (" .. path .. ")")
    error(provider_error("http_error", label .. " request failed with HTTP " .. status .. ".", status))
  end
  body = body or ""
  if body:match("^%s*$") then return nil end
  if not pcall(json.decode, body) then
    error(provider_error("invalid_json", label .. " returned invalid JSON.", nil))
  end
  return body
end

local function request_json(label, path, query, auth_query, handled_statuses)
  local started = utils.time_ms()
  local response = http.get(build_url(path, query, auth_query), {
    headers = { Accept = "application/json" },
    user_agent = USER_AGENT,
    timeout = REQUEST_TIMEOUT_SECONDS,
    -- An authenticated request must not be replayed against another URL.
    follow_redirects = false,
  })
  local duration_ms = utils.time_ms() - started
  if duration_ms >= SLOW_REQUEST_LOG_THRESHOLD_MS then
    logger:info(string.format("Slow %s request: %s took %d ms", label, path, duration_ms))
  end
  if response == nil then return interpret_response(label, path, 0, nil, duration_ms, handled_statuses) end
  local headers = response.headers or {}
  local retry_after = tonumber(headers["Retry-After"] or headers["retry-after"] or "")
  return interpret_response(label, path, response.status, response.body, duration_ms, handled_statuses, retry_after)
end

-- Millennium's Lua http module is synchronous, so a page's independent requests would queue up
-- one after another. curl.exe (bundled with Windows 10 1803+) fetches them concurrently instead.
-- URLs carry the API key, so they go through a config file that is deleted right after the run
-- rather than onto the command line, which other processes can read.
-- Returns { {status, body}, ... } aligned with urls, or nil when curl is unavailable.
local function curl_parallel(urls)
  if not fs.is_file(CURL_PATH) then return nil end
  local dir = storage.temp_dir()
  local id = utils.uuid()
  local config_path = fs.join(dir, id .. ".curlrc")
  local output_paths = {}
  local lines = {
    "silent",
    "max-time = " .. REQUEST_TIMEOUT_SECONDS,
    'user-agent = "' .. USER_AGENT .. '"',
    'header = "Accept: application/json"',
    'write-out = "%{urlnum} %{http_code}\\n"',
  }
  for index, url in ipairs(urls) do
    -- Query values are percent-encoded, so a URL holds no quote or backslash to escape.
    output_paths[index] = (fs.join(dir, id .. "-" .. index .. ".json"):gsub("\\", "/"))
    table.insert(lines, 'url = "' .. url .. '"')
    table.insert(lines, 'output = "' .. output_paths[index] .. '"')
  end
  if not utils.write_file(config_path, table.concat(lines, "\n") .. "\n") then return nil end
  -- cmd.exe strips the outer pair of quotes, so the whole command is wrapped once more.
  local output = utils.exec(string.format('""%s" --parallel --parallel-max %d --config "%s""',
    CURL_PATH, CURL_PARALLEL_MAX, config_path))
  fs.remove(config_path)

  local statuses = {}
  for line in (output or ""):gmatch("[^\r\n]+") do
    local urlnum, code = line:match("^(%d+)%s+(%d+)$")
    if urlnum ~= nil then statuses[tonumber(urlnum) + 1] = tonumber(code) end
  end
  local results = {}
  for index, output_path in ipairs(output_paths) do
    local body = fs.is_file(output_path) and utils.read_file(output_path) or nil
    fs.remove(output_path)
    results[index] = { status = statuses[index] or 0, body = body }
  end
  if next(statuses) == nil then return nil end
  return results
end

local RA_HANDLED_STATUSES = { [401] = true, [403] = true, [404] = true, [429] = true }

local function disk_cache_ttl(path, query, config)
  local ttl = RA_DISK_CACHE_TTL_SECONDS[path]
  if ttl ~= nil and path == "API_GetUserProfile.php" then
    -- The signed-in user's own profile is account data and is never cached.
    local target = type(query) == "table" and query.u or nil
    if is_null(target) or tostring(target):lower() == config.username:lower() then return nil end
  end
  return ttl
end

-- Validates one frontend request and resolves its auth and cache entry.
local function prepare_ra_request(request, config, secret)
  local path = storage.coerce_string(request.path)
  if path == nil then error("RetroAchievements request requires a path.") end
  if not RA_API_PATHS[path] then error("RetroAchievements request requires an allowed API endpoint.") end
  local query = type(request.query) == "table" and request.query or nil
  local ttl = disk_cache_ttl(path, query, config)
  return {
    path = path,
    query = query,
    auth = path == "API_GetUserProfile.php" and { y = secret } or { u = config.username, y = secret },
    ttl = ttl,
    cache_key = ttl ~= nil and (path .. "?" .. build_query(query, nil)) or nil,
  }
end

local function read_ra_cache(prepared)
  if prepared.cache_key == nil then return nil end
  -- The disk cache is best effort; any failure falls back to the network request.
  local ok, cached = pcall(storage.read_cache, prepared.cache_key, prepared.ttl)
  return ok and cached or nil
end

local function write_ra_cache(prepared, result)
  if prepared.cache_key == nil or type(result) ~= "string" then return end
  local ok, err = pcall(storage.write_cache, prepared.cache_key, result)
  if not ok then logger:warn("RetroAchievements cache write failed: " .. tostring(err)) end
end

local function retroachievements_credentials()
  local config = storage.retroachievements_config_view()
  if config == nil or config.hasApiKey ~= true then error("RetroAchievements credentials are missing.") end
  return config, storage.load_api_key("retroAchievements")
end

local function resolve_api_key(payload, provider_key)
  return storage.coerce_string(payload.apiKey)
    or storage.coerce_string(payload.apiKeyDraft)
    or storage.load_api_key(provider_key)
end

local function app_id_text(value)
  if type(value) == "number" then return string.format("%d", value) end
  return storage.coerce_string(value)
end

rpc("get_plugin_version", function()
  return json.encode(PLUGIN_VERSION)
end)

rpc("get_provider_configs", function()
  return { version = 1, retroAchievements = storage.retroachievements_config_view() }
end)

rpc("record_diagnostic_event", function(payload)
  if type(payload.message) == "string" then logger:info(payload.message) end
  return true
end)

rpc("save_retroachievements_credentials", function(payload)
  local username = storage.coerce_string(payload.username)
  if username == nil then return nil end
  local api_key = resolve_api_key(payload, "retroAchievements")
  if api_key == nil then return nil end
  local existing = storage.load_provider_config("retroAchievements") or {}
  local config = {
    username = username,
    hasApiKey = true,
    recentAchievementsCount = storage.optional_positive_count(payload.recentAchievementsCount)
      or storage.optional_positive_count(existing.recentAchievementsCount),
    recentlyPlayedCount = storage.optional_positive_count(payload.recentlyPlayedCount)
      or storage.optional_positive_count(existing.recentlyPlayedCount),
  }
  storage.save_api_key("retroAchievements", api_key)
  storage.save_provider_config("retroAchievements", config)
  logger:info("Saved RetroAchievements credentials")
  return config
end)

rpc("clear_provider_credentials", function(payload)
  if storage.coerce_string(payload.providerId) ~= "retroachievements" then return false end
  local removed = storage.load_provider_config("retroAchievements") ~= nil or storage.load_api_key("retroAchievements") ~= nil
  storage.clear_provider_config("retroAchievements")
  storage.clear_api_key("retroAchievements")
  if removed then logger:info("Cleared RetroAchievements credentials") end
  return removed
end)

rpc("request_retroachievements_json", function(payload)
  local config, secret = retroachievements_credentials()
  local prepared = prepare_ra_request(payload, config, secret)
  local cached = read_ra_cache(prepared)
  if cached ~= nil then return cached end
  local result = request_json("RetroAchievements", prepared.path, prepared.query, prepared.auth, RA_HANDLED_STATUSES)
  write_ra_cache(prepared, result)
  return result
end)

-- Several request_retroachievements_json calls in one round trip, fetched concurrently.
-- Each entry of the answer is {"body": "<raw JSON>"}, {"value": <handledHttpError>} or
-- {"error": {...}}, so one failing request does not fail its siblings.
rpc("request_retroachievements_json_batch", function(payload)
  local config, secret = retroachievements_credentials()
  local requests = type(payload.requests) == "table" and payload.requests or {}
  local results, pending = {}, {}

  local function fail(index, err)
    if getmetatable(err) == ProviderError then
      results[index] = { error = { category = err.category, message = err.message, statusCode = err.statusCode } }
    else
      results[index] = { error = { message = tostring(err) } }
    end
  end
  local function settle(index, ok, value)
    if not ok then return fail(index, value) end
    if type(value) == "table" then results[index] = { value = value } else results[index] = { body = value } end
  end

  for index, request in ipairs(requests) do
    local ok, prepared = pcall(prepare_ra_request, request, config, secret)
    if not ok then
      fail(index, prepared)
    else
      local cached = read_ra_cache(prepared)
      if cached ~= nil then
        results[index] = { body = cached }
      else
        table.insert(pending, { index = index, prepared = prepared })
      end
    end
  end

  local fetched = nil
  if #pending > 1 then
    local urls = {}
    for i, item in ipairs(pending) do urls[i] = build_url(item.prepared.path, item.prepared.query, item.prepared.auth) end
    local started = utils.time_ms()
    fetched = curl_parallel(urls)
    local duration_ms = utils.time_ms() - started
    if fetched ~= nil and duration_ms >= SLOW_REQUEST_LOG_THRESHOLD_MS then
      logger:info(string.format("Slow RetroAchievements batch: %d requests took %d ms", #pending, duration_ms))
    end
  end
  for i, item in ipairs(pending) do
    local prepared = item.prepared
    local ok, value
    if fetched ~= nil then
      ok, value = pcall(interpret_response, "RetroAchievements", prepared.path, fetched[i].status, fetched[i].body, 0, RA_HANDLED_STATUSES)
    else
      ok, value = pcall(request_json, "RetroAchievements", prepared.path, prepared.query, prepared.auth, RA_HANDLED_STATUSES)
    end
    if ok then write_ra_cache(prepared, value) end
    settle(item.index, ok, value)
  end

  -- Encoded here so the answer stays a JSON array even when every entry is empty.
  if #requests == 0 then return "[]" end
  return json.encode(results)
end)

rpc("validate_retroachievements_credentials", function(payload)
  local username = storage.coerce_string(payload.username)
  local api_key = storage.coerce_string(payload.apiKey)
  if username == nil or api_key == nil then return { ok = false, failure = { category = "authentication" } } end
  local ok, response = pcall(request_json, "RetroAchievements", "API_GetUserProfile.php", nil,
    { u = username, y = api_key }, { [400] = true, [401] = true, [403] = true, [404] = true, [429] = true })
  if not ok then
    if getmetatable(response) == ProviderError then
      return { ok = false, failure = { category = response.category, statusCode = response.statusCode } }
    end
    error(response)
  end
  if type(response) == "table" and response.handledHttpError then
    return { ok = false, failure = { category = "http", statusCode = response.status } }
  end
  -- RetroAchievements can return a JSON error object for an unknown user without an HTTP error.
  local decoded = type(response) == "string" and json.decode(response) or nil
  if type(decoded) == "table" and (decoded.Error or decoded.error or decoded.ErrorCode or decoded.errorCode) then
    return { ok = false, failure = { category = "authentication" } }
  end
  return { ok = true }
end)

rpc("list_steam_shortcut_app_ids", function()
  -- Encoded here so an empty list stays a JSON array rather than {}.
  local app_ids = shortcuts.list_app_ids()
  if #app_ids == 0 then return "[]" end
  return json.encode(app_ids)
end)

rpc("get_steam_shortcut_metadata", function(payload)
  local app_id = app_id_text(payload.appId)
  if app_id == nil then return nil end
  return shortcuts.load_metadata(app_id)
end)

rpc("get_steam_shortcut_rom_hash", function(payload)
  local app_id = app_id_text(payload.appId)
  if app_id == nil then return nil end
  return rom_hash.load(app_id, payload.consoleId)
end)

local function on_load()
  if modules_loaded then
    logger:info("Rcheevo Bridge backend loaded")
  else
    logger:error("Rcheevo Bridge backend modules failed to load: " .. tostring(modules_error))
  end
  millennium.ready()
end

local function on_unload()
  logger:info("Rcheevo Bridge backend unloaded")
end

return {
  on_load = on_load,
  on_unload = on_unload,
}
