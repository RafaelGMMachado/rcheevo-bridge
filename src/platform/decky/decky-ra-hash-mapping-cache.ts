import { readDeckyStorageText, removeDeckyStorageText, writeDeckyStorageText } from "./storage";

// Persistent ROM-hash → RetroAchievements game mapping. A hit lets a shortcut skip the
// API_GetGameList download (every hash for the console) that otherwise runs on each start.
// The key is console + ROM hash, so replacing a ROM changes the hash and misses on its own.
// v2: misses are checked against the unfiltered catalogue too; v1 misses predate that check.
const STORAGE_KEY = "achievement-companion:decky:ra-hash-mapping:v2";
const OBSOLETE_STORAGE_KEYS = ["achievement-companion:decky:ra-hash-mapping:v1"];
// A matched hash rarely moves to another game; revalidate it occasionally anyway.
const MATCHED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// RetroAchievements links new hashes to games and publishes achievement sets over time, so a
// miss or an empty game must not stick.
const SHORT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 2000;

export type RaHashMapping =
  | { readonly status: "matched"; readonly gameId: string; readonly title: string }
  /** The hash belongs to a RetroAchievements game that has no achievements yet. */
  | { readonly status: "no-achievements"; readonly gameId: string; readonly title: string }
  | { readonly status: "no-match" };

type StoredRaHashMapping = RaHashMapping & { readonly storedAt: number };

let entries: Map<string, StoredRaHashMapping> | undefined;

function mappingKey(consoleId: string, romHash: string): string {
  return `${consoleId}:${romHash.trim().toLowerCase()}`;
}

function isStoredMapping(value: unknown): value is StoredRaHashMapping {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record["storedAt"] !== "number") return false;
  if (record["status"] === "no-match") return true;
  return (record["status"] === "matched" || record["status"] === "no-achievements")
    && typeof record["gameId"] === "string" && typeof record["title"] === "string";
}

function loadEntries(): Map<string, StoredRaHashMapping> {
  if (entries !== undefined) return entries;
  entries = new Map();
  for (const key of OBSOLETE_STORAGE_KEYS) removeDeckyStorageText(key);
  const text = readDeckyStorageText(STORAGE_KEY);
  if (text === undefined) return entries;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (isStoredMapping(value)) entries.set(key, value);
      }
    }
  } catch {
    // A corrupt cache only costs a catalogue download.
  }
  return entries;
}

function persist(map: Map<string, StoredRaHashMapping>): void {
  writeDeckyStorageText(STORAGE_KEY, JSON.stringify(Object.fromEntries(map)));
}

export function readRaHashMapping(consoleId: string, romHash: string, now = Date.now()): RaHashMapping | undefined {
  const stored = loadEntries().get(mappingKey(consoleId, romHash));
  if (stored === undefined) return undefined;
  const ttl = stored.status === "matched" ? MATCHED_TTL_MS : SHORT_TTL_MS;
  if (now - stored.storedAt > ttl) return undefined;
  return stored.status === "no-match"
    ? { status: "no-match" }
    : { status: stored.status, gameId: stored.gameId, title: stored.title };
}

export function writeRaHashMapping(consoleId: string, romHash: string, mapping: RaHashMapping, now = Date.now()): void {
  const map = loadEntries();
  const key = mappingKey(consoleId, romHash);
  map.delete(key);
  map.set(key, { ...mapping, storedAt: now });
  // Map keeps insertion order, so the oldest writes are dropped first.
  while (map.size > MAX_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  persist(map);
}

export function clearRaHashMappingsForTests(): void {
  entries = undefined;
  removeDeckyStorageText(STORAGE_KEY);
}
