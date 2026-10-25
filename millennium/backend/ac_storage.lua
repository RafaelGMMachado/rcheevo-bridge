-- Provider config and API key storage (port of backend/provider_config.py and backend/secrets.py).
-- The Python backend obfuscates keys with PBKDF2/HMAC; Millennium's Lua runtime has no crypto
-- primitives, so the Windows build keeps the key in a separate file under the user's profile.
local fs = require("fs")
local json = require("json")
local utils = require("utils")

local M = {}

local CONFIG_VERSION = 1
local SECRET_VERSION = 1
local SENSITIVE_KEYS = {
  apikey = true, apikeydraft = true, key = true, y = true, token = true,
  password = true, secret = true, authorization = true,
}

local function settings_dir()
  local base = utils.getenv("APPDATA") or utils.getenv("LOCALAPPDATA") or fs.parent_path(utils.get_backend_path() or ".")
  local dir = fs.join(base, "achievement-companion")
  if not fs.exists(dir) then fs.create_directories(dir) end
  return dir
end

local function config_path() return fs.join(settings_dir(), "provider-config.json") end
local function secrets_path() return fs.join(settings_dir(), "provider-secrets.json") end

local function read_json(path)
  if not fs.exists(path) then return {} end
  local text = utils.read_file(path)
  if text == nil or text == "" then return {} end
  local ok, value = pcall(json.decode, text)
  if ok and type(value) == "table" then return value end
  return {}
end

local function write_json(path, value)
  local tmp = path .. ".tmp"
  local ok, err = utils.write_file(tmp, json.encode(value))
  if not ok then error("Unable to write " .. path .. ": " .. tostring(err)) end
  fs.remove(path)
  fs.rename(tmp, path)
end

local function count_keys(store)
  local n = 0
  for _ in pairs(store) do n = n + 1 end
  return n
end

function M.coerce_string(value)
  if type(value) ~= "string" then return nil end
  local trimmed = value:match("^%s*(.-)%s*$")
  if trimmed == "" then return nil end
  return trimmed
end

function M.optional_positive_count(value)
  if type(value) == "number" and value > 0 then return math.floor(value) end
  return nil
end

local function load_store(path, version)
  local store = read_json(path)
  if store.version ~= version then return { version = version } end
  return store
end

local function clear_entry(path, version, key)
  local store = load_store(path, version)
  if store[key] == nil then return end
  store[key] = nil
  if count_keys(store) <= 1 then
    fs.remove(path)
  else
    write_json(path, store)
  end
end

function M.load_provider_config(provider_key)
  local value = load_store(config_path(), CONFIG_VERSION)[provider_key]
  if type(value) == "table" then return value end
  return nil
end

function M.save_provider_config(provider_key, config)
  local store = load_store(config_path(), CONFIG_VERSION)
  local sanitized = {}
  for key, value in pairs(config) do
    if type(key) == "string" and not SENSITIVE_KEYS[key:lower()] then sanitized[key] = value end
  end
  store.version = CONFIG_VERSION
  store[provider_key] = sanitized
  write_json(config_path(), store)
end

function M.clear_provider_config(provider_key)
  clear_entry(config_path(), CONFIG_VERSION, provider_key)
end

function M.load_api_key(provider_key)
  local entry = load_store(secrets_path(), SECRET_VERSION)[provider_key]
  if type(entry) ~= "table" then return nil end
  return M.coerce_string(entry.apiKey)
end

function M.save_api_key(provider_key, api_key)
  local store = load_store(secrets_path(), SECRET_VERSION)
  store.version = SECRET_VERSION
  store[provider_key] = { apiKey = api_key }
  write_json(secrets_path(), store)
end

function M.clear_api_key(provider_key)
  clear_entry(secrets_path(), SECRET_VERSION, provider_key)
end

function M.retroachievements_config_view()
  local stored = M.load_provider_config("retroAchievements")
  if stored == nil then return nil end
  local username = M.coerce_string(stored.username)
  if username == nil then return nil end
  local view = { username = username, hasApiKey = M.load_api_key("retroAchievements") ~= nil }
  view.recentAchievementsCount = M.optional_positive_count(stored.recentAchievementsCount)
  view.recentlyPlayedCount = M.optional_positive_count(stored.recentlyPlayedCount)
  return view
end

-- Scratch directory for curl batch files; callers delete what they create.
function M.temp_dir()
  local dir = fs.join(settings_dir(), "tmp")
  if not fs.exists(dir) then fs.create_directories(dir) end
  return dir
end

-- Response cache for account-independent API responses. Each entry is "<unix seconds>\n<body>".
local function cache_path(key)
  local dir = fs.join(settings_dir(), "cache")
  if not fs.exists(dir) then fs.create_directories(dir) end
  return fs.join(dir, (key:gsub("[^%w%-]", "_")) .. ".json")
end

function M.read_cache(key, ttl_seconds)
  local path = cache_path(key)
  if not fs.is_file(path) then return nil end
  local text = utils.read_file(path)
  if text == nil then return nil end
  local newline = text:find("\n", 1, true)
  local stored_at = newline and tonumber(text:sub(1, newline - 1)) or nil
  if stored_at == nil or os.time() - stored_at > ttl_seconds then return nil end
  return text:sub(newline + 1)
end

function M.write_cache(key, body)
  local path = cache_path(key)
  local tmp = path .. ".tmp"
  if utils.write_file(tmp, tostring(os.time()) .. "\n" .. body) then
    fs.remove(path)
    fs.rename(tmp, path)
  end
end

return M
