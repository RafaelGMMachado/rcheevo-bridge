import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CacheEntry, CacheStore, ResourceState } from "../src/core/cache";
import {
  createProviderAchievementHistoryCacheKey,
  CACHE_VERSION,
  createProviderCompletionProgressCacheKey,
  createProviderDashboardCacheKey,
  createProviderGameDetailCacheKey,
  createProviderRelatedGamesCacheKey,
} from "../src/core/cache-keys";
import { createAppServices } from "../src/core/app-services";
import type {
  DashboardSnapshot,
  CompletionProgressSnapshot,
  GameDetailSnapshot,
  NormalizedAchievement,
  NormalizedGame,
  ProviderCapabilities,
  RecentlyPlayedGame,
  RelatedGameSummary,
} from "../src/core/domain";
import {
  DeckyAchievementTypeBadge,
  getAchievementTypeBadgeDescriptor,
} from "../src/platform/decky/decky-achievement-type-badge";
import { getCompletionBarFillStyle } from "../src/platform/decky/decky-completion-progress-bar";
import { raRecipes, raTheme } from "../src/platform/decky/ra-theme";
import { createProviderRegistry } from "../src/core/provider-registry";
import type { AchievementProvider } from "../src/core/ports";
import type { KeyValueStore, PlatformServices } from "../src/core/platform";
import type {
  AuthenticatedProviderTransportFactory,
  DashboardSnapshotStore,
  DiagnosticLogger,
  PlatformCapabilities,
  ProviderConfigStore,
  SteamLibraryScanStore,
} from "../src/core/platform";
import {
  ACHIEVEMENT_COMPANION_SETTINGS_STORAGE_KEY,
  DEFAULT_ACHIEVEMENT_COMPANION_SETTINGS,
  DEFAULT_GAME_PAGE_ACHIEVEMENT_BADGE_COLORS,
  parseAchievementCompanionSettings,
  serializeAchievementCompanionSettings,
} from "../src/core/settings";
import { resolveProviderDashboardPreferences } from "../src/core/provider-dashboard-preferences";
import { redactFrontendLogText, redactFrontendLogValue } from "../src/core/redaction";
import {
  applyDeckyRecentAchievementHistory,
  buildDeckyRecentAchievementHistory,
  getDeckyDashboardStateForFullScreenEntryInitial,
  loadDeckyAchievementHistoryStateForFullScreenEntry,
  loadDeckyDashboardState,
  loadDeckyDashboardStateForFullScreenEntry,
  loadDeckyCompletionProgressState,
  loadDeckyCompletionProgressStateForFullScreenEntry,
  deckyAuthenticatedProviderTransportFactory,
  mergeDeckySteamCompletionProgressWithDashboard,
  mergeDeckySteamLibraryScanRecentAchievements,
  deckyPlatformCapabilities,
  refreshDeckySteamLibraryForExplicitRefresh,
  resetDeckyAppServicesForTests,
} from "../src/platform/decky/decky-app-services";
import { setDeckyBackendCallImplementationForTests } from "../src/platform/decky/decky-backend-bridge";
import {
  formatRetroAchievementsBeatenAtText,
  buildAchievementStatus,
  dedupeDistinctLabels,
  formatRetroAchievementsMasteredAtText,
  formatProviderAchievementPointsText,
  formatProviderAchievementStatusText,
  formatProviderAchievementUnlockRateText,
  getAchievementCounts,
  getAchievementDescriptionText,
  getAchievementDetailCounts,
  formatAchievementDetailUnlockRatePercent,
  hasAchievementCounts,
  getAchievementSpotlightCounts,
  formatAchievementUnlockRatePercent,
  formatAchievementUnlockRateValue,
  formatAchievementUnlockModeLabel,
  formatModeProgressSummary,
  isSteamAchievementPresentationProvider,
  shouldRenderRetroAchievementsModeSummaryCard,
  shouldHideSteamAchievementDetailStats,
  shouldRenderAchievementModeFilter,
} from "../src/platform/decky/decky-achievement-detail-helpers";
import { sortAchievementsForDisplay } from "../src/platform/decky/decky-game-detail-ordering";
import {
  formatCompletionProgressFilterLabelForProvider,
  formatCompletionProgressStatusLabel,
  formatCompletionProgressSummary,
  formatProfileMemberSince,
  getRetroAchievementsProfileSectionAccentStyle,
  getRetroAchievementsProfileSectionStyle,
  getRetroAchievementsProfileSectionTitleStyle,
  formatSteamPlaytimeMinutes,
  getSteamCompletionProgressGameDetailId,
  getSteamAccountProgressCards,
  getSteamAccountProgressSummary,
  getRetroAchievementsProfileStatSections,
  getSteamProfileStats,
} from "../src/platform/decky/decky-stat-helpers";
import {
  getRetroAchievementsProfileAwardStatus,
  getRetroAchievementsSupplementaryProfileStats,
  selectRetroAchievementsCompletionProgressGames,
  selectRetroAchievementsGameAwards,
} from "../src/platform/decky/decky-full-screen-profile-data";
import {
  buildCompletionProgressSummaryCards,
} from "../src/platform/decky/decky-completion-progress-summary-card-data";
import {
  formatRetroAchievementsCompletionIndicatorLabel,
  getRetroAchievementsCompletionIndicatorState,
  getRetroAchievementsCompletionIndicatorStyle,
  isRetroAchievementsBeatenGame,
  isRetroAchievementsMasteredHardcoreGame,
} from "../src/platform/decky/decky-retroachievements-completion-indicator";
import {
  addProfileAvatarCacheBustParam,
} from "../src/platform/decky/decky-avatar-cache-busting";
import {
  ACHIEVEMENT_COMPANION_LAST_GAME_PAGE_BADGE_DEBUG_STORAGE_KEY,
  ACHIEVEMENT_COMPANION_LAST_RA_SHORTCUT_RESOLUTION_DEBUG_STORAGE_KEY,
  ACHIEVEMENT_COMPANION_RUNTIME_DEBUG_GLOBAL_NAME,
  getAchievementCompanionRuntimeDebugState,
  getAchievementCompanionLastGamePageBadgeDebug,
  getAchievementCompanionLastRaShortcutResolutionDebug,
  resolveAchievementCompanionRuntimeDebugHostContext,
} from "../src/platform/decky/decky-runtime-debug";
import {
  DECKY_GAME_PAGE_ACHIEVEMENT_ROUTE_PATTERN,
  detectDeckyGamePageAchievementRouteFromUrl,
  resolveDeckyGamePageAchievementAppIdFromRouteProps,
} from "../src/platform/decky/decky-game-page-achievement-route";
import {
  clearDeckyGamePageAchievementSummaryCacheForTests,
  enrichDeckyGamePageAchievementSummaryCompletionStatus,
  formatDeckyGamePageAchievementBadgeLoadingText,
  formatDeckyGamePageAchievementBadgeLabel,
  invalidateDeckyGamePageAchievementSummaryCache,
  loadDeckyGamePageAchievementSummary,
  normalizeRetroAchievementsPlatformLabel,
  selectDeckyGamePageAchievementSummaryForAppId,
} from "../src/platform/decky/decky-game-page-achievement-summary";
import { resolveDeckyGamePageAchievementBadgePresentation } from "../src/platform/decky/decky-game-page-achievement-badge-presentation";
import {
  resolveDeckyGamePageAchievementBadgeColor,
  resolveDeckyGamePageAchievementBadgePalette,
} from "../src/platform/decky/decky-game-page-achievement-badge-colors";
import { loadDeckySteamShortcutMetadata } from "../src/platform/decky/decky-steam-shortcut-metadata";
import { loadDeckySteamShortcutRomHashInfo } from "../src/platform/decky/decky-steam-shortcut-metadata";
import { readDeckyStorageText } from "../src/platform/decky/storage";
import {
  DECKY_ACHIEVEMENT_FILTER_GROUP_CLASS,
  DECKY_ACHIEVEMENT_FILTER_OPTION_CLASS,
  DECKY_ACHIEVEMENT_FILTER_OPTION_FOCUSED_CLASS,
  DECKY_ACHIEVEMENT_FILTER_OPTION_SELECTED_CLASS,
  DECKY_FULLSCREEN_ACTION_ROW_CENTERED_CLASS,
  DECKY_FULLSCREEN_ACTION_ROW_CLASS,
  DECKY_FULLSCREEN_CHIP_CLASS,
  DECKY_FULLSCREEN_CHIP_FOCUSED_CLASS,
  getDeckyFocusStylesCss,
} from "../src/platform/decky/decky-focus-styles";
import { getDeckyFullscreenActionStylesCss } from "../src/platform/decky/decky-full-screen-action-styles";
import {
  clearDeckyDashboardSnapshot,
  readDeckyDashboardSnapshotCacheEntry,
  readDeckyDashboardSnapshotState,
  deckyDashboardSnapshotStore,
  writeDeckyDashboardSnapshot,
} from "../src/platform/decky/decky-dashboard-snapshot-cache";
import {
  deckyDiagnosticLogger,
  type DeckyDiagnosticEventPayload,
} from "../src/platform/decky/decky-diagnostic-logger";
import {
  clearDeckyProviderConfig,
  clearDeckyRetroAchievementsAccountState,
  loadDeckyProviderConfig as loadDeckyRetroAchievementsProviderConfig,
  readDeckyProviderConfig,
  writeDeckyProviderConfig,
} from "../src/platform/decky/providers/retroachievements/config";
import { RETROACHIEVEMENTS_PROVIDER_ID } from "../src/providers/retroachievements/config";
import type { DeckyProviderConfigValue } from "../src/platform/decky/providers/provider-config-store";
import {
  RETROACHIEVEMENTS_CREDENTIAL_HELPER_COPY,
  buildRetroAchievementsCredentialsFormModel,
  getRetroAchievementsApiKeyInputDescriptor,
  getRetroAchievementsCredentialsFieldSpecs,
  resolveRetroAchievementsApiKeyForSave,
} from "../src/platform/decky/providers/retroachievements/credentials-help";
import {
  clearDeckySteamLibraryAchievementScanSummary,
  clearDeckySteamProviderConfig,
  deckySteamLibraryScanStore,
  loadDeckyProviderConfig as loadDeckySteamProviderConfig,
  readDeckySteamLibraryAchievementScanOverview,
  readDeckySteamLibraryAchievementScanSummary,
  readDeckySteamAchievementSchemaCache,
  getDeckySteamLibraryAchievementScanRevision,
  readDeckySteamProviderConfig,
  writeDeckySteamLibraryAchievementScanSummary,
  writeDeckySteamLibraryAchievementScanSummaryIfRevisionMatches,
  writeDeckySteamAchievementSchemaCache,
  writeDeckySteamProviderConfig,
  type SteamLibraryAchievementScanOverview,
  type SteamLibraryAchievementScanSummary,
} from "../src/platform/decky/providers/steam/config";
import { STEAM_PROVIDER_ID } from "../src/providers/steam";
import {
  clearDeckyProviderConfigCache,
  deckyProviderConfigStore,
  updateDeckyProviderConfigCache,
} from "../src/platform/decky/providers/provider-config-store";
import {
  STEAM_CREDENTIAL_HELPER_COPY,
  buildSteamCredentialsFormModel,
  getSteamApiKeyInputDescriptor,
  getSteamCredentialsFieldSpecs,
  resolveSteamApiKeyForSave,
} from "../src/platform/decky/providers/steam/credentials-help";
import {
  buildDeckySteamCompletionProgressSnapshotFromSummary,
  buildDeckySteamAchievementHistorySnapshotFromSummary,
  refreshAndCacheDeckySteamLibraryAchievementProgress,
  runAndCacheDeckySteamLibraryAchievementScan,
} from "../src/platform/decky/providers/steam/library-scan";
import {
  reconcileSteamLibraryAchievementSummaryWithRecentGames,
  refreshSteamLibraryAchievementProgress,
  scanSteamLibraryAchievements,
  validateSteamOwnedGamesResponse,
} from "../src/providers/steam/library-scan";
import { countSteamPlayerAchievements } from "../src/providers/steam/achievement-count";
import {
  loadSteamPlayerAchievementsCoalesced,
  type SteamClient,
} from "../src/providers/steam/client/client";
import { normalizeSteamBadges } from "../src/providers/steam/badges";
import {
  applySteamLibraryScanGameDetailMetadata,
  findSteamLibraryScanGameSummaryByAppId,
} from "../src/platform/decky/providers/steam/game-detail";
import type { SteamLibraryAchievementScanSummary } from "../src/platform/decky/providers/steam";
import {
  countCompletionProgressSubsetGames,
  filterCompletionProgressGamesBySubsetVisibility,
  groupCompletionProgressGames,
  sortCompletionProgressGroups,
  summarizeCompletionProgressSummaryBySubsetVisibility,
} from "../src/platform/decky/decky-completion-progress-grouping";
import {
  normalizeRetroAchievementsCompletionProgressGames,
  normalizeRetroAchievementsGameDetail,
  normalizeRetroAchievementsProfile,
  normalizeRetroAchievementsRecentUnlocks,
  normalizeRetroAchievementsRecentlyPlayedGames,
  summarizeRetroAchievementsCompletionProgress,
  summarizeRetroAchievementsProfileAchievementCounts,
} from "../src/providers/retroachievements/mappers/normalize";
import type {
  RawRetroAchievementsCompletionProgressEntry,
  RawRetroAchievementsGameListEntry,
  RawRetroAchievementsGameProgressResponse,
  RawRetroAchievementsProfileResponse,
  RawRetroAchievementsRecentUnlockResponse,
  RawRetroAchievementsRecentlyPlayedGameResponse,
  RawRetroAchievementsSystemResponse,
} from "../src/providers/retroachievements/raw-types";
import {
  readDeckyStorageText,
  writeDeckyStorageText,
} from "../src/platform/decky/storage";
import {
  createRetroAchievementsClient,
  createRetroAchievementsProvider,
  type RetroAchievementsClient,
} from "../src/providers/retroachievements";
import { loadOptionalRetroAchievementsProfileSummary } from "../src/providers/retroachievements/retroachievements.provider";
import {
  DEFAULT_STEAM_PROVIDER_CONFIG,
  normalizeSteamProviderConfig,
  parseSteamProviderConfig,
  serializeSteamProviderConfig,
} from "../src/providers/steam/config";
import {
  createFetchSteamTransport,
  createSteamClient,
  createSteamProvider,
  clearSteamRecentGameSnapshotLoadCacheForTests,
} from "../src/providers/steam";
import {
  normalizeSteamGameDetail,
  normalizeSteamProfile,
  normalizeSteamRecentUnlocks,
  normalizeSteamRecentlyPlayedGames,
  mergeSteamRecentlyPlayedCandidates,
  mergeSteamRecentlyPlayedLastPlayedTimes,
  sortSteamRecentlyPlayedGamesNewestFirst,
} from "../src/providers/steam/mappers/normalize";
import type {
  SteamLibraryAchievementScanSummary,
  RawSteamPlayerAchievement,
  RawSteamBadge,
  RawSteamPlayerSummary,
  RawSteamOwnedGame,
  RawSteamGetBadgesResponse,
  RawSteamGetOwnedGamesResponse,
  RawSteamRecentlyPlayedGame,
  RawSteamGetSteamLevelResponse,
  RawSteamSchemaAchievement,
} from "../src/providers/steam/raw-types";
import { getSteamXpProgress } from "../src/platform/decky/steam-xp";

const PROVIDER_ID = "retroachievements";
const PLATFORM: PlatformServices = {
  info: {
    platformId: "decky",
    appName: "Achievement Companion",
  },
};
const PROVIDER_CAPABILITIES: ProviderCapabilities = {
  requiresCredentials: true,
  profileSummary: true,
  completionProgress: true,
  recentUnlocks: true,
  gameProgress: true,
  rarityStats: true,
  search: false,
};

function collectSourceFiles(rootDir: string): readonly string[] {
  const entries = readdirSync(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(entryPath));
      continue;
    }

    if (entry.isFile() && /\.(ts|tsx|py)$/u.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

function readSourceTree(rootDir: string): string {
  return collectSourceFiles(rootDir)
    .map((filePath) => readFileSync(filePath, "utf-8"))
    .join("\n");
}

interface CallCounts {
  config: number;
  profile: number;
  retroAchievementsSystems: number;
  retroAchievementsGameList: number;
  completionProgress: number;
  recentUnlocks: number;
  achievementsEarnedBetween: number;
  recentlyPlayedGames: number;
  gameProgress: number;
  relatedGames: number;
  relatedGameProgress: number;
}

function createMemoryCacheStore(
  initialEntries: readonly CacheEntry<unknown>[] = [],
): { readonly cacheStore: CacheStore; readonly writes: readonly CacheEntry<unknown>[] } {
  const entries = new Map<string, CacheEntry<unknown>>();
  const writes: CacheEntry<unknown>[] = [];

  for (const entry of initialEntries) {
    entries.set(entry.key, entry);
  }

  return {
    writes,
    cacheStore: {
      async read<T>(key: string): Promise<CacheEntry<T> | undefined> {
        return entries.get(key) as CacheEntry<T> | undefined;
      },

      async write<T>(entry: CacheEntry<T>): Promise<void> {
        writes.push(entry as CacheEntry<unknown>);
        entries.set(entry.key, entry as CacheEntry<unknown>);
      },

      async delete(key: string): Promise<void> {
        entries.delete(key);
      },

      async clear(prefix?: string): Promise<void> {
        if (prefix === undefined) {
          entries.clear();
          return;
        }

        for (const key of [...entries.keys()]) {
          if (key.startsWith(prefix)) {
            entries.delete(key);
          }
        }
      },
    },
  };
}

function createCacheEntry<T>(
  key: string,
  value: T,
  storedAt: number,
  expiresAt: number,
): CacheEntry<T> {
  return {
    key,
    value,
    storedAt,
    expiresAt,
    version: CACHE_VERSION,
  };
}

function setGlobalTestValue<T>(key: string, value: T): () => void {
  const globalRecord = globalThis as Record<string, unknown>;
  const hadOwnProperty = Object.prototype.hasOwnProperty.call(globalRecord, key);
  const previousValue = globalRecord[key];
  globalRecord[key] = value as unknown;

  return () => {
    if (hadOwnProperty) {
      globalRecord[key] = previousValue;
      return;
    }

    delete globalRecord[key];
  };
}

function createDashboardSnapshot(): DashboardSnapshot {
  return {
    profile: {
      providerId: PROVIDER_ID,
      identity: {
        providerId: PROVIDER_ID,
        accountId: "alice",
        displayName: "Alice",
      },
      summary: {
        unlockedCount: 12,
        totalCount: 20,
        completionPercent: 60,
      },
      metrics: [],
      refreshedAt: 1_700_000_000_000,
    },
    recentAchievements: [],
    recentlyPlayedGames: [],
    recentUnlocks: [],
    featuredGames: [],
    refreshedAt: 1_700_000_000_000,
  };
}

function createDashboardSnapshotWithRecentAchievements(
  recentAchievements: DashboardSnapshot["recentAchievements"],
): DashboardSnapshot {
  return {
    ...createDashboardSnapshot(),
    recentAchievements,
    recentUnlocks: recentAchievements,
  };
}

function createRecentUnlock(sequence: number): DashboardSnapshot["recentAchievements"][number] {
  const unlockedAt = 1_700_000_000_000 + sequence * 1_000;

  return {
    achievement: {
      providerId: PROVIDER_ID,
      achievementId: `ach-${sequence}`,
      gameId: "game-1",
      title: `Achievement ${sequence}`,
      isUnlocked: true,
      unlockedAt,
      points: 10,
      metrics: [],
    },
    game: {
      providerId: PROVIDER_ID,
      gameId: "game-1",
      title: "Test Game",
    },
    unlockedAt,
  };
}

function createRecentUnlockWithoutTimestamp(
  sequence: number,
): DashboardSnapshot["recentAchievements"][number] {
  const recentUnlock = createRecentUnlock(sequence);

  return {
    ...recentUnlock,
    achievement: {
      ...recentUnlock.achievement,
      unlockedAt: undefined,
    },
    unlockedAt: undefined,
  };
}

function createRecentUnlockForGame(
  gameId: string,
  gameTitle: string,
  achievementNumber: number,
  unlockedAt: number,
): DashboardSnapshot["recentAchievements"][number] {
  return {
    achievement: {
      providerId: PROVIDER_ID,
      achievementId: `${gameId}-ach-${achievementNumber}`,
      gameId,
      title: `${gameTitle} Achievement ${achievementNumber}`,
      isUnlocked: true,
      unlockedAt,
      points: 10,
      metrics: [],
    },
    game: {
      providerId: PROVIDER_ID,
      gameId,
      title: gameTitle,
    },
    unlockedAt,
  };
}

function createBackfillGameDetail(
  gameId: string,
  title: string,
  timestamps: readonly number[],
): GameDetailSnapshot {
  return {
    game: {
      providerId: PROVIDER_ID,
      gameId,
      title,
      summary: {
        unlockedCount: timestamps.length,
      },
      metrics: [],
    },
    achievements: timestamps.map((unlockedAt, index) => ({
      providerId: PROVIDER_ID,
      achievementId: `${gameId}-ach-${index + 1}`,
      gameId,
      title: `${title} Achievement ${index + 1}`,
      description: `Unlock ${index + 1} for ${title}`,
      isUnlocked: true,
      unlockedAt,
      points: 10 + index,
      metrics: [],
    })),
    refreshedAt: timestamps[0],
  };
}

function createBackfillCompletionProgress(): readonly NormalizedGame[] {
  return [
    {
      providerId: PROVIDER_ID,
      gameId: "game-a",
      title: "Game A",
      status: "in_progress",
      summary: {
        unlockedCount: 3,
      },
      metrics: [],
      lastUnlockAt: 1_700_000_000_500,
    },
    {
      providerId: PROVIDER_ID,
      gameId: "game-b",
      title: "Game B",
      status: "in_progress",
      summary: {
        unlockedCount: 3,
      },
      metrics: [],
      lastUnlockAt: 1_700_000_000_200,
    },
  ];
}

function createBackfillCompletionProgressWithoutDates(): readonly NormalizedGame[] {
  return [
    {
      providerId: PROVIDER_ID,
      gameId: "game-a",
      title: "Game A",
      status: "in_progress",
      summary: {
        unlockedCount: 3,
      },
      metrics: [],
    },
    {
      providerId: PROVIDER_ID,
      gameId: "game-b",
      title: "Game B",
      status: "in_progress",
      summary: {
        unlockedCount: 2,
      },
      metrics: [],
    },
  ];
}

function createDeferredPromise<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function createBackfillRecentlyPlayedGame(
  gameId: string,
  title: string,
  unlockedCount: number,
  lastPlayedAt: number,
): RecentlyPlayedGame {
  return {
    providerId: PROVIDER_ID,
    gameId,
    title,
    summary: {
      unlockedCount,
    },
    lastPlayedAt,
  };
}

function createMockStorage(): Storage {
  const entries = new Map<string, string>();

  return {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key: string): string | null {
      return entries.get(key) ?? null;
    },
    key(index: number): string | null {
      return [...entries.keys()][index] ?? null;
    },
    removeItem(key: string): void {
      entries.delete(key);
    },
    setItem(key: string, value: string): void {
      entries.set(key, value);
    },
  };
}

function createMemoryKeyValueStore(
  initialEntries: Readonly<Record<string, string>> = {},
): KeyValueStore {
  const entries = new Map<string, string>(Object.entries(initialEntries));

  return {
    async read(key: string): Promise<string | undefined> {
      return entries.get(key);
    },

    async write(key: string, value: string): Promise<void> {
      entries.set(key, value);
    },

    async delete(key: string): Promise<void> {
      entries.delete(key);
    },
  };
}

async function withMockDeckyStorage<T>(callback: () => Promise<T> | T): Promise<T> {
  const globalObject = globalThis as typeof globalThis & {
    localStorage?: Storage;
    sessionStorage?: Storage;
  };
  const previousLocalStorage = globalObject.localStorage;
  const previousSessionStorage = globalObject.sessionStorage;
  const mockStorage = createMockStorage();

  globalObject.localStorage = mockStorage;
  globalObject.sessionStorage = mockStorage;

  try {
    return await callback();
  } finally {
    if (previousLocalStorage === undefined) {
      delete globalObject.localStorage;
    } else {
      globalObject.localStorage = previousLocalStorage;
    }

    if (previousSessionStorage === undefined) {
      delete globalObject.sessionStorage;
    } else {
      globalObject.sessionStorage = previousSessionStorage;
    }
  }
}

interface DeckyBackendTestRetroAchievementsState {
  readonly config?: {
    readonly username: string;
    readonly hasApiKey: boolean;
    readonly recentAchievementsCount?: number;
    readonly recentlyPlayedCount?: number;
  };
  readonly secret?: string;
  readonly systems?: readonly RawRetroAchievementsSystemResponse[];
  readonly completionProgressEntries?: readonly RawRetroAchievementsCompletionProgressEntry[];
  readonly gameListByConsoleId?: Readonly<Record<string, readonly RawRetroAchievementsGameListEntry[]>>;
  readonly gameProgressByGameId?: Readonly<Record<string, RawRetroAchievementsGameProgressResponse>>;
  systemsRequestCount?: number;
  gameListRequestCount?: number;
  gameListRequestedConsoleIds?: string[];
  gameProgressRequestCount?: number;
}

interface DeckyBackendTestSteamState {
  readonly config?: {
    readonly steamId64: string;
    readonly hasApiKey: boolean;
    readonly language: string;
    readonly recentAchievementsCount: number;
    readonly recentlyPlayedCount: number;
    readonly includePlayedFreeGames: boolean;
  };
  readonly secret?: string;
  readonly shortcutMetadataByAppId?: Readonly<
    Record<
      string,
      {
        readonly title: string;
        readonly platformTag?: string;
        readonly platformLabel?: string;
        readonly tags?: readonly string[];
        readonly exe?: string;
        readonly startDir?: string;
      }
    >
  >;
  readonly shortcutRomHashByAppId?: Readonly<
    Record<
      string,
      {
        readonly shortcutRomPathDetected: boolean;
        readonly romHashAttempted: boolean;
        readonly romHashStatus: "resolved" | "skipped" | "error" | "ambiguous";
        readonly romHashAlgorithm?: "rcheevos";
        readonly romHash?: string;
        readonly shortcutRomPathSource?: string;
        readonly hashResolverSkippedReason?: string;
        readonly hashRejectedReason?: string;
        readonly candidateCount?: number;
        readonly candidateExtension?: string;
        readonly archiveMemberExtension?: string;
        readonly candidateResults?: readonly { readonly source: string; readonly extension: string; readonly status: string; readonly reason?: string; readonly memberExtension?: string }[];
        readonly candidateRejections?: readonly { readonly source: string; readonly extension: string; readonly reason: string }[];
      }
    >
  >;
  hashRequestedConsoleIds?: number[];
  steamRequestCount?: number;
  steamRequestedPaths?: string[];
}

const deckyBackendTestState = {
  retroAchievements: {} as DeckyBackendTestRetroAchievementsState,
  steam: {} as DeckyBackendTestSteamState,
};

function resetDeckyBackendTestState(): void {
  deckyBackendTestState.retroAchievements = {};
  deckyBackendTestState.steam = {};
}

function getDeckyBackendTestSecret(providerId: "retroachievements" | "steam"): string | undefined {
  return providerId === "retroachievements"
    ? deckyBackendTestState.retroAchievements.secret
    : deckyBackendTestState.steam.secret;
}

const deckyBackendTestCallImplementation = async (route: string, payload: unknown) => {
  const record = payload as Record<string, unknown> | undefined;

  if (route === "get_provider_configs") {
    const result: Record<string, unknown> = { version: 1 };

    if (deckyBackendTestState.retroAchievements.config !== undefined) {
      result.retroAchievements = deckyBackendTestState.retroAchievements.config;
    }

    if (deckyBackendTestState.steam.config !== undefined) {
      result.steam = deckyBackendTestState.steam.config;
    }

    return result;
  }

  if (route === "validate_retroachievements_credentials") {
    return { ok: true };
  }

  if (route === "validate_steam_credentials") {
    return { ok: true };
  }

  if (route === "request_retroachievements_json") {
    const path = typeof record?.path === "string" ? record.path : "";
    if (path === "API_GetConsoleIDs.php") {
      const systems = deckyBackendTestState.retroAchievements.systems;
      if (systems === undefined) {
        throw new Error("Unexpected RetroAchievements systems request in test");
      }

      deckyBackendTestState.retroAchievements.systemsRequestCount =
        (deckyBackendTestState.retroAchievements.systemsRequestCount ?? 0) + 1;
      return systems;
    }

    if (path === "API_GetGameList.php") {
      const consoleId =
        typeof record?.query === "object" && record.query !== null
          ? (() => {
              const query = record.query as Record<string, unknown>;
              const rawConsoleId = query["i"];
              return typeof rawConsoleId === "string"
                ? rawConsoleId.trim()
                : typeof rawConsoleId === "number"
                  ? String(Math.trunc(rawConsoleId))
                  : "";
            })()
          : "";

      if (consoleId.length === 0) {
        throw new Error("Unexpected RetroAchievements game list request without a console id in test");
      }

      const response = deckyBackendTestState.retroAchievements.gameListByConsoleId?.[consoleId];
      if (response === undefined) {
        throw new Error(`Unexpected RetroAchievements game list request for console id ${consoleId} in test`);
      }

      deckyBackendTestState.retroAchievements.gameListRequestCount =
        (deckyBackendTestState.retroAchievements.gameListRequestCount ?? 0) + 1;
      if (deckyBackendTestState.retroAchievements.gameListRequestedConsoleIds === undefined) {
        deckyBackendTestState.retroAchievements.gameListRequestedConsoleIds = [];
      }
      deckyBackendTestState.retroAchievements.gameListRequestedConsoleIds.push(consoleId);
      return response;
    }

    if (path === "API_GetUserCompletionProgress.php") {
      const entries = deckyBackendTestState.retroAchievements.completionProgressEntries;
      if (entries === undefined) {
        throw new Error("Unexpected RetroAchievements completion progress request in test");
      }

      return {
        Count: entries.length,
        Total: entries.length,
        Results: entries,
      };
    }

    if (path === "API_GetGameInfoAndUserProgress.php") {
      const gameId = typeof record?.query === "object" && record.query !== null
        ? (() => {
            const query = record.query as Record<string, unknown>;
            const rawGameId = query["g"];
            return typeof rawGameId === "string"
              ? rawGameId.trim()
              : typeof rawGameId === "number"
                ? String(rawGameId)
                : "";
          })()
        : "";

      if (gameId.length === 0) {
        throw new Error("Unexpected RetroAchievements game progress request without a game id in test");
      }

      deckyBackendTestState.retroAchievements.gameProgressRequestCount =
        (deckyBackendTestState.retroAchievements.gameProgressRequestCount ?? 0) + 1;

      const response = deckyBackendTestState.retroAchievements.gameProgressByGameId?.[gameId];
      if (response === undefined) {
        throw new Error(`Unexpected RetroAchievements game progress request for game id ${gameId} in test`);
      }

      return response;
    }

    throw new Error(`Unexpected RetroAchievements backend request path in test: ${path}`);
  }

  if (route === "save_retroachievements_credentials") {
    const username =
      typeof record?.username === "string" ? record.username.trim() : "";
    const draftApiKey =
      typeof record?.apiKeyDraft === "string"
        ? record.apiKeyDraft.trim()
        : typeof record?.apiKey === "string"
          ? record.apiKey.trim()
          : "";
    const recentAchievementsCount =
      typeof record?.recentAchievementsCount === "number"
        ? record.recentAchievementsCount
        : deckyBackendTestState.retroAchievements.config?.recentAchievementsCount;
    const recentlyPlayedCount =
      typeof record?.recentlyPlayedCount === "number"
        ? record.recentlyPlayedCount
        : deckyBackendTestState.retroAchievements.config?.recentlyPlayedCount;

    if (username.length === 0) {
      return undefined;
    }

    if (draftApiKey.length > 0) {
      deckyBackendTestState.retroAchievements.secret = draftApiKey;
    } else if (deckyBackendTestState.retroAchievements.secret === undefined) {
      return undefined;
    }

    deckyBackendTestState.retroAchievements.config = {
      username,
      hasApiKey: true,
      ...(typeof recentAchievementsCount === "number" ? { recentAchievementsCount } : {}),
      ...(typeof recentlyPlayedCount === "number" ? { recentlyPlayedCount } : {}),
    };

    return deckyBackendTestState.retroAchievements.config;
  }

  if (route === "save_steam_credentials") {
    const steamId64 =
      typeof record?.steamId64 === "string" ? record.steamId64.trim() : "";
    const draftApiKey =
      typeof record?.apiKeyDraft === "string"
        ? record.apiKeyDraft.trim()
        : typeof record?.apiKey === "string"
          ? record.apiKey.trim()
          : "";
    const language = typeof record?.language === "string" ? record.language.trim() || "english" : "english";

    if (steamId64.length === 0) {
      return undefined;
    }

    if (draftApiKey.length > 0) {
      deckyBackendTestState.steam.secret = draftApiKey;
    } else if (deckyBackendTestState.steam.secret === undefined) {
      return undefined;
    }

    deckyBackendTestState.steam.config = {
      steamId64,
      hasApiKey: true,
      language,
      recentAchievementsCount: typeof record?.recentAchievementsCount === "number" ? record.recentAchievementsCount : 5,
      recentlyPlayedCount: typeof record?.recentlyPlayedCount === "number" ? record.recentlyPlayedCount : 5,
      includePlayedFreeGames: typeof record?.includePlayedFreeGames === "boolean"
        ? record.includePlayedFreeGames
        : false,
    };

    return deckyBackendTestState.steam.config;
  }

  if (route === "clear_provider_credentials") {
    const providerId = typeof record?.providerId === "string" ? record.providerId : "";
    if (providerId === "retroachievements") {
      const hadState =
        deckyBackendTestState.retroAchievements.config !== undefined ||
        deckyBackendTestState.retroAchievements.secret !== undefined;
      deckyBackendTestState.retroAchievements = {};
      return hadState;
    }

    if (providerId === "steam") {
      const hadState =
        deckyBackendTestState.steam.config !== undefined || deckyBackendTestState.steam.secret !== undefined;
      deckyBackendTestState.steam = {};
      return hadState;
    }

    return false;
  }

  if (route === "request_steam_json") {
    const path = typeof record?.path === "string" ? record.path : "";
    deckyBackendTestState.steam.steamRequestCount =
      (deckyBackendTestState.steam.steamRequestCount ?? 0) + 1;
    if (deckyBackendTestState.steam.steamRequestedPaths === undefined) {
      deckyBackendTestState.steam.steamRequestedPaths = [];
    }
    deckyBackendTestState.steam.steamRequestedPaths.push(path);
    if (path === "ISteamUser/GetPlayerSummaries/v2/") {
      return {
        response: {
          players: [
            {
              steamid: deckyBackendTestState.steam.config?.steamId64 ?? "12345678901234567",
              personaname: "Steam User",
              avatarfull: "https://cdn.steam.com/avatar.jpg",
            },
          ],
        },
      };
    }

    if (path === "IPlayerService/GetSteamLevel/v1/") {
      return {
        response: {
          player_level: 29,
        },
      };
    }

    if (path === "IPlayerService/GetBadges/v1/") {
      return {
        response: {
          badges: [],
          player_xp: 5_740,
        },
      };
    }

    if (path === "IPlayerService/GetOwnedGames/v1/") {
      return {
        response: {
          game_count: 1,
          games: [
            {
              appid: 220,
              name: "Half-Life 2",
              img_icon_url: "half-life-2-icon",
              playtime_forever: 42,
              playtime_2weeks: 12,
            },
          ],
        },
      };
    }

    if (path === "IPlayerService/GetRecentlyPlayedGames/v1/") {
      return {
        response: {
          games: [
            {
              appid: 220,
              name: "Half-Life 2",
              img_icon_url: "half-life-2-icon",
              playtime_forever: 42,
              playtime_2weeks: 12,
            },
          ],
        },
      };
    }

    if (path === "ISteamUserStats/GetPlayerAchievements/v1/") {
      return {
        playerstats: {
          success: true,
          achievements: [],
        },
      };
    }

    if (path === "ISteamUserStats/GetSchemaForGame/v2/") {
      return {
        game: {
          availableGameStats: {
            achievements: [],
          },
        },
      };
    }

    if (path === "ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/") {
      return {
        achievementpercentages: {
          achievements: [],
        },
      };
    }

    throw new Error(`Unexpected steam backend request path in test: ${path}`);
  }

  if (route === "get_steam_shortcut_metadata") {
    const appId =
      typeof record?.appId === "string"
        ? record.appId
        : typeof record?.appId === "number"
          ? String(record.appId)
          : "";
    const metadata = deckyBackendTestState.steam.shortcutMetadataByAppId?.[appId];
    return metadata === undefined
      ? undefined
      : {
          appId,
          title: metadata.title,
          ...(metadata.platformTag !== undefined ? { platformTag: metadata.platformTag } : {}),
          ...(metadata.platformLabel !== undefined ? { platformLabel: metadata.platformLabel } : {}),
          ...(metadata.tags !== undefined ? { tags: metadata.tags } : {}),
          ...(metadata.exe !== undefined ? { exe: metadata.exe } : {}),
          ...(metadata.startDir !== undefined ? { startDir: metadata.startDir } : {}),
      };
  }

  if (route === "get_steam_shortcut_rom_hash") {
    if (typeof record?.consoleId === "number") {
      (deckyBackendTestState.steam.hashRequestedConsoleIds ??= []).push(record.consoleId);
    }
    const appId =
      typeof record?.appId === "string"
        ? record.appId
        : typeof record?.appId === "number"
          ? String(record.appId)
          : "";
    const hashInfo = deckyBackendTestState.steam.shortcutRomHashByAppId?.[appId];
    return hashInfo === undefined
      ? undefined
      : {
          appId,
          shortcutRomPathDetected: hashInfo.shortcutRomPathDetected,
          ...(hashInfo.shortcutRomPathSource !== undefined ? { shortcutRomPathSource: hashInfo.shortcutRomPathSource } : {}),
          romHashAttempted: hashInfo.romHashAttempted,
          romHashStatus: hashInfo.romHashStatus,
          ...(hashInfo.candidateCount !== undefined ? { candidateCount: hashInfo.candidateCount } : {}),
          ...(hashInfo.candidateExtension !== undefined ? { candidateExtension: hashInfo.candidateExtension } : {}),
          ...(hashInfo.archiveMemberExtension !== undefined ? { archiveMemberExtension: hashInfo.archiveMemberExtension } : {}),
          ...(hashInfo.candidateResults !== undefined ? { candidateResults: hashInfo.candidateResults } : {}),
          ...(hashInfo.candidateRejections !== undefined ? { candidateRejections: hashInfo.candidateRejections } : {}),
          ...(hashInfo.romHashAlgorithm !== undefined ? { romHashAlgorithm: hashInfo.romHashAlgorithm } : {}),
          ...(hashInfo.romHash !== undefined ? { romHash: hashInfo.romHash } : {}),
          ...(hashInfo.hashResolverSkippedReason !== undefined
            ? { hashResolverSkippedReason: hashInfo.hashResolverSkippedReason }
            : {}),
          ...(hashInfo.hashRejectedReason !== undefined ? { hashRejectedReason: hashInfo.hashRejectedReason } : {}),
        };
  }

  throw new Error(`Unexpected decky backend route in test: ${route}`);
};

setDeckyBackendCallImplementationForTests(deckyBackendTestCallImplementation);

beforeEach(() => {
  resetDeckyBackendTestState();
  clearDeckyProviderConfigCache("retroachievements");
  clearDeckyProviderConfigCache("steam");
  clearDeckySteamLibraryAchievementScanSummary();
  clearDeckyGamePageAchievementSummaryCacheForTests();
  clearSteamRecentGameSnapshotLoadCacheForTests();
});

const DASHBOARD_REFRESH_FEATURED_GAMES: DashboardSnapshot["featuredGames"] = [
  {
    providerId: PROVIDER_ID,
    gameId: "game-2",
    title: "Test Journey",
    platformLabel: "NES",
    status: "in_progress",
    summary: {
      unlockedCount: 4,
      totalCount: 10,
      completionPercent: 40,
    },
    metrics: [],
    lastUnlockAt: 1_700_000_000_050,
  },
];

const DASHBOARD_REFRESH_PROFILE: DashboardSnapshot["profile"] = {
  providerId: PROVIDER_ID,
  identity: {
    providerId: PROVIDER_ID,
    accountId: "alice",
    displayName: "Alice",
  },
  summary: {
    unlockedCount: 12,
    totalCount: 20,
    completionPercent: 60,
  },
  metrics: [],
  featuredGames: DASHBOARD_REFRESH_FEATURED_GAMES,
  refreshedAt: 1_700_000_000_100,
};

const DASHBOARD_REFRESH_RECENT_UNLOCKS: DashboardSnapshot["recentUnlocks"] = [
  {
    achievement: {
      providerId: PROVIDER_ID,
      achievementId: "ach-1",
      gameId: "game-1",
      title: "First Blood",
      isUnlocked: true,
      unlockedAt: 1_700_000_000_100,
      points: 10,
      metrics: [],
    },
    game: {
      providerId: PROVIDER_ID,
      gameId: "game-1",
      title: "Test Game",
    },
    unlockedAt: 1_700_000_000_100,
  },
];

const DASHBOARD_REFRESH_RECENTLY_PLAYED_GAMES: DashboardSnapshot["recentlyPlayedGames"] = [
  {
    providerId: PROVIDER_ID,
    gameId: "game-3",
    title: "Familiar Game",
    platformLabel: "SNES",
    coverImageUrl: "https://example.com/game-3.png",
    summary: {
      unlockedCount: 8,
      totalCount: 16,
      completionPercent: 50,
    },
    lastPlayedAt: 1_700_000_000_200,
  },
];

function createGameDetailSnapshot(): GameDetailSnapshot {
  return {
    game: {
      providerId: PROVIDER_ID,
      gameId: "game-1",
      title: "Test Game",
      status: "in_progress",
      summary: {
        unlockedCount: 3,
        totalCount: 10,
        completionPercent: 30,
      },
      metrics: [],
    },
    achievements: [],
    refreshedAt: 1_700_000_000_000,
  };
}

function createRetroAchievementsGameProgressResponse(args: {
  readonly gameId: string;
  readonly title: string;
  readonly consoleName?: string;
  readonly consoleId?: number | string;
  readonly highestAwardKind?: string;
  readonly highestAwardDate?: string;
  readonly unlockedCount?: number;
  readonly totalCount?: number;
  readonly hardcoreUnlockedCount?: number;
}): RawRetroAchievementsGameProgressResponse {
  const unlockedCount = args.unlockedCount ?? 1;
  const totalCount = args.totalCount ?? Math.max(unlockedCount, 1);

  return {
    ID: args.gameId,
    Title: args.title,
    ...(args.consoleId !== undefined ? { ConsoleID: args.consoleId } : {}),
    ConsoleName: args.consoleName ?? "NES",
    NumAchievements: totalCount,
    NumAwardedToUser: unlockedCount,
    ...(args.hardcoreUnlockedCount !== undefined
      ? { NumAwardedToUserHardcore: args.hardcoreUnlockedCount }
      : {}),
    UserCompletion: totalCount > 0 ? `${((unlockedCount / totalCount) * 100).toFixed(2)}%` : undefined,
    ...(args.highestAwardKind !== undefined ? { HighestAwardKind: args.highestAwardKind } : {}),
    ...(args.highestAwardDate !== undefined ? { HighestAwardDate: args.highestAwardDate } : {}),
    Achievements: {
      "1": {
        ID: 1,
        Title: "Achievement One",
        Description: "Test achievement",
        Points: 1,
        NumAwarded: 100,
        NumAwardedHardcore: 50,
        BadgeName: "badge-1",
        DisplayOrder: 0,
      },
    },
  };
}

test("retroachievements game progress normalizes achievement badge art", () => {
  const rawGameProgress: RawRetroAchievementsGameProgressResponse = {
    ID: 14402,
    Title: "Dragster",
    ConsoleName: "Atari 2600",
    ImageIcon: "/Images/026368.png",
    ImageBoxArt: "/Images/066952.png",
    NumAchievements: 2,
    NumAwardedToUser: 2,
    NumAwardedToUserHardcore: 1,
    UserCompletion: "100.00%",
    UserCompletionHardcore: "50.00%",
    HighestAwardKind: "mastered",
    HighestAwardDate: "2024-04-23T21:28:49+00:00",
    Achievements: {
      "79434": {
        ID: 79434,
        Title: "Novice Dragster Driver 1",
        Description: "Complete your very first race in game 1.",
        Points: 1,
        NumAwarded: 200,
        NumAwardedHardcore: 50,
        BadgeName: "85541",
        DisplayOrder: 0,
        DateEarned: "2022-08-23 22:56:38",
        DateEarnedHardcore: "2022-08-23 22:56:38",
      },
      "79435": {
        ID: 79435,
        Title: "Novice Dragster Driver 2",
        Description: "Complete your second race in game 1.",
        Points: 2,
        NumAwarded: 120,
        NumAwardedHardcore: 60,
        BadgeName: "85542",
        DisplayOrder: 1,
        DateEarned: "2022-09-01 22:56:38",
      },
    },
  };

  const snapshot = normalizeRetroAchievementsGameDetail(rawGameProgress);

  assert.equal(snapshot.reportedAchievementCount, 2);
  assert.equal(snapshot.game.hardcoreSummary?.unlockedCount, 1);
  assert.equal(snapshot.game.hardcoreSummary?.totalCount, 2);
  assert.equal(snapshot.game.hardcoreSummary?.completionPercent, 50);
  assert.equal(snapshot.game.softcoreSummary?.unlockedCount, 1);
  assert.equal(snapshot.game.softcoreSummary?.totalCount, 2);
  assert.equal(snapshot.game.softcoreSummary?.completionPercent, 50);
  assert.equal(
    snapshot.achievements[0]?.badgeImageUrl,
    "https://i.retroachievements.org/Badge/85541.png",
  );
  assert.equal(snapshot.achievements[0]?.unlockMode, "hardcore");
  assert.equal(snapshot.achievements[0]?.hardcoreUnlockedAt, Date.parse("2022-08-23T22:56:38Z"));
  assert.equal(snapshot.achievements[0]?.softcoreUnlockedAt, Date.parse("2022-08-23T22:56:38Z"));
  assert.equal(snapshot.achievements[1]?.unlockMode, "softcore");
  assert.equal(snapshot.achievements[1]?.softcoreUnlockedAt, Date.parse("2022-09-01T22:56:38Z"));
  assert.equal(
    snapshot.achievements[0]?.metrics.find((metric) => metric.key === "unlocked-count")?.value,
    "200",
  );
  assert.equal(
    snapshot.achievements[0]?.metrics.find((metric) => metric.key === "hardcore-unlocked-count")?.value,
    "50",
  );
  assert.equal(
    snapshot.achievements[0]?.metrics.find((metric) => metric.key === "softcore-unlocked-count")?.value,
    "150",
  );
  assert.equal(snapshot.game.lastUnlockAt, Date.parse("2024-04-23T21:28:49+00:00"));
  assert.equal(
    snapshot.game.coverImageUrl,
    "https://i.retroachievements.org/Images/026368.png",
  );
  assert.equal(
    snapshot.game.boxArtImageUrl,
    "https://i.retroachievements.org/Images/066952.png",
  );
});

test("retroachievements achievement types survive normalization as typed classifications", () => {
  const rawGameProgress = createRetroAchievementsGameProgressResponse({
    gameId: "typed-game",
    title: "Typed Achievements",
    totalCount: 6,
  });
  rawGameProgress.Achievements = {
    "1": { ID: 1, Title: "Missable", Type: "missable", DisplayOrder: 1 },
    "2": { ID: 2, Title: "Progression", type: "progression", DisplayOrder: 2 },
    "3": { ID: 3, Title: "Win", Type: "win_condition", DisplayOrder: 3 },
    "4": { ID: 4, Title: "Normal", Type: null, DisplayOrder: 4 },
    "5": { ID: 5, Title: "Unknown", Type: "future_type", DisplayOrder: 5 },
    "6": { ID: 6, Title: "Absent", DisplayOrder: 6 },
  };

  const snapshot = normalizeRetroAchievementsGameDetail(rawGameProgress);

  assert.deepEqual(
    snapshot.achievements.map((achievement) => achievement.classification),
    ["missable", "progression", "win-condition", undefined, undefined, undefined],
  );
});

test("achievement type badge maps supported classifications and ignores absent cached or unknown values", () => {
  assert.equal(getAchievementTypeBadgeDescriptor("missable")?.label, "Missable");
  assert.equal(getAchievementTypeBadgeDescriptor("progression")?.label, "Progression");
  assert.equal(getAchievementTypeBadgeDescriptor("win-condition")?.label, "Win Condition");
  assert.match(
    renderToStaticMarkup(DeckyAchievementTypeBadge({ classification: "missable" })),
    />Missable<\/span>/u,
  );
  assert.match(
    renderToStaticMarkup(DeckyAchievementTypeBadge({ classification: "progression" })),
    />Progression<\/span>/u,
  );
  assert.match(
    renderToStaticMarkup(DeckyAchievementTypeBadge({ classification: "win-condition" })),
    />Win Condition<\/span>/u,
  );
  assert.equal(getAchievementTypeBadgeDescriptor(null), undefined);
  assert.equal(getAchievementTypeBadgeDescriptor(undefined), undefined);
  assert.equal(getAchievementTypeBadgeDescriptor("future_type"), undefined);
  assert.equal(DeckyAchievementTypeBadge({ classification: undefined }), null);
  assert.equal(DeckyAchievementTypeBadge({ classification: "future_type" }), null);

  const oldCachedAchievement = JSON.parse(JSON.stringify({
    providerId: "retroachievements",
    achievementId: "legacy-achievement",
    gameId: "legacy-game",
    title: "Legacy Achievement",
    isUnlocked: false,
    metrics: [],
  })) as NormalizedAchievement;
  assert.equal(getAchievementTypeBadgeDescriptor(oldCachedAchievement.classification), undefined);
});



test("retroachievements recent unlocks normalize badge art urls", () => {
  const rawRecentUnlocks: readonly RawRetroAchievementsRecentUnlockResponse[] = [
    {
      AchievementID: 108302,
      Title: "First Steps",
      Description: "Unlock a starter achievement.",
      BadgeURL: "/Badge/108302.png",
      GameID: 1234,
      GameTitle: "Test Game",
      GameIcon: "/Images/000001.png",
      ConsoleName: "NES",
      Date: "2024-01-01 00:00:00",
      HardcoreMode: true,
      Type: "progression",
    },
    {
      AchievementID: 108303,
      Title: "Second Steps",
      Description: "Unlock another starter achievement.",
      BadgeURL: "/Badge/108303.png",
      GameID: 1234,
      GameTitle: "Test Game",
      GameIcon: "/Images/000001.png",
      ConsoleName: "NES",
      Date: "2024-01-01 01:00:00",
      HardcoreMode: false,
    },
  ];

  const recentUnlocks = normalizeRetroAchievementsRecentUnlocks(rawRecentUnlocks);

  assert.equal(
    recentUnlocks[0]?.achievement.badgeImageUrl,
    "https://i.retroachievements.org/Badge/108302.png",
  );
  assert.equal(recentUnlocks[0]?.achievement.unlockMode, "hardcore");
  assert.equal(recentUnlocks[0]?.achievement.classification, "progression");
  assert.equal(recentUnlocks[1]?.achievement.unlockMode, "softcore");
});

test("retroachievements earned-between history splits saturated date ranges without dropping recent unlocks", async () => {
  const requests: Array<{ readonly from: number; readonly to: number }> = [];
  const saturatedResponse = Array.from({ length: 500 }, (_, index) => ({
    AchievementID: index + 1,
    Title: `Older ${String(index + 1)}`,
    GameID: 1,
    GameTitle: "Older Game",
    Date: "2020-01-01 00:00:00",
  } satisfies RawRetroAchievementsRecentUnlockResponse));
  const provider = createRetroAchievementsProvider({
    client: {
      async loadProfile() {
        throw new Error("not used");
      },
      async loadCompletionProgress() {
        throw new Error("not used");
      },
      async loadAchievementsEarnedBetween(_config, options) {
        requests.push({ from: options.fromEpochSeconds, to: options.toEpochSeconds });
        if (options.fromEpochSeconds === 100 && options.toEpochSeconds === 200) {
          return saturatedResponse;
        }

        return [
          {
            AchievementID: options.fromEpochSeconds === 100 ? 501 : 502,
            Title: options.fromEpochSeconds === 100 ? "Older boundary" : "Recent boundary",
            GameID: 1,
            GameTitle: "Test Game",
            Date: options.fromEpochSeconds === 100 ? "2020-01-02 00:00:00" : "2020-01-03 00:00:00",
          },
        ] satisfies readonly RawRetroAchievementsRecentUnlockResponse[];
      },
      async loadRecentUnlocks() {
        throw new Error("not used");
      },
      async loadRecentlyPlayedGames() {
        throw new Error("not used");
      },
      async loadGameProgress() {
        throw new Error("not used");
      },
    },
  });

  const unlocks = await provider.loadAchievementsEarnedBetween?.(
    { username: "alice", apiKey: "secret" },
    { fromEpochSeconds: 100, toEpochSeconds: 200 },
  );

  assert.deepStrictEqual(requests, [
    { from: 100, to: 200 },
    { from: 151, to: 200 },
    { from: 100, to: 150 },
  ]);
  assert.deepStrictEqual(
    unlocks?.map((unlock) => unlock.achievement.achievementId),
    ["501", "502"],
  );
});

test("retroachievements recent unlock timestamps parse timezone-less UTC strings correctly", () => {
  const nowAt = Date.parse("2026-04-18T18:45:00Z");
  const rawRecentUnlocks: readonly RawRetroAchievementsRecentUnlockResponse[] = [
    {
      AchievementID: 108302,
      Title: "First Steps",
      Description: "Unlock a starter achievement.",
      BadgeURL: "/Badge/108302.png",
      GameID: 1234,
      GameTitle: "Test Game",
      GameIcon: "/Images/000001.png",
      ConsoleName: "NES",
      Date: "2026-04-18 18:30:00",
    },
    {
      AchievementID: 108303,
      Title: "Second Steps",
      Description: "Unlock another starter achievement.",
      BadgeURL: "/Badge/108303.png",
      GameID: 1234,
      GameTitle: "Test Game",
      GameIcon: "/Images/000001.png",
      ConsoleName: "NES",
      Date: "2026-04-18T18:30:00Z",
    },
    {
      AchievementID: 108304,
      Title: "Broken Steps",
      Description: "Invalid time should be ignored.",
      BadgeURL: "/Badge/108304.png",
      GameID: 1234,
      GameTitle: "Test Game",
      GameIcon: "/Images/000001.png",
      ConsoleName: "NES",
      Date: "not-a-date",
    },
  ];

  const recentUnlocks = normalizeRetroAchievementsRecentUnlocks(rawRecentUnlocks);

  assert.equal(recentUnlocks.length, 3);
  assert.equal(recentUnlocks[0]?.unlockedAt, Date.parse("2026-04-18T18:30:00Z"));
  assert.equal(recentUnlocks[1]?.unlockedAt, Date.parse("2026-04-18T18:30:00Z"));
  assert.equal(nowAt - (recentUnlocks[0]?.unlockedAt ?? 0), 15 * 60 * 1000);
  assert.equal(recentUnlocks[2]?.unlockedAt, undefined);
});

test("retroachievements achievement row mode label helper distinguishes hardcore and softcore unlocks", () => {
  assert.equal(
    formatAchievementUnlockModeLabel({
      isUnlocked: true,
      unlockMode: "hardcore",
    }),
    "Hardcore unlocked",
  );

  assert.equal(
    formatAchievementUnlockModeLabel({
      isUnlocked: true,
      unlockMode: "softcore",
    }),
    "Softcore unlocked",
  );

  assert.equal(
    formatAchievementUnlockModeLabel({
      isUnlocked: true,
    }),
    "Unlocked",
  );

  assert.equal(
    formatAchievementUnlockModeLabel({
      isUnlocked: false,
    }),
    "Locked",
  );
});

test("decky game detail mode filter is retroachievements only", () => {
  assert.equal(shouldRenderAchievementModeFilter("retroachievements"), true);
  assert.equal(shouldRenderAchievementModeFilter("steam"), false);
  assert.equal(shouldRenderAchievementModeFilter(undefined), false);
});

test("retroachievements achievement status helper distinguishes hardcore and softcore unlocks", () => {
  assert.deepStrictEqual(
    buildAchievementStatus({
      isUnlocked: true,
      unlockMode: "hardcore",
      unlockedAt: Date.parse("2024-01-01T00:00:00Z"),
    }),
    {
      value: "Hardcore unlocked",
      secondary: `Hardcore unlocked ${new Date(Date.parse("2024-01-01T00:00:00Z")).toLocaleString()}`,
    },
  );

  assert.deepStrictEqual(
    buildAchievementStatus({
      isUnlocked: true,
      unlockMode: "softcore",
      unlockedAt: Date.parse("2024-01-01T01:00:00Z"),
    }),
    {
      value: "Softcore unlocked",
      secondary: `Softcore unlocked ${new Date(Date.parse("2024-01-01T01:00:00Z")).toLocaleString()}`,
    },
  );

  assert.deepStrictEqual(buildAchievementStatus({ isUnlocked: false }), {
    value: "Locked",
  });
});

test("retroachievements mode progress helper falls back safely when data is missing", () => {
  assert.equal(formatModeProgressSummary(undefined, "Hardcore"), "No hardcore progress available.");
  assert.equal(formatModeProgressSummary(undefined, "Softcore"), "No softcore progress available.");
});

test("retroachievements mode summary cards hide empty mode containers and keep meaningful ones", () => {
  const hardcoreAwardGame = {
    providerId: PROVIDER_ID,
    metrics: [
      {
        key: "highest-award-kind",
        label: "Highest Award",
        value: "beaten-hardcore",
      },
    ],
  };
  const softcoreAwardGame = {
    providerId: PROVIDER_ID,
    metrics: [
      {
        key: "highest-award-kind",
        label: "Highest Award",
        value: "beaten",
      },
    ],
  };
  const emptySummary = {
    unlockedCount: 0,
    completionPercent: 0,
  };

  assert.equal(
    shouldRenderRetroAchievementsModeSummaryCard({
      game: { providerId: STEAM_PROVIDER_ID, metrics: [] },
      mode: "softcore",
      summary: emptySummary,
      points: 0,
    }),
    false,
  );
  assert.equal(
    shouldRenderRetroAchievementsModeSummaryCard({
      game: { providerId: PROVIDER_ID, metrics: [] },
      mode: "softcore",
      summary: undefined,
      points: 0,
    }),
    false,
  );
  assert.equal(
    shouldRenderRetroAchievementsModeSummaryCard({
      game: { providerId: PROVIDER_ID, metrics: [] },
      mode: "softcore",
      summary: emptySummary,
      points: 0,
    }),
    false,
  );
  assert.equal(
    shouldRenderRetroAchievementsModeSummaryCard({
      game: { providerId: PROVIDER_ID, metrics: [] },
      mode: "hardcore",
      summary: {
        unlockedCount: 4,
        completionPercent: 50,
      },
      points: 17,
    }),
    true,
  );
  assert.equal(
    shouldRenderRetroAchievementsModeSummaryCard({
      game: { providerId: PROVIDER_ID, metrics: [] },
      mode: "softcore",
      summary: {
        unlockedCount: 0,
        completionPercent: 0,
      },
      points: 8,
    }),
    true,
  );
  assert.equal(
    shouldRenderRetroAchievementsModeSummaryCard({
      game: hardcoreAwardGame,
      mode: "hardcore",
      summary: emptySummary,
      points: 0,
    }),
    true,
  );
  assert.equal(
    shouldRenderRetroAchievementsModeSummaryCard({
      game: hardcoreAwardGame,
      mode: "softcore",
      summary: emptySummary,
      points: 0,
    }),
    false,
  );
  assert.equal(
    shouldRenderRetroAchievementsModeSummaryCard({
      game: softcoreAwardGame,
      mode: "softcore",
      summary: emptySummary,
      points: 0,
    }),
    true,
  );
});

test("provider-aware achievement presentation helpers suppress retro placeholders for steam", () => {
  const unlockedAt = Date.parse("2024-01-01T01:00:00Z");

  assert.equal(isSteamAchievementPresentationProvider("steam"), true);
  assert.equal(isSteamAchievementPresentationProvider("retroachievements"), false);
  assert.equal(
    formatProviderAchievementStatusText("steam", {
      isUnlocked: true,
      unlockedAt,
    }),
    `Unlocked ${new Date(unlockedAt).toLocaleString()}`,
  );
  assert.equal(
    formatProviderAchievementStatusText("retroachievements", {
      isUnlocked: true,
      unlockMode: "hardcore",
      unlockedAt,
    }),
    "Hardcore unlocked",
  );
  assert.equal(formatProviderAchievementPointsText("steam", undefined), undefined);
  assert.equal(formatProviderAchievementPointsText("retroachievements", undefined), "Points unavailable");
  assert.equal(formatProviderAchievementPointsText("steam", 5), "5 points");
  assert.equal(formatProviderAchievementPointsText("steam", 5, "prefixed"), "Points 5");
  assert.equal(formatProviderAchievementUnlockRateText("steam", undefined), undefined);
  assert.equal(
    formatProviderAchievementUnlockRateText("retroachievements", undefined),
    "Unlock rate unavailable",
  );
});

test("retroachievements achievement spotlight counts use game players and award totals", () => {
  const spotlightCounts = getAchievementSpotlightCounts(
    [
      { key: "unlocked-count", label: "Total Players", value: "1082" },
      { key: "hardcore-unlocked-count", label: "Hardcore Unlocks", value: "688" },
    ],
    [{ key: "total-players", label: "Total Players", value: "5253" }],
  );

  assert.equal(spotlightCounts.totalUnlockCount, 1082);
  assert.equal(spotlightCounts.hardcoreUnlockCount, 688);
  assert.equal(spotlightCounts.softcoreUnlockCount, 394);
  assert.equal(spotlightCounts.totalPlayers, 5253);
  assert.equal(spotlightCounts.unlockRatePercent?.toFixed(2), "20.60");
  assert.equal(formatAchievementUnlockRateValue(spotlightCounts.unlockRatePercent), "20.60%");
  assert.equal(
    formatAchievementUnlockRatePercent(spotlightCounts.unlockRatePercent),
    "20.60% unlock rate",
  );
});

test("retroachievements achievement spotlight counts fall back safely when source data is missing", () => {
  const spotlightCounts = getAchievementSpotlightCounts([], []);

  assert.equal(spotlightCounts.softcoreUnlockCount, undefined);
  assert.equal(spotlightCounts.hardcoreUnlockCount, undefined);
  assert.equal(spotlightCounts.totalPlayers, undefined);
  assert.equal(spotlightCounts.unlockRatePercent, undefined);
  assert.equal(formatAchievementUnlockRateValue(spotlightCounts.unlockRatePercent), "-");
  assert.equal(
    formatAchievementUnlockRatePercent(spotlightCounts.unlockRatePercent),
    "Unlock rate unavailable",
  );
});

test("retroachievements achievement detail counts use game players and award totals", () => {
  const detailCounts = getAchievementDetailCounts(
    [
      { key: "unlocked-count", label: "Total Players", value: "1082" },
      { key: "hardcore-unlocked-count", label: "Hardcore Unlocks", value: "688" },
    ],
    [{ key: "total-players", label: "Total Players", value: "5253" }],
  );

  assert.equal(detailCounts.totalUnlockCount, 1082);
  assert.equal(detailCounts.hardcoreUnlockCount, 688);
  assert.equal(detailCounts.softcoreUnlockCount, 394);
  assert.equal(detailCounts.totalPlayers, 5253);
  assert.equal(detailCounts.unlockRatePercent?.toFixed(2), "20.60");
  assert.equal(formatAchievementDetailUnlockRatePercent(detailCounts.unlockRatePercent), "20.60% unlock rate");
});

test("retroachievements profile normalizes avatar image urls", () => {
  const rawProfile: RawRetroAchievementsProfileResponse = {
    User: "Alice",
    ULID: "abc123",
    UserPic: "/UserPic/0001.png",
    MemberSince: "2020-01-02 00:00:00",
    Motto: "Keep on playing",
    TotalPoints: 1234,
  };

  const profile = normalizeRetroAchievementsProfile(
    rawProfile,
    {
      unlockedCount: 12,
      totalCount: 20,
      completionPercent: 60,
    },
    {
      username: "alice",
      apiKey: "secret",
    },
  );

  assert.equal(
    profile.identity.avatarUrl,
    "https://i.retroachievements.org/UserPic/0001.png",
  );
  assert.equal(profile.motto, "Keep on playing");
});

test("profile avatar cache bust helper preserves query params and updates a safe refresh token", () => {
  const refreshedAt = 1_717_000_000_000;
  const cachedAvatar = addProfileAvatarCacheBustParam(
    "https://example.com/avatar.png?existing=1",
    refreshedAt,
  );

  assert.equal(cachedAvatar !== undefined, true);
  const url = new URL(cachedAvatar ?? "");
  assert.equal(url.searchParams.get("existing"), "1");
  assert.equal(url.searchParams.get("ac_avatar_refresh"), String(refreshedAt));
  assert.equal(url.searchParams.getAll("ac_avatar_refresh").length, 1);

  const updatedAvatar = addProfileAvatarCacheBustParam(
    "https://example.com/avatar.png?existing=1&ac_avatar_refresh=42",
    refreshedAt,
  );
  assert.equal(updatedAvatar !== undefined, true);
  const updatedUrl = new URL(updatedAvatar ?? "");
  assert.equal(updatedUrl.searchParams.get("existing"), "1");
  assert.equal(updatedUrl.searchParams.get("ac_avatar_refresh"), String(refreshedAt));
  assert.equal(updatedUrl.searchParams.getAll("ac_avatar_refresh").length, 1);

  assert.equal(
    addProfileAvatarCacheBustParam("https://example.com/avatar.png", undefined),
    "https://example.com/avatar.png",
  );
  assert.equal(addProfileAvatarCacheBustParam("not a url", refreshedAt), "not a url");
  assert.equal(addProfileAvatarCacheBustParam(undefined, refreshedAt), undefined);
});

test("achievement companion settings normalize invalid stored values", () => {
  const settings = parseAchievementCompanionSettings(
    JSON.stringify({
      recentAchievementsCount: 9,
      recentlyPlayedCount: 3,
      showCompletionProgressSubsets: "yes",
      defaultCompletionProgressFilter: "secret",
    }),
  );

  assert.deepStrictEqual(settings, {
    ...DEFAULT_ACHIEVEMENT_COMPANION_SETTINGS,
    gamePageAchievementBadgeSize: "large",
    recentlyPlayedCount: 3,
  });
  assert.equal(
    serializeAchievementCompanionSettings(DEFAULT_ACHIEVEMENT_COMPANION_SETTINGS),
    JSON.stringify(DEFAULT_ACHIEVEMENT_COMPANION_SETTINGS),
  );
});

test("theme settings default to Blue, preserve Neon, and accept every alternate palette", () => {
  assert.equal(DEFAULT_ACHIEVEMENT_COMPANION_SETTINGS.theme, "ac-blue");
  assert.equal(parseAchievementCompanionSettings("{}").theme, "ac-blue");
  assert.equal(parseAchievementCompanionSettings('{"theme":"ac-neon"}').theme, "ac-neon");
  assert.equal(parseAchievementCompanionSettings('{"theme":"ac-arcade"}').theme, "ac-arcade");
  assert.equal(parseAchievementCompanionSettings('{"theme":"ac-aurora"}').theme, "ac-aurora");
  assert.equal(parseAchievementCompanionSettings('{"theme":"ac-carbon"}').theme, "ac-carbon");
  assert.equal(parseAchievementCompanionSettings('{"theme":"ac-dune"}').theme, "ac-dune");
  assert.equal(parseAchievementCompanionSettings('{"theme":"ac-ember"}').theme, "ac-ember");
  assert.equal(parseAchievementCompanionSettings('{"theme":"ac-grove"}').theme, "ac-grove");
  assert.equal(parseAchievementCompanionSettings('{"theme":"ac-onyx"}').theme, "ac-onyx");
  assert.equal(parseAchievementCompanionSettings('{"theme":"ac-paper"}').theme, "ac-paper");
  assert.equal(parseAchievementCompanionSettings('{"theme":"ac-pocket-lcd"}').theme, "ac-pocket-lcd");
  assert.equal(parseAchievementCompanionSettings('{"theme":"ac-ra-classic"}').theme, "ac-ra-classic");
  assert.equal(parseAchievementCompanionSettings('{"theme":"ac-rosewood"}').theme, "ac-rosewood");
  assert.equal(parseAchievementCompanionSettings('{"theme":"ac-solarized"}').theme, "ac-solarized");
  assert.equal(parseAchievementCompanionSettings('{"theme":"ac-steam"}').theme, "ac-steam");
  assert.equal(parseAchievementCompanionSettings('{"theme":"ac-terminal"}').theme, "ac-terminal");
  assert.equal(parseAchievementCompanionSettings('{"theme":"ac-velvet"}').theme, "ac-velvet");
  assert.equal(parseAchievementCompanionSettings('{"theme":"ac-glacier"}').theme, "ac-blue");
  assert.equal(parseAchievementCompanionSettings('{"theme":"unknown"}').theme, "ac-blue");
});

test("SteamHunters personal data stays enabled for existing settings and can be disabled", () => {
  assert.equal(DEFAULT_ACHIEVEMENT_COMPANION_SETTINGS.steamHuntersPersonalDataEnabled, true);
  assert.equal(parseAchievementCompanionSettings(JSON.stringify({ recentAchievementsCount: 3 })).steamHuntersPersonalDataEnabled, true);
  assert.equal(parseAchievementCompanionSettings(JSON.stringify({ steamHuntersPersonalDataEnabled: false })).steamHuntersPersonalDataEnabled, false);
  assert.equal(parseAchievementCompanionSettings(JSON.stringify({ steamHuntersPersonalDataEnabled: "false" })).steamHuntersPersonalDataEnabled, true);
});

test("game page badge settings preserve valid preferences and reject invalid positions", () => {
  assert.equal(DEFAULT_ACHIEVEMENT_COMPANION_SETTINGS.gamePageAchievementBadgeSize, "small");
  assert.deepStrictEqual(DEFAULT_GAME_PAGE_ACHIEVEMENT_BADGE_COLORS, {
    perfected: "purple",
    mastered: "gold",
    beaten: "blue",
    inProgress: "gray",
  });
  assert.equal(parseAchievementCompanionSettings(undefined).gamePageAchievementBadgeSize, "small");
  assert.equal(parseAchievementCompanionSettings("{}").gamePageAchievementBadgeSize, "large");
  const validSettings = parseAchievementCompanionSettings(
    JSON.stringify({
      showGamePageAchievementBadge: false,
      gamePageAchievementBadgeSize: "small",
      gamePageAchievementBadgePosition: "bottom-center",
      gamePageAchievementBadgeColors: {
        perfected: "gold",
        mastered: "cyan",
        beaten: "red",
        inProgress: "purple",
      },
    }),
  );
  assert.equal(validSettings.showGamePageAchievementBadge, false);
  assert.equal(validSettings.gamePageAchievementBadgeSize, "small");
  assert.equal(validSettings.gamePageAchievementBadgePosition, "bottom-center");
  assert.deepStrictEqual(validSettings.gamePageAchievementBadgeColors, {
    perfected: "gold",
    mastered: "cyan",
    beaten: "red",
    inProgress: "purple",
  });

  const invalidPositionSettings = parseAchievementCompanionSettings(
    JSON.stringify({
      gamePageAchievementBadgePosition: "middle-left",
      gamePageAchievementBadgeSize: "huge",
      gamePageAchievementBadgeColors: {
        perfected: "orange",
        mastered: "green",
        beaten: 42,
        inProgress: "gray",
      },
    }),
  );
  assert.equal(
    invalidPositionSettings.gamePageAchievementBadgePosition,
    DEFAULT_ACHIEVEMENT_COMPANION_SETTINGS.gamePageAchievementBadgePosition,
  );
  assert.equal(invalidPositionSettings.gamePageAchievementBadgeSize, "large");
  assert.deepStrictEqual(invalidPositionSettings.gamePageAchievementBadgeColors, {
    ...DEFAULT_GAME_PAGE_ACHIEVEMENT_BADGE_COLORS,
    mastered: "green",
    inProgress: "gray",
  });
});

test("decky provider config persists and clears retroachievements credentials", async () => {
  await withMockDeckyStorage(async () => {
    assert.equal(readDeckyProviderConfig("retroachievements"), undefined);

    assert.equal(
      await writeDeckyProviderConfig(
        {
          username: "alice",
          recentAchievementsCount: 10,
          recentlyPlayedCount: 7,
        },
        "secret",
      ),
      true,
    );
    assert.deepStrictEqual(readDeckyProviderConfig("retroachievements"), {
      username: "alice",
      hasApiKey: true,
      recentAchievementsCount: 10,
      recentlyPlayedCount: 7,
    });

    assert.equal(await clearDeckyProviderConfig(), true);
    assert.equal(readDeckyProviderConfig("retroachievements"), undefined);
  });
});

test("retroachievements dashboard preferences prefer provider counts and fall back to settings", () => {
  const fallbackSettings = {
    ...DEFAULT_ACHIEVEMENT_COMPANION_SETTINGS,
    recentAchievementsCount: 7,
    recentlyPlayedCount: 3,
  };

  assert.deepStrictEqual(
    resolveProviderDashboardPreferences(
      {
        username: "alice",
        hasApiKey: true,
        recentAchievementsCount: 10,
        recentlyPlayedCount: 10,
      },
      fallbackSettings,
    ),
    {
      recentAchievementsCount: 10,
      recentlyPlayedCount: 10,
    },
  );

  assert.deepStrictEqual(
    resolveProviderDashboardPreferences(
      {
        username: "alice",
        hasApiKey: true,
      },
      fallbackSettings,
    ),
    {
      recentAchievementsCount: 7,
      recentlyPlayedCount: 3,
    },
  );
});

test("decky sign out clears retroachievements credentials and recent history", async () => {
  await withMockDeckyStorage(async () => {
    const recentHistoryStorageKey = "achievement-companion:decky:recent-achievements:retroachievements:alice";

    assert.equal(
      writeDeckyStorageText(recentHistoryStorageKey, JSON.stringify([{ recentUnlock: 1 }])),
      true,
    );
    assert.equal(await writeDeckyProviderConfig({ username: "alice" }, "secret"), true);

    assert.equal(await clearDeckyRetroAchievementsAccountState(), true);
    assert.equal(readDeckyProviderConfig("retroachievements"), undefined);
    assert.equal(readDeckyStorageText(recentHistoryStorageKey), undefined);
  });
});

test("decky steam provider config clears saved api key credentials", async () => {
  await withMockDeckyStorage(async () => {
    assert.equal(
      await writeDeckySteamProviderConfig(
        {
          steamId64: "12345678901234567",
          language: "english",
          recentAchievementsCount: 5,
          recentlyPlayedCount: 5,
          includePlayedFreeGames: false,
        },
        "secret",
      ),
      true,
    );

    assert.equal(await clearDeckySteamProviderConfig(), true);
    assert.equal(readDeckySteamProviderConfig("steam"), undefined);
  });
});

test("decky credential migration and draft saves stay backend-owned", async () => {
  await withMockDeckyStorage(async () => {
    const retroAchievementsLegacyStorageKey = "achievement-companion:decky:retroachievements:config";
    const steamLegacyStorageKey = "achievement-companion:decky:steam:config";

    writeDeckyStorageText(
      retroAchievementsLegacyStorageKey,
      JSON.stringify({ username: "alice", apiKey: "ra-secret" }),
    );
    writeDeckyStorageText(
      steamLegacyStorageKey,
      JSON.stringify({
        steamId64: "12345678901234567",
        apiKey: "steam-secret",
        language: "english",
        recentAchievementsCount: 5,
        recentlyPlayedCount: 5,
        includePlayedFreeGames: false,
      }),
    );

    assert.deepStrictEqual(
      await loadDeckyRetroAchievementsProviderConfig("retroachievements"),
      {
        username: "alice",
        hasApiKey: true,
      },
    );
    assert.deepStrictEqual(await loadDeckySteamProviderConfig("steam"), {
      steamId64: "12345678901234567",
      hasApiKey: true,
      language: "english",
      recentAchievementsCount: 5,
      recentlyPlayedCount: 5,
      includePlayedFreeGames: false,
    });
    assert.equal(getDeckyBackendTestSecret("retroachievements"), "ra-secret");
    assert.equal(getDeckyBackendTestSecret("steam"), "steam-secret");
    assert.equal(readDeckyStorageText(retroAchievementsLegacyStorageKey), undefined);
    assert.equal(readDeckyStorageText(steamLegacyStorageKey), undefined);

    assert.equal(await writeDeckyProviderConfig({ username: "alice" }, ""), true);
    assert.equal(getDeckyBackendTestSecret("retroachievements"), "ra-secret");
    assert.equal(
      await writeDeckyProviderConfig({ username: "alice" }, "ra-secret-2"),
      true,
    );
    assert.equal(getDeckyBackendTestSecret("retroachievements"), "ra-secret-2");

    assert.equal(
      await writeDeckySteamProviderConfig(
        {
          steamId64: "12345678901234567",
          language: "english",
          recentAchievementsCount: 5,
          recentlyPlayedCount: 5,
          includePlayedFreeGames: false,
        },
        "",
      ),
      true,
    );
    assert.equal(getDeckyBackendTestSecret("steam"), "steam-secret");
    assert.equal(
      await writeDeckySteamProviderConfig(
        {
          steamId64: "12345678901234567",
          language: "english",
          recentAchievementsCount: 5,
          recentlyPlayedCount: 5,
          includePlayedFreeGames: false,
        },
        "steam-secret-2",
      ),
      true,
    );
    assert.equal(getDeckyBackendTestSecret("steam"), "steam-secret-2");
  });
});

test("decky legacy credential migration keeps the old localStorage key when the backend save fails", async () => {
  await withMockDeckyStorage(async () => {
    const retroAchievementsLegacyStorageKey = "achievement-companion:decky:retroachievements:config";
    writeDeckyStorageText(
      retroAchievementsLegacyStorageKey,
      JSON.stringify({ username: "alice", apiKey: "ra-secret" }),
    );

    setDeckyBackendCallImplementationForTests(async (route: string) => {
      if (route === "get_provider_configs") {
        return { version: 1 };
      }

      if (route === "save_retroachievements_credentials") {
        return undefined;
      }

      if (route === "save_steam_credentials") {
        return undefined;
      }

      if (route === "clear_provider_credentials") {
        return false;
      }

      throw new Error(`Unexpected decky backend route in test: ${route}`);
    });

    try {
      assert.equal(await loadDeckyRetroAchievementsProviderConfig("retroachievements"), undefined);
      assert.ok(readDeckyStorageText(retroAchievementsLegacyStorageKey) !== undefined);
      assert.equal(getDeckyBackendTestSecret("retroachievements"), undefined);
    } finally {
      setDeckyBackendCallImplementationForTests(deckyBackendTestCallImplementation);
    }
  });
});

test("frontend log redaction masks secret-like fields and preserves safe diagnostics", () => {
  const sentinel = "AC_REDACTION_SENTINEL";
  const rawMessage = [
    `apiKey=${sentinel}`,
    `apiKeyDraft: ${sentinel}`,
    `key=${sentinel}`,
    `y=${sentinel}`,
    `token=${sentinel}`,
    `password=${sentinel}`,
    `secret=${sentinel}`,
    `Authorization: Bearer ${sentinel}`,
    `Bearer ${sentinel}`,
    `https://retroachievements.org/API/API_GetUserProfile.php?u=alice&y=${sentinel}`,
    `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${sentinel}&steamid=1234`,
  ].join(" ");

  const redactedMessage = redactFrontendLogText(rawMessage);

  assert.doesNotMatch(redactedMessage, new RegExp(sentinel));
  assert.match(redactedMessage, /apiKey: \[redacted\]/);
  assert.match(redactedMessage, /apiKeyDraft: \[redacted\]/);
  assert.match(redactedMessage, /key: \[redacted\]/);
  assert.match(redactedMessage, /y: \[redacted\]/);
  assert.match(redactedMessage, /token: \[redacted\]/);
  assert.match(redactedMessage, /password: \[redacted\]/);
  assert.match(redactedMessage, /secret: \[redacted\]/);
  assert.match(redactedMessage, /Authorization: \[redacted\]/);
  assert.match(redactedMessage, /Bearer \[redacted\]/);
  assert.match(redactedMessage, /[?&]y=\[redacted\]/);
  assert.match(redactedMessage, /[?&]key=\[redacted\]/);

  const redactedPayload = redactFrontendLogValue({
    providerId: "steam",
    path: "IPlayerService/GetOwnedGames/v1/",
    status: 401,
    durationMs: 1234,
    apiKey: sentinel,
    apiKeyDraft: sentinel,
    key: sentinel,
    y: sentinel,
    token: sentinel,
    password: sentinel,
    secret: sentinel,
    Authorization: `Bearer ${sentinel}`,
    nested: [
      {
        url: `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${sentinel}`,
        message: `Authorization=Bearer ${sentinel}`,
      },
    ],
  }) as Record<string, unknown>;

  assert.equal(redactedPayload.providerId, "steam");
  assert.equal(redactedPayload.path, "IPlayerService/GetOwnedGames/v1/");
  assert.equal(redactedPayload.status, 401);
  assert.equal(redactedPayload.durationMs, 1234);
  assert.equal(redactedPayload.apiKey, "[redacted]");
  assert.equal(redactedPayload.apiKeyDraft, "[redacted]");
  assert.equal(redactedPayload.Authorization, "[redacted]");

  const renderedPayload = JSON.stringify(redactedPayload);
  assert.doesNotMatch(renderedPayload, new RegExp(sentinel));
  assert.match(renderedPayload, /\[redacted\]/);
});

test("decky provider barrel does not expose stale generic save or clear facades", () => {
  const deckyProviderIndexSource = readFileSync(
    new URL("../src/platform/decky/providers/index.ts", import.meta.url),
    "utf-8",
  );
  const providerConfigStoreSource = readFileSync(
    new URL("../src/platform/decky/providers/provider-config-store.ts", import.meta.url),
    "utf-8",
  );

  assert.doesNotMatch(
    deckyProviderIndexSource,
    /export async function writeDeckyProviderConfig/,
  );
  assert.doesNotMatch(
    deckyProviderIndexSource,
    /export async function clearDeckyProviderAccountState/,
  );
  assert.doesNotMatch(
    deckyProviderIndexSource,
    /saveDeckyRetroAchievementsCredentials|saveDeckySteamCredentials/,
  );
  assert.doesNotMatch(
    providerConfigStoreSource,
    /export async function clearDeckyProviderAccountState/,
  );
});





test("legacy provider forms retain their immediate-persistence controls outside the new full-screen dropdowns", () => {
  const retroAchievementsProviderSettingsSource = readFileSync(
    "src/platform/decky/providers/retroachievements/provider-settings-page.tsx",
    "utf8",
  );
  const steamProviderSettingsSource = readFileSync(
    "src/platform/decky/providers/steam/provider-settings-page.tsx",
    "utf8",
  );
  const steamCredentialsFormSource = readFileSync(
    "src/platform/decky/providers/steam/credentials-form.tsx",
    "utf8",
  );
  const fullscreenActionControlsSource = readFileSync(
    "src/platform/decky/decky-full-screen-action-controls.tsx",
    "utf8",
  );

  assert.match(
    retroAchievementsProviderSettingsSource,
    /import \{[^}]*PanelSection, PanelSectionRow, ScrollPanel[^}]*\} from "@decky\/ui"/u,
  );
  assert.doesNotMatch(retroAchievementsProviderSettingsSource, /label="Show subsets"/u);
  assert.match(
    retroAchievementsProviderSettingsSource,
    /import \{ DeckyProviderSettingsActionRow \} from "\.\.\/\.\.\/decky-provider-settings-action-row"/u,
  );
  assert.match(
    retroAchievementsProviderSettingsSource,
    /<DeckyProviderSettingsActionRow[\s\S]*label="Recent Achievements count"[\s\S]*getNextCountOption\(providerRecentAchievementsCount\)[\s\S]*persistProviderCounts\(\{ recentAchievementsCount \}\)/u,
  );
  assert.match(
    retroAchievementsProviderSettingsSource,
    /<DeckyProviderSettingsActionRow[\s\S]*label="Recently Played count"[\s\S]*getNextCountOption\(providerRecentlyPlayedCount\)[\s\S]*persistProviderCounts\(\{ recentlyPlayedCount \}\)/u,
  );
  assert.doesNotMatch(retroAchievementsProviderSettingsSource, /label="Default Completion Progress filter"/u);
  assert.doesNotMatch(
    retroAchievementsProviderSettingsSource,
    /DeckyActionButtonItem|DropdownItem|COUNT_DROPDOWN_OPTIONS|COMPLETION_PROGRESS_FILTER_DROPDOWN_OPTIONS/,
  );
  assert.doesNotMatch(steamProviderSettingsSource, /DropdownItem|\bDropdown\b/);
  assert.match(
    steamCredentialsFormSource,
    /import \{[\s\S]*DeckyProviderSettingsActionGroup,[\s\S]*DeckyProviderSettingsActionRow,[\s\S]*\} from "\.\.\/\.\.\/decky-provider-settings-action-row"/u,
  );
  assert.match(
    steamCredentialsFormSource,
    /<DeckyProviderSettingsActionRow[\s\S]*label="Recent Achievements count"[\s\S]*<DeckyProviderSettingsActionRow[\s\S]*label="Recently Played count"/u,
  );
  assert.doesNotMatch(steamCredentialsFormSource, /Include played free games/u);
  assert.doesNotMatch(steamCredentialsFormSource, /DropdownItem|\bDropdown\b/);
  assert.match(fullscreenActionControlsSource, /import \{[^}]*\bFocusable\b[^}]*\btype FocusableProps\b[^}]*\} from "@decky\/ui"/u);
  assert.doesNotMatch(
    `${retroAchievementsProviderSettingsSource}\n${steamCredentialsFormSource}`,
    /localStorage|sessionStorage/,
  );
});

test("provider setup and current settings actions use focusable controls", () => {
  const fullscreenSettingsSource = readFileSync(
    "src/platform/decky/decky-full-screen-settings-page.tsx",
    "utf8",
  );
  const fullscreenAboutSource = readFileSync(
    "src/platform/decky/decky-full-screen-about-page.tsx",
    "utf8",
  );
  const providerSettingsActionRowSource = readFileSync(
    "src/platform/decky/decky-provider-settings-action-row.tsx",
    "utf8",
  );
  const focusStylesSource = readFileSync(
    "src/platform/decky/decky-focus-styles.tsx",
    "utf8",
  );
  const retroAchievementsSetupSource = readFileSync(
    "src/platform/decky/providers/retroachievements/setup-screen.tsx",
    "utf8",
  );
  const retroAchievementsCredentialsSource = readFileSync(
    "src/platform/decky/providers/retroachievements/credentials-form.tsx",
    "utf8",
  );
  const retroAchievementsProviderSettingsSource = readFileSync(
    "src/platform/decky/providers/retroachievements/provider-settings-page.tsx",
    "utf8",
  );
  const steamSetupSource = readFileSync(
    "src/platform/decky/providers/steam/setup-screen.tsx",
    "utf8",
  );
  const steamCredentialsSource = readFileSync(
    "src/platform/decky/providers/steam/credentials-form.tsx",
    "utf8",
  );
  const steamProviderSettingsSource = readFileSync(
    "src/platform/decky/providers/steam/provider-settings-page.tsx",
    "utf8",
  );
  const fullscreenActionControlsSource = readFileSync(
    "src/platform/decky/decky-full-screen-action-controls.tsx",
    "utf8",
  );

  for (const setupSource of [retroAchievementsSetupSource, steamSetupSource]) {
    assert.match(
      setupSource,
      /<DeckyCompactPillActionItem[\s\S]*label="Back"[\s\S]*onCancelButton=\{onBackToProviders\}[\s\S]*onClick=\{onBackToProviders\}/u,
    );
    assert.match(setupSource, /saveLabel="Save provider settings"[\s\S]*compactSurface/u);
  }

  assert.match(
    retroAchievementsCredentialsSource,
    /<DeckyProviderSettingsActionGroup>[\s\S]*<DeckyCompactPillActionItem[\s\S]*emphasis="primary"[\s\S]*label=\{saveLabel\}[\s\S]*void handleSave\(\)[\s\S]*label=\{clearLabel \?\? "Clear credentials"\}[\s\S]*void handleClear\(\)[\s\S]*<\/DeckyProviderSettingsActionGroup>/u,
  );
  assert.doesNotMatch(retroAchievementsCredentialsSource, /DeckyCompactPillActionGroup/);
  assert.doesNotMatch(retroAchievementsCredentialsSource, /DeckyActionButtonItem/);
  assert.match(
    steamCredentialsSource,
    /<DeckyProviderSettingsActionGroup>[\s\S]*<DeckyCompactPillActionItem[\s\S]*emphasis="primary"[\s\S]*label=\{saveLabel\}[\s\S]*void handleSave\(\)[\s\S]*label=\{clearLabel \?\? "Clear credentials"\}[\s\S]*void handleClear\(\)[\s\S]*<\/DeckyProviderSettingsActionGroup>/u,
  );
  assert.doesNotMatch(steamCredentialsSource, /DeckyCompactPillActionGroup/);
  assert.doesNotMatch(steamCredentialsSource, /DeckyActionButtonItem/);
  assert.match(
    steamProviderSettingsSource,
    /<DeckyCompactPillActionItem[\s\S]*emphasis="primary"[\s\S]*disabled=\{scanButtonDisabled\}[\s\S]*label=\{scanButtonLabel\}[\s\S]*void handleScanLibraryAchievements\(\)/u,
  );
  assert.doesNotMatch(steamProviderSettingsSource, /DeckyActionButtonItem/);

  assert.match(
    retroAchievementsProviderSettingsSource,
    /<DeckyFullscreenActionButton[\s\S]*label="Back"[\s\S]*isFullscreenBackAction/u,
  );
  assert.match(
    steamProviderSettingsSource,
    /<DeckyFullscreenActionButton[\s\S]*label="Back"[\s\S]*isFullscreenBackAction/u,
  );
  assert.match(fullscreenActionControlsSource, /import \{[^}]*\bFocusable\b[^}]*\btype FocusableProps\b[^}]*\} from "@decky\/ui"/u);
  assert.doesNotMatch(fullscreenSettingsSource, /<SteamSettingsSectionPill title="Updates"/u);
  assert.match(fullscreenAboutSource, /<DeckyUpdateSettingsPanel onGamepadDirection=\{handleCardDirection\} \/>/u);
  assert.doesNotMatch(fullscreenSettingsSource, /DeckyActionButtonItem|ButtonItem/);
  assert.match(
    providerSettingsActionRowSource,
    /import \{ Focusable, type FocusableProps, PanelSectionRow \} from "@decky\/ui"/u,
  );
  assert.match(
    providerSettingsActionRowSource,
    /export function DeckyProviderSettingsActionGroup[\s\S]*<Focusable[\s\S]*flow-children="left-right"[\s\S]*noFocusRing[\s\S]*style=\{getActionGroupStyle\(\)\}/u,
  );
  assert.match(
    providerSettingsActionRowSource,
    /function getActionGroupStyle\(\)[\s\S]*alignItems: "center"[\s\S]*justifyContent: "center"[\s\S]*gap: "8px 10px"[\s\S]*width: "100%"/u,
  );
  assert.match(
    providerSettingsActionRowSource,
    /<Focusable[\s\S]*focusClassName=\{DECKY_PROVIDER_SETTINGS_ACTION_ROW_ACTIVE_CLASS\}[\s\S]*focusWithinClassName=\{DECKY_PROVIDER_SETTINGS_ACTION_ROW_ACTIVE_CLASS\}[\s\S]*role="button"[\s\S]*onActivate=\{disabled \? \(\) => undefined : onClick\}[\s\S]*onClick=\{disabled \? \(\) => undefined : onClick\}/u,
  );
  assert.doesNotMatch(providerSettingsActionRowSource, /ButtonItem|DropdownItem/);
  assert.match(providerSettingsActionRowSource, /actionLabel = "Change"/u);
  assert.match(
    providerSettingsActionRowSource,
    /className=\{DECKY_PROVIDER_SETTINGS_ACTION_PILL_CLASS\}[\s\S]*style=\{getActionPillStyle\(isFocused\)\}/u,
  );
  assert.match(providerSettingsActionRowSource, /margin: "5px 0"/u);
  assert.match(providerSettingsActionRowSource, /scrollMarginBlock: 10/u);
  assert.match(
    focusStylesSource,
    /\.achievement-companion-focus-pill\[role="button"\]\.achievement-companion-focus-pill--focused/u,
  );
  assert.match(
    focusStylesSource,
    /DECKY_PROVIDER_SETTINGS_ACTION_ROW_ACTIVE_CLASS[\s\S]*qamTheme\.focus\.shadow[\s\S]*DECKY_PROVIDER_SETTINGS_ACTION_PILL_CLASS/u,
  );
  assert.match(
    readFileSync("src/platform/decky/decky-compact-pill-action-item.tsx", "utf8"),
    /focusClassName=\{DECKY_FOCUS_PILL_ACTIVE_CLASS\}[\s\S]*focusWithinClassName=\{DECKY_FOCUS_PILL_ACTIVE_CLASS\}/u,
  );
  assert.match(
    readFileSync("src/platform/decky/decky-compact-pill-action-item.tsx", "utf8"),
    /function getFocusedPillStyle\(selected: boolean\)[\s\S]*focusedSelectedContentStat[\s\S]*focusedContentStat[\s\S]*qamTheme\.focus\.shadow/u,
  );

  assert.match(
    retroAchievementsCredentialsSource,
    /<DeckyCredentialTextField[\s\S]*bIsPassword=\{apiKeyInputDescriptor\.bIsPassword\}[\s\S]*style=\{\{\s*\.\.\.getCredentialInputStyle\(\),\s*\.\.\.getDeckyCredentialTextFieldMaskStyle\(\)\s*\}\}/u,
  );
  assert.match(
    steamCredentialsSource,
    /<DeckyCredentialTextField[\s\S]*style=\{getDeckyCredentialTextFieldMaskStyle\(\)\}/u,
  );
  assert.doesNotMatch(retroAchievementsProviderSettingsSource, /DropdownItem|\bDropdown\b/);
  assert.match(
    retroAchievementsProviderSettingsSource,
    /<DeckyProviderSettingsActionRow[\s\S]*label="Recent Achievements count"[\s\S]*label="Recently Played count"/u,
  );
  assert.doesNotMatch(retroAchievementsProviderSettingsSource, /DeckyActionButtonItem|ButtonItem/);
  assert.doesNotMatch(retroAchievementsProviderSettingsSource, /<ToggleField[\s\S]*label="Show subsets"/u);

  assert.doesNotMatch(
    [
      retroAchievementsSetupSource,
      retroAchievementsCredentialsSource,
      retroAchievementsProviderSettingsSource,
      steamSetupSource,
      steamCredentialsSource,
      steamProviderSettingsSource,
    ].join("\n"),
    /localStorage|sessionStorage/,
  );
});




test("Decky third-party notices preserve the bundled API license and generated-file boundary", () => {
  const noticeSource = readFileSync("THIRD_PARTY_NOTICES.md", "utf8");
  const ignoreLines = readFileSync(".gitignore", "utf8").split(/\r?\n/u);
  const licenseStart = "                   GNU LESSER GENERAL PUBLIC LICENSE";

  assert.equal(ignoreLines.filter((line) => line === "defaults/THIRD_PARTY_NOTICES.md").length, 1);
  assert.equal(ignoreLines.includes("defaults/"), false);
  assert.doesNotMatch(noticeSource, /\uFFFD/u);
  assert.match(noticeSource, /`@decky\/api` \| `1\.1\.3`/u);
  assert.match(noticeSource, /GNU Lesser General Public License v2\.1 \(`LGPL-2\.1`\)/u);
  assert.match(noticeSource, /SteamDeckHomebrew\/loader-api\/tree\/v1\.1\.3/u);
  assert.match(noticeSource, /Steam and the Steam logo are trademarks/u);
  assert.match(noticeSource, new RegExp(licenseStart, "u"));
  assert.match(noticeSource, /That's all there is to it!\r?\n```/u);

  const embeddedLicense = `${noticeSource.split(/```text\r?\n/u, 2)[1]?.split(/\r?\n```/u, 1)[0] ?? ""}\n`;
  const normalizeLineEndings = (value: string): string => value.replace(/\r\n/gu, "\n");
  assert.equal(
    normalizeLineEndings(embeddedLicense),
    normalizeLineEndings(readFileSync("node_modules/@decky/api/LICENSE", "utf8")),
  );
});


test("RetroAchievements profile summary is optional and bounded by a configurable wait", async () => {
  const summary = { Rank: 12, CasualRank: 34 };
  assert.equal(await loadOptionalRetroAchievementsProfileSummary(undefined, 1), undefined);
  assert.equal(await loadOptionalRetroAchievementsProfileSummary(async () => summary, 20), summary);
  assert.equal(await loadOptionalRetroAchievementsProfileSummary(async () => {
    throw new Error("optional summary unavailable");
  }, 20), undefined);
  assert.equal(await loadOptionalRetroAchievementsProfileSummary(() => new Promise(() => undefined), 2), undefined);
});

test("RetroAchievements profile aggregates require complete denominators and mode counts", () => {
  const incomplete = [
    { NumAwarded: 10 },
    { NumAwarded: 2, NumAwardedHardcore: 2, MaxPossible: 4 },
  ] satisfies readonly RawRetroAchievementsCompletionProgressEntry[];
  assert.deepEqual(summarizeRetroAchievementsCompletionProgress(incomplete), { unlockedCount: 12 });
  assert.deepEqual(summarizeRetroAchievementsProfileAchievementCounts(incomplete), {});
  assert.deepEqual(summarizeRetroAchievementsCompletionProgress([
    { NumAwarded: 3, MaxPossible: 0 },
    { NumAwarded: 2, MaxPossible: 4 },
  ]), { unlockedCount: 5 });

  const complete = [
    { NumAwarded: 10, NumAwardedHardcore: 3, MaxPossible: 10 },
    { NumAwarded: 2, NumAwardedHardcore: 2, MaxPossible: 4 },
  ] satisfies readonly RawRetroAchievementsCompletionProgressEntry[];
  assert.deepEqual(summarizeRetroAchievementsCompletionProgress(complete), {
    unlockedCount: 12,
    totalCount: 14,
    completionPercent: 86,
  });
  assert.deepEqual(summarizeRetroAchievementsProfileAchievementCounts(complete), {
    hardcoreUnlockedCount: 5,
    softcoreUnlockedCount: 7,
  });
});

test("RetroAchievements game cards reject impossible totals and mode counts", () => {
  const [completionGame] = normalizeRetroAchievementsCompletionProgressGames([{
    GameID: 101,
    Title: "Inconsistent totals",
    NumAwarded: 5,
    NumAwardedHardcore: 6,
    MaxPossible: 3,
  }]);
  assert.equal(completionGame?.summary.unlockedCount, 5);
  assert.equal(completionGame?.summary.totalCount, undefined);
  assert.equal(completionGame?.summary.completionPercent, undefined);
  assert.equal(completionGame?.hardcoreSummary, undefined);
  assert.equal(completionGame?.softcoreSummary, undefined);

  const [recentGame] = normalizeRetroAchievementsRecentlyPlayedGames([{
    GameID: 102,
    Title: "Inconsistent recent game",
    LastPlayed: "2024-01-01 00:00:00",
    NumAchieved: 5,
    NumAchievedHardcore: 6,
    AchievementsTotal: 3,
  }]);
  assert.equal(recentGame?.summary.unlockedCount, 5);
  assert.equal(recentGame?.summary.totalCount, undefined);
  assert.equal(recentGame?.summary.completionPercent, undefined);
  assert.equal(recentGame?.hardcoreSummary, undefined);
  assert.equal(recentGame?.softcoreSummary, undefined);
});



test("retroachievements full-screen profile groups stats by category", () => {
  const profile = normalizeRetroAchievementsProfile(
    {
      User: "Retro User",
      ULID: "abc123",
      MemberSince: "2020-01-02 00:00:00",
      TotalPoints: 1234,
      TotalSoftcorePoints: 4321,
      TotalTruePoints: 987,
    },
    {
      unlockedCount: 12,
      totalCount: 20,
      completionPercent: 60,
    },
    {
      username: "retro-user",
      apiKey: "secret",
    },
  );

  const sections = getRetroAchievementsProfileStatSections({
    profile,
  });

  assert.deepStrictEqual(
    sections.map((section) => section.title),
    ["Softcore", "Hardcore", "RetroAchievements", "Game Completion"],
  );
  assert.deepStrictEqual(
    sections.map((section) => section.stats.map((stat) => stat.label)),
    [
      ["Points", "Unlocked"],
      ["Points", "Unlocked"],
      ["Points", "Ratio"],
      ["Beaten", "Mastered"],
    ],
  );
  assert.deepStrictEqual(
    sections.map((section) => section.variant),
    ["softcore", "hardcore", "retroachievements", "completion"],
  );
  assert.equal(
    sections.flatMap((section) => section.stats).some((stat) => stat.label === "Member since"),
    false,
  );
});

test("retroachievements full-screen profile uses a compact stats grid and provider-scoped overview cards", () => {
  const source = readFileSync("src/platform/decky/decky-full-screen-profile-page.tsx", "utf8");

  assert.match(
    source,
    /function getCompactStatsOverviewStyle\(\): CSSProperties \{[\s\S]*gridTemplateColumns: "repeat\(2, minmax\(0, 1fr\)\)"/u,
  );
  assert.match(
    source,
    /function getAwardsProgressGridStyle\(\): CSSProperties \{[\s\S]*alignItems: "stretch"/u,
  );
  assert.match(
    source,
    /function getOverviewCardStyle\(\): CSSProperties \{[\s\S]*height: "100%"/u,
  );
  assert.match(source, /data-retroachievements-profile-stats-overview/u);
  assert.match(source, /retroAchievementsSupplementaryStats\.map/u);
  assert.match(source, /data-retroachievements-profile-game-awards/u);
  assert.match(source, /data-retroachievements-profile-completion-progress/u);
  assert.doesNotMatch(source, /completionStats=\{retroAchievementsCompletionStats\}/u);
  assert.doesNotMatch(source, /function getAwardSummaryStyle/u);
  assert.match(source, /loadDeckyCompletionProgressStateForFullScreenEntry\(providerId\)/u);
  assert.match(source, /completionProgressState\.data\.games/u);
  assert.doesNotMatch(
    source,
    /selectRetroAchievements(?:GameAward|CompletionProgress)Games\(snapshot\.featuredGames\)/u,
  );
  assert.match(source, /DeckyCompletionProgressBar compact percent=\{completionPercent\}/u);
  assert.match(source, /Loading full completion records\.\.\./u);
  assert.match(source, /Full completion records are unavailable right now\./u);
  assert.match(source, /No completed game records are available\./u);
  assert.match(source, />\s*Beaten Games\s*</u);
  assert.match(source, /No unfinished games are available in this snapshot\./u);
  assert.match(source, /if \(steamProfileSummary !== undefined\) \{[\s\S]*<SteamFullScreenProfileDashboard/u);
  assert.match(source, /<PanelSection title="Awards & Progress">/u);
  assert.match(source, /return buildSteamFullScreenProfileSummary\(\{/u);
  assert.match(
    source,
    /DeckyFullscreenActionRow centered[\s\S]*label="Back"[\s\S]*label="Completion Progress"[\s\S]*label="Achievement History"[\s\S]*label="Settings"/u,
  );
});

test("retroachievements supplementary profile stats render only meaningful loaded values", () => {
  const profile = normalizeRetroAchievementsProfile(
    {
      User: "Retro User",
      ULID: "abc123",
      MemberSince: "2020-01-02 00:00:00",
    },
    {
      unlockedCount: 12,
      totalCount: 20,
      completionPercent: 60,
    },
    {
      username: "retro-user",
      apiKey: "secret",
    },
  );
  const completionGame: NormalizedGame = {
    providerId: RETROACHIEVEMENTS_PROVIDER_ID,
    gameId: "1",
    title: "Active Game",
    status: "in_progress",
    summary: {
      unlockedCount: 2,
      totalCount: 10,
      completionPercent: 20,
    },
    metrics: [],
    lastUnlockAt: Date.now() - 60_000,
  };

  const populated = getRetroAchievementsSupplementaryProfileStats({
    profile,
    recentlyPlayedGames: [],
    completionGames: [completionGame],
  });
  assert.deepStrictEqual(populated.map((stat) => stat.label), ["Achievement completion", "Last activity"]);
  assert.equal(populated[0]?.value, "60%");
  assert.notEqual(populated[1]?.value, undefined);

  const empty = getRetroAchievementsSupplementaryProfileStats({
    profile: {
      ...profile,
      summary: {
        unlockedCount: 0,
      },
    },
    recentlyPlayedGames: [],
    completionGames: [],
  });
  assert.deepStrictEqual(empty, []);
});

test("retroachievements profile game awards prefer authoritative mastered records and cap at three", () => {
  const createAwardGame = (
    gameId: string,
    title: string,
    highestAwardKind: string,
  ): NormalizedGame => ({
    providerId: RETROACHIEVEMENTS_PROVIDER_ID,
    gameId,
    title,
    platformLabel: "NES/Famicom",
    status: highestAwardKind.includes("beaten") ? "beaten" : "mastered",
    summary: {
      unlockedCount: 5,
      totalCount: 5,
      completionPercent: 100,
    },
    metrics: [
      {
        key: "highest-award-kind",
        label: "Highest Award",
        value: highestAwardKind,
      },
    ],
  });
  const games = [
    createAwardGame("1", "Beaten First", "beaten-hardcore"),
    createAwardGame("2", "Mastered First", "mastered"),
    createAwardGame("3", "Beaten Second", "beaten"),
    createAwardGame("4", "Mastered Second", "completed"),
    createAwardGame("5", "Mastered Third", "mastered-hardcore"),
    createAwardGame("6", "Mastered Fourth", "completed-softcore"),
  ];

  const selection = selectRetroAchievementsGameAwards(games);
  assert.equal(selection.mode, "mastered");
  assert.equal(selection.subtitle, "4 mastered awards");
  assert.deepStrictEqual(
    selection.games.map((game) => game.title),
    ["Mastered First", "Mastered Second", "Mastered Third"],
  );
});

test("retroachievements profile game awards fall back to clearly labeled beaten games", () => {
  const createBeatenGame = (gameId: string): NormalizedGame => ({
    providerId: RETROACHIEVEMENTS_PROVIDER_ID,
    gameId,
    title: `Beaten ${gameId}`,
    status: "beaten",
    summary: { unlockedCount: 8, totalCount: 10, completionPercent: 80 },
    metrics: [
      { key: "highest-award-kind", label: "Highest Award", value: "beaten-hardcore" },
    ],
  });
  const selection = selectRetroAchievementsGameAwards([
    createBeatenGame("1"),
    createBeatenGame("2"),
    createBeatenGame("3"),
    createBeatenGame("4"),
  ]);

  assert.equal(selection.mode, "beaten");
  assert.equal(selection.subtitle, "No mastered awards yet");
  assert.equal(selection.games.length, 3);
  assert.equal(
    selection.games.every((game) => getRetroAchievementsProfileAwardStatus(game) === "beaten"),
    true,
  );
});

test("retroachievements profile game awards expose a compact empty state", () => {
  assert.deepStrictEqual(selectRetroAchievementsGameAwards([]), {
    mode: "empty",
    games: [],
    subtitle: "No awards yet",
  });
});

test("retroachievements profile awards can use mastered records absent from the partial dashboard snapshot", () => {
  const beatenGame: NormalizedGame = {
    providerId: RETROACHIEVEMENTS_PROVIDER_ID,
    gameId: "partial-beaten",
    title: "Partial Beaten",
    status: "beaten",
    summary: { unlockedCount: 8, totalCount: 10, completionPercent: 80 },
    metrics: [
      { key: "highest-award-kind", label: "Highest Award", value: "beaten-hardcore" },
    ],
  };
  const masteredGame: NormalizedGame = {
    providerId: RETROACHIEVEMENTS_PROVIDER_ID,
    gameId: "full-mastered",
    title: "Full Mastered",
    status: "mastered",
    summary: { unlockedCount: 20, totalCount: 20, completionPercent: 100 },
    metrics: [
      { key: "highest-award-kind", label: "Highest Award", value: "mastered" },
    ],
  };

  assert.equal(selectRetroAchievementsGameAwards([beatenGame]).mode, "beaten");
  const fullSelection = selectRetroAchievementsGameAwards([beatenGame, masteredGame]);
  assert.equal(fullSelection.mode, "mastered");
  assert.equal(fullSelection.subtitle, "1 mastered award");
  assert.deepStrictEqual(fullSelection.games.map((game) => game.gameId), ["full-mastered"]);
});

test("retroachievements profile completion preview ranks incomplete games closest to mastery", () => {
  const createProgressGame = (
    gameId: string,
    title: string,
    unlockedCount: number,
    totalCount: number,
    highestAwardKind?: string,
    status: NormalizedGame["status"] = highestAwardKind === undefined ? "in_progress" : "mastered",
  ): NormalizedGame => ({
    providerId: RETROACHIEVEMENTS_PROVIDER_ID,
    gameId,
    title,
    platformLabel: "SNES/Super Famicom",
    status,
    summary: {
      unlockedCount,
      totalCount,
      completionPercent: Math.round((unlockedCount / totalCount) * 100),
    },
    metrics:
      highestAwardKind === undefined
        ? []
        : [
            {
              key: "highest-award-kind",
              label: "Highest Award",
              value: highestAwardKind,
            },
          ],
  });
  const games = [
    createProgressGame("1", "Lower Progress", 3, 10),
    createProgressGame("2", "Mastered Award", 8, 10, "mastered"),
    createProgressGame("3", "Beaten Progress", 47, 70, "beaten-hardcore", "beaten"),
    createProgressGame("4", "Highest Progress", 20, 25),
    createProgressGame("5", "Equal Ratio Lower Earned", 8, 20),
    createProgressGame("6", "Equal Ratio Higher Earned First", 16, 40),
    createProgressGame("7", "Equal Ratio Higher Earned Second", 16, 40),
    createProgressGame("8", "Complete Without Award", 10, 10, undefined, "completed"),
    createProgressGame("9", "No Total", 2, 0),
    createProgressGame("10", "Completed Status Below 100", 9, 10, undefined, "completed"),
  ];

  const selected = selectRetroAchievementsCompletionProgressGames(games, 6);
  assert.deepStrictEqual(
    selected.map((game) => game.title),
    [
      "Highest Progress",
      "Beaten Progress",
      "Equal Ratio Higher Earned First",
      "Equal Ratio Higher Earned Second",
      "Equal Ratio Lower Earned",
      "Lower Progress",
    ],
  );
  assert.equal(selected.some((game) => game.title === "Mastered Award"), false);
  assert.equal(selected.some((game) => game.title === "Complete Without Award"), false);
  assert.equal(selected.some((game) => game.title === "Completed Status Below 100"), false);
  assert.equal(selected.some((game) => game.title === "Beaten Progress"), true);
  assert.deepStrictEqual(
    selectRetroAchievementsCompletionProgressGames(games).map((game) => game.title),
    ["Highest Progress", "Beaten Progress", "Equal Ratio Higher Earned First"],
  );
});

test("retroachievements profile section helpers apply distinct softcore and hardcore tints", () => {
  const softcoreStyle = getRetroAchievementsProfileSectionStyle("softcore");
  const hardcoreStyle = getRetroAchievementsProfileSectionStyle("hardcore");
  const defaultStyle = getRetroAchievementsProfileSectionStyle("default");
  const retroAchievementsStyle = getRetroAchievementsProfileSectionStyle("retroachievements");
  const completionStyle = getRetroAchievementsProfileSectionStyle("completion");

  assert.equal(softcoreStyle.border, `1px solid ${raTheme.color.borderSubtle}`);
  assert.equal(softcoreStyle.borderLeft, `4px solid ${raTheme.color.softcore}`);
  assert.equal(softcoreStyle.background, `linear-gradient(180deg, ${raTheme.surface.softcore}, ${raTheme.surface.softcore}), ${raTheme.surface.contentCard}`);
  assert.equal(hardcoreStyle.border, `1px solid ${raTheme.color.borderSubtle}`);
  assert.equal(hardcoreStyle.borderLeft, `4px solid ${raTheme.color.hardcore}`);
  assert.equal(hardcoreStyle.background, `linear-gradient(180deg, ${raTheme.surface.hardcore}, ${raTheme.surface.hardcore}), ${raTheme.surface.contentCard}`);
  assert.notEqual(softcoreStyle.borderLeft, hardcoreStyle.borderLeft);
  assert.notEqual(softcoreStyle.background, hardcoreStyle.background);
  assert.equal(retroAchievementsStyle.borderLeft, `4px solid ${raTheme.color.accent}`);
  assert.equal(retroAchievementsStyle.background, `linear-gradient(180deg, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0)), ${raTheme.surface.contentCard}`);
  assert.equal(completionStyle.borderLeft, `4px solid ${raTheme.color.accent}`);
  assert.equal(completionStyle.background, retroAchievementsStyle.background);
  assert.equal(defaultStyle.borderLeft, `4px solid ${raTheme.color.borderSubtle}`);
  assert.equal(defaultStyle.background, retroAchievementsStyle.background);
  assert.equal(defaultStyle.boxShadow, undefined);

  const softcoreTitleStyle = getRetroAchievementsProfileSectionTitleStyle("softcore");
  const hardcoreTitleStyle = getRetroAchievementsProfileSectionTitleStyle("hardcore");
  const retroAchievementsTitleStyle = getRetroAchievementsProfileSectionTitleStyle("retroachievements");
  const completionTitleStyle = getRetroAchievementsProfileSectionTitleStyle("completion");
  const defaultTitleStyle = getRetroAchievementsProfileSectionTitleStyle("default");

  assert.equal(softcoreTitleStyle.color, raTheme.color.softcore);
  assert.equal(hardcoreTitleStyle.color, raTheme.color.hardcore);
  assert.equal(retroAchievementsTitleStyle.color, raTheme.color.accent);
  assert.equal(completionTitleStyle.color, raTheme.color.accent);
  assert.equal(defaultTitleStyle.color, raTheme.color.textMuted);
});

test("retroachievements full-screen profile section accents mirror the grouped mode language", () => {
  const softcoreAccent = getRetroAchievementsProfileSectionAccentStyle("softcore");
  const hardcoreAccent = getRetroAchievementsProfileSectionAccentStyle("hardcore");
  const retroAchievementsAccent = getRetroAchievementsProfileSectionAccentStyle("retroachievements");
  const completionAccent = getRetroAchievementsProfileSectionAccentStyle("completion");
  const defaultAccent = getRetroAchievementsProfileSectionAccentStyle("default");

  assert.equal(softcoreAccent.position, "absolute");
  assert.equal(softcoreAccent.width, 4);
  assert.equal(softcoreAccent.background, `linear-gradient(180deg, ${raTheme.color.softcore}, transparent)`);
  assert.equal(hardcoreAccent.position, "absolute");
  assert.equal(hardcoreAccent.width, 4);
  assert.equal(hardcoreAccent.background, `linear-gradient(180deg, ${raTheme.color.hardcore}, transparent)`);
  assert.equal(retroAchievementsAccent.position, "absolute");
  assert.equal(retroAchievementsAccent.width, 4);
  assert.equal(
    retroAchievementsAccent.background,
    `linear-gradient(180deg, ${raTheme.color.accent}, transparent)`,
  );
  assert.equal(completionAccent.position, "absolute");
  assert.equal(completionAccent.width, 4);
  assert.equal(
    completionAccent.background,
    `linear-gradient(180deg, ${raTheme.color.accent}, transparent)`,
  );
  assert.equal(defaultAccent.position, "absolute");
  assert.equal(defaultAccent.width, 4);
  assert.equal(defaultAccent.background, `linear-gradient(180deg, ${raTheme.color.borderSubtle}, transparent)`);
});


test("retroachievements completion progress normalizes beaten and mastered status", () => {
  const games = normalizeRetroAchievementsCompletionProgressGames([
    {
      GameID: 1,
      Title: "Beaten Game",
      ConsoleName: "NES",
      MaxPossible: 5,
      NumAwarded: 3,
      HighestAwardKind: "beaten-hardcore",
    },
    {
      GameID: 2,
      Title: "Mastered Game",
      ConsoleName: "NES",
      MaxPossible: 5,
      NumAwarded: 5,
      HighestAwardKind: "mastered",
    },
    {
      GameID: 3,
      Title: "Completed Game",
      ConsoleName: "NES",
      MaxPossible: 10,
      NumAwarded: 9,
      HighestAwardKind: "completed-hardcore",
    },
  ] satisfies readonly RawRetroAchievementsCompletionProgressEntry[]);

  assert.equal(games.find((game) => game.title === "Beaten Game")?.status, "beaten");
  assert.equal(games.find((game) => game.title === "Mastered Game")?.status, "mastered");
  assert.equal(games.find((game) => game.title === "Completed Game")?.status, "completed");
  assert.equal(
    games
      .find((game) => game.title === "Beaten Game")
      ?.metrics.find((metric) => metric.key === "highest-award-kind")?.value,
    "beaten-hardcore",
  );
});


test("retroachievements mastered date text requires explicit hardcore mastered state", () => {
  const masteredAtText = formatRetroAchievementsMasteredAtText({
    providerId: PROVIDER_ID,
    lastUnlockAt: Date.parse("2024-04-23T21:28:49Z"),
    metrics: [
      {
        key: "highest-award-kind",
        label: "Highest Award",
        value: "mastered",
      },
    ],
  });

  assert.match(masteredAtText ?? "", /^Mastered on /u);
  assert.equal(
    formatRetroAchievementsMasteredAtText({
      providerId: PROVIDER_ID,
      lastUnlockAt: Date.parse("2024-04-23T21:28:49Z"),
      metrics: [],
    }),
    undefined,
  );
  assert.equal(
    formatRetroAchievementsMasteredAtText({
      providerId: STEAM_PROVIDER_ID,
      lastUnlockAt: Date.parse("2024-04-23T21:28:49Z"),
      metrics: [
        {
          key: "highest-award-kind",
          label: "Highest Award",
          value: "mastered",
        },
      ],
    }),
    undefined,
  );
});

test("retroachievements beaten date text requires explicit beaten state", () => {
  const beatenAtText = formatRetroAchievementsBeatenAtText({
    providerId: PROVIDER_ID,
    lastUnlockAt: Date.parse("2024-04-23T21:28:49Z"),
    metrics: [
      {
        key: "highest-award-kind",
        label: "Highest Award",
        value: "beaten-hardcore",
      },
    ],
  });

  assert.match(beatenAtText ?? "", /^Beaten on /u);
  assert.equal(
    formatRetroAchievementsBeatenAtText({
      providerId: PROVIDER_ID,
      lastUnlockAt: Date.parse("2024-04-23T21:28:49Z"),
      metrics: [],
    }),
    undefined,
  );
  assert.equal(
    formatRetroAchievementsBeatenAtText({
      providerId: PROVIDER_ID,
      lastUnlockAt: Date.parse("2024-04-23T21:28:49Z"),
      metrics: [
        {
          key: "highest-award-kind",
          label: "Highest Award",
          value: "mastered",
        },
      ],
    }),
    undefined,
  );
  assert.equal(
    formatRetroAchievementsBeatenAtText({
      providerId: STEAM_PROVIDER_ID,
      lastUnlockAt: Date.parse("2024-04-23T21:28:49Z"),
      metrics: [
        {
          key: "highest-award-kind",
          label: "Highest Award",
          value: "beaten-hardcore",
        },
      ],
    }),
    undefined,
  );
});


test("animated default completion progress switches the whole fill to flame colors at 90 percent", () => {
  const blueBackground = raRecipes.progressFill.completion;
  const flameBackground =
    "linear-gradient(90deg, rgba(245, 196, 66, 0.96), rgba(249, 115, 22, 0.98), rgba(239, 68, 68, 0.98))";

  assert.equal(getCompletionBarFillStyle(89, "default", true).background, blueBackground);
  assert.equal(getCompletionBarFillStyle(90, "default", true).background, flameBackground);
  assert.equal(getCompletionBarFillStyle(100, "default", true).background, flameBackground);
  assert.equal(getCompletionBarFillStyle(100, "default", false).background, blueBackground);
  assert.equal(
    getCompletionBarFillStyle(100, "retroachievements-mastered", true).background,
    raRecipes.progressFill.mastered,
  );
});

test("retroachievements fullscreen completion progress rows use explicit beaten and mastered progress tones", () => {
  const fullScreenCompletionProgressSource = readFileSync(
    "src/platform/decky/decky-full-screen-completion-progress-page.tsx",
    "utf8",
  );
  const steamProviderSource = readFileSync("src/providers/steam/mappers/normalize.ts", "utf8");

  assert.match(
    fullScreenCompletionProgressSource,
    /function getCompletionProgressRowTone[\s\S]*getRetroAchievementsCompletionIndicatorState\(game\)/u,
  );
  assert.match(
    fullScreenCompletionProgressSource,
    /completionIndicatorState === "mastered-hardcore"[\s\S]*completionIndicatorState === "mastered-softcore"[\s\S]*return "retroachievements-mastered";/u,
  );
  assert.match(
    fullScreenCompletionProgressSource,
    /completionIndicatorState === "beaten-hardcore"[\s\S]*completionIndicatorState === "beaten-softcore"[\s\S]*return "retroachievements-beaten";/u,
  );
  assert.match(fullScreenCompletionProgressSource, /return "default";/u);
  assert.match(fullScreenCompletionProgressSource, /const progressTone = getCompletionProgressRowTone\(game\);/u);
  assert.match(
    fullScreenCompletionProgressSource,
    /<DeckyCompletionProgressBar compact percent=\{completionPercent\} tone=\{progressTone\} \/>/u,
  );
  assert.doesNotMatch(
    steamProviderSource,
    /retroachievements-mastered|retroachievements-beaten|getRetroAchievementsCompletionIndicatorState/u,
  );
});


test("retroachievements completion progress preserves parent game ids", () => {
  const games = normalizeRetroAchievementsCompletionProgressGames([
    {
      GameID: 1,
      Title: "Mega Man X",
      ConsoleName: "SNES",
      MaxPossible: 10,
      NumAwarded: 5,
      ParentGameID: null,
    },
    {
      GameID: 2,
      Title: "Mega Man X (Subset)",
      ConsoleName: "SNES",
      MaxPossible: 6,
      NumAwarded: 3,
      ParentGameID: 1,
    },
  ] satisfies readonly RawRetroAchievementsCompletionProgressEntry[]);

  assert.equal(games.find((game) => game.gameId === "1")?.parentGameId, undefined);
  assert.equal(games.find((game) => game.gameId === "2")?.parentGameId, "1");
});

test("completion progress groups explicit subsets under the parent game", () => {
  const groupedGames = groupCompletionProgressGames([
    {
      providerId: PROVIDER_ID,
      gameId: "base-game",
      title: "Mega Man X",
      platformLabel: "SNES",
      status: "in_progress",
      summary: {
        unlockedCount: 5,
        totalCount: 10,
        completionPercent: 50,
      },
      metrics: [],
      lastUnlockAt: 1_900_000_000_900,
    },
    {
      providerId: PROVIDER_ID,
      gameId: "subset-a",
      title: "Mega Man X (Subset)",
      platformLabel: "SNES",
      parentGameId: "base-game",
      status: "in_progress",
      summary: {
        unlockedCount: 3,
        totalCount: 6,
        completionPercent: 50,
      },
      metrics: [],
      lastUnlockAt: 1_900_000_000_800,
    },
    {
      providerId: PROVIDER_ID,
      gameId: "subset-b",
      title: "Mega Man X (Challenge Set)",
      platformLabel: "SNES",
      status: "beaten",
      summary: {
        unlockedCount: 6,
        totalCount: 6,
        completionPercent: 100,
      },
      metrics: [],
      lastUnlockAt: 1_900_000_000_700,
    },
    {
      providerId: PROVIDER_ID,
      gameId: "other-game",
      title: "Donkey Kong Country",
      platformLabel: "SNES",
      status: "mastered",
      summary: {
        unlockedCount: 8,
        totalCount: 8,
        completionPercent: 100,
      },
      metrics: [],
      lastUnlockAt: 1_900_000_000_600,
    },
  ]);

  const groupedMegaManX = groupedGames.find(
    (group) => group.representativeGame.title === "Mega Man X",
  );

  assert.equal(groupedGames.length, 2);
  assert.equal(groupedMegaManX?.games.length, 3);
  assert.equal(groupedMegaManX?.subsetGames.length, 2);
  assert.deepStrictEqual(
    groupedMegaManX?.subsetGames.map((game) => game.title),
    ["Mega Man X (Subset)", "Mega Man X (Challenge Set)"],
  );
});

test("steam completion progress sorts Most Recent by last played activity", () => {
  const groupedGames = groupCompletionProgressGames([
    {
      providerId: STEAM_PROVIDER_ID,
      gameId: "older-play-session",
      title: "Older play session",
      status: "in_progress",
      summary: { unlockedCount: 10, totalCount: 20, completionPercent: 50 },
      metrics: [],
      lastPlayedAt: Date.parse("2026-04-22T17:33:54Z"),
      // A newer achievement unlock must not make this game appear more recently played.
      lastUnlockAt: Date.parse("2026-08-01T12:00:00Z"),
    },
    {
      providerId: STEAM_PROVIDER_ID,
      gameId: "newer-play-session",
      title: "Newer play session",
      status: "in_progress",
      summary: { unlockedCount: 4, totalCount: 10, completionPercent: 40 },
      metrics: [],
      lastPlayedAt: Date.parse("2026-07-08T15:44:30Z"),
      lastUnlockAt: Date.parse("2026-05-01T12:00:00Z"),
    },
  ] satisfies readonly NormalizedGame[]);

  const sortedGames = sortCompletionProgressGroups(groupedGames, "recent");

  assert.deepStrictEqual(
    sortedGames.map((group) => group.representativeGame.gameId),
    ["newer-play-session", "older-play-session"],
  );
});

test("completion progress groups named subset titles under the parent game and leaves ordinary bracketed titles separate", () => {
  const groupedGames = groupCompletionProgressGames([
    {
      providerId: PROVIDER_ID,
      gameId: "base-game",
      title: "Final Fantasy X: International",
      platformLabel: "PlayStation 2",
      status: "in_progress",
      summary: {
        unlockedCount: 20,
        totalCount: 40,
        completionPercent: 50,
      },
      metrics: [],
      lastUnlockAt: 1_900_000_001_000,
    },
    {
      providerId: PROVIDER_ID,
      gameId: "subset-a",
      title: "Final Fantasy X: International [Subset - No Sphere Grid]",
      platformLabel: "PlayStation 2",
      status: "in_progress",
      summary: {
        unlockedCount: 12,
        totalCount: 24,
        completionPercent: 50,
      },
      metrics: [],
      lastUnlockAt: 1_900_000_000_900,
    },
    {
      providerId: PROVIDER_ID,
      gameId: "subset-b",
      title: "Final Fantasy X: International (Challenge Set - No Sphere Grid)",
      platformLabel: "PlayStation 2",
      status: "in_progress",
      summary: {
        unlockedCount: 8,
        totalCount: 16,
        completionPercent: 50,
      },
      metrics: [],
      lastUnlockAt: 1_900_000_000_800,
    },
    {
      providerId: PROVIDER_ID,
      gameId: "non-subset",
      title: "Final Fantasy X: International [HD Remaster]",
      platformLabel: "PlayStation 2",
      status: "beaten",
      summary: {
        unlockedCount: 40,
        totalCount: 40,
        completionPercent: 100,
      },
      metrics: [],
      lastUnlockAt: 1_900_000_000_700,
    },
  ] satisfies readonly NormalizedGame[]);

  const groupedFinalFantasyX = groupedGames.find(
    (group) => group.representativeGame.title === "Final Fantasy X: International",
  );
  const bracketedNonSubset = groupedGames.find(
    (group) => group.representativeGame.title === "Final Fantasy X: International [HD Remaster]",
  );

  assert.equal(groupedGames.length, 2);
  assert.equal(groupedFinalFantasyX?.games.length, 3);
  assert.equal(groupedFinalFantasyX?.subsetGames.length, 2);
  assert.deepStrictEqual(
    groupedFinalFantasyX?.subsetGames.map((game) => game.title),
    [
      "Final Fantasy X: International [Subset - No Sphere Grid]",
      "Final Fantasy X: International (Challenge Set - No Sphere Grid)",
    ],
  );
  assert.equal(bracketedNonSubset?.subsetGames.length, 0);
});

test("completion progress subset visibility excludes unfinished subset games when hidden", () => {
  const games = [
    {
      providerId: PROVIDER_ID,
      gameId: "base-game",
      title: "Final Fantasy X: International",
      platformLabel: "PlayStation 2",
      status: "in_progress",
      summary: {
        unlockedCount: 5,
        totalCount: 10,
        completionPercent: 50,
      },
      metrics: [],
      lastUnlockAt: 1_900_000_000_900,
    },
    {
      providerId: PROVIDER_ID,
      gameId: "subset-a",
      title: "Final Fantasy X: International [Subset - No Sphere Grid]",
      platformLabel: "PlayStation 2",
      status: "in_progress",
      summary: {
        unlockedCount: 3,
        totalCount: 6,
        completionPercent: 50,
      },
      metrics: [],
      lastUnlockAt: 1_900_000_000_800,
    },
    {
      providerId: PROVIDER_ID,
      gameId: "subset-b",
      title: "Final Fantasy X: International (Challenge Set - No Sphere Grid)",
      platformLabel: "PlayStation 2",
      status: "in_progress",
      summary: {
        unlockedCount: 2,
        totalCount: 4,
        completionPercent: 50,
      },
      metrics: [],
      lastUnlockAt: 1_900_000_000_700,
    },
    {
      providerId: PROVIDER_ID,
      gameId: "non-subset",
      title: "Final Fantasy X: International [HD Remaster]",
      platformLabel: "PlayStation 2",
      status: "in_progress",
      summary: {
        unlockedCount: 4,
        totalCount: 8,
        completionPercent: 50,
      },
      metrics: [],
      lastUnlockAt: 1_900_000_000_650,
    },
    {
      providerId: PROVIDER_ID,
      gameId: "beaten-game",
      title: "Donkey Kong Country",
      platformLabel: "SNES",
      status: "beaten",
      summary: {
        unlockedCount: 8,
        totalCount: 8,
        completionPercent: 100,
      },
      metrics: [],
      lastUnlockAt: 1_900_000_000_600,
    },
  ] satisfies readonly NormalizedGame[];
  const summary = {
    playedCount: 33,
    unfinishedCount: 32,
    beatenCount: 1,
    masteredCount: 0,
  };

  const hiddenGames = filterCompletionProgressGamesBySubsetVisibility(games, false);
  const visibleGames = filterCompletionProgressGamesBySubsetVisibility(games, true);
  const hiddenSummary = summarizeCompletionProgressSummaryBySubsetVisibility(summary, games, false);
  const visibleSummary = summarizeCompletionProgressSummaryBySubsetVisibility(summary, games, true);

  assert.equal(hiddenGames.length, 3);
  assert.deepStrictEqual(
    hiddenGames.map((game) => game.title),
    [
      "Final Fantasy X: International",
      "Final Fantasy X: International [HD Remaster]",
      "Donkey Kong Country",
    ],
  );
  assert.equal(visibleGames.length, 5);
  assert.equal(hiddenSummary.playedCount, 33);
  assert.equal(hiddenSummary.unfinishedCount, 30);
  assert.equal(hiddenSummary.beatenCount, 1);
  assert.equal(hiddenSummary.masteredCount, 0);
  assert.equal(visibleSummary.playedCount, 33);
  assert.equal(visibleSummary.unfinishedCount, 32);
  assert.equal(visibleSummary.beatenCount, 1);
  assert.equal(visibleSummary.masteredCount, 0);
});

test("completion progress subset visibility keeps subset rows selectable when shown and hidden when off", () => {
  const games = [
    {
      providerId: PROVIDER_ID,
      gameId: "base-game",
      title: "Final Fantasy X: International",
      platformLabel: "PlayStation 2",
      status: "in_progress",
      summary: {
        unlockedCount: 5,
        totalCount: 10,
        completionPercent: 50,
      },
      metrics: [],
      lastUnlockAt: 1_900_000_001_000,
    },
    {
      providerId: PROVIDER_ID,
      gameId: "subset-a",
      title: "Final Fantasy X: International [Subset - No Sphere Grid]",
      platformLabel: "PlayStation 2",
      status: "in_progress",
      summary: {
        unlockedCount: 3,
        totalCount: 6,
        completionPercent: 50,
      },
      metrics: [],
      lastUnlockAt: 1_900_000_000_900,
    },
    {
      providerId: PROVIDER_ID,
      gameId: "subset-b",
      title: "Final Fantasy X: International (Challenge Set - No Sphere Grid)",
      platformLabel: "PlayStation 2",
      status: "in_progress",
      summary: {
        unlockedCount: 2,
        totalCount: 4,
        completionPercent: 50,
      },
      metrics: [],
      lastUnlockAt: 1_900_000_000_800,
    },
    {
      providerId: PROVIDER_ID,
      gameId: "non-subset",
      title: "Final Fantasy X: International [HD Remaster]",
      platformLabel: "PlayStation 2",
      status: "beaten",
      summary: {
        unlockedCount: 4,
        totalCount: 8,
        completionPercent: 50,
      },
      metrics: [],
      lastUnlockAt: 1_900_000_000_700,
    },
    ...Array.from({ length: 29 }, (_, index) => ({
      providerId: PROVIDER_ID,
      gameId: `extra-game-${index + 1}`,
      title: `Extra Game ${index + 1}`,
      platformLabel: "SNES",
      status: "in_progress" as const,
      summary: {
        unlockedCount: 1,
        totalCount: 2,
        completionPercent: 50,
      },
      metrics: [],
      lastUnlockAt: 1_900_000_000_600 - index,
    })),
  ] satisfies readonly NormalizedGame[];
  const summary = {
    playedCount: 33,
    unfinishedCount: 32,
    beatenCount: 1,
    masteredCount: 0,
  };

  const hiddenGames = filterCompletionProgressGamesBySubsetVisibility(games, false);
  const visibleGames = filterCompletionProgressGamesBySubsetVisibility(games, true);
  const hiddenGroups = groupCompletionProgressGames(hiddenGames, false);
  const visibleGroups = groupCompletionProgressGames(visibleGames, true);
  const hiddenSummary = summarizeCompletionProgressSummaryBySubsetVisibility(summary, games, false);
  const visibleSummary = summarizeCompletionProgressSummaryBySubsetVisibility(summary, games, true);

  assert.equal(countCompletionProgressSubsetGames(games), 2);
  assert.equal(hiddenGames.length, 31);
  assert.equal(visibleGames.length, 33);
  assert.equal(hiddenGroups.length, 31);
  assert.equal(visibleGroups.length, 33);
  assert.equal(
    hiddenGames.some((game) =>
      game.title === "Final Fantasy X: International [Subset - No Sphere Grid]" ||
      game.title === "Final Fantasy X: International (Challenge Set - No Sphere Grid)",
    ),
    false,
  );
  assert.equal(
    visibleGroups.some(
      (group) => group.representativeGame.title === "Final Fantasy X: International [Subset - No Sphere Grid]",
    ),
    true,
  );
  assert.equal(
    visibleGroups.some(
      (group) => group.representativeGame.title === "Final Fantasy X: International (Challenge Set - No Sphere Grid)",
    ),
    true,
  );
  assert.equal(hiddenSummary.playedCount, 33);
  assert.equal(hiddenSummary.unfinishedCount, 30);
  assert.equal(hiddenSummary.beatenCount, 1);
  assert.equal(hiddenSummary.masteredCount, 0);
  assert.equal(visibleSummary.playedCount, 33);
  assert.equal(visibleSummary.unfinishedCount, 32);
  assert.equal(visibleSummary.beatenCount, 1);
  assert.equal(visibleSummary.masteredCount, 0);
});

test("completion progress summary cards replace the old filter pill row and act as filter controls", () => {
  const summaryHiddenSubsets = {
    playedCount: 33,
    unfinishedCount: 30,
    beatenCount: 1,
    masteredCount: 0,
  };
  const summaryVisibleSubsets = {
    playedCount: 33,
    unfinishedCount: 32,
    beatenCount: 1,
    masteredCount: 0,
  };
  const cardsHiddenSubsets = buildCompletionProgressSummaryCards({
    summary: summaryHiddenSubsets,
    subsetCount: 2,
    providerId: PROVIDER_ID,
    currentFilter: "unfinished",
    showSubsets: false,
  });
  const cardsVisibleSubsets = buildCompletionProgressSummaryCards({
    summary: summaryVisibleSubsets,
    subsetCount: 2,
    providerId: PROVIDER_ID,
    currentFilter: "subsets",
    showSubsets: true,
  });
  const renderSource = readFileSync(
    join("src", "platform", "decky", "decky-completion-progress-summary-cards.tsx"),
    "utf8",
  );
  const summaryCardDataSource = readFileSync(
    join("src", "platform", "decky", "decky-completion-progress-summary-card-data.ts"),
    "utf8",
  );
  const groupingSource = readFileSync(
    join("src", "platform", "decky", "decky-completion-progress-grouping.ts"),
    "utf8",
  );
  const pageSource = readFileSync(
    join("src", "platform", "decky", "decky-full-screen-completion-progress-page.tsx"),
    "utf8",
  );

  assert.deepStrictEqual(cardsHiddenSubsets.map((card) => card.label), [
    "Played",
    "Unfinished",
    "Subsets",
    "Beaten",
    "Mastered",
  ]);
  assert.deepStrictEqual(cardsHiddenSubsets.map((card) => card.filter), [
    "all",
    "unfinished",
    "subsets",
    "beaten",
    "mastered",
  ]);
  assert.deepStrictEqual(
    cardsHiddenSubsets.map((card) => `${card.label}:${card.selected ? "selected" : "idle"}:${card.disabled ? "disabled" : "enabled"}`),
    [
      "Played:idle:enabled",
      "Unfinished:selected:enabled",
      "Subsets:idle:disabled",
      "Beaten:idle:enabled",
      "Mastered:idle:enabled",
    ],
  );
  assert.deepStrictEqual(
    cardsVisibleSubsets.map((card) => `${card.label}:${card.selected ? "selected" : "idle"}:${card.disabled ? "disabled" : "enabled"}`),
    [
      "Played:idle:enabled",
      "Unfinished:idle:enabled",
      "Subsets:selected:enabled",
      "Beaten:idle:enabled",
      "Mastered:idle:enabled",
    ],
  );
  assert.equal(renderSource.includes("Focusable"), true);
  assert.equal(renderSource.includes("role=\"button\""), true);
  assert.equal(renderSource.includes("tabIndex={disabled ? -1 : undefined}"), true);
  assert.equal(renderSource.includes("noFocusRing"), true);
  assert.equal(renderSource.includes("onActivate"), true);
  assert.equal(renderSource.includes("onGamepadFocus"), true);
  assert.equal(renderSource.includes("onBlur"), true);
  assert.equal(renderSource.includes("aria-pressed={selected}"), true);
  assert.equal(renderSource.includes("aria-disabled={disabled}"), true);
  assert.equal(renderSource.includes("data-completion-progress-filter-selected"), true);
  assert.equal(renderSource.includes("data-completion-progress-filter-disabled"), true);
  assert.equal(renderSource.includes("repeat(5, minmax(0, 1fr))"), true);
  assert.equal(renderSource.includes("gap: 12"), true);
  assert.equal(renderSource.includes('padding: "12px 12px 11px"'), true);
  assert.equal(renderSource.includes('borderRadius: 16'), true);
  assert.equal(renderSource.includes('rgba(255, 255, 255, 0.075)'), true);
  assert.equal(renderSource.includes("background: sharedTheme.surface.contentStat"), true);
  assert.equal(renderSource.includes("background: sharedTheme.surface.selectedContentStat"), true);
  assert.equal(renderSource.includes("background: sharedTheme.surface.focusedSelectedContentStat"), true);
  assert.equal(renderSource.includes("<button"), false);
  assert.equal(renderSource.includes("Field"), false);
  assert.equal(renderSource.includes('from "./decky-completion-progress-summary-card-data"'), true);
  assert.equal(renderSource.includes("function formatCompletionProgressSelectionLabelForProvider"), false);
  assert.equal(renderSource.includes("export function buildCompletionProgressSummaryCards({"), false);
  assert.equal(summaryCardDataSource.includes("export function buildCompletionProgressSummaryCards"), true);
  assert.equal(getDeckyFocusStylesCss().includes("achievement-companion-completion-progress-summary-card"), false);
  assert.equal(groupingSource.includes("subset sets"), false);
  assert.equal(pageSource.includes("CompletionProgressFilterPills"), false);
  assert.equal(pageSource.includes("COMPLETION_PROGRESS_FILTERS"), false);
  assert.equal(pageSource.includes("export interface CompletionProgressGameGroup"), false);
  assert.equal(pageSource.includes("export function groupCompletionProgressGames"), false);
  assert.equal(pageSource.includes("function formatSteamPlaytimeMinutes"), false);
  assert.equal(pageSource.includes("function parseCompletionProgressSubsetTitle"), false);
});

const DOCUMENTED_GAME_PROGRESS_RESPONSE = {
  ID: 14402,
  Title: "Dragster",
  ConsoleName: "Atari 2600",
  ImageIcon: "/Images/026368.png",
  Publisher: "Activision",
  Developer: "David Crane",
  Genre: "Racing",
  Released: "1992-06-02 00:00:00",
  NumDistinctPlayers: 456,
  NumAchievements: 2,
  NumAwardedToUser: 1,
  NumAwardedToUserHardcore: 1,
  UserCompletion: "50.00%",
  UserCompletionHardcore: "50.00%",
  UserTotalPlaytime: 60,
  HighestAwardDate: "2024-04-23T21:28:49+00:00",
  Achievements: {
    "79434": {
      ID: 79434,
      NumAwarded: 366,
      NumAwardedHardcore: 274,
      Title: "Novice Dragster Driver 1",
      Description: "Complete your very first race in game 1.",
      Points: 1,
      TrueRatio: 1,
      Author: "Boldewin",
      AuthorULID: "00003EMFWR7XB8SDPEHB3K56ZQ",
      DateModified: "2019-08-01 19:03:46",
      DateCreated: "2019-07-31 18:49:57",
      BadgeName: "85541",
      DisplayOrder: 0,
      MemAddr: "f5c41fa0b5fa0d5fbb8a74c598f18582",
      Type: "progression",
      DateEarned: "2024-04-23 21:28:49",
      DateEarnedHardcore: "2024-04-23 21:28:49",
    },
    "79435": {
      ID: 79435,
      NumAwarded: 100,
      NumAwardedHardcore: 50,
      Title: "Another Test Achievement",
      Description: "Do something else.",
      Points: 2,
      TrueRatio: 2,
      Author: "Boldewin",
      AuthorULID: "00003EMFWR7XB8SDPEHB3K56ZQ",
      DateModified: "2019-08-01 19:03:46",
      DateCreated: "2019-07-31 18:49:57",
      BadgeName: "85542",
      DisplayOrder: 1,
      MemAddr: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      Type: "progression",
    },
  },
} satisfies RawRetroAchievementsGameProgressResponse;

function createRetroAchievementsGameDetailClient(
  response: RawRetroAchievementsGameProgressResponse,
  counts?: Pick<CallCounts, "gameProgress" | "achievementsEarnedBetween">,
): RetroAchievementsClient {
  return {
    async loadProfile() {
      return {
        User: "Alice",
      };
    },

    async loadCompletionProgress() {
      return [];
    },

    async loadAchievementsEarnedBetween() {
      if (counts !== undefined) {
        counts.achievementsEarnedBetween += 1;
      }

      return [];
    },

    async loadRecentUnlocks() {
      return [];
    },

    async loadRecentlyPlayedGames() {
      return [];
    },

    async loadGameProgress() {
      if (counts !== undefined) {
        counts.gameProgress += 1;
      }

      return response;
    },
  };
}

function createThrowingProvider(counts: CallCounts): AchievementProvider {
  return {
    id: PROVIDER_ID,
    capabilities: PROVIDER_CAPABILITIES,
    async loadProfile() {
      counts.profile += 1;
      throw new Error("dashboard refresh failed");
    },
    async loadCompletionProgress() {
      counts.completionProgress += 1;
      throw new Error("completion progress refresh failed");
    },
    async loadAchievementsEarnedBetween() {
      counts.achievementsEarnedBetween += 1;
      throw new Error("achievement history refresh failed");
    },
    async loadRecentUnlocks() {
      counts.recentUnlocks += 1;
      throw new Error("dashboard refresh failed");
    },
    async loadRecentlyPlayedGames() {
      counts.recentlyPlayedGames += 1;
      throw new Error("dashboard refresh failed");
    },
    async loadGameProgress(_config, _gameId) {
      counts.gameProgress += 1;
      throw new Error("game detail refresh failed");
    },
  };
}

function createSuccessfulProvider(counts: CallCounts): AchievementProvider {
  return {
    id: PROVIDER_ID,
    capabilities: PROVIDER_CAPABILITIES,
    async loadProfile() {
      counts.profile += 1;
      return DASHBOARD_REFRESH_PROFILE;
    },
    async loadCompletionProgress() {
      counts.completionProgress += 1;
      return [];
    },
    async loadAchievementsEarnedBetween() {
      counts.achievementsEarnedBetween += 1;
      return [];
    },
    async loadRecentUnlocks() {
      counts.recentUnlocks += 1;
      return DASHBOARD_REFRESH_RECENT_UNLOCKS;
    },
    async loadRecentlyPlayedGames() {
      counts.recentlyPlayedGames += 1;
      return DASHBOARD_REFRESH_RECENTLY_PLAYED_GAMES;
    },
    async loadGameProgress() {
      counts.gameProgress += 1;
      return createGameDetailSnapshot();
    },
  };
}

function createHarness(options: {
  readonly cacheEntries?: readonly CacheEntry<unknown>[];
  readonly providerConfig?: unknown | undefined;
  readonly providerFactory?: (counts: CallCounts) => AchievementProvider;
  readonly platform?: PlatformServices;
}) {
  const counts: CallCounts = {
    config: 0,
    profile: 0,
    completionProgress: 0,
    recentUnlocks: 0,
    achievementsEarnedBetween: 0,
    recentlyPlayedGames: 0,
    gameProgress: 0,
    relatedGames: 0,
    relatedGameProgress: 0,
  };

  const provider = options.providerFactory?.(counts) ?? createThrowingProvider(counts);
  const { cacheStore, writes } = createMemoryCacheStore(options.cacheEntries);
  const loadProviderConfig = async (): Promise<unknown | undefined> => {
    counts.config += 1;
    return options.providerConfig;
  };

  return {
    counts,
    writes,
    appServices: createAppServices({
      providerRegistry: createProviderRegistry([provider]),
      platform: options.platform ?? PLATFORM,
      cacheStore,
      loadProviderConfig,
    }),
  };
}

test("dashboard cache hit returns cached state without calling refresh path", async () => {
  const now = Date.now();
  const cachedSnapshot = createDashboardSnapshot();
  const cacheKey = createProviderDashboardCacheKey(PROVIDER_ID);
  const { appServices, counts } = createHarness({
    cacheEntries: [
      createCacheEntry(cacheKey, cachedSnapshot, now - 1_000, now + 60_000),
    ],
  });

  const state = await appServices.dashboard.loadDashboard(PROVIDER_ID);

  assert.equal(state.status, "success");
  assert.equal(state.isStale, false);
  assert.equal(state.error, undefined);
  assert.deepStrictEqual(state.data, cachedSnapshot);
  assert.equal(counts.config, 0);
  assert.equal(counts.profile, 0);
  assert.equal(counts.recentUnlocks, 0);
  assert.equal(counts.recentlyPlayedGames, 0);
});

test("decky dashboard snapshot cache returns cached state immediately without backend refresh", async () => {
  await withMockDeckyStorage(async () => {
    const cachedSnapshot = createDashboardSnapshot();
    assert.ok(writeDeckyDashboardSnapshot(cachedSnapshot));

    setDeckyBackendCallImplementationForTests(async () => {
      throw new Error("backend should not be called for cached dashboard snapshot");
    });

    try {
      const state = await loadDeckyDashboardState(PROVIDER_ID);

      assert.equal(state.status, "stale");
      assert.equal(state.isStale, true);
      assert.equal(state.error, undefined);
      assert.deepStrictEqual(state.data, cachedSnapshot);

      const cachedEntry = readDeckyDashboardSnapshotCacheEntry(PROVIDER_ID);
      assert.deepStrictEqual(cachedEntry?.snapshot, cachedSnapshot);
      assert.equal(JSON.stringify(cachedEntry ?? {}).includes("apiKey"), false);
    } finally {
      setDeckyBackendCallImplementationForTests(deckyBackendTestCallImplementation);
      assert.equal(clearDeckyDashboardSnapshot(PROVIDER_ID), true);
    }
  });
});

test("decky steam scan overview is readable without parsing the full summary blob", async () => {
  await withMockDeckyStorage(async () => {
    const overview = {
      ownedGameCount: 123,
      scannedGameCount: 120,
      gamesWithAchievements: 80,
      unlockedAchievements: 300,
      totalAchievements: 500,
      perfectGames: 10,
      completionPercent: 60,
      scannedAt: new Date(1_700_000_000_000).toISOString(),
    };

    writeDeckyStorageText(
      "achievement-companion:decky:steam:library-achievement-scan-overview",
      JSON.stringify(overview),
    );
    writeDeckyStorageText(
      "achievement-companion:decky:steam:library-achievement-scan-summary",
      "{ not valid json",
    );

    const loadedOverview = readDeckySteamLibraryAchievementScanOverview("steam");

    assert.deepStrictEqual(loadedOverview, overview);
  });
});

test("decky dashboard refresh logging breadcrumbs are present in source", () => {
  const source = readFileSync("src/platform/decky/decky-app-services.ts", "utf8");
  assert.match(source, /Dashboard refresh started/);
  assert.match(source, /Dashboard refresh completed/);
  assert.match(source, /Dashboard refresh failed/);
  assert.match(source, /deckyDiagnosticLogger\.record/);
});

test("decky dashboard refresh reuses an in-flight refresh for the same provider", async () => {
  await withMockDeckyStorage(async () => {
    resetDeckyAppServicesForTests();
    resetDeckyBackendTestState();
    deckyBackendTestState.steam.config = {
      steamId64: "12345678901234567",
      hasApiKey: true,
      language: "english",
      recentAchievementsCount: 5,
      recentlyPlayedCount: 5,
      includePlayedFreeGames: false,
    };
    deckyBackendTestState.steam.secret = "dummy-secret";

    const diagnosticEvents: Array<Record<string, unknown>> = [];
    setDeckyBackendCallImplementationForTests(async (route: string, payload: unknown) => {
      if (route === "record_diagnostic_event") {
        diagnosticEvents.push(payload as Record<string, unknown>);
        return true;
      }

      return deckyBackendTestCallImplementation(route, payload);
    });

    try {
      const firstProgressEvents: { stepId: string; status: string }[] = [];
      const joinedProgressEvents: { stepId: string; status: string }[] = [];
      const firstRefresh = loadDeckyDashboardState("steam", {
        forceRefresh: true,
        onProgress: (event) => firstProgressEvents.push(event),
      });
      const secondRefresh = loadDeckyDashboardState("steam", {
        forceRefresh: true,
        onProgress: (event) => joinedProgressEvents.push(event),
      });

      const [firstState, secondState] = await Promise.all([firstRefresh, secondRefresh]);

      assert.equal(firstState.status, "success");
      assert.equal(secondState.status, "success");
      assert.equal(
        diagnosticEvents.filter((event) => event.event === "dashboard_refresh_started").length,
        1,
      );
      assert.equal(
        diagnosticEvents.filter((event) => event.event === "dashboard_refresh_completed").length,
        1,
      );
      assert.equal(
        diagnosticEvents.filter((event) => event.event === "dashboard_refresh_failed").length,
        0,
      );
      for (const progressEvents of [firstProgressEvents, joinedProgressEvents]) {
        assert.ok(progressEvents.some((event) => event.stepId === "profile" && event.status === "in-progress"));
        assert.ok(progressEvents.some((event) => event.stepId === "profile" && event.status === "complete"));
        assert.ok(progressEvents.some((event) => event.stepId === "finalize" && event.status === "complete"));
      }
    } finally {
      setDeckyBackendCallImplementationForTests(deckyBackendTestCallImplementation);
      resetDeckyAppServicesForTests();
      resetDeckyBackendTestState();
    }
  });
});

test("decky dashboard refresh keeps steam and retroachievements refreshes independent", async () => {
  const steamHarness = createHarness({
    providerFactory: (counts) => ({
      id: STEAM_PROVIDER_ID,
      capabilities: PROVIDER_CAPABILITIES,
      async loadProfile() {
        counts.profile += 1;
        return DASHBOARD_REFRESH_PROFILE;
      },
      async loadRecentUnlocks() {
        counts.recentUnlocks += 1;
        return DASHBOARD_REFRESH_RECENT_UNLOCKS;
      },
      async loadRecentlyPlayedGames() {
        counts.recentlyPlayedGames += 1;
        return DASHBOARD_REFRESH_RECENTLY_PLAYED_GAMES;
      },
      async loadGameProgress() {
        counts.gameProgress += 1;
        return createGameDetailSnapshot();
      },
    }),
    providerConfig: {
      steamId64: "12345678901234567",
      hasApiKey: true,
      language: "english",
      recentAchievementsCount: 5,
      recentlyPlayedCount: 5,
      includePlayedFreeGames: false,
    },
  });

  const retroHarness = createHarness({
    providerFactory: (counts) => ({
      id: PROVIDER_ID,
      capabilities: PROVIDER_CAPABILITIES,
      async loadProfile() {
        counts.profile += 1;
        return DASHBOARD_REFRESH_PROFILE;
      },
      async loadRecentUnlocks() {
        counts.recentUnlocks += 1;
        return DASHBOARD_REFRESH_RECENT_UNLOCKS;
      },
      async loadRecentlyPlayedGames() {
        counts.recentlyPlayedGames += 1;
        return DASHBOARD_REFRESH_RECENTLY_PLAYED_GAMES;
      },
      async loadGameProgress() {
        counts.gameProgress += 1;
        return createGameDetailSnapshot();
      },
    }),
    providerConfig: {
      username: "retro-user",
      hasApiKey: true,
      recentAchievementsCount: 5,
      recentlyPlayedCount: 5,
    },
  });

  const [steamState, retroState] = await Promise.all([
    steamHarness.appServices.dashboard.loadDashboard(STEAM_PROVIDER_ID, { forceRefresh: true }),
    retroHarness.appServices.dashboard.loadDashboard(PROVIDER_ID, { forceRefresh: true }),
  ]);

  assert.equal(steamState.status, "success");
  assert.equal(retroState.status, "success");
  assert.equal(steamHarness.counts.profile, 1);
  assert.equal(steamHarness.counts.recentUnlocks, 1);
  assert.equal(steamHarness.counts.recentlyPlayedGames, 1);
  assert.equal(retroHarness.counts.profile, 1);
  assert.equal(retroHarness.counts.recentUnlocks, 1);
  assert.equal(retroHarness.counts.recentlyPlayedGames, 1);
});

test("dashboard missing config returns auth error state", async () => {
  const { appServices, counts } = createHarness({
    providerConfig: undefined,
  });

  const state = await appServices.dashboard.loadDashboard(PROVIDER_ID);

  assert.equal(state.status, "error");
  assert.equal(state.error?.kind, "auth");
  assert.match(state.error?.userMessage ?? "", /provider settings are missing/i);
  assert.equal(state.isStale, false);
  assert.equal(state.data, undefined);
  assert.equal(counts.config, 1);
  assert.equal(counts.profile, 0);
  assert.equal(counts.recentUnlocks, 0);
  assert.equal(counts.recentlyPlayedGames, 0);
});

test("dashboard stale cached data is preserved when refresh fails", async () => {
  const now = Date.now();
  const cachedSnapshot = createDashboardSnapshot();
  const cacheKey = createProviderDashboardCacheKey(PROVIDER_ID);
  const { appServices, counts } = createHarness({
    cacheEntries: [
      createCacheEntry(cacheKey, cachedSnapshot, now - 60_000, now - 1),
    ],
    providerConfig: {
      username: "alice",
      apiKey: "secret",
    },
  });

  const state = await appServices.dashboard.loadDashboard(PROVIDER_ID, {
    forceRefresh: true,
  });

  assert.equal(state.status, "stale");
  assert.equal(state.isStale, true);
  assert.deepStrictEqual(state.data, cachedSnapshot);
  assert.equal(state.error?.kind, "unknown");
  assert.match(state.error?.userMessage ?? "", /refresh dashboard data/i);
  assert.equal(counts.config, 1);
  assert.equal(counts.profile, 1);
  assert.equal(counts.recentUnlocks, 1);
  assert.equal(counts.recentlyPlayedGames, 1);
});

test("dashboard successful refresh writes normalized snapshot to cache", async () => {
  const { appServices, counts, writes } = createHarness({
    providerFactory: createSuccessfulProvider,
    providerConfig: {
      username: "alice",
      apiKey: "secret",
    },
  });

  const state = await appServices.dashboard.loadDashboard(PROVIDER_ID);

  assert.equal(state.status, "success");
  assert.equal(state.isStale, false);
  assert.equal(state.error, undefined);
  assert.equal(counts.config, 1);
  assert.equal(counts.profile, 1);
  assert.equal(counts.recentUnlocks, 1);
  assert.equal(counts.recentlyPlayedGames, 1);
  assert.deepStrictEqual(state.data?.featuredGames, DASHBOARD_REFRESH_FEATURED_GAMES);
  assert.deepStrictEqual(state.data?.profile, DASHBOARD_REFRESH_PROFILE);
  assert.deepStrictEqual(state.data?.recentUnlocks, DASHBOARD_REFRESH_RECENT_UNLOCKS);
  assert.deepStrictEqual(state.data?.recentAchievements, DASHBOARD_REFRESH_RECENT_UNLOCKS);
  assert.deepStrictEqual(state.data?.recentlyPlayedGames, DASHBOARD_REFRESH_RECENTLY_PLAYED_GAMES);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.key, createProviderDashboardCacheKey(PROVIDER_ID));
  assert.equal(writes[0]?.version, CACHE_VERSION);
  assert.equal(writes[0]?.storedAt, state.lastUpdatedAt);
  assert.deepStrictEqual(writes[0]?.value, state.data);
});

test("dashboard force refresh updates the decky dashboard snapshot cache", async () => {
  await withMockDeckyStorage(async () => {
    const initialSnapshot = createDashboardSnapshot();
    assert.ok(writeDeckyDashboardSnapshot(initialSnapshot));

    resetDeckyBackendTestState();
    deckyBackendTestState.steam.config = {
      steamId64: "12345678901234567",
      hasApiKey: true,
      language: "english",
      recentAchievementsCount: 5,
      recentlyPlayedCount: 5,
      includePlayedFreeGames: false,
    };
    deckyBackendTestState.steam.secret = "dummy-secret";

    setDeckyBackendCallImplementationForTests(deckyBackendTestCallImplementation);
    try {
      const state = await loadDeckyDashboardState("steam", {
        forceRefresh: true,
      });

      assert.equal(state.status, "success");
      assert.equal(state.isStale, false);
      assert.equal(state.data?.profile.providerId, "steam");

      const cachedEntry = readDeckyDashboardSnapshotCacheEntry("steam");
      assert.ok(cachedEntry !== undefined);
      assert.equal(cachedEntry?.providerId, "steam");
      assert.equal(cachedEntry?.snapshot.profile.providerId, "steam");
      assert.equal(JSON.stringify(cachedEntry ?? {}).includes("dummy-secret"), false);
    } finally {
      setDeckyBackendCallImplementationForTests(deckyBackendTestCallImplementation);
      resetDeckyBackendTestState();
      assert.equal(clearDeckyDashboardSnapshot("steam"), true);
    }
  });
});

test("dashboard recent achievements and recently played games populate from provider data", async () => {
  const { appServices, counts } = createHarness({
    providerFactory: (callCounts) => ({
      id: PROVIDER_ID,
      capabilities: PROVIDER_CAPABILITIES,
      async loadProfile() {
        callCounts.profile += 1;
        return DASHBOARD_REFRESH_PROFILE;
      },
      async loadRecentUnlocks() {
        callCounts.recentUnlocks += 1;
        return DASHBOARD_REFRESH_RECENT_UNLOCKS;
      },
      async loadRecentlyPlayedGames() {
        callCounts.recentlyPlayedGames += 1;
        return DASHBOARD_REFRESH_RECENTLY_PLAYED_GAMES;
      },
      async loadGameProgress() {
        callCounts.gameProgress += 1;
        return createGameDetailSnapshot();
      },
    }),
    providerConfig: {
      username: "alice",
      apiKey: "secret",
    },
  });

  const state = await appServices.dashboard.loadDashboard(PROVIDER_ID);

  assert.equal(state.status, "success");
  assert.equal(state.error, undefined);
  assert.deepStrictEqual(state.data?.recentAchievements, DASHBOARD_REFRESH_RECENT_UNLOCKS);
  assert.deepStrictEqual(state.data?.recentlyPlayedGames, DASHBOARD_REFRESH_RECENTLY_PLAYED_GAMES);
  assert.equal(counts.config, 1);
  assert.equal(counts.profile, 1);
  assert.equal(counts.recentUnlocks, 1);
  assert.equal(counts.recentlyPlayedGames, 1);
});

test("dashboard retains maximum recent collections so display counts can change without a provider reload", async () => {
  const settingsStore = createMemoryKeyValueStore({
    [ACHIEVEMENT_COMPANION_SETTINGS_STORAGE_KEY]: JSON.stringify({
      recentAchievementsCount: 3,
      recentlyPlayedCount: 7,
      showCompletionProgressSubsets: false,
      defaultCompletionProgressFilter: "beaten",
    }),
  });

  const provider = {
    id: PROVIDER_ID,
    capabilities: PROVIDER_CAPABILITIES,
    async loadProfile() {
      return DASHBOARD_REFRESH_PROFILE;
    },
    async loadRecentUnlocks(_config: unknown, options?: { readonly limit?: number }) {
      assert.equal(options?.limit, 10);
      return Array.from({ length: 8 }, (_value, index) => createRecentUnlock(index + 1));
    },
    async loadRecentlyPlayedGames(_config: unknown, options?: { readonly count?: number }) {
      assert.equal(options?.count, 10);
      return Array.from({ length: 8 }, (_value, index) => ({
        providerId: PROVIDER_ID,
        gameId: `game-${index + 1}`,
        title: `Game ${index + 1}`,
        summary: {
          unlockedCount: index + 1,
        },
        lastPlayedAt: 1_700_000_000_000 + index * 1_000,
      }));
    },
    async loadCompletionProgress() {
      return [];
    },
    async loadAchievementsEarnedBetween() {
      return [];
    },
    async loadGameProgress() {
      return createGameDetailSnapshot();
    },
  } satisfies AchievementProvider;

  const { appServices } = createHarness({
    providerFactory: () => provider,
    providerConfig: {
      username: "alice",
      apiKey: "secret",
    },
    platform: {
      ...PLATFORM,
      settingsStore,
    },
  });

  const state = await appServices.dashboard.loadDashboard(PROVIDER_ID);

  assert.equal(state.status, "success");
  assert.equal(state.data?.recentAchievements.length, 8);
  assert.equal(state.data?.recentUnlocks.length, 8);
  assert.equal(state.data?.recentlyPlayedGames.length, 8);
});


test("achievement history service loads newest-first earned-between history and caches it", async () => {
  const { appServices, counts, writes } = createHarness({
    providerFactory: () => ({
      id: PROVIDER_ID,
      capabilities: PROVIDER_CAPABILITIES,
      async loadProfile() {
        counts.profile += 1;
        return {
          ...DASHBOARD_REFRESH_PROFILE,
          metrics: [
            ...DASHBOARD_REFRESH_PROFILE.metrics,
            {
              key: "member-since",
              label: "Member Since",
              value: "2020-01-02 00:00:00",
            },
          ],
        };
      },
      async loadCompletionProgress() {
        counts.completionProgress += 1;
        return [];
      },
      async loadAchievementsEarnedBetween(_config, options) {
        counts.achievementsEarnedBetween += 1;
        assert.equal(options.fromEpochSeconds, Math.trunc(Date.parse("2020-01-02 00:00:00") / 1000));
        return [
          createRecentUnlockForGame("game-1", "Test Game", 1, 1_700_000_000_100),
          createRecentUnlockForGame("game-2", "Second Game", 1, 1_700_000_000_300),
          createRecentUnlockForGame("game-1", "Test Game", 2, 1_700_000_000_200),
        ];
      },
      async loadRecentUnlocks() {
        counts.recentUnlocks += 1;
        return [];
      },
      async loadRecentlyPlayedGames() {
        counts.recentlyPlayedGames += 1;
        return [];
      },
      async loadGameProgress() {
        counts.gameProgress += 1;
        return createGameDetailSnapshot();
      },
    }),
    providerConfig: {
      username: "alice",
      apiKey: "secret",
    },
  });

  const state = await appServices.achievementHistory.loadAchievementHistory(PROVIDER_ID, {
    forceRefresh: true,
  });
  const cachedState = await appServices.achievementHistory.loadAchievementHistory(PROVIDER_ID);

  assert.equal(state.status, "success");
  assert.equal(state.error, undefined);
  assert.deepStrictEqual(state.data?.entries.map((entry) => entry.achievement.achievementId), [
    "game-2-ach-1",
    "game-1-ach-2",
    "game-1-ach-1",
  ]);
  assert.equal(state.data?.summary.unlockedCount, 3);
  assert.match(state.data?.sourceLabel ?? "", /Member since/i);
  assert.equal(counts.config, 1);
  assert.equal(counts.profile, 1);
  assert.equal(counts.achievementsEarnedBetween, 1);
  assert.equal(counts.recentUnlocks, 0);
  assert.equal(cachedState.status, "success");
  assert.deepStrictEqual(cachedState.data?.entries.map((entry) => entry.achievement.achievementId), [
    "game-2-ach-1",
    "game-1-ach-2",
    "game-1-ach-1",
  ]);
  assert.equal(counts.config, 1);
  assert.equal(counts.profile, 1);
  assert.equal(counts.achievementsEarnedBetween, 1);
  assert.equal(counts.recentUnlocks, 0);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.key, createProviderAchievementHistoryCacheKey(PROVIDER_ID));
});

test("achievement history reuses a full-screen session profile without loading it twice", async () => {
  const sessionProfile = {
    ...DASHBOARD_REFRESH_PROFILE,
    metrics: [
      ...DASHBOARD_REFRESH_PROFILE.metrics,
      { key: "member-since", label: "Member Since", value: "2020-01-02 00:00:00" },
    ],
  };
  const { appServices, counts } = createHarness({
    providerFactory: () => ({
      id: PROVIDER_ID,
      capabilities: PROVIDER_CAPABILITIES,
      async loadProfile() {
        counts.profile += 1;
        return sessionProfile;
      },
      async loadCompletionProgress() {
        counts.completionProgress += 1;
        return [];
      },
      async loadAchievementsEarnedBetween() {
        counts.achievementsEarnedBetween += 1;
        return [createRecentUnlockForGame("game-1", "Test Game", 1, 1_700_000_000_100)];
      },
      async loadRecentUnlocks() {
        counts.recentUnlocks += 1;
        return [];
      },
      async loadRecentlyPlayedGames() {
        counts.recentlyPlayedGames += 1;
        return [];
      },
      async loadGameProgress() {
        counts.gameProgress += 1;
        return createGameDetailSnapshot();
      },
    }),
    providerConfig: { username: "alice", apiKey: "secret" },
  });

  const state = await appServices.achievementHistory.loadAchievementHistory(PROVIDER_ID, {
    forceRefresh: true,
    profile: sessionProfile,
  });

  assert.equal(state.status, "success");
  assert.equal(state.data?.profile, sessionProfile);
  assert.equal(counts.profile, 0);
  assert.equal(counts.achievementsEarnedBetween, 1);
});

test("completion progress service exposes played, unfinished, beaten, and mastered counts", async () => {
  const { appServices, counts, writes } = createHarness({
    providerFactory: (callCounts) => ({
      id: PROVIDER_ID,
      capabilities: PROVIDER_CAPABILITIES,
      async loadProfile() {
        callCounts.profile += 1;
        return DASHBOARD_REFRESH_PROFILE;
      },
      async loadCompletionProgress() {
        callCounts.completionProgress += 1;
        return [
          {
            providerId: PROVIDER_ID,
            gameId: "unfinished-game",
            title: "Unfinished Game",
            status: "in_progress",
            summary: {
              unlockedCount: 3,
              totalCount: 10,
              completionPercent: 30,
            },
            metrics: [],
          },
          {
            providerId: PROVIDER_ID,
            gameId: "completed-game",
            title: "Completed Game",
            status: "completed",
            summary: {
              unlockedCount: 9,
              totalCount: 10,
              completionPercent: 90,
            },
            metrics: [],
          },
          {
            providerId: PROVIDER_ID,
            gameId: "beaten-game",
            title: "Beaten Game",
            status: "beaten",
            summary: {
              unlockedCount: 10,
              totalCount: 10,
              completionPercent: 100,
            },
            metrics: [],
          },
          {
            providerId: PROVIDER_ID,
            gameId: "mastered-game",
            title: "Mastered Game",
            status: "mastered",
            summary: {
              unlockedCount: 12,
              totalCount: 12,
              completionPercent: 100,
            },
            metrics: [],
          },
        ] satisfies readonly NormalizedGame[];
      },
      async loadRecentUnlocks() {
        callCounts.recentUnlocks += 1;
        return DASHBOARD_REFRESH_RECENT_UNLOCKS;
      },
      async loadRecentlyPlayedGames() {
        callCounts.recentlyPlayedGames += 1;
        return DASHBOARD_REFRESH_RECENTLY_PLAYED_GAMES;
      },
      async loadGameProgress() {
        callCounts.gameProgress += 1;
        return createGameDetailSnapshot();
      },
    }),
    providerConfig: {
      username: "alice",
      apiKey: "secret",
    },
  });

  const state = await appServices.completionProgress.loadCompletionProgress(PROVIDER_ID);

  assert.equal(state.status, "success");
  assert.equal(state.error, undefined);
  assert.deepStrictEqual(state.data?.summary, {
    playedCount: 4,
    unfinishedCount: 1,
    beatenCount: 1,
    masteredCount: 1,
  });
  assert.deepStrictEqual(state.data?.games.map((game) => game.status), [
    "in_progress",
    "completed",
    "beaten",
    "mastered",
  ]);
  assert.equal(counts.config, 1);
  assert.equal(counts.completionProgress, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.key, createProviderCompletionProgressCacheKey(PROVIDER_ID));
  assert.equal(writes[0]?.version, CACHE_VERSION);
  assert.equal(writes[0]?.storedAt, state.lastUpdatedAt);
  assert.deepStrictEqual(writes[0]?.value, state.data);
});

test("decky recent achievements persist the last ten observed unlocks", async () => {
  await withMockDeckyStorage(async () => {
    const seededSnapshot = createDashboardSnapshotWithRecentAchievements(
      [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(createRecentUnlock),
    );

    const seededState = applyDeckyRecentAchievementHistory(seededSnapshot);
    assert.deepStrictEqual(
      seededState.recentAchievements.map((recentUnlock) => recentUnlock.achievement.achievementId),
      ["ach-10", "ach-9", "ach-8", "ach-7", "ach-6", "ach-5", "ach-4", "ach-3", "ach-2", "ach-1"],
    );

    const emptyWindowState = applyDeckyRecentAchievementHistory(
      createDashboardSnapshotWithRecentAchievements([]),
    );
    assert.deepStrictEqual(
      emptyWindowState.recentAchievements.map((recentUnlock) => recentUnlock.achievement.achievementId),
      ["ach-10", "ach-9", "ach-8", "ach-7", "ach-6", "ach-5", "ach-4", "ach-3", "ach-2", "ach-1"],
    );

    const rolledState = applyDeckyRecentAchievementHistory(
      createDashboardSnapshotWithRecentAchievements([11].map(createRecentUnlock)),
    );
    assert.deepStrictEqual(
      rolledState.recentAchievements.map((recentUnlock) => recentUnlock.achievement.achievementId),
      ["ach-11", "ach-10", "ach-9", "ach-8", "ach-7", "ach-6", "ach-5", "ach-4", "ach-3", "ach-2"],
    );
  });
});

test("decky recent achievements rank newer live entries ahead of stale cached history", async () => {
  await withMockDeckyStorage(async () => {
    const cachedSnapshot = createDashboardSnapshotWithRecentAchievements(
      [5, 4, 3, 2, 1].map(createRecentUnlock),
    );
    applyDeckyRecentAchievementHistory(cachedSnapshot);

    const rankedState = await buildDeckyRecentAchievementHistory({
      provider: undefined,
      providerConfig: undefined,
      snapshot: createDashboardSnapshotWithRecentAchievements(
        [101, 100].map(createRecentUnlock),
      ),
    });

    assert.deepStrictEqual(
      rankedState.recentAchievements.map((recentUnlock) => recentUnlock.achievement.achievementId),
      ["ach-101", "ach-100", "ach-5", "ach-4", "ach-3", "ach-2", "ach-1"],
    );
  });
});

test("decky recent achievements fill remaining slots with fallback entries up to ten", async () => {
  await withMockDeckyStorage(async () => {
    const cachedSnapshot = createDashboardSnapshotWithRecentAchievements([
      createRecentUnlockWithoutTimestamp(1),
      createRecentUnlockWithoutTimestamp(2),
      createRecentUnlockWithoutTimestamp(3),
    ]);
    applyDeckyRecentAchievementHistory(cachedSnapshot);

    const rankedState = await buildDeckyRecentAchievementHistory({
      provider: undefined,
      providerConfig: undefined,
      snapshot: createDashboardSnapshotWithRecentAchievements(
        [10, 9, 8, 7, 6].map(createRecentUnlock),
      ),
    });

    assert.deepStrictEqual(
      rankedState.recentAchievements.map((recentUnlock) => recentUnlock.achievement.achievementId),
      ["ach-10", "ach-9", "ach-8", "ach-7", "ach-6", "ach-1", "ach-2", "ach-3"],
    );
  });
});

test("decky recent achievements keep missing timestamps behind trusted ones", async () => {
  await withMockDeckyStorage(async () => {
    const cachedSnapshot = createDashboardSnapshotWithRecentAchievements([
      createRecentUnlockWithoutTimestamp(1),
      createRecentUnlock(2),
    ]);
    applyDeckyRecentAchievementHistory(cachedSnapshot);

    const rankedState = await buildDeckyRecentAchievementHistory({
      provider: undefined,
      providerConfig: undefined,
      snapshot: createDashboardSnapshotWithRecentAchievements([100].map(createRecentUnlock)),
    });

    assert.deepStrictEqual(
      rankedState.recentAchievements.map((recentUnlock) => recentUnlock.achievement.achievementId),
      ["ach-100", "ach-2", "ach-1"],
    );
  });
});

test("decky recent achievements backfill from completion progress without dates", async () => {
  await withMockDeckyStorage(async () => {
    let completionProgressCalls = 0;
    let gameProgressCalls = 0;

    const state = await buildDeckyRecentAchievementHistory({
      provider: {
        async loadCompletionProgress() {
          completionProgressCalls += 1;
          return createBackfillCompletionProgressWithoutDates();
        },
        async loadGameProgress(_config, gameId) {
          gameProgressCalls += 1;
          if (gameId === "game-a") {
            return createBackfillGameDetail("game-a", "Game A", [
              1_700_000_000_500,
              1_700_000_000_400,
              1_700_000_000_300,
            ]);
          }

          return createBackfillGameDetail("game-b", "Game B", [
            1_700_000_000_200,
            1_700_000_000_100,
          ]);
        },
      },
      providerConfig: {
        username: "alice",
        apiKey: "secret",
      },
      snapshot: createDashboardSnapshotWithRecentAchievements([]),
    });

    assert.deepStrictEqual(
      state.recentAchievements.map((recentUnlock) => recentUnlock.achievement.achievementId),
      ["game-a-ach-1", "game-a-ach-2", "game-a-ach-3", "game-b-ach-1", "game-b-ach-2"],
    );
    assert.equal(completionProgressCalls, 1);
    assert.equal(gameProgressCalls, 2);
  });
});

test("decky recent achievements discover missing games from recently played history", async () => {
  await withMockDeckyStorage(async () => {
    let completionProgressCalls = 0;
    let recentlyPlayedCalls = 0;
    let gameProgressCalls = 0;

    const state = await buildDeckyRecentAchievementHistory({
      provider: {
        async loadCompletionProgress() {
          completionProgressCalls += 1;
          return createBackfillCompletionProgressWithoutDates();
        },
        async loadRecentlyPlayedGames() {
          recentlyPlayedCalls += 1;
          return [
            createBackfillRecentlyPlayedGame(
              "game-dkc",
              "Donkey Kong Country",
              5,
              1_700_000_000_900,
            ),
            createBackfillRecentlyPlayedGame("game-b", "Game B", 2, 1_700_000_000_200),
          ];
        },
        async loadGameProgress(_config, gameId) {
          gameProgressCalls += 1;
          if (gameId === "game-dkc") {
            return createBackfillGameDetail("game-dkc", "Donkey Kong Country", [
              1_700_000_000_900,
              1_700_000_000_800,
              1_700_000_000_700,
              1_700_000_000_600,
              1_700_000_000_500,
            ]);
          }

          if (gameId === "game-a") {
            return createBackfillGameDetail("game-a", "Game A", [
              1_699_000_000_400,
              1_699_000_000_300,
              1_699_000_000_200,
            ]);
          }

          return createBackfillGameDetail("game-b", "Game B", [
            1_699_000_000_100,
            1_699_000_000_000,
          ]);
        },
      },
      providerConfig: {
        username: "alice",
        apiKey: "secret",
      },
      snapshot: createDashboardSnapshotWithRecentAchievements([]),
    });

    assert.deepStrictEqual(
      state.recentAchievements.map((recentUnlock) => recentUnlock.achievement.achievementId),
      [
        "game-dkc-ach-1",
        "game-dkc-ach-2",
        "game-dkc-ach-3",
        "game-dkc-ach-4",
        "game-dkc-ach-5",
        "game-a-ach-1",
        "game-a-ach-2",
        "game-a-ach-3",
        "game-b-ach-1",
        "game-b-ach-2",
      ],
    );
    assert.equal(completionProgressCalls, 1);
    assert.equal(recentlyPlayedCalls, 1);
    assert.equal(gameProgressCalls, 3);
  });
});

test("decky recent achievements prefer date-range history and stay stable across reopen", async () => {
  await withMockDeckyStorage(async () => {
    const dateRangeAchievements = [
      createRecentUnlockForGame("game-dkc", "Donkey Kong Country", 1, 1_900_000_000_900),
      createRecentUnlockForGame("game-dkc", "Donkey Kong Country", 2, 1_900_000_000_800),
      createRecentUnlockForGame("game-pokemon", "Pokémon Gold Version", 1, 1_900_000_000_700),
      createRecentUnlockForGame("game-pokemon", "Pokémon Gold Version", 2, 1_900_000_000_600),
      createRecentUnlockForGame("game-mario", "Super Mario World", 1, 1_900_000_000_500),
      createRecentUnlockForGame("game-mario", "Super Mario World", 2, 1_900_000_000_400),
    ];

    let completionProgressCalls = 0;
    let dateRangeCalls = 0;
    let gameProgressCalls = 0;

    const provider = {
      async loadCompletionProgress() {
        completionProgressCalls += 1;
        throw new Error("completion progress should not be needed when date-range history is sufficient");
      },
      async loadAchievementsEarnedBetween() {
        dateRangeCalls += 1;
        return dateRangeAchievements;
      },
      async loadGameProgress() {
        gameProgressCalls += 1;
        throw new Error("game progress should not be needed when date-range history is sufficient");
      },
    };
    const snapshotWithRecentAchievements = createDashboardSnapshotWithRecentAchievements([
      createRecentUnlockWithoutTimestamp(1),
      createRecentUnlockWithoutTimestamp(2),
      createRecentUnlockWithoutTimestamp(3),
    ]);
    const snapshot = {
      ...snapshotWithRecentAchievements,
      profile: {
        ...snapshotWithRecentAchievements.profile,
        metrics: [
          {
            key: "member-since",
            label: "Member Since",
            value: "2020-01-02 00:00:00",
          },
        ],
      },
    };

    const firstState = await buildDeckyRecentAchievementHistory({
      provider,
      providerConfig: {
        username: "alice",
        apiKey: "secret",
      },
      snapshot,
    });

    const secondState = await buildDeckyRecentAchievementHistory({
      provider,
      providerConfig: {
        username: "alice",
        apiKey: "secret",
      },
      snapshot,
    });

    assert.deepStrictEqual(
      firstState.recentAchievements.map((recentUnlock) => recentUnlock.achievement.achievementId),
      [
        "game-dkc-ach-1",
        "game-dkc-ach-2",
        "game-pokemon-ach-1",
        "game-pokemon-ach-2",
        "game-mario-ach-1",
        "game-mario-ach-2",
        "ach-1",
        "ach-2",
        "ach-3",
      ],
    );
    assert.deepStrictEqual(
      secondState.recentAchievements.map((recentUnlock) => recentUnlock.achievement.achievementId),
      [
        "game-dkc-ach-1",
        "game-dkc-ach-2",
        "game-pokemon-ach-1",
        "game-pokemon-ach-2",
        "game-mario-ach-1",
        "game-mario-ach-2",
        "ach-1",
        "ach-2",
        "ach-3",
      ],
    );
    assert.equal(completionProgressCalls, 2);
    assert.equal(dateRangeCalls, 2);
    assert.equal(gameProgressCalls, 0);
  });
});

test("decky overview recent achievements stay separate from persistent recent achievements", async () => {
  await withMockDeckyStorage(async () => {
    const persistentSnapshot = createDashboardSnapshotWithRecentAchievements([
      createRecentUnlock(1),
      createRecentUnlock(2),
      createRecentUnlock(3),
      createRecentUnlock(4),
      createRecentUnlock(5),
    ]);
    const snapshot = {
      ...persistentSnapshot,
      recentUnlocks: [createRecentUnlock(90), createRecentUnlock(91)],
    };

    const state = await buildDeckyRecentAchievementHistory({
      provider: undefined,
      providerConfig: undefined,
      snapshot,
    });

    assert.equal(state.recentAchievements.length, 5);
  });
});

test("decky recent achievements continue when one backfill game fails", async () => {
  await withMockDeckyStorage(async () => {
    const state = await buildDeckyRecentAchievementHistory({
      provider: {
        async loadCompletionProgress() {
          return createBackfillCompletionProgressWithoutDates();
        },
        async loadGameProgress(_config, gameId) {
          if (gameId === "game-a") {
            throw new Error("temporary backfill failure");
          }

          return createBackfillGameDetail("game-b", "Game B", [
            1_700_000_000_200,
            1_700_000_000_100,
          ]);
        },
      },
      providerConfig: {
        username: "alice",
        apiKey: "secret",
      },
      snapshot: createDashboardSnapshotWithRecentAchievements([]),
    });

    assert.deepStrictEqual(
      state.recentAchievements.map((recentUnlock) => recentUnlock.achievement.achievementId),
      ["game-b-ach-1", "game-b-ach-2"],
    );
  });
});

test("decky recent achievements can be backfilled from completion progress", async () => {
  await withMockDeckyStorage(async () => {
    const provider = {
      async loadCompletionProgress() {
        return createBackfillCompletionProgress();
      },
      async loadGameProgress(_config: unknown, gameId: string) {
        if (gameId === "game-a") {
          return createBackfillGameDetail("game-a", "Game A", [
            1_700_000_000_500,
            1_700_000_000_400,
            1_700_000_000_300,
          ]);
        }

        return createBackfillGameDetail("game-b", "Game B", [
          1_700_000_000_250,
          1_700_000_000_200,
          1_700_000_000_150,
        ]);
      },
    };

    const backfilledState = await buildDeckyRecentAchievementHistory({
      provider,
      providerConfig: {
        username: "alice",
        apiKey: "secret",
      },
      snapshot: createDashboardSnapshotWithRecentAchievements([]),
    });

    assert.equal(backfilledState.recentAchievements.length, 6);
    assert.deepStrictEqual(
      backfilledState.recentAchievements.map((recentUnlock) => recentUnlock.achievement.achievementId),
      [
        "game-a-ach-1",
        "game-a-ach-2",
        "game-a-ach-3",
        "game-b-ach-1",
        "game-b-ach-2",
        "game-b-ach-3",
      ],
    );
  });
});

test("retroachievements recently played games normalize badge art urls and progress", () => {
  const rawRecentlyPlayedGames: readonly RawRetroAchievementsRecentlyPlayedGameResponse[] = [
    {
      GameID: 1234,
      ConsoleID: 7,
      Title: "Test Game",
      ConsoleName: "NES",
      ImageIcon: "/Images/000001.png",
      LastPlayed: "2024-01-01 00:00:00",
      AchievementsTotal: 20,
      NumAchieved: 5,
      HighestAwardKind: "mastered",
    },
  ];

  const recentlyPlayedGames = normalizeRetroAchievementsRecentlyPlayedGames(rawRecentlyPlayedGames);

  assert.equal(recentlyPlayedGames[0]?.coverImageUrl, "https://i.retroachievements.org/Images/000001.png");
  assert.equal(recentlyPlayedGames[0]?.summary.unlockedCount, 5);
  assert.equal(recentlyPlayedGames[0]?.summary.totalCount, 20);
  assert.equal(recentlyPlayedGames[0]?.summary.completionPercent, 25);
  assert.equal(recentlyPlayedGames[0]?.metrics?.find((metric) => metric.key === "highest-award-kind")?.value, "mastered");
  assert.equal(isRetroAchievementsMasteredHardcoreGame(recentlyPlayedGames[0]!), true);
  assert.equal(recentlyPlayedGames[0]?.lastPlayedAt, Date.parse("2024-01-01T00:00:00Z"));
});

test("retroachievements client loads official systems from API_GetConsoleIDs.php", async () => {
  const requests: Array<{ readonly path: string; readonly query?: Record<string, unknown> }> = [];
  const client = createRetroAchievementsClient({
    async requestJson<T>(request) {
      requests.push({
        path: request.path,
        ...(request.query !== undefined ? { query: request.query as Record<string, unknown> } : {}),
      });

      return [
        {
          ID: 7,
          Name: "NES",
          IconURL: "/Images/Consoles/007.png",
          Active: true,
          IsGameSystem: true,
        },
      ] as T;
    },
  });

  const systems = await client.loadSystems?.({
    username: "alice",
    hasApiKey: true,
  });

  assert.deepStrictEqual(requests, [
    {
      path: "API_GetConsoleIDs.php",
      query: {
        u: "alice",
      },
    },
  ]);
  assert.equal(systems?.[0]?.ID, 7);
  assert.equal(systems?.[0]?.IconURL, "/Images/Consoles/007.png");
});

test("retroachievements provider caches systems and maps ConsoleID to systemIconUrl", async () => {
  let systemsCalls = 0;
  const provider = createRetroAchievementsProvider({
    client: {
      async loadSystems() {
        systemsCalls += 1;
        return [
          {
            ID: 7,
            Name: "NES",
            IconURL: "/Images/Consoles/007.png",
            Active: true,
            IsGameSystem: true,
          },
          {
            ID: 8,
            Name: "SNES",
            IconURL: "https://static.retroachievements.org/Images/Consoles/008.png",
            Active: true,
            IsGameSystem: true,
          },
        ] satisfies readonly RawRetroAchievementsSystemResponse[];
      },
      async loadProfile() {
        throw new Error("not used");
      },
      async loadCompletionProgress() {
        throw new Error("not used");
      },
      async loadAchievementsEarnedBetween() {
        throw new Error("not used");
      },
      async loadRecentUnlocks() {
        throw new Error("not used");
      },
      async loadRecentlyPlayedGames() {
        return [
          {
            GameID: 100,
            ConsoleID: 7,
            Title: "Console Mapped Game",
            ConsoleName: "NES",
            LastPlayed: "2024-01-03 00:00:00",
            AchievementsTotal: 12,
            NumAchieved: 3,
          },
          {
            GameID: 200,
            ConsoleID: 8,
            Title: "Absolute Icon Game",
            ConsoleName: "SNES",
            LastPlayed: "2024-01-02 00:00:00",
            AchievementsTotal: 20,
            NumAchieved: 10,
          },
        ] satisfies readonly RawRetroAchievementsRecentlyPlayedGameResponse[];
      },
      async loadGameProgress() {
        return {
          ...createRetroAchievementsGameProgressResponse({
            gameId: "100",
            title: "Console Mapped Game",
            unlockedCount: 3,
            totalCount: 12,
          }),
          ConsoleID: 7,
        };
      },
    },
  });

  const firstLoad = await provider.loadRecentlyPlayedGames(
    {
      username: "alice",
      apiKey: "secret",
    },
    { count: 2 },
  );
  const gameDetail = await provider.loadGameProgress(
    {
      username: "alice",
      apiKey: "secret",
    },
    "100",
  );
  const secondLoad = await provider.loadRecentlyPlayedGames(
    {
      username: "alice",
      apiKey: "secret",
    },
    { count: 2 },
  );

  assert.equal(systemsCalls, 1);
  assert.equal(
    firstLoad[0]?.systemIconUrl,
    "https://i.retroachievements.org/Images/Consoles/007.png",
  );
  assert.equal(
    firstLoad[1]?.systemIconUrl,
    "https://static.retroachievements.org/Images/Consoles/008.png",
  );
  assert.equal(
    gameDetail.game.systemIconUrl,
    "https://i.retroachievements.org/Images/Consoles/007.png",
  );
  assert.equal(secondLoad[0]?.systemIconUrl, firstLoad[0]?.systemIconUrl);
});

test("retroachievements recently played games enrich explicit award state from bounded game detail", async () => {
  const gameProgressCalls: string[] = [];
  const provider = createRetroAchievementsProvider({
    client: {
      async loadSystems() {
        return [];
      },
      async loadProfile() {
        throw new Error("not used");
      },
      async loadCompletionProgress() {
        throw new Error("not used");
      },
      async loadAchievementsEarnedBetween() {
        throw new Error("not used");
      },
      async loadRecentUnlocks() {
        throw new Error("not used");
      },
      async loadRecentlyPlayedGames(_config, options) {
        assert.equal(options?.count, 3);
        return [
          {
            GameID: 100,
            Title: "Mastered Missing Award",
            ConsoleName: "NES",
            LastPlayed: "2024-01-03 00:00:00",
            AchievementsTotal: 57,
            NumAchieved: 57,
          },
          {
            GameID: 200,
            Title: "Already Explicit",
            ConsoleName: "SNES",
            LastPlayed: "2024-01-02 00:00:00",
            AchievementsTotal: 20,
            NumAchieved: 10,
            HighestAwardKind: "beaten-hardcore",
          },
          {
            GameID: 250,
            Title: "Placeholder Award",
            ConsoleName: "Nintendo 64",
            LastPlayed: "2024-01-01 12:00:00",
            AchievementsTotal: 96,
            NumAchieved: 70,
            HighestAwardKind: "played",
          },
          {
            GameID: 300,
            Title: "Should Not Be Enriched",
            ConsoleName: "Genesis",
            LastPlayed: "2024-01-01 00:00:00",
            AchievementsTotal: 8,
            NumAchieved: 8,
          },
        ] satisfies readonly RawRetroAchievementsRecentlyPlayedGameResponse[];
      },
      async loadGameProgress(_config, gameId) {
        gameProgressCalls.push(gameId);
        if (gameId === "100") {
          return createRetroAchievementsGameProgressResponse({
            gameId,
            title: "Mastered Missing Award",
            highestAwardKind: "mastered",
            highestAwardDate: "2024-04-23T21:28:49+00:00",
            unlockedCount: 57,
            totalCount: 57,
          });
        }

        if (gameId === "250") {
          return createRetroAchievementsGameProgressResponse({
            gameId,
            title: "Placeholder Award",
            highestAwardKind: "beaten-hardcore",
            unlockedCount: 70,
            totalCount: 96,
          });
        }

        throw new Error(`unexpected game progress call for ${gameId}`);
      },
    },
  });

  const games = await provider.loadRecentlyPlayedGames(
    {
      username: "alice",
      apiKey: "secret",
    },
    { count: 3 },
  );

  assert.deepStrictEqual(games.map((game) => game.title), ["Mastered Missing Award", "Already Explicit", "Placeholder Award"]);
  assert.deepStrictEqual(gameProgressCalls, ["100", "250"]);
  assert.equal(games[0]?.metrics?.find((metric) => metric.key === "highest-award-kind")?.value, "mastered");
  assert.equal(games[0]?.metrics?.find((metric) => metric.key === "highest-award-date")?.value, String(Date.parse("2024-04-23T21:28:49+00:00")));
  assert.equal(isRetroAchievementsMasteredHardcoreGame(games[0]!), true);
  assert.equal(games[1]?.metrics?.find((metric) => metric.key === "highest-award-kind")?.value, "beaten-hardcore");
  assert.equal(games[2]?.metrics?.find((metric) => metric.key === "highest-award-kind")?.value, "beaten-hardcore");
  assert.equal(isRetroAchievementsBeatenGame(games[2]!), true);
});

test("retroachievements recently played enrichment does not infer mastered from 100 percent and falls back safely", async () => {
  const gameProgressCalls: string[] = [];
  const provider = createRetroAchievementsProvider({
    client: {
      async loadSystems() {
        return [];
      },
      async loadProfile() {
        throw new Error("not used");
      },
      async loadCompletionProgress() {
        throw new Error("not used");
      },
      async loadAchievementsEarnedBetween() {
        throw new Error("not used");
      },
      async loadRecentUnlocks() {
        throw new Error("not used");
      },
      async loadRecentlyPlayedGames() {
        return [
          {
            GameID: 400,
            Title: "Hundred Percent Without Award",
            ConsoleName: "Game Boy",
            LastPlayed: "2024-01-04 00:00:00",
            AchievementsTotal: 10,
            NumAchieved: 10,
          },
          {
            GameID: 500,
            Title: "Progress Fetch Fails",
            ConsoleName: "Game Boy Color",
            LastPlayed: "2024-01-03 00:00:00",
            AchievementsTotal: 12,
            NumAchieved: 6,
          },
        ] satisfies readonly RawRetroAchievementsRecentlyPlayedGameResponse[];
      },
      async loadGameProgress(_config, gameId) {
        gameProgressCalls.push(gameId);
        if (gameId === "400") {
          return createRetroAchievementsGameProgressResponse({
            gameId,
            title: "Hundred Percent Without Award",
            unlockedCount: 10,
            totalCount: 10,
          });
        }

        throw new Error("detail unavailable");
      },
    },
  });

  const games = await provider.loadRecentlyPlayedGames(
    {
      username: "alice",
      apiKey: "secret",
    },
    { count: 2 },
  );

  assert.deepStrictEqual(gameProgressCalls, ["400", "500"]);
  assert.equal(games.length, 2);
  assert.equal(games[0]?.summary.completionPercent, 100);
  assert.equal(games[0]?.metrics?.find((metric) => metric.key === "highest-award-kind"), undefined);
  assert.equal(isRetroAchievementsMasteredHardcoreGame(games[0]!), false);
  assert.equal(games[1]?.metrics?.find((metric) => metric.key === "highest-award-kind"), undefined);
  assert.equal(isRetroAchievementsMasteredHardcoreGame(games[1]!), false);
});

test("retroachievements systems fetch failure falls back to text-only game surfaces", async () => {
  const provider = createRetroAchievementsProvider({
    client: {
      async loadSystems() {
        throw new Error("systems unavailable");
      },
      async loadProfile() {
        throw new Error("not used");
      },
      async loadCompletionProgress() {
        throw new Error("not used");
      },
      async loadAchievementsEarnedBetween() {
        throw new Error("not used");
      },
      async loadRecentUnlocks() {
        throw new Error("not used");
      },
      async loadRecentlyPlayedGames() {
        return [
          {
            GameID: 100,
            ConsoleID: 7,
            Title: "Fallback Game",
            ConsoleName: "NES",
            LastPlayed: "2024-01-03 00:00:00",
            AchievementsTotal: 12,
            NumAchieved: 3,
          },
        ] satisfies readonly RawRetroAchievementsRecentlyPlayedGameResponse[];
      },
      async loadGameProgress() {
        return {
          ...createRetroAchievementsGameProgressResponse({
            gameId: "100",
            title: "Fallback Game",
            unlockedCount: 3,
            totalCount: 12,
          }),
          ConsoleID: 7,
        };
      },
    },
  });

  const recentlyPlayedGames = await provider.loadRecentlyPlayedGames(
    {
      username: "alice",
      apiKey: "secret",
    },
    { count: 1 },
  );
  const gameDetail = await provider.loadGameProgress(
    {
      username: "alice",
      apiKey: "secret",
    },
    "100",
  );

  assert.equal(recentlyPlayedGames[0]?.systemIconUrl, undefined);
  assert.equal(gameDetail.game.systemIconUrl, undefined);
});

test("game detail parses the documented RetroAchievements game-progress shape", async () => {
  const { appServices, counts } = createHarness({
    providerFactory: (callCounts) =>
      createRetroAchievementsProvider({
        client: createRetroAchievementsGameDetailClient(DOCUMENTED_GAME_PROGRESS_RESPONSE, callCounts),
      }),
    providerConfig: {
      username: "alice",
      apiKey: "secret",
    },
  });

  const state = await appServices.gameDetail.loadGameDetail(PROVIDER_ID, "14402", {
    forceRefresh: true,
  });

  assert.equal(state.status, "success");
  assert.equal(state.isStale, false);
  assert.equal(state.error, undefined);
  assert.equal(state.data?.game.gameId, "14402");
  assert.equal(state.data?.game.title, "Dragster");
  assert.equal(state.data?.game.metrics.find((metric) => metric.key === "total-players")?.value, "456");
  assert.equal(
    state.data?.game.metrics.find((metric) => metric.key === "released")?.value,
    "1992-06-02 00:00:00",
  );
  assert.equal(state.data?.game.metrics.find((metric) => metric.key === "points")?.value, "3");
  assert.equal(state.data?.game.metrics.find((metric) => metric.key === "retro-points")?.value, "3");
  assert.equal(state.data?.game.summary.unlockedCount, 1);
  assert.equal(state.data?.game.summary.totalCount, 2);
  assert.equal(state.data?.game.summary.completionPercent, 50);
  assert.equal(state.data?.achievements[0]?.unlockedAt, Date.parse("2024-04-23T21:28:49Z"));
  assert.equal(state.data?.achievements.length, 2);
  assert.equal(state.data?.achievements[0]?.title, "Novice Dragster Driver 1");
  assert.equal(state.data?.achievements[0]?.isUnlocked, true);
  assert.equal(state.data?.achievements[1]?.title, "Another Test Achievement");
  assert.equal(state.data?.achievements[1]?.isUnlocked, false);
  assert.equal(counts.config, 1);
  assert.equal(counts.gameProgress, 1);
});

test("game detail achievement ordering keeps unlocked items first and newest unlocks first", () => {
  const achievements = sortAchievementsForDisplay([
    {
      providerId: PROVIDER_ID,
      achievementId: "locked-old",
      gameId: "game-1",
      title: "Locked Old",
      isUnlocked: false,
      metrics: [],
    },
    {
      providerId: PROVIDER_ID,
      achievementId: "hardcore-new",
      gameId: "game-1",
      title: "Hardcore New",
      isUnlocked: true,
      unlockMode: "hardcore",
      unlockedAt: Date.parse("2024-01-04T00:00:00Z"),
      hardcoreUnlockedAt: Date.parse("2024-01-04T00:00:00Z"),
      softcoreUnlockedAt: Date.parse("2024-01-04T00:00:00Z"),
      points: 3,
      metrics: [],
    },
    {
      providerId: PROVIDER_ID,
      achievementId: "softcore-newer",
      gameId: "game-1",
      title: "Softcore Newer",
      isUnlocked: true,
      unlockMode: "softcore",
      unlockedAt: Date.parse("2024-01-05T00:00:00Z"),
      hardcoreUnlockedAt: Date.parse("2024-01-05T00:00:00Z"),
      softcoreUnlockedAt: Date.parse("2024-01-05T00:00:00Z"),
      points: 5,
      metrics: [],
    },
    {
      providerId: PROVIDER_ID,
      achievementId: "hardcore-older",
      gameId: "game-1",
      title: "Hardcore Older",
      isUnlocked: true,
      unlockMode: "hardcore",
      unlockedAt: Date.parse("2024-01-02T00:00:00Z"),
      hardcoreUnlockedAt: Date.parse("2024-01-02T00:00:00Z"),
      softcoreUnlockedAt: Date.parse("2024-01-02T00:00:00Z"),
      points: 2,
      metrics: [],
    },
    {
      providerId: PROVIDER_ID,
      achievementId: "softcore-missing",
      gameId: "game-1",
      title: "Softcore Missing",
      isUnlocked: true,
      unlockMode: "softcore",
      metrics: [],
    },
    {
      providerId: PROVIDER_ID,
      achievementId: "locked-new",
      gameId: "game-1",
      title: "Locked New",
      isUnlocked: false,
      metrics: [],
    },
  ]);

  assert.deepStrictEqual(
    achievements.map((achievement) => achievement.achievementId),
    ["softcore-newer", "hardcore-new", "hardcore-older", "softcore-missing", "locked-old", "locked-new"],
  );

  const filterVisibleAchievements = (
    input: readonly (typeof achievements)[number][],
    modeFilter: "all" | "hardcore" | "softcore",
    stateFilter: "all" | "unlocked" | "locked",
  ): string[] =>
    sortAchievementsForDisplay(input)
      .filter((achievement) => {
        if (stateFilter === "unlocked" && !achievement.isUnlocked) {
          return false;
        }

        if (stateFilter === "locked" && achievement.isUnlocked) {
          return false;
        }

        if (!achievement.isUnlocked) {
          return true;
        }

        if (modeFilter === "all") {
          return true;
        }

        if (modeFilter === "hardcore") {
          return achievement.unlockMode !== "softcore";
        }

        return achievement.unlockMode !== "hardcore";
      })
      .map((achievement) => achievement.achievementId);

  assert.deepStrictEqual(
    filterVisibleAchievements(achievements, "all", "all"),
    ["softcore-newer", "hardcore-new", "hardcore-older", "softcore-missing", "locked-old", "locked-new"],
  );
  assert.deepStrictEqual(
    filterVisibleAchievements(achievements, "all", "unlocked"),
    ["softcore-newer", "hardcore-new", "hardcore-older", "softcore-missing"],
  );
  assert.deepStrictEqual(
    filterVisibleAchievements(achievements, "hardcore", "all"),
    ["hardcore-new", "hardcore-older", "locked-old", "locked-new"],
  );
  assert.deepStrictEqual(
    filterVisibleAchievements(achievements, "softcore", "all"),
    ["softcore-newer", "softcore-missing", "locked-old", "locked-new"],
  );
  assert.deepStrictEqual(
    filterVisibleAchievements(achievements, "hardcore", "unlocked"),
    ["hardcore-new", "hardcore-older"],
  );
  assert.deepStrictEqual(
    filterVisibleAchievements(achievements, "softcore", "unlocked"),
    ["softcore-newer", "softcore-missing"],
  );
  assert.deepStrictEqual(
    filterVisibleAchievements(achievements, "all", "locked"),
    ["locked-old", "locked-new"],
  );
});

test("game detail surfaces an error when the documented shape is unusable", async () => {
  const { appServices, counts } = createHarness({
    providerFactory: (callCounts) =>
      createRetroAchievementsProvider({
        client: createRetroAchievementsGameDetailClient(
          {} as RawRetroAchievementsGameProgressResponse,
          callCounts,
        ),
      }),
    providerConfig: {
      username: "alice",
      apiKey: "secret",
    },
  });

  const state = await appServices.gameDetail.loadGameDetail(PROVIDER_ID, "14402", {
    forceRefresh: true,
  });

  assert.equal(state.status, "error");
  assert.equal(state.error?.kind, "parse");
  assert.match(state.error?.userMessage ?? "", /unexpected response/i);
  assert.equal(state.data, undefined);
  assert.equal(counts.config, 1);
  assert.equal(counts.gameProgress, 1);
});

test("game detail cache hit returns cached state without calling refresh path", async () => {
  const now = Date.now();
  const cachedSnapshot = createGameDetailSnapshot();
  const cacheKey = createProviderGameDetailCacheKey(PROVIDER_ID, cachedSnapshot.game.gameId);
  const { appServices, counts } = createHarness({
    cacheEntries: [
      createCacheEntry(cacheKey, cachedSnapshot, now - 1_000, now + 60_000),
    ],
  });

  const state = await appServices.gameDetail.loadGameDetail(PROVIDER_ID, cachedSnapshot.game.gameId);

  assert.equal(state.status, "success");
  assert.equal(state.isStale, false);
  assert.equal(state.error, undefined);
  assert.deepStrictEqual(state.data, cachedSnapshot);
  assert.equal(counts.config, 0);
  assert.equal(counts.gameProgress, 0);
});

test("fresh empty related-game cache skips subset discovery entirely", async () => {
  const now = Date.now();
  const rootGame = createGameDetailSnapshot().game;
  const { appServices, counts } = createHarness({
    cacheEntries: [
      createCacheEntry(
        createProviderRelatedGamesCacheKey(PROVIDER_ID, rootGame.gameId),
        [],
        now - 1_000,
        now + 60_000,
      ),
    ],
    providerFactory: (callCounts) => ({
      ...createSuccessfulProvider(callCounts),
      async loadRelatedGames() {
        callCounts.relatedGames += 1;
        throw new Error("relationship discovery should not run for a fresh empty result");
      },
      async loadRelatedGameProgress() {
        callCounts.relatedGameProgress += 1;
        throw new Error("progress refresh should not run when there are no subsets");
      },
    }),
  });

  const state = await appServices.relatedGames.loadRelatedGames(PROVIDER_ID, rootGame);

  assert.equal(state.status, "success");
  assert.deepStrictEqual(state.data, []);
  assert.equal(counts.config, 0);
  assert.equal(counts.relatedGames, 0);
  assert.equal(counts.relatedGameProgress, 0);
});

test("fresh related-game cache refreshes only subset progress", async () => {
  const now = Date.now();
  const rootGame = createGameDetailSnapshot().game;
  const relatedGame: RelatedGameSummary = {
    providerId: PROVIDER_ID,
    gameId: "subset-1",
    title: "Test Game [Subset - Bonus]",
    parentGameId: rootGame.gameId,
    totalAchievementCount: 10,
  };
  const refreshedRelatedGame: RelatedGameSummary = {
    ...relatedGame,
    progress: {
      unlockedCount: 2,
      totalCount: 10,
      completionPercent: 20,
    },
  };
  const { appServices, counts, writes } = createHarness({
    cacheEntries: [
      createCacheEntry(
        createProviderRelatedGamesCacheKey(PROVIDER_ID, rootGame.gameId),
        [relatedGame],
        now - 1_000,
        now + 60_000,
      ),
    ],
    providerConfig: { username: "alice", apiKey: "secret" },
    providerFactory: (callCounts) => ({
      ...createSuccessfulProvider(callCounts),
      async loadRelatedGames() {
        callCounts.relatedGames += 1;
        throw new Error("relationship discovery should not rerun for a fresh result");
      },
      async loadRelatedGameProgress(_config, _game, cachedRelatedGames) {
        callCounts.relatedGameProgress += 1;
        assert.deepStrictEqual(cachedRelatedGames, [relatedGame]);
        return [refreshedRelatedGame];
      },
    }),
  });

  const state = await appServices.relatedGames.loadRelatedGames(PROVIDER_ID, rootGame);

  assert.equal(state.status, "success");
  assert.deepStrictEqual(state.data, [refreshedRelatedGame]);
  assert.equal(counts.config, 1);
  assert.equal(counts.relatedGames, 0);
  assert.equal(counts.relatedGameProgress, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.key, createProviderRelatedGamesCacheKey(PROVIDER_ID, rootGame.gameId));
});

test("game detail missing config returns auth error state", async () => {
  const { appServices, counts } = createHarness({
    providerConfig: undefined,
  });

  const state = await appServices.gameDetail.loadGameDetail(PROVIDER_ID, "game-1");

  assert.equal(state.status, "error");
  assert.equal(state.error?.kind, "auth");
  assert.match(state.error?.userMessage ?? "", /provider settings are missing/i);
  assert.equal(state.isStale, false);
  assert.equal(state.data, undefined);
  assert.equal(counts.config, 1);
  assert.equal(counts.gameProgress, 0);
});

test("game detail stale cached data is preserved when refresh fails", async () => {
  const now = Date.now();
  const cachedSnapshot = createGameDetailSnapshot();
  const cacheKey = createProviderGameDetailCacheKey(PROVIDER_ID, cachedSnapshot.game.gameId);
  const { appServices, counts } = createHarness({
    cacheEntries: [
      createCacheEntry(cacheKey, cachedSnapshot, now - 60_000, now - 1),
    ],
    providerConfig: {
      username: "alice",
      apiKey: "secret",
    },
  });

  const state = await appServices.gameDetail.loadGameDetail(PROVIDER_ID, cachedSnapshot.game.gameId, {
    forceRefresh: true,
  });

  assert.equal(state.status, "stale");
  assert.equal(state.isStale, true);
  assert.deepStrictEqual(state.data, cachedSnapshot);
  assert.equal(state.error?.kind, "unknown");
  assert.match(state.error?.userMessage ?? "", /refresh game detail data/i);
  assert.equal(counts.config, 1);
  assert.equal(counts.gameProgress, 1);
});

test("game detail refreshes an expired cache entry without an explicit force refresh", async () => {
  const now = Date.now();
  const cachedSnapshot = createGameDetailSnapshot();
  const cacheKey = createProviderGameDetailCacheKey(PROVIDER_ID, cachedSnapshot.game.gameId);
  const { appServices, counts, writes } = createHarness({
    cacheEntries: [createCacheEntry(cacheKey, cachedSnapshot, now - 60_000, now - 1)],
    providerFactory: createSuccessfulProvider,
    providerConfig: { username: "alice", apiKey: "secret" },
  });

  const state = await appServices.gameDetail.loadGameDetail(PROVIDER_ID, cachedSnapshot.game.gameId, {
    forceRefresh: false,
  });

  assert.equal(state.status, "success");
  assert.equal(state.isStale, false);
  assert.equal(counts.gameProgress, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.key, cacheKey);
});

test("game detail successful refresh writes normalized snapshot to cache", async () => {
  const { appServices, counts, writes } = createHarness({
    providerFactory: createSuccessfulProvider,
    providerConfig: {
      username: "alice",
      apiKey: "secret",
    },
  });

  const state = await appServices.gameDetail.loadGameDetail(PROVIDER_ID, "game-1");
  const expectedSnapshot = createGameDetailSnapshot();

  assert.equal(state.status, "success");
  assert.equal(state.isStale, false);
  assert.equal(state.error, undefined);
  assert.equal(counts.config, 1);
  assert.equal(counts.gameProgress, 1);
  assert.deepStrictEqual(state.data, expectedSnapshot);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.key, createProviderGameDetailCacheKey(PROVIDER_ID, "game-1"));
  assert.equal(writes[0]?.version, CACHE_VERSION);
  assert.equal(writes[0]?.storedAt, state.lastUpdatedAt);
  assert.deepStrictEqual(writes[0]?.value, state.data);
});

test("steam recently played normalization sorts newest first with stable missing timestamps", () => {
  const recentGames = normalizeSteamRecentlyPlayedGames([
    {
      appid: 10,
      name: "Missing Timestamp First",
      playtime_forever: 10,
    },
    {
      appid: 20,
      name: "Older Known",
      playtime_forever: 20,
      rtime_last_played: 1_700_000_000,
    },
    {
      appid: 30,
      name: "Newest Known",
      playtime_forever: 30,
      rtime_last_played: 1_700_000_200,
    },
    {
      appid: 40,
      name: "Equal Newest Known",
      playtime_forever: 40,
      rtime_last_played: 1_700_000_200,
    },
    {
      appid: 50,
      name: "Missing Timestamp Second",
      playtime_forever: 50,
    },
  ]);

  assert.deepStrictEqual(
    recentGames.map((game) => game.title),
    [
      "Newest Known",
      "Equal Newest Known",
      "Older Known",
      "Missing Timestamp First",
      "Missing Timestamp Second",
    ],
  );
  assert.deepStrictEqual(
    recentGames.map((game) => game.lastPlayedAt),
    [1_700_000_200_000, 1_700_000_200_000, 1_700_000_000_000, undefined, undefined],
  );

  assert.deepStrictEqual(
    sortSteamRecentlyPlayedGamesNewestFirst([
      recentGames[2]!,
      recentGames[3]!,
      recentGames[1]!,
      recentGames[4]!,
      recentGames[0]!,
    ]).map((game) => game.title),
    [
      "Equal Newest Known",
      "Newest Known",
      "Older Known",
      "Missing Timestamp First",
      "Missing Timestamp Second",
    ],
  );
  assert.match(
    readFileSync("src/providers/steam/steam.provider.ts", "utf8"),
    /return sortSteamRecentlyPlayedGamesNewestFirst\(\s*recentGameSnapshots\.map\(\(snapshot\) => snapshot\.recentGame\),\s*\);/u,
  );
});

test("steam recently played merges owned-game timestamps before sorting", async () => {
  const mergedGames = mergeSteamRecentlyPlayedLastPlayedTimes(
    [
      {
        appid: 100,
        name: "GTA-like Older Game",
      },
      {
        appid: 200,
        name: "Minecraft-like Newer Game",
      },
      {
        appid: 300,
        name: "Direct Timestamp Wins",
        rtime_last_played: 1_700_000_300,
      },
      {
        appid: 400,
        name: "Missing Everywhere",
      },
    ],
    [
      {
        appid: 100,
        name: "GTA-like Older Game",
        rtime_last_played: 1_700_000_100,
      },
      {
        appid: 200,
        name: "Minecraft-like Newer Game",
        rtime_last_played: 1_700_000_200,
      },
      {
        appid: 300,
        name: "Direct Timestamp Wins",
        rtime_last_played: 1_700_000_400,
      },
    ],
  );
  const normalizedGames = normalizeSteamRecentlyPlayedGames(mergedGames);

  assert.deepStrictEqual(
    normalizedGames.map((game) => game.title),
    [
      "Direct Timestamp Wins",
      "Minecraft-like Newer Game",
      "GTA-like Older Game",
      "Missing Everywhere",
    ],
  );
  assert.deepStrictEqual(
    normalizedGames.map((game) => game.lastPlayedAt),
    [1_700_000_300_000, 1_700_000_200_000, 1_700_000_100_000, undefined],
  );

  const mergedCandidates = mergeSteamRecentlyPlayedCandidates(
    [
      {
        appid: 100,
        name: "Richer Recent Name",
        playtime_2weeks: 25,
        playtime_forever: 120,
      },
      {
        appid: 100,
        name: "Duplicate Recent Name",
        playtime_forever: 5,
      },
    ],
    [
      {
        appid: 100,
        name: "Owned Name",
        playtime_forever: 90,
        rtime_last_played: 1_700_000_100,
      },
      {
        appid: 300,
        name: "Cuphead-like Owned-only Game",
        playtime_forever: 10,
        rtime_last_played: 1_700_000_300,
      },
    ],
  );
  assert.equal(mergedCandidates.length, 2);
  assert.deepStrictEqual(mergedCandidates[0], {
    appid: 100,
    name: "Richer Recent Name",
    playtime_2weeks: 25,
    playtime_forever: 120,
    rtime_last_played: 1_700_000_100,
  });
  assert.equal(mergedCandidates[1]?.name, "Cuphead-like Owned-only Game");

  let ownedGamesCalls = 0;
  const provider = createSteamProvider({
    client: {
      async loadRecentlyPlayedGames() {
        return {
          response: {
            games: [
              {
                appid: 100,
                name: "GTA-like Older Game",
                playtime_forever: 120,
              },
              {
                appid: 200,
                name: "Minecraft-like Newer Game",
                playtime_forever: 60,
              },
              {
                appid: 400,
                name: "Oldest Direct Game",
                playtime_forever: 180,
              },
            ],
          },
        };
      },
      async loadOwnedGames() {
        ownedGamesCalls += 1;
        return {
          response: {
            games: [
              {
                appid: 100,
                name: "GTA-like Older Game",
                rtime_last_played: 1_700_000_100,
              },
              {
                appid: 200,
                name: "Minecraft-like Newer Game",
                rtime_last_played: 1_700_000_200,
              },
              {
                appid: 300,
                name: "Cuphead-like Owned-only Game",
                playtime_forever: 10,
                rtime_last_played: 1_700_000_300,
              },
              {
                appid: 400,
                name: "Oldest Direct Game",
                rtime_last_played: 1_700_000_050,
              },
            ],
          },
        };
      },
      async loadPlayerAchievements() {
        return {
          playerstats: {
            success: true,
            achievements: [],
          },
        };
      },
      async loadSchemaForGame() {
        return {
          game: {
            availableGameStats: {
              achievements: [],
            },
          },
        };
      },
      async loadGlobalAchievementPercentagesForApp() {
        return {
          achievementpercentages: {
            achievements: [],
          },
        };
      },
    } as SteamClient,
  });
  const providerGames = await provider.loadRecentlyPlayedGames(
    normalizeSteamProviderConfig({
      steamId64: "12345678901234567",
      apiKey: "api-key",
      language: "english",
      recentAchievementsCount: 3,
      recentlyPlayedCount: 3,
      includePlayedFreeGames: false,
    }),
    { count: 3 },
  );

  assert.equal(ownedGamesCalls, 1);
  assert.deepStrictEqual(
    providerGames.map((game) => game.title),
    [
      "Cuphead-like Owned-only Game",
      "Minecraft-like Newer Game",
      "GTA-like Older Game",
    ],
  );
  assert.deepStrictEqual(
    providerGames.map((game) => game.lastPlayedAt),
    [1_700_000_300_000, 1_700_000_200_000, 1_700_000_100_000],
  );
  assert.equal(providerGames.every((game) => game.achievementStateIsComplete === true), true);
});

test("Steam recent detail without usable schema is not marked complete for library projections", async () => {
  clearSteamRecentGameSnapshotLoadCacheForTests();
  const provider = createSteamProvider({
    client: {
      async loadRecentlyPlayedGames() {
        return { response: { games: [{ appid: 991, name: "Schema Unavailable", playtime_forever: 10 }] } };
      },
      async loadOwnedGames() {
        return { response: { games: [] } };
      },
      async loadPlayerAchievements() {
        return { playerstats: { success: true, achievements: [{ apiname: "A", achieved: 1 }] } };
      },
      async loadSchemaForGame() {
        throw new Error("temporary schema failure");
      },
      async loadGlobalAchievementPercentagesForApp() {
        return { achievementpercentages: { achievements: [] } };
      },
    } as SteamClient,
  });
  const config = normalizeSteamProviderConfig({
    steamId64: "32345678901234567",
    hasApiKey: true,
    language: "english",
    recentAchievementsCount: 1,
    recentlyPlayedCount: 1,
    includePlayedFreeGames: false,
  });

  const recentGames = await provider.loadRecentlyPlayedGames(config, { count: 1 });
  assert.equal(recentGames[0]?.summary.unlockedCount, 1);
  assert.equal(recentGames[0]?.achievementStateIsComplete, undefined);
  clearSteamRecentGameSnapshotLoadCacheForTests();
});

test("steam recently played falls back safely when owned-game candidates fail to load", async () => {
  const provider = createSteamProvider({
    client: {
      async loadRecentlyPlayedGames() {
        return {
          response: {
            games: [
              {
                appid: 100,
                name: "First Direct Game",
                playtime_forever: 120,
              },
              {
                appid: 200,
                name: "Second Direct Game",
                playtime_forever: 60,
              },
            ],
          },
        };
      },
      async loadOwnedGames() {
        throw new Error("Owned games unavailable.");
      },
      async loadPlayerAchievements() {
        return {
          playerstats: {
            success: true,
            achievements: [],
          },
        };
      },
      async loadSchemaForGame() {
        return {
          game: {
            availableGameStats: {
              achievements: [],
            },
          },
        };
      },
      async loadGlobalAchievementPercentagesForApp() {
        return {
          achievementpercentages: {
            achievements: [],
          },
        };
      },
    } as SteamClient,
  });
  const games = await provider.loadRecentlyPlayedGames(
    normalizeSteamProviderConfig({
      steamId64: "12345678901234567",
      apiKey: "api-key",
      language: "english",
      recentAchievementsCount: 3,
      recentlyPlayedCount: 3,
      includePlayedFreeGames: false,
    }),
    { count: 3 },
  );

  assert.deepStrictEqual(
    games.map((game) => game.title),
    ["First Direct Game", "Second Direct Game"],
  );
});

test("decky steam dashboard merges cached library unlocks into recent achievements", () => {
  const snapshot: DashboardSnapshot = {
    profile: {
      providerId: STEAM_PROVIDER_ID,
      identity: {
        providerId: STEAM_PROVIDER_ID,
        accountId: "steam-account",
        displayName: "Steam User",
      },
      summary: {
        unlockedCount: 1,
      },
      metrics: [],
    },
    recentAchievements: [
      {
        achievement: {
          providerId: STEAM_PROVIDER_ID,
          achievementId: "older-achievement",
          gameId: "100",
          title: "Older Achievement",
          isUnlocked: true,
          unlockedAt: 1_700_000_100_000,
          metrics: [],
        },
        game: {
          providerId: STEAM_PROVIDER_ID,
          gameId: "100",
          title: "Older Game",
        },
        unlockedAt: 1_700_000_100_000,
      },
    ],
    recentUnlocks: [],
    recentlyPlayedGames: [],
    featuredGames: [],
  };
  const summary: SteamLibraryAchievementScanSummary = {
    scannedAt: "2026-06-11T12:00:00.000Z",
    ownedGameCount: 1,
    scannedGameCount: 1,
    gamesWithAchievements: 1,
    skippedGameCount: 0,
    failedGameCount: 0,
    totalAchievements: 10,
    unlockedAchievements: 1,
    perfectGames: 0,
    completionPercent: 10,
    games: [],
    unlockedAchievementsList: [
      {
        id: "300:new-achievement:2026-06-11T11:55:00.000Z",
        achievementId: "new-achievement",
        apiName: "new-achievement",
        title: "Cuphead-like New Achievement",
        description: "Beat a level",
        unlockedAt: "2026-06-11T11:55:00.000Z",
        gameId: "300",
        gameTitle: "Cuphead-like Game",
        providerId: STEAM_PROVIDER_ID,
      },
    ],
  };

  const merged = mergeDeckySteamLibraryScanRecentAchievements(snapshot, summary);

  assert.equal(merged.recentAchievements[0]?.achievement.title, "Cuphead-like New Achievement");
  assert.equal(merged.recentAchievements[0]?.game.title, "Cuphead-like Game");
  assert.deepStrictEqual(merged.recentUnlocks, merged.recentAchievements);
  const deckyAppServicesSource = readFileSync("src/platform/decky/decky-app-services.ts", "utf8");
  assert.match(
    deckyAppServicesSource,
    /if \(providerId === STEAM_PROVIDER_ID && options\?\.forceRefresh\) \{\s*clearSteamRecentGameSnapshotLoadCache\(\);/u,
  );
  assert.match(
    deckyAppServicesSource,
    /mergeDeckySteamLibraryScanRecentAchievements\(\s*state\.data,/u,
  );
});



test("steam library achievement scan emits throttled progress logs when logger is provided", async () => {
  await withMockDeckyStorage(async () => {
    const startedEvents: Array<Record<string, unknown>> = [];
    const progressEvents: Array<Record<string, unknown>> = [];
    const completedEvents: Array<Record<string, unknown>> = [];
    const failedEvents: Array<Record<string, unknown>> = [];
    const client: SteamClient = {
      async loadOwnedGames() {
        return {
          response: {
            game_count: 30,
            games: Array.from({ length: 30 }, (_, index) => ({
              appid: index + 1,
              name: `Game ${index + 1}`,
            })),
          },
        };
      },
      async loadPlayerAchievements() {
        return {
          playerstats: {
            success: true,
            achievements: [],
          },
        };
      },
      async loadSchemaForGame() {
        return {
          game: {
            availableGameStats: {
              achievements: [],
            },
          },
        };
      },
      async loadGlobalAchievementPercentagesForApp() {
        return {
          achievementpercentages: {
            achievements: [],
          },
        };
      },
      async loadPlayerSummaries() {
        return {
          response: {
            players: [],
          },
        };
      },
      async loadSteamLevel() {
        return {
          response: {
            player_level: 29,
          },
        };
      },
      async loadBadges() {
        return {
          playerstats: {
            badges: [],
          },
        };
      },
    };

    const summary = await scanSteamLibraryAchievements(
      normalizeSteamProviderConfig({
        steamId64: "12345678901234567",
        hasApiKey: true,
        language: "english",
        recentAchievementsCount: 5,
        recentlyPlayedCount: 5,
        includePlayedFreeGames: false,
      }),
      {
        client,
        concurrencyLimit: 1,
        logger: {
          started(fields) {
            startedEvents.push(fields);
          },
          progress(fields) {
            progressEvents.push(fields);
          },
          completed(fields) {
            completedEvents.push(fields);
          },
          failed(fields) {
            failedEvents.push(fields);
          },
        },
      },
    );

    assert.equal(summary.scannedGameCount, 30);
    assert.equal(startedEvents.length, 1);
    assert.equal(startedEvents[0]?.ownedGameCount, 30);
    assert.ok(progressEvents.length >= 1);
    assert.ok(progressEvents.length <= 3);
    assert.equal(completedEvents.length, 1);
    assert.equal(failedEvents.length, 0);
  });
});

test("steam library achievement scan de-duplicates final progress diagnostics", async () => {
  await withMockDeckyStorage(async () => {
    const achievementsDeferred = createDeferredPromise<{
      readonly playerstats: {
        readonly success: true;
        readonly achievements: readonly RawSteamPlayerAchievement[];
      };
    }>();
    let playerAchievementsCalls = 0;
    const progressEvents: Array<Record<string, unknown>> = [];
    const client: SteamClient = {
      async loadOwnedGames() {
        return {
          response: {
            game_count: 2,
            games: [
              {
                appid: 1,
                name: "Game 1",
              },
              {
                appid: 2,
                name: "Game 2",
              },
            ],
          },
        };
      },
      async loadPlayerAchievements() {
        playerAchievementsCalls += 1;
        return achievementsDeferred.promise;
      },
      async loadSchemaForGame() {
        return {
          game: {
            availableGameStats: {
              achievements: [],
            },
          },
        };
      },
      async loadGlobalAchievementPercentagesForApp() {
        return {
          achievementpercentages: {
            achievements: [],
          },
        };
      },
      async loadPlayerSummaries() {
        return {
          response: {
            players: [],
          },
        };
      },
      async loadSteamLevel() {
        return {
          response: {
            player_level: 29,
          },
        };
      },
      async loadBadges() {
        return {
          playerstats: {
            badges: [],
          },
        };
      },
    };

    const scanPromise = scanSteamLibraryAchievements(
      normalizeSteamProviderConfig({
        steamId64: "12345678901234567",
        hasApiKey: true,
        language: "english",
        recentAchievementsCount: 5,
        recentlyPlayedCount: 5,
        includePlayedFreeGames: false,
      }),
      {
        client,
        concurrencyLimit: 2,
        logger: {
          started() {},
          progress(fields) {
            progressEvents.push(fields);
          },
          completed() {},
          failed() {},
        },
      },
    );

    for (let attempt = 0; attempt < 20 && playerAchievementsCalls < 2; attempt += 1) {
      await Promise.resolve();
    }

    assert.equal(playerAchievementsCalls, 2);

    achievementsDeferred.resolve({
      playerstats: {
        success: true,
        achievements: [],
      },
    });

    const summary = await scanPromise;
    assert.equal(summary.scannedGameCount, 2);
    assert.equal(progressEvents.length, 1);
    assert.equal(progressEvents[0]?.ownedGameCount, 2);
    assert.equal(progressEvents[0]?.scannedGameCount, 2);
    assert.equal(progressEvents[0]?.failedGameCount, 0);
  });
});

test("decky steam library scan reuses an in-flight runtime scan", async () => {
  await withMockDeckyStorage(async () => {
    const config = normalizeSteamProviderConfig({
      steamId64: "12345678901234567",
      hasApiKey: true,
      language: "english",
      recentAchievementsCount: 5,
      recentlyPlayedCount: 5,
      includePlayedFreeGames: false,
    });

    const ownedGamesDeferred = createDeferredPromise<RawSteamGetOwnedGamesResponse>();
    let ownedGamesCalls = 0;
    const client: SteamClient = {
      async loadOwnedGames() {
        ownedGamesCalls += 1;
        return ownedGamesDeferred.promise;
      },
      async loadPlayerAchievements() {
        return {
          playerstats: {
            success: true,
            achievements: [],
          },
        };
      },
      async loadSchemaForGame() {
        return {
          game: {
            availableGameStats: {
              achievements: [],
            },
          },
        };
      },
      async loadGlobalAchievementPercentagesForApp() {
        return {
          achievementpercentages: {
            achievements: [],
          },
        };
      },
      async loadPlayerSummaries() {
        return {
          response: {
            players: [],
          },
        };
      },
      async loadSteamLevel() {
        return {
          response: {
            player_level: 29,
          },
        };
      },
      async loadBadges() {
        return {
          playerstats: {
            badges: [],
          },
        };
      },
    };

    const firstScan = runAndCacheDeckySteamLibraryAchievementScan(config, {
      client,
      concurrencyLimit: 1,
    });
    const secondScan = runAndCacheDeckySteamLibraryAchievementScan(config, {
      client,
      concurrencyLimit: 1,
    });

    await Promise.resolve();
    assert.equal(ownedGamesCalls, 1);

    ownedGamesDeferred.resolve({
      response: {
        game_count: 1,
        games: [
          {
            appid: 220,
            name: "Half-Life 2",
          } satisfies RawSteamOwnedGame,
        ],
      },
    });

    const [firstSummary, secondSummary] = await Promise.all([firstScan, secondScan]);
    assert.equal(firstSummary.scannedGameCount, 1);
    assert.equal(secondSummary.scannedGameCount, 1);
    assert.equal(ownedGamesCalls, 1);
    assert.equal(readDeckySteamLibraryAchievementScanSummary("steam")?.scannedGameCount, 1);
  });
});

test("decky steam library scan preserves the last successful cache when a later scan fails", async () => {
  await withMockDeckyStorage(async () => {
    const config = normalizeSteamProviderConfig({
      steamId64: "12345678901234567",
      hasApiKey: true,
      language: "english",
      recentAchievementsCount: 5,
      recentlyPlayedCount: 5,
      includePlayedFreeGames: false,
    });

    const cachedSummary: SteamLibraryAchievementScanSummary = {
      scannedAt: "2026-04-18T18:45:00Z",
      ownedGameCount: 1,
      scannedGameCount: 1,
      gamesWithAchievements: 1,
      skippedGameCount: 0,
      failedGameCount: 0,
      totalAchievements: 1,
      unlockedAchievements: 1,
      perfectGames: 1,
      completionPercent: 100,
      games: [
        {
          appid: 220,
          id: "220",
          gameId: "220",
          title: "Half-Life 2",
          providerId: "steam",
          platformLabel: "Steam",
          totalAchievements: 1,
          unlockedAchievements: 1,
          completionPercent: 100,
          hasAchievements: true,
          scanStatus: "scanned",
        },
      ],
    };

    writeDeckySteamLibraryAchievementScanSummary(cachedSummary);

    const initialOverview = readDeckySteamLibraryAchievementScanOverview("steam");
    assert.equal(initialOverview?.scannedGameCount, 1);

    await assert.rejects(
      runAndCacheDeckySteamLibraryAchievementScan(config, {
        client: {
          async loadOwnedGames() {
            throw new Error("steam owned games refresh failed");
          },
          async loadPlayerAchievements() {
            throw new Error("unexpected player achievements request");
          },
          async loadSchemaForGame() {
            throw new Error("unexpected schema request");
          },
          async loadGlobalAchievementPercentagesForApp() {
            throw new Error("unexpected global achievement percentages request");
          },
          async loadPlayerSummaries() {
            throw new Error("unexpected player summaries request");
          },
          async loadSteamLevel() {
            throw new Error("unexpected steam level request");
          },
          async loadBadges() {
            throw new Error("unexpected badges request");
          },
        },
      }),
    );

    const preservedSummary = readDeckySteamLibraryAchievementScanSummary("steam");
    const preservedOverview = readDeckySteamLibraryAchievementScanOverview("steam");
    assert.equal(preservedSummary?.scannedGameCount, 1);
    assert.equal(preservedOverview?.scannedGameCount, 1);
    assert.equal(preservedSummary?.games[0]?.title, "Half-Life 2");
  });
});

test("decky steam library scan uses backend request route without frontend apiKey", async () => {
  await withMockDeckyStorage(async () => {
    const config = normalizeSteamProviderConfig({
      steamId64: "12345678901234567",
      hasApiKey: true,
      language: "english",
      recentAchievementsCount: 5,
      recentlyPlayedCount: 5,
      includePlayedFreeGames: false,
    });

    const requestPaths: string[] = [];
    const diagnosticEvents: Array<{ readonly event: string; readonly fields: Record<string, unknown> }> = [];
    const restoreFetch = setGlobalTestValue("fetch", async () => {
      throw new Error("unexpected frontend fetch during decky steam scan");
    });
    const restoreBackend = setDeckyBackendCallImplementationForTests(async (route: string, payload: unknown) => {
      if (route === "record_diagnostic_event") {
        const record = payload as Record<string, unknown>;
        diagnosticEvents.push({
          event: String(record.event),
          fields: record,
        });
        return true;
      }

      assert.equal(route, "request_steam_json");
      const record = payload as Record<string, unknown>;
      assert.equal(typeof record.apiKey, "undefined");
      assert.equal(typeof record.key, "undefined");
      assert.equal(typeof record.path, "string");
      requestPaths.push(record.path as string);

      if (record.path === "IPlayerService/GetOwnedGames/v1/") {
        return {
          response: {
            game_count: 1,
            games: [
              {
                appid: 220,
                name: "Half-Life 2",
                img_icon_url: "half-life-2-icon",
              },
            ],
          },
        };
      }

      if (record.path === "ISteamUserStats/GetPlayerAchievements/v1/") {
        assert.equal((record.query as Record<string, unknown>)?.appid, 220);
        return {
          playerstats: {
            success: true,
            achievements: [
              {
                apiname: "ACH_WIN",
                achieved: 1,
                unlocktime: 1_700_000_000,
              },
            ],
          },
        };
      }

      if (record.path === "ISteamUserStats/GetSchemaForGame/v2/") {
        assert.equal((record.query as Record<string, unknown>)?.appid, 220);
        return {
          game: {
            availableGameStats: {
              achievements: [
                {
                  name: "ACH_WIN",
                  displayName: "Win",
                  description: "Win the game.",
                },
              ],
            },
          },
        };
      }

      throw new Error(`Unexpected Steam backend request path in test: ${String(record.path)}`);
    });

    try {
      const summary = await runAndCacheDeckySteamLibraryAchievementScan(config);
      assert.equal(summary.ownedGameCount, 1);
      assert.equal(summary.scannedGameCount, 1);
      assert.equal(summary.gamesWithAchievements, 1);
      assert.equal(summary.failedGameCount, 0);
      assert.equal(summary.skippedGameCount, 0);
      assert.equal(summary.totalAchievements, 1);
      assert.equal(summary.unlockedAchievements, 1);
      assert.equal(summary.perfectGames, 1);
      assert.equal(summary.games[0]?.appid, 220);
      assert.equal(summary.games[0]?.scanStatus, "scanned");
      assert.equal(summary.games[0]?.unlockedAchievements, 1);
      assert.equal(summary.games[0]?.totalAchievements, 1);
      assert.equal(summary.unlockedAchievementsList?.length, 1);
      assert.ok(diagnosticEvents.some((event) => event.event === "steam_library_scan_started"));
      assert.ok(diagnosticEvents.some((event) => event.event === "steam_library_scan_progress"));
      assert.ok(diagnosticEvents.some((event) => event.event === "steam_library_scan_completed"));
      assert.equal(
        diagnosticEvents.filter((event) => event.event === "steam_library_scan_failed").length,
        0,
      );
      assert.deepStrictEqual(requestPaths, [
        "IPlayerService/GetOwnedGames/v1/",
        "ISteamUserStats/GetSchemaForGame/v2/",
        "ISteamUserStats/GetPlayerAchievements/v1/",
      ]);
      const providerSettingsSource = readFileSync(
        "src/platform/decky/providers/steam/provider-settings-page.tsx",
        "utf8",
      );
      assert.match(providerSettingsSource, /createDeckySteamLibraryScanDependencies\(\)/u);
      assert.doesNotMatch(
        providerSettingsSource,
        /runAndCacheDeckySteamLibraryAchievementScan\(providerConfig\)/u,
      );
    } finally {
      restoreFetch();
      setDeckyBackendCallImplementationForTests(deckyBackendTestCallImplementation);
    }
  });
});

test("steam cached scan normalizes icon urls, percent, and library unlock history", async () => {
  await withMockDeckyStorage(async () => {
    const cachedSummary: SteamLibraryAchievementScanSummary = {
      scannedAt: "2026-04-18T18:45:00Z",
      ownedGameCount: 1,
      scannedGameCount: 1,
      gamesWithAchievements: 1,
      skippedGameCount: 0,
      failedGameCount: 0,
      totalAchievements: 500,
      unlockedAchievements: 164,
      perfectGames: 0,
      completionPercent: 333,
      games: [
        {
          appid: 1,
          id: "1",
          gameId: "1",
          title: "Steam Test Game",
          providerId: "steam",
          iconUrl: "d081048291a422432720ec71721d7e6b58add966",
          playtimeForeverMinutes: 28,
          playtimeTwoWeeksMinutes: 1,
          playtimeDeckForeverMinutes: 28,
          lastPlayedAt: new Date(1_700_000_010_000).toISOString(),
          totalAchievements: 500,
          unlockedAchievements: 164,
          completionPercent: 333,
          hasAchievements: true,
          scanStatus: "scanned",
        },
      ],
      unlockedAchievementsList: [
        {
          id: "1:ACH_B:2026-04-18T18:31:00Z",
          achievementId: "ACH_B",
          apiName: "ACH_B",
          title: "Second Unlock",
          unlockedAt: "2026-04-18T18:31:00Z",
          gameId: "1",
          gameTitle: "Steam Test Game",
          gameIconUrl: "d081048291a422432720ec71721d7e6b58add966",
          providerId: "steam",
        },
        {
          id: "1:ACH_A:2026-04-18T18:30:00Z",
          achievementId: "ACH_A",
          apiName: "ACH_A",
          title: "First Unlock",
          unlockedAt: "2026-04-18T18:30:00Z",
          gameId: "1",
          gameTitle: "Steam Test Game",
          gameIconUrl: "d081048291a422432720ec71721d7e6b58add966",
          providerId: "steam",
        },
      ],
    };

    writeDeckySteamLibraryAchievementScanSummary(cachedSummary);

    const normalizedSummary = readDeckySteamLibraryAchievementScanSummary("steam");
    assert.equal(normalizedSummary?.completionPercent, 33);
    assert.equal(normalizedSummary?.games[0]?.platformLabel, "Steam");
    assert.equal(
      normalizedSummary?.games[0]?.iconUrl,
      "https://media.steampowered.com/steamcommunity/public/images/apps/1/d081048291a422432720ec71721d7e6b58add966.jpg",
    );
    assert.equal(normalizedSummary?.games[0]?.completionPercent, 33);
    assert.equal(normalizedSummary?.unlockedAchievementsList?.length, 2);
    assert.deepStrictEqual(
      normalizedSummary?.unlockedAchievementsList?.map((unlock) => unlock.apiName),
      ["ACH_B", "ACH_A"],
    );
    assert.equal(
      normalizedSummary?.unlockedAchievementsList?.[0]?.gameIconUrl,
      "https://media.steampowered.com/steamcommunity/public/images/apps/1/d081048291a422432720ec71721d7e6b58add966.jpg",
    );

    const profile = normalizeSteamProfile({
      playerSummary: {
        steamid: "12345678901234567",
        personaname: "Steam User",
        avatarfull: "https://cdn.steam.com/avatar.jpg",
      } satisfies RawSteamPlayerSummary,
      config: normalizeSteamProviderConfig({
        steamId64: "12345678901234567",
        apiKey: "api-key",
        language: "english",
        recentAchievementsCount: 5,
        recentlyPlayedCount: 5,
        includePlayedFreeGames: false,
      }),
      recentGames: [],
      gamesBeatenCount: 0,
      steamLevel: 29,
      badgeCount: 9,
      playerXp: 5_740,
      ownedGameCount: 1,
    });

    const history = buildDeckySteamAchievementHistorySnapshotFromSummary({
      profile,
      summary: cachedSummary,
    });

    assert.equal(history.sourceLabel, "Library unlocks");
    assert.equal(history.entries.length, 2);
    assert.equal(history.entries[0]?.achievement.title, "Second Unlock");
    assert.equal(history.entries[0]?.game.platformLabel, "Steam");
    assert.equal(
      history.entries.find((entry) => entry.achievement.achievementId === "A_ONE")?.achievement.badgeImageUrl,
      undefined,
    );
    assert.equal(history.summary.unlockedCount, 164);

    const legacyCachedSummaryText = JSON.stringify({
      scannedAt: "2026-04-18T18:45:00Z",
      ownedGameCount: 1,
      scannedGameCount: 1,
      gamesWithAchievements: 1,
      skippedGameCount: 0,
      failedGameCount: 0,
      totalAchievements: 1,
      unlockedAchievements: 1,
      perfectGames: 1,
      completionPercent: 100,
      games: [
        {
          id: "1",
          gameId: "1",
          title: "Legacy Steam Game",
          iconUrl: "d081048291a422432720ec71721d7e6b58add966",
          totalAchievements: 1,
          unlockedAchievements: 1,
          completionPercent: 100,
          hasAchievements: true,
          scanStatus: "scanned",
        },
      ],
      unlockedAchievementsList: [
        {
          id: "1:ACH_LEGACY:2026-04-18T18:30:00Z",
          achievementId: "ACH_LEGACY",
          apiName: "ACH_LEGACY",
          title: "Legacy Unlock",
          unlockedAt: "2026-04-18T18:30:00Z",
          gameId: "1",
          gameTitle: "Legacy Steam Game",
          providerId: "steam",
        },
      ],
    });

    clearDeckySteamLibraryAchievementScanSummary();
    writeDeckyStorageText("achievement-companion:decky:steam:library-achievement-scan", legacyCachedSummaryText);
    const normalizedLegacySummary = readDeckySteamLibraryAchievementScanSummary("steam");
    assert.equal(normalizedLegacySummary?.games[0]?.appid, 1);
    assert.equal(normalizedLegacySummary?.games[0]?.gameId, "1");
    assert.equal(normalizedLegacySummary?.games[0]?.providerId, "steam");
    assert.equal(
      normalizedLegacySummary?.games[0]?.iconUrl,
      "https://media.steampowered.com/steamcommunity/public/images/apps/1/d081048291a422432720ec71721d7e6b58add966.jpg",
    );
    const legacyHistory = buildDeckySteamAchievementHistorySnapshotFromSummary({
      profile,
      summary: normalizedLegacySummary ?? cachedSummary,
    });
    assert.equal(legacyHistory.entries[0]?.achievement.badgeImageUrl, undefined);

    const legacyNoIconSummaryText = JSON.stringify({
      scannedAt: "2026-04-18T18:45:00Z",
      ownedGameCount: 1,
      scannedGameCount: 1,
      gamesWithAchievements: 1,
      skippedGameCount: 0,
      failedGameCount: 0,
      totalAchievements: 1,
      unlockedAchievements: 1,
      perfectGames: 1,
      completionPercent: 100,
      games: [
        {
          id: "1",
          gameId: "1",
          title: "Legacy Steam Game",
          totalAchievements: 1,
          unlockedAchievements: 1,
          completionPercent: 100,
          hasAchievements: true,
          scanStatus: "scanned",
        },
      ],
      unlockedAchievementsList: [
        {
          id: "1:ACH_LEGACY:2026-04-18T18:30:00Z",
          achievementId: "ACH_LEGACY",
          apiName: "ACH_LEGACY",
          title: "Legacy Unlock",
          unlockedAt: "2026-04-18T18:30:00Z",
          gameId: "1",
          gameTitle: "Legacy Steam Game",
          providerId: "steam",
        },
      ],
    });

    clearDeckySteamLibraryAchievementScanSummary();
    writeDeckyStorageText("achievement-companion:decky:steam:library-achievement-scan", legacyNoIconSummaryText);
    const legacyNoIconSummary = readDeckySteamLibraryAchievementScanSummary("steam");
    const legacyNoIconHistory = buildDeckySteamAchievementHistorySnapshotFromSummary({
      profile,
      summary: legacyNoIconSummary ?? cachedSummary,
    });
    assert.equal(legacyNoIconHistory.entries[0]?.achievement.badgeImageUrl, undefined);
  });
});

test("steam cached completion rows prefer canonical appids over stale ids", () => {
  assert.equal(
    getSteamCompletionProgressGameDetailId({
      appid: 423530,
      gameId: "Lovika",
    }),
    "423530",
  );
  assert.equal(
    getSteamCompletionProgressGameDetailId({
      gameId: "377160",
    }),
    "377160",
  );
});

test("steam cached game detail metadata prefers cached library titles and icons over codename names", () => {
  const cachedSummary: SteamLibraryAchievementScanSummary = {
    scannedAt: "2026-04-18T18:45:00Z",
    ownedGameCount: 2,
    scannedGameCount: 2,
    gamesWithAchievements: 2,
    skippedGameCount: 0,
    failedGameCount: 0,
    totalAchievements: 6,
    unlockedAchievements: 3,
    perfectGames: 0,
    completionPercent: 50,
    games: [
      {
        appid: 423530,
        id: "423530",
        gameId: "423530",
        title: "Minecraft Dungeons",
        providerId: "steam",
        platformLabel: "Steam",
        iconUrl: "https://media.steampowered.com/steamcommunity/public/images/apps/423530/cached-dungeons-icon.jpg",
        playtimeForeverMinutes: 28,
        playtimeTwoWeeksMinutes: 1,
        playtimeDeckForeverMinutes: 28,
        lastPlayedAt: "2026-04-18T18:30:00.000Z",
        totalAchievements: 3,
        unlockedAchievements: 2,
        completionPercent: 67,
        hasAchievements: true,
        scanStatus: "scanned",
      },
      {
        appid: 1174150,
        id: "1174150",
        gameId: "1174150",
        title: "Battlefield 6",
        providerId: "steam",
        platformLabel: "Steam",
        iconUrl: "https://media.steampowered.com/steamcommunity/public/images/apps/1174150/cached-battlefield-icon.jpg",
        totalAchievements: 3,
        unlockedAchievements: 1,
        completionPercent: 33,
        hasAchievements: true,
        scanStatus: "scanned",
      },
    ],
  };

  const cachedSummaryGame = findSteamLibraryScanGameSummaryByAppId(cachedSummary, 423530);
  assert.equal(cachedSummaryGame?.title, "Minecraft Dungeons");

  const dungeonsSnapshot: GameDetailSnapshot = {
    game: {
      providerId: "steam",
      appid: 423530,
      gameId: "423530",
      title: "Lovika",
      platformLabel: "Steam",
      coverImageUrl: "https://cdn.steam.invalid/lovika.jpg",
      boxArtImageUrl: "https://cdn.steam.invalid/lovika-box.jpg",
      status: "in_progress",
      summary: {
        unlockedCount: 2,
        totalCount: 3,
        completionPercent: 67,
      },
      metrics: [],
    },
    achievements: [],
  };

  const patchedDungeonsSnapshot = applySteamLibraryScanGameDetailMetadata(dungeonsSnapshot, cachedSummary);
  assert.equal(patchedDungeonsSnapshot.game.appid, 423530);
  assert.equal(patchedDungeonsSnapshot.game.gameId, "423530");
  assert.equal(patchedDungeonsSnapshot.game.title, "Minecraft Dungeons");
  assert.equal(patchedDungeonsSnapshot.game.playtimeForeverMinutes, 28);
  assert.equal(patchedDungeonsSnapshot.game.playtimeTwoWeeksMinutes, 1);
  assert.equal(patchedDungeonsSnapshot.game.playtimeDeckForeverMinutes, 28);
  assert.equal(
    patchedDungeonsSnapshot.game.coverImageUrl,
    "https://media.steampowered.com/steamcommunity/public/images/apps/423530/cached-dungeons-icon.jpg",
  );
  assert.equal(
    patchedDungeonsSnapshot.game.boxArtImageUrl,
    "https://media.steampowered.com/steamcommunity/public/images/apps/423530/cached-dungeons-icon.jpg",
  );

  const battlefieldSnapshot: GameDetailSnapshot = {
    game: {
      providerId: "steam",
      appid: 1174150,
      gameId: "1174150",
      title: "Glacier",
      platformLabel: "Steam",
      status: "in_progress",
      summary: {
        unlockedCount: 1,
        totalCount: 3,
        completionPercent: 33,
      },
      metrics: [],
    },
    achievements: [],
  };

  const patchedBattlefieldSnapshot = applySteamLibraryScanGameDetailMetadata(battlefieldSnapshot, cachedSummary);
  assert.equal(patchedBattlefieldSnapshot.game.title, "Battlefield 6");
  assert.equal(
    patchedBattlefieldSnapshot.game.coverImageUrl,
    "https://media.steampowered.com/steamcommunity/public/images/apps/1174150/cached-battlefield-icon.jpg",
  );

  const livePlaytimeSnapshot = applySteamLibraryScanGameDetailMetadata({
    ...battlefieldSnapshot,
    game: {
      ...battlefieldSnapshot.game,
      playtimeForeverMinutes: 44,
    },
  }, cachedSummary);
  assert.equal(livePlaytimeSnapshot.game.playtimeForeverMinutes, 44);

  const fallbackSnapshot = applySteamLibraryScanGameDetailMetadata(dungeonsSnapshot, undefined);
  assert.deepStrictEqual(fallbackSnapshot, dungeonsSnapshot);
});

test("steam fullscreen completion prefers cached library scan games and labels perfect games", async () => {
  await withMockDeckyStorage(async () => {
    const cachedSummary: SteamLibraryAchievementScanSummary = {
      scannedAt: "2026-04-18T18:45:00Z",
      ownedGameCount: 5,
      scannedGameCount: 5,
      gamesWithAchievements: 2,
      skippedGameCount: 1,
      failedGameCount: 2,
      totalAchievements: 5,
      unlockedAchievements: 4,
      perfectGames: 1,
      completionPercent: 80,
      games: [
        {
          appid: 1,
          id: "1",
          gameId: "1",
          title: "Perfect One",
          providerId: "steam",
          iconUrl: "https://cdn.steam.com/game-1.jpg",
          playtimeForeverMinutes: 10,
          playtimeTwoWeeksMinutes: 3,
          playtimeDeckForeverMinutes: 4,
          lastPlayedAt: new Date(1_700_000_010_000).toISOString(),
          totalAchievements: 2,
          unlockedAchievements: 2,
          completionPercent: 100,
          hasAchievements: true,
          scanStatus: "scanned",
        },
        {
          appid: 2,
          id: "2",
          gameId: "2",
          title: "Almost Two",
          providerId: "steam",
          iconUrl: "https://cdn.steam.com/game-2.jpg",
          playtimeForeverMinutes: 20,
          totalAchievements: 3,
          unlockedAchievements: 2,
          completionPercent: 67,
          hasAchievements: true,
          scanStatus: "scanned",
        },
        {
          appid: 3,
          id: "3",
          gameId: "3",
          title: "No Achievements",
          providerId: "steam",
          iconUrl: "https://cdn.steam.com/game-3.jpg",
          playtimeForeverMinutes: 30,
          totalAchievements: 0,
          unlockedAchievements: 0,
          completionPercent: 0,
          hasAchievements: false,
          scanStatus: "no-achievements",
        },
        {
          appid: 4,
          id: "4",
          gameId: "4",
          title: "Private Game",
          providerId: "steam",
          iconUrl: "https://cdn.steam.com/game-4.jpg",
          playtimeForeverMinutes: 40,
          totalAchievements: 0,
          unlockedAchievements: 0,
          completionPercent: 0,
          hasAchievements: false,
          scanStatus: "failed",
        },
        {
          appid: 5,
          id: "5",
          gameId: "5",
          title: "Broken Game",
          providerId: "steam",
          iconUrl: "https://cdn.steam.com/game-5.jpg",
          playtimeForeverMinutes: 50,
          totalAchievements: 0,
          unlockedAchievements: 0,
          completionPercent: 0,
          hasAchievements: false,
          scanStatus: "failed",
        },
      ],
    };
    writeDeckySteamLibraryAchievementScanSummary(cachedSummary);

    const state = await loadDeckyCompletionProgressState("steam");

    assert.equal(state.status, "success");
    assert.equal(state.data?.games.length, 5);
    assert.equal(state.data?.summary.playedCount, 5);
    assert.equal(state.data?.summary.unfinishedCount, 1);
    assert.equal(state.data?.summary.beatenCount, 1);
    assert.equal(state.data?.summary.masteredCount, 1);
    assert.equal(state.data?.games[0]?.playtimeForeverMinutes, 10);
    assert.equal(state.data?.games[0]?.lastPlayedAt, 1_700_000_010_000);
    assert.equal(state.data?.games[2]?.scanStatus, "no-achievements");
    assert.equal(state.data?.games[3]?.scanStatus, "failed");
    assert.deepStrictEqual(
      formatCompletionProgressSummary(state.data?.summary ?? { playedCount: 0, unfinishedCount: 0, beatenCount: 0, masteredCount: 0 }, "steam"),
      "5 Played | 1 Unfinished | 1 Skipped | 1 Perfect",
    );
    assert.equal(formatCompletionProgressStatusLabel("mastered", "steam"), "Perfect");
    assert.equal(formatCompletionProgressFilterLabelForProvider("mastered", "steam"), "Perfect");
  });
});

test("steam fullscreen games overlays freshly refreshed recent-game activity onto the library scan", () => {
  const completionProgress: CompletionProgressSnapshot = {
    providerId: "steam",
    summary: {
      playedCount: 1,
      unfinishedCount: 1,
      beatenCount: 0,
      masteredCount: 0,
    },
    games: [
      {
        providerId: "steam",
        appid: 2218750,
        gameId: "2218750",
        title: "Halls of Torment",
        status: "in_progress",
        summary: { unlockedCount: 164, totalCount: 500, completionPercent: 33 },
        metrics: [],
        playtimeForeverMinutes: 720,
        lastPlayedAt: 1_790_000_000_000,
        scanStatus: "scanned",
        hasAchievements: true,
      } satisfies NormalizedGame,
    ],
    refreshedAt: 1_790_000_000_000,
  };
  const dashboard: DashboardSnapshot = {
    ...createDashboardSnapshot(),
    profile: {
      ...createDashboardSnapshot().profile,
      providerId: "steam",
      identity: {
        ...createDashboardSnapshot().profile.identity,
        providerId: "steam",
      },
    },
    recentlyPlayedGames: [
      {
        providerId: "steam",
        appid: 2218750,
        gameId: "2218750",
        title: "Halls of Torment",
        summary: { unlockedCount: 168, totalCount: 500, completionPercent: 34 },
        achievementStateIsComplete: true,
        playtimeForeverMinutes: 780,
        lastPlayedAt: 1_790_100_000_000,
      },
      {
        providerId: "steam",
        appid: 1672970,
        gameId: "1672970",
        title: "Minecraft Dungeons 2",
        summary: { unlockedCount: 0 },
        playtimeForeverMinutes: 65,
        lastPlayedAt: 1_790_200_000_000,
      },
    ],
    refreshedAt: 1_790_100_000_000,
  };

  const merged = mergeDeckySteamCompletionProgressWithDashboard(completionProgress, dashboard);

  assert.equal(merged.games[0]?.summary.unlockedCount, 168);
  assert.equal(merged.games[0]?.summary.completionPercent, 34);
  assert.equal(merged.games[0]?.playtimeForeverMinutes, 780);
  assert.equal(merged.games[0]?.lastPlayedAt, 1_790_100_000_000);
  assert.equal(merged.games[0]?.scanStatus, "scanned");
  assert.equal(merged.games[1]?.title, "Minecraft Dungeons 2");
  assert.equal(merged.games[1]?.playtimeForeverMinutes, 65);
  assert.equal(merged.games[1]?.scanStatus, undefined);
  assert.deepStrictEqual(merged.summary, {
    playedCount: 2,
    unfinishedCount: 1,
    beatenCount: 0,
    masteredCount: 0,
  });
});

test("Steam Games projection keeps library counts when recent detail is fallback, and accepts valid recent detail", () => {
  const completionProgress: CompletionProgressSnapshot = {
    providerId: "steam",
    summary: { playedCount: 1, unfinishedCount: 1, beatenCount: 0, masteredCount: 0 },
    games: [{
      providerId: "steam",
      appid: 55,
      gameId: "55",
      title: "Recent Failure Test",
      status: "in_progress",
      summary: { unlockedCount: 50, totalCount: 100, completionPercent: 50 },
      metrics: [],
      scanStatus: "scanned",
      hasAchievements: true,
    }],
  };
  const dashboard: DashboardSnapshot = {
    ...createDashboardSnapshot(),
    profile: {
      ...createDashboardSnapshot().profile,
      providerId: "steam",
      identity: { ...createDashboardSnapshot().profile.identity, providerId: "steam" },
    },
    recentlyPlayedGames: [{
      providerId: "steam",
      appid: 55,
      gameId: "55",
      title: "Recent Failure Test",
      summary: { unlockedCount: 0 },
    }],
  };

  const fallbackProjection = mergeDeckySteamCompletionProgressWithDashboard(completionProgress, dashboard);
  assert.equal(fallbackProjection.games[0]?.summary.unlockedCount, 50);

  const validDashboard: DashboardSnapshot = {
    ...dashboard,
    recentlyPlayedGames: dashboard.recentlyPlayedGames.map((game) => ({
      ...game,
      summary: { unlockedCount: 55, totalCount: 100, completionPercent: 55 },
      achievementStateIsComplete: true,
    })),
  };
  const validProjection = mergeDeckySteamCompletionProgressWithDashboard(completionProgress, validDashboard);
  assert.equal(validProjection.games[0]?.summary.unlockedCount, 55);
});

test("Steam bounded profile refresh reconciles only complete recent-game progress into library totals", () => {
  const summary: SteamLibraryAchievementScanSummary = {
    steamId64: "12345678901234567",
    scannedAt: "2026-09-01T00:00:00.000Z",
    ownedGameCount: 2,
    scannedGameCount: 2,
    gamesWithAchievements: 2,
    skippedGameCount: 0,
    failedGameCount: 0,
    totalAchievements: 1_500,
    unlockedAchievements: 825,
    perfectGames: 0,
    completionPercent: 55,
    games: [
      {
        appid: 2218750, id: "2218750", gameId: "2218750", title: "Halls of Torment", providerId: "steam",
        totalAchievements: 500, unlockedAchievements: 168, completionPercent: 34,
        hasAchievements: true, scanStatus: "scanned",
      },
      {
        appid: 70, id: "70", gameId: "70", title: "Half-Life", providerId: "steam",
        totalAchievements: 1_000, unlockedAchievements: 657, completionPercent: 66,
        hasAchievements: true, scanStatus: "scanned",
      },
    ],
  };
  const reconciled = reconcileSteamLibraryAchievementSummaryWithRecentGames(summary, [{
    providerId: "steam",
    appid: 2218750,
    gameId: "2218750",
    title: "Halls of Torment",
    summary: { unlockedCount: 169, totalCount: 500, completionPercent: 34 },
    achievementStateIsComplete: true,
  }], "2026-09-25T20:00:00.000Z");

  assert.equal(reconciled.unlockedAchievements, 826);
  assert.equal(reconciled.games[0]?.unlockedAchievements, 169);
  assert.equal(reconciled.lastRecentActivityRefreshAt, "2026-09-25T20:00:00.000Z");

  const unchanged = reconcileSteamLibraryAchievementSummaryWithRecentGames(summary, [{
    providerId: "steam",
    appid: 2218750,
    gameId: "2218750",
    title: "Halls of Torment",
    summary: { unlockedCount: 169, totalCount: 500, completionPercent: 34 },
  }]);
  assert.equal(unchanged, summary, "fallback detail must not alter the saved library aggregate");
});

test("Steam dashboard refresh keeps cached library totals when bounded recent detail fails", async () => {
  await withMockDeckyStorage(async () => {
    resetDeckyAppServicesForTests();
    const config = normalizeSteamProviderConfig({
      steamId64: "12345678901234567", hasApiKey: true, language: "english",
      recentAchievementsCount: 1, recentlyPlayedCount: 1, includePlayedFreeGames: false,
    });
    deckyBackendTestState.steam.config = config;
    deckyBackendTestState.steam.secret = "steam-test-secret";
    updateDeckyProviderConfigCache("steam", config);
    writeDeckySteamLibraryAchievementScanSummary({
      steamId64: config.steamId64,
      scannedAt: "2026-09-01T00:00:00.000Z",
      ownedGameCount: 1,
      scannedGameCount: 1,
      gamesWithAchievements: 1,
      skippedGameCount: 0,
      failedGameCount: 0,
      totalAchievements: 100,
      unlockedAchievements: 50,
      perfectGames: 0,
      completionPercent: 50,
      games: [{
        appid: 220, id: "220", gameId: "220", title: "Half-Life 2", providerId: "steam",
        totalAchievements: 100, unlockedAchievements: 50, completionPercent: 50,
        hasAchievements: true, scanStatus: "scanned",
      }],
    });

    let signalPlayerRequest: (() => void) | undefined;
    const playerRequestStarted = new Promise<void>((resolve) => { signalPlayerRequest = resolve; });
    let releasePlayerRequest: (() => void) | undefined;
    const playerRequestGate = new Promise<void>((resolve) => { releasePlayerRequest = resolve; });
    let playerRequestCount = 0;
    let refreshSettled = false;
    setDeckyBackendCallImplementationForTests(async (route: string, payload: unknown) => {
      if (route === "request_steam_json" && (payload as Record<string, unknown>).path === "ISteamUserStats/GetPlayerAchievements/v1/") {
        playerRequestCount += 1;
        signalPlayerRequest?.();
        await playerRequestGate;
        throw new Error("temporary recent player-state failure");
      }
      return deckyBackendTestCallImplementation(route, payload);
    });

    try {
      const refresh = loadDeckyDashboardState("steam", { forceRefresh: true }).then((state) => {
        refreshSettled = true;
        return state;
      });
      await playerRequestStarted;
      await Promise.resolve();
      assert.equal(refreshSettled, false);
      releasePlayerRequest?.();
      const dashboardState = await refresh;
      assert.equal(dashboardState.data?.recentlyPlayedGames[0]?.summary.unlockedCount, 0);
      assert.equal(playerRequestCount, 2, "only the bounded dashboard and history requests run; no complete library updater runs");
      const completionState = await loadDeckyCompletionProgressState("steam");
      assert.equal(completionState.data?.games[0]?.summary.unlockedCount, 50);
    } finally {
      setDeckyBackendCallImplementationForTests(deckyBackendTestCallImplementation);
      resetDeckyAppServicesForTests();
    }
  });
});

test("Steam full-screen entry refreshes the bounded account snapshot and reuses the saved library", async () => {
  await withMockDeckyStorage(async () => {
    resetDeckyAppServicesForTests();
    const config = normalizeSteamProviderConfig({
      steamId64: "12345678901234567", hasApiKey: true, language: "english",
      recentAchievementsCount: 1, recentlyPlayedCount: 1, includePlayedFreeGames: false,
    });
    deckyBackendTestState.steam.config = config;
    deckyBackendTestState.steam.secret = "steam-test-secret";
    updateDeckyProviderConfigCache("steam", config);

    const ownedGames = Array.from({ length: 101 }, (_, index) => ({
      appid: 220 + index,
      name: `Owned Game ${index + 1}`,
      playtime_forever: index === 0 ? 42 : 0,
      ...(index === 0 ? { playtime_2weeks: 12 } : {}),
    }));
    let ownedGamesRequestCount = 0;
    let playerAchievementRequestCount = 0;
    setDeckyBackendCallImplementationForTests(async (route: string, payload: unknown) => {
      if (route === "request_steam_json") {
        const path = (payload as Record<string, unknown>).path;
        if (path === "IPlayerService/GetOwnedGames/v1/") {
          ownedGamesRequestCount += 1;
          return { response: { game_count: ownedGames.length, games: ownedGames } };
        }
        if (path === "ISteamUserStats/GetPlayerAchievements/v1/") {
          playerAchievementRequestCount += 1;
        }
      }
      return deckyBackendTestCallImplementation(route, payload);
    });

    try {
      const profileState = await loadDeckyDashboardStateForFullScreenEntry("steam");
      assert.equal(profileState.status, "success");
      assert.ok(profileState.data !== undefined);
      assert.equal(ownedGamesRequestCount, 3, "full-screen entry uses only the bounded profile/activity inputs");
      assert.equal(
        playerAchievementRequestCount,
        2,
        "full-screen entry refreshes only the configured recent game's bounded live state",
      );

      const cachedEntryState = getDeckyDashboardStateForFullScreenEntryInitial("steam");
      assert.equal(cachedEntryState.status, "success");
      assert.equal(cachedEntryState.data?.profile.providerId, "steam");

      const completedSessionRequestCounts = {
        ownedGames: ownedGamesRequestCount,
        playerAchievements: playerAchievementRequestCount,
      };
      const gamesState = await loadDeckyCompletionProgressStateForFullScreenEntry("steam");
      const activityState = await loadDeckyAchievementHistoryStateForFullScreenEntry("steam");
      assert.equal(gamesState.status, "success");
      assert.equal(activityState.status, "success");
      assert.deepEqual(
        {
          ownedGames: ownedGamesRequestCount,
          playerAchievements: playerAchievementRequestCount,
        },
        completedSessionRequestCounts,
        "switching to Games or Activity reuses the completed full-screen session without API calls",
      );

      playerAchievementRequestCount = 0;
      ownedGamesRequestCount = 0;
      await refreshDeckySteamLibraryForExplicitRefresh();
      assert.equal(ownedGamesRequestCount, 1);
      assert.equal(
        playerAchievementRequestCount,
        ownedGames.length,
        "an explicit library refresh still updates every owned game's achievement state",
      );
    } finally {
      setDeckyBackendCallImplementationForTests(deckyBackendTestCallImplementation);
      resetDeckyAppServicesForTests();
    }
  });
});

test("Steam inactive games remain historical but are excluded from current completion projections", () => {
  const historicalUnlock = {
    id: "9:OLD:1700000000",
    achievementId: "OLD",
    apiName: "OLD",
    title: "Old achievement",
    unlockedAt: "2023-11-14T22:13:20.000Z",
    gameId: "9",
    gameTitle: "Inactive Game",
    providerId: "steam" as const,
  };
  const summary: SteamLibraryAchievementScanSummary = {
    steamId64: "12345678901234567",
    scannedAt: "2026-09-24T00:00:00.000Z",
    ownedGameCount: 1,
    scannedGameCount: 1,
    gamesWithAchievements: 1,
    skippedGameCount: 0,
    failedGameCount: 0,
    totalAchievements: 2,
    unlockedAchievements: 1,
    perfectGames: 0,
    completionPercent: 50,
    unlockedAchievementsList: [historicalUnlock],
    games: [
      {
        appid: 9,
        id: "9",
        gameId: "9",
        title: "Inactive Game",
        providerId: "steam",
        totalAchievements: 10,
        unlockedAchievements: 10,
        completionPercent: 100,
        hasAchievements: true,
        scanStatus: "scanned",
        ownershipStatus: "inactive",
      },
      {
        appid: 10,
        id: "10",
        gameId: "10",
        title: "Owned Game",
        providerId: "steam",
        totalAchievements: 2,
        unlockedAchievements: 1,
        completionPercent: 50,
        hasAchievements: true,
        scanStatus: "scanned",
        ownershipStatus: "owned",
      },
    ],
  };

  const projection = buildDeckySteamCompletionProgressSnapshotFromSummary(summary);
  assert.deepStrictEqual(projection.games.map((game) => game.gameId), ["10"]);
  assert.equal(projection.summary.playedCount, 1);
  assert.equal(projection.summary.unfinishedCount, 1);
  assert.equal(projection.summary.masteredCount, 0);
  assert.equal(summary.unlockedAchievementsList?.length, 1, "historical unlock stays retained");
});

test("incremental Steam library refresh discovers and safely updates the complete owned library", async () => {
  const config = normalizeSteamProviderConfig({
    steamId64: "12345678901234567",
    hasApiKey: true,
    language: "english",
    recentAchievementsCount: 1,
    recentlyPlayedCount: 1,
    includePlayedFreeGames: false,
  });
  let ownedGames: RawSteamOwnedGame[] = [
    { appid: 10, name: "Recent Game", playtime_forever: 10 },
    { appid: 20, name: "Non-recent Owned Game", playtime_forever: 0 },
  ];
  const playerState = new Map<number, RawSteamPlayerAchievement[]>([
    [10, [{ apiname: "A", achieved: 1, unlocktime: 1_700_000_001 }, { apiname: "B", achieved: 0 }]],
    [20, [{ apiname: "C", achieved: 1, unlocktime: 1_700_000_002 }, { apiname: "D", achieved: 0 }]],
  ]);
  const schemaState = new Map<number, RawSteamSchemaAchievement[]>([
    [10, [{ name: "A" }, { name: "B" }]],
    [20, [{ name: "C" }, { name: "D" }]],
  ]);
  const failedGames = new Set<number>();
  const missingAchievementsGames = new Set<number>();
  let ownedGamesResponse: RawSteamGetOwnedGamesResponse | undefined;
  const schemaCalls = new Map<number, number>();
  const schemaCache = new Map<number, readonly RawSteamSchemaAchievement[]>();
  const schemaCacheAdapter = {
    read(appId: number) { return schemaCache.get(appId); },
    write(appId: number, achievements: readonly RawSteamSchemaAchievement[]) {
      schemaCache.set(appId, achievements);
    },
  };
  const client: SteamClient = {
    async loadOwnedGames() {
      return ownedGamesResponse ?? { response: { game_count: ownedGames.length, games: ownedGames } };
    },
    async loadPlayerAchievements(_config, appId) {
      if (failedGames.has(appId)) {
        throw new Error("temporary player-achievements failure");
      }
      if (missingAchievementsGames.has(appId)) {
        return { playerstats: { success: true } };
      }
      return { playerstats: { success: true, achievements: playerState.get(appId) ?? [] } };
    },
    async loadSchemaForGame(_config, appId) {
      schemaCalls.set(appId, (schemaCalls.get(appId) ?? 0) + 1);
      return { game: { availableGameStats: { achievements: schemaState.get(appId) ?? [] } } };
    },
    async loadPlayerSummaries() { throw new Error("unused"); },
    async loadSteamLevel() { throw new Error("unused"); },
    async loadBadges() { throw new Error("unused"); },
    async loadRecentlyPlayedGames() { throw new Error("unused"); },
    async loadGlobalAchievementPercentagesForApp() { throw new Error("unused"); },
  };

  const initial = await scanSteamLibraryAchievements(config, { client, schemaCache: schemaCacheAdapter });
  assert.equal(initial.ownedGameCount, 2);
  assert.equal(initial.totalAchievements, 4);
  assert.equal(initial.unlockedAchievements, 2);
  assert.equal(initial.games.find((game) => game.appid === 20)?.totalAchievements, 2);

  const unchanged = await refreshSteamLibraryAchievementProgress(config, initial, { client, schemaCache: schemaCacheAdapter });
  assert.equal(unchanged.totalAchievements, 4);
  assert.equal(unchanged.unlockedAchievements, 2);
  assert.equal(unchanged.games.find((game) => game.appid === 20)?.totalAchievements, 2);
  assert.equal(schemaCalls.get(10), 1, "cached static schema should be reused");
  assert.equal(schemaCalls.get(20), 1, "cached static schema should be reused");

  // A newly unlocked state on a game outside the recent-game UI limit is still refreshed.
  playerState.set(20, [
    { apiname: "C", achieved: 1, unlocktime: 1_700_000_002 },
    { apiname: "D", achieved: 1, unlocktime: 1_800_000_000 },
  ]);
  let updated = await refreshSteamLibraryAchievementProgress(config, unchanged, { client, schemaCache: schemaCacheAdapter });
  assert.equal(updated.unlockedAchievements, 3);
  assert.equal(updated.games.find((game) => game.appid === 20)?.unlockedAchievements, 2);
  assert.equal(updated.unlockedAchievementsList?.some((unlock) => unlock.apiName === "D"), true);

  // Owned-game discovery does not use installation state and adds new titles on normal refresh.
  const uninstalledButOwned = { appid: 30, name: "Owned but uninstalled" } as RawSteamOwnedGame & {
    readonly installed: false;
  };
  ownedGames = [...ownedGames, uninstalledButOwned];
  playerState.set(30, [{ apiname: "E", achieved: 1, unlocktime: 1_800_000_100 }]);
  schemaState.set(30, [{ name: "E" }]);
  updated = await refreshSteamLibraryAchievementProgress(config, updated, { client, schemaCache: schemaCacheAdapter });
  assert.equal(updated.ownedGameCount, 3);
  assert.equal(updated.games.some((game) => game.appid === 30 && game.ownershipStatus === "owned"), true);
  assert.equal(updated.unlockedAchievements, 4);

  // Absence in a single routine refresh is not proof of ownership loss.
  ownedGames = ownedGames.filter((game) => game.appid !== 20);
  updated = await refreshSteamLibraryAchievementProgress(config, updated, { client, schemaCache: schemaCacheAdapter });
  assert.equal(updated.games.find((game) => game.appid === 20)?.ownershipStatus, "owned");
  assert.equal(updated.ownedGameCount, 3);
  assert.equal(updated.unlockedAchievements, 4);
  ownedGames = [...ownedGames, { appid: 20, name: "Non-recent Owned Game", playtime_forever: 0 }];

  const knownGoodUnlocked = updated.unlockedAchievements;
  failedGames.add(20);
  const afterRequestFailure = await refreshSteamLibraryAchievementProgress(config, updated, { client, schemaCache: schemaCacheAdapter });
  assert.equal(afterRequestFailure.unlockedAchievements, knownGoodUnlocked);
  assert.equal(afterRequestFailure.games.find((game) => game.appid === 20)?.unlockedAchievements, 2);
  assert.match(afterRequestFailure.games.find((game) => game.appid === 20)?.lastAchievementRefreshError ?? "", /failure/u);

  failedGames.clear();
  missingAchievementsGames.add(20);
  const afterMissingState = await refreshSteamLibraryAchievementProgress(config, afterRequestFailure, { client, schemaCache: schemaCacheAdapter });
  assert.equal(afterMissingState.unlockedAchievements, knownGoodUnlocked);
  assert.equal(afterMissingState.games.find((game) => game.appid === 20)?.unlockedAchievements, 2);

  // Shape/count mismatches and ambiguous empty responses cannot replace the prior collection.
  assert.equal(validateSteamOwnedGamesResponse({ response: { game_count: 2, games: ownedGames } }), undefined);
  assert.equal(validateSteamOwnedGamesResponse({ response: { game_count: 0 } }), undefined);
  ownedGamesResponse = { response: { game_count: 2, games: ownedGames.slice(0, 2) } };
  const afterPartialOwnedList = await refreshSteamLibraryAchievementProgress(config, afterMissingState, { client, schemaCache: schemaCacheAdapter });
  assert.equal(afterPartialOwnedList.ownedGameCount, 3, "a partial owned-games list preserves cached ownership");
  ownedGamesResponse = { response: { game_count: 0, games: [] } };
  await assert.rejects(refreshSteamLibraryAchievementProgress(config, afterMissingState, { client, schemaCache: schemaCacheAdapter }));
  ownedGamesResponse = undefined;
  assert.equal(afterMissingState.ownedGameCount, 3);
  assert.equal(afterMissingState.unlockedAchievements, knownGoodUnlocked);

  // Player API names define counts; a partial schema cannot omit valid player states.
  const playerAchievements = [
    { apiname: "A", achieved: 1 },
    { apiname: "B", achieved: 0 },
  ] satisfies RawSteamPlayerAchievement[];
  const partialSchemaCounts = countSteamPlayerAchievements(playerAchievements);
  assert.equal(partialSchemaCounts?.total, 2);
  assert.equal(partialSchemaCounts?.unlocked, 1);
  const partialSchemaDetail = normalizeSteamGameDetail({
    appId: 10,
    rawGameName: "Recent Game",
    rawGameIcon: undefined,
    rawGameBoxArt: undefined,
    playerAchievements,
    schemaAchievements: [{ name: "A" }],
    globalAchievementPercentages: new Map(),
    playtimeForever: undefined,
    playtimeTwoWeeks: undefined,
    playtimeDeckForever: undefined,
  });
  assert.equal(partialSchemaDetail.game.summary.totalCount, 2);
  assert.equal(partialSchemaDetail.game.summary.unlockedCount, 1);

  // A complete player response with a refreshed schema can authoritatively lower totals.
  failedGames.clear();
  missingAchievementsGames.clear();
  schemaState.set(10, [{ name: "A" }]);
  playerState.set(10, [{ apiname: "A", achieved: 0 }]);
  updated = await refreshSteamLibraryAchievementProgress(config, updated, { client, schemaCache: schemaCacheAdapter });
  assert.equal(updated.games.find((game) => game.appid === 10)?.totalAchievements, 1);
  const rebuilt = await scanSteamLibraryAchievements(config, { client, previousSummary: updated, schemaCache: schemaCacheAdapter });
  assert.equal(rebuilt.totalAchievements, updated.totalAchievements);
  assert.equal(rebuilt.unlockedAchievements, updated.unlockedAchievements);
});

test("concurrent Steam recent-detail and library requests share only the in-flight player state", async () => {
  const config = normalizeSteamProviderConfig({
    steamId64: "12345678901234567", hasApiKey: true, language: "english",
    recentAchievementsCount: 1, recentlyPlayedCount: 1, includePlayedFreeGames: false,
  });
  let requestCount = 0;
  let resolveRequest: ((response: RawSteamGetPlayerAchievementsResponse) => void) | undefined;
  const pendingResponse = new Promise<RawSteamGetPlayerAchievementsResponse>((resolve) => {
    resolveRequest = resolve;
  });
  const createClient = (): SteamClient => ({
    loadPlayerAchievements() {
      requestCount += 1;
      return pendingResponse;
    },
    async loadOwnedGames() { throw new Error("unused"); },
    async loadPlayerSummaries() { throw new Error("unused"); },
    async loadSteamLevel() { throw new Error("unused"); },
    async loadBadges() { throw new Error("unused"); },
    async loadRecentlyPlayedGames() { throw new Error("unused"); },
    async loadSchemaForGame() { throw new Error("unused"); },
    async loadGlobalAchievementPercentagesForApp() { throw new Error("unused"); },
  });

  const recentRequest = loadSteamPlayerAchievementsCoalesced(createClient(), config, 123);
  const libraryRequest = loadSteamPlayerAchievementsCoalesced(createClient(), config, 123);
  assert.equal(requestCount, 1);
  resolveRequest?.({ playerstats: { success: true, achievements: [{ apiname: "A", achieved: 1 }] } });
  assert.deepStrictEqual(await recentRequest, await libraryRequest);
  await Promise.resolve();
  const laterRefresh = loadSteamPlayerAchievementsCoalesced(createClient(), config, 123);
  assert.equal(requestCount, 2, "resolved player state is not reused across refreshes");
  resolveRequest?.({ playerstats: { success: true, achievements: [{ apiname: "A", achieved: 1 }] } });
  await laterRefresh;
});

test("Steam library refresh preserves unverifiable decreases and accepts complete lower or increased state", async () => {
  const config = normalizeSteamProviderConfig({
    steamId64: "12345678901234567",
    hasApiKey: true,
    language: "english",
    recentAchievementsCount: 1,
    recentlyPlayedCount: 1,
    includePlayedFreeGames: false,
  });
  const previousAchievements = Array.from({ length: 100 }, (_, index) => ({
    apiname: `ACH_${index}`,
    achieved: index < 50 ? 1 : 0,
  } satisfies RawSteamPlayerAchievement));
  const previous: SteamLibraryAchievementScanSummary = {
    steamId64: config.steamId64,
    scannedAt: "2026-09-01T00:00:00.000Z",
    ownedGameCount: 1,
    scannedGameCount: 1,
    gamesWithAchievements: 1,
    skippedGameCount: 0,
    failedGameCount: 0,
    totalAchievements: 100,
    unlockedAchievements: 50,
    perfectGames: 0,
    completionPercent: 50,
    games: [{
      appid: 1,
      id: "1",
      gameId: "1",
      title: "Known Game",
      providerId: "steam",
      totalAchievements: 100,
      unlockedAchievements: 50,
      completionPercent: 50,
      hasAchievements: true,
      scanStatus: "scanned",
    }],
  };
  const makeClient = (
    achievements: readonly RawSteamPlayerAchievement[],
    schema: readonly RawSteamSchemaAchievement[] | undefined,
  ): SteamClient => ({
    async loadOwnedGames() { return { response: { game_count: 1, games: [{ appid: 1, name: "Known Game" }] } }; },
    async loadPlayerAchievements() { return { playerstats: { success: true, achievements } }; },
    async loadSchemaForGame() {
      if (schema === undefined) throw new Error("schema unavailable");
      return { game: { availableGameStats: { achievements: schema } } };
    },
    async loadPlayerSummaries() { throw new Error("unused"); },
    async loadSteamLevel() { throw new Error("unused"); },
    async loadBadges() { throw new Error("unused"); },
    async loadRecentlyPlayedGames() { throw new Error("unused"); },
    async loadGlobalAchievementPercentagesForApp() { throw new Error("unused"); },
  });

  const lowerPartial = Array.from({ length: 90 }, (_, index) => ({
    apiname: `ACH_${index}`,
    achieved: index < 45 ? 1 : 0,
  } satisfies RawSteamPlayerAchievement));
  const preserved = await refreshSteamLibraryAchievementProgress(
    config,
    previous,
    { client: makeClient(lowerPartial, undefined) },
  );
  assert.equal(preserved.totalAchievements, 100);
  assert.equal(preserved.unlockedAchievements, 50);
  assert.match(preserved.games[0]?.lastAchievementRefreshError ?? "", /authoritative state/u);

  const increased = previousAchievements.map((achievement, index) => ({
    ...achievement,
    achieved: index < 51 ? 1 : 0,
  }));
  const acceptedIncrease = await refreshSteamLibraryAchievementProgress(
    config,
    previous,
    { client: makeClient(increased, undefined) },
  );
  assert.equal(acceptedIncrease.totalAchievements, 100);
  assert.equal(acceptedIncrease.unlockedAchievements, 51);

  const completeSchema = Array.from({ length: 90 }, (_, index) => ({ name: `ACH_${index}` }));
  const acceptedDecrease = await refreshSteamLibraryAchievementProgress(
    config,
    previous,
    { client: makeClient(lowerPartial, completeSchema) },
  );
  assert.equal(acceptedDecrease.totalAchievements, 90);
  assert.equal(acceptedDecrease.unlockedAchievements, 45);

  const newGameClient: SteamClient = {
    ...makeClient([
      { apiname: "NEW_A", achieved: 1 },
      { apiname: "NEW_B", achieved: 0 },
      { apiname: "NEW_C", achieved: 0 },
    ], undefined),
    async loadOwnedGames() { return { response: { game_count: 1, games: [{ appid: 2, name: "New Game" }] } }; },
  };
  const initialized = await refreshSteamLibraryAchievementProgress(config, undefined, { client: newGameClient });
  assert.equal(initialized.totalAchievements, 3);
  assert.equal(initialized.unlockedAchievements, 1);
});

test("Steam incremental refresh prevents the 825 to 812 stale-detail regression and stale cache writes", async () => {
  await withMockDeckyStorage(async () => {
    const achievements = Array.from({ length: 825 }, (_, index) => ({
      apiname: `ACH_${index}`,
      achieved: index < 825 ? 1 : 0,
      unlocktime: 1_800_000_000 + index,
    } satisfies RawSteamPlayerAchievement));
    const schema = achievements.map((achievement) => ({ name: achievement.apiname }));
    const ownedGames: RawSteamOwnedGame[] = [{ appid: 99, name: "825-count game" }];
    const client: SteamClient = {
      async loadOwnedGames() { return { response: { game_count: 1, games: ownedGames } }; },
      async loadPlayerAchievements() { return { playerstats: { success: true, achievements } }; },
      async loadSchemaForGame() { return { game: { availableGameStats: { achievements: schema } } }; },
      async loadPlayerSummaries() { throw new Error("unused"); },
      async loadSteamLevel() { throw new Error("unused"); },
      async loadBadges() { throw new Error("unused"); },
      async loadRecentlyPlayedGames() { throw new Error("unused"); },
      async loadGlobalAchievementPercentagesForApp() { throw new Error("unused"); },
    };
    const config = normalizeSteamProviderConfig({
      steamId64: "12345678901234567",
      hasApiKey: true,
      language: "english",
      recentAchievementsCount: 1,
      recentlyPlayedCount: 1,
      includePlayedFreeGames: false,
    });
    const initial = await scanSteamLibraryAchievements(config, { client });
    assert.equal(initial.unlockedAchievements, 825);
    const refreshed = await refreshSteamLibraryAchievementProgress(config, initial, { client });
    assert.equal(refreshed.unlockedAchievements, 825);
    assert.equal(refreshed.games[0]?.unlockedAchievements, 825);

    const newer = { ...refreshed, unlockedAchievements: 826 };
    const stale = { ...refreshed, unlockedAchievements: 812 };
    writeDeckySteamLibraryAchievementScanSummary(newer);
    const expectedRevision = getDeckySteamLibraryAchievementScanRevision();
    writeDeckySteamLibraryAchievementScanSummary({ ...newer, unlockedAchievements: 827 });
    assert.equal(
      writeDeckySteamLibraryAchievementScanSummaryIfRevisionMatches(expectedRevision, stale),
      false,
    );
    assert.equal(readDeckySteamLibraryAchievementScanSummary("steam")?.unlockedAchievements, 827);

    const cached = await refreshAndCacheDeckySteamLibraryAchievementProgress(config, { client });
    assert.equal(cached?.unlockedAchievements, 825);
  });
});

test("Steam scan and incremental refresh serialize so older work cannot overwrite the later operation", async () => {
  await withMockDeckyStorage(async () => {
    const config = normalizeSteamProviderConfig({
      steamId64: "12345678901234567",
      hasApiKey: true,
      language: "english",
      recentAchievementsCount: 1,
      recentlyPlayedCount: 1,
      includePlayedFreeGames: false,
    });
    const ownedGames: RawSteamOwnedGame[] = [{ appid: 77, name: "Race Test" }];
    const oldPlayerState: RawSteamPlayerAchievement[] = [
      { apiname: "A", achieved: 0 },
      { apiname: "B", achieved: 0 },
    ];
    const newPlayerState: RawSteamPlayerAchievement[] = [
      { apiname: "A", achieved: 1, unlocktime: 1_800_000_001 },
      { apiname: "B", achieved: 1, unlocktime: 1_800_000_002 },
    ];
    writeDeckySteamLibraryAchievementScanSummary({
      scannedAt: "2026-09-01T00:00:00.000Z",
      ownedGameCount: 1,
      scannedGameCount: 1,
      gamesWithAchievements: 1,
      skippedGameCount: 0,
      failedGameCount: 0,
      totalAchievements: 2,
      unlockedAchievements: 0,
      perfectGames: 0,
      completionPercent: 0,
      games: [{
        appid: 77,
        id: "77",
        gameId: "77",
        title: "Race Test",
        providerId: "steam",
        totalAchievements: 2,
        unlockedAchievements: 0,
        completionPercent: 0,
        hasAchievements: true,
        scanStatus: "scanned",
        achievementSchema: [{ name: "A" }, { name: "B" }],
      }],
    });

    let notifyRefreshStarted: (() => void) | undefined;
    const refreshStarted = new Promise<void>((resolve) => { notifyRefreshStarted = resolve; });
    let releaseRefresh: (() => void) | undefined;
    const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    const refreshClient: SteamClient = {
      async loadOwnedGames() { return { response: { game_count: 1, games: ownedGames } }; },
      async loadPlayerAchievements() {
        notifyRefreshStarted?.();
        await refreshGate;
        return { playerstats: { success: true, achievements: oldPlayerState } };
      },
      async loadSchemaForGame() { throw new Error("cached schema should be reused"); },
      async loadPlayerSummaries() { throw new Error("unused"); },
      async loadSteamLevel() { throw new Error("unused"); },
      async loadBadges() { throw new Error("unused"); },
      async loadRecentlyPlayedGames() { throw new Error("unused"); },
      async loadGlobalAchievementPercentagesForApp() { throw new Error("unused"); },
    };
    const scanClient: SteamClient = {
      async loadOwnedGames() { return { response: { game_count: 1, games: ownedGames } }; },
      async loadPlayerAchievements() { return { playerstats: { success: true, achievements: newPlayerState } }; },
      async loadSchemaForGame() { throw new Error("cached schema should be reused"); },
      async loadPlayerSummaries() { throw new Error("unused"); },
      async loadSteamLevel() { throw new Error("unused"); },
      async loadBadges() { throw new Error("unused"); },
      async loadRecentlyPlayedGames() { throw new Error("unused"); },
      async loadGlobalAchievementPercentagesForApp() { throw new Error("unused"); },
    };

    const refresh = refreshAndCacheDeckySteamLibraryAchievementProgress(config, { client: refreshClient });
    await refreshStarted;
    const scan = runAndCacheDeckySteamLibraryAchievementScan(config, { client: scanClient });
    releaseRefresh?.();
    await Promise.all([refresh, scan]);
    assert.equal(readDeckySteamLibraryAchievementScanSummary("steam")?.unlockedAchievements, 2);
  });
});

test("Steam account changes clear prior library state and old in-flight refreshes cannot write across accounts", async () => {
  await withMockDeckyStorage(async () => {
    const accountA = normalizeSteamProviderConfig({
      steamId64: "12345678901234567", hasApiKey: true, language: "english",
      recentAchievementsCount: 1, recentlyPlayedCount: 1, includePlayedFreeGames: false,
    });
    const accountB = normalizeSteamProviderConfig({
      steamId64: "22345678901234567", hasApiKey: true, language: "english",
      recentAchievementsCount: 1, recentlyPlayedCount: 1, includePlayedFreeGames: false,
    });
    deckyBackendTestState.steam.config = {
      ...accountA,
      hasApiKey: true,
    };
    deckyBackendTestState.steam.secret = "steam-test-secret";
    updateDeckyProviderConfigCache("steam", accountA);
    writeDeckySteamLibraryAchievementScanSummary({
      steamId64: accountA.steamId64,
      scannedAt: "2026-09-01T00:00:00.000Z",
      ownedGameCount: 1,
      scannedGameCount: 1,
      gamesWithAchievements: 1,
      skippedGameCount: 0,
      failedGameCount: 0,
      totalAchievements: 1,
      unlockedAchievements: 1,
      perfectGames: 1,
      completionPercent: 100,
      games: [{
        appid: 101,
        id: "101",
        gameId: "101",
        title: "Account A Game",
        providerId: "steam",
        totalAchievements: 1,
        unlockedAchievements: 1,
        completionPercent: 100,
        hasAchievements: true,
        scanStatus: "scanned",
      }],
    });

    let signalAccountAPlayerRequest: (() => void) | undefined;
    const accountAPlayerRequest = new Promise<void>((resolve) => { signalAccountAPlayerRequest = resolve; });
    let releaseAccountAPlayer: (() => void) | undefined;
    const accountAPlayerGate = new Promise<void>((resolve) => { releaseAccountAPlayer = resolve; });
    const accountAClient: SteamClient = {
      async loadOwnedGames() { return { response: { game_count: 1, games: [{ appid: 101, name: "Account A Game" }] } }; },
      async loadPlayerAchievements() {
        signalAccountAPlayerRequest?.();
        await accountAPlayerGate;
        return { playerstats: { success: true, achievements: [{ apiname: "A", achieved: 1 }] } };
      },
      async loadSchemaForGame() { return { game: { availableGameStats: { achievements: [{ name: "A" }] } } }; },
      async loadPlayerSummaries() { throw new Error("unused"); },
      async loadSteamLevel() { throw new Error("unused"); },
      async loadBadges() { throw new Error("unused"); },
      async loadRecentlyPlayedGames() { throw new Error("unused"); },
      async loadGlobalAchievementPercentagesForApp() { throw new Error("unused"); },
    };
    const accountARefresh = refreshAndCacheDeckySteamLibraryAchievementProgress(accountA, { client: accountAClient });
    await accountAPlayerRequest;

    assert.equal(await writeDeckySteamProviderConfig({
      steamId64: accountB.steamId64,
      language: accountB.language,
      recentAchievementsCount: accountB.recentAchievementsCount,
      recentlyPlayedCount: accountB.recentlyPlayedCount,
      includePlayedFreeGames: accountB.includePlayedFreeGames,
    }, ""), true);
    assert.equal(readDeckySteamLibraryAchievementScanSummary("steam"), undefined);

    const accountBClient: SteamClient = {
      async loadOwnedGames() { return { response: { game_count: 1, games: [{ appid: 202, name: "Account B Game" }] } }; },
      async loadPlayerAchievements() { return { playerstats: { success: true, achievements: [{ apiname: "B", achieved: 1 }] } }; },
      async loadSchemaForGame() { return { game: { availableGameStats: { achievements: [{ name: "B" }] } } }; },
      async loadPlayerSummaries() { throw new Error("unused"); },
      async loadSteamLevel() { throw new Error("unused"); },
      async loadBadges() { throw new Error("unused"); },
      async loadRecentlyPlayedGames() { throw new Error("unused"); },
      async loadGlobalAchievementPercentagesForApp() { throw new Error("unused"); },
    };
    const accountBRefresh = refreshAndCacheDeckySteamLibraryAchievementProgress(accountB, { client: accountBClient });
    releaseAccountAPlayer?.();
    await Promise.all([accountARefresh, accountBRefresh]);
    const activeSummary = readDeckySteamLibraryAchievementScanSummary("steam");
    assert.equal(activeSummary?.steamId64, accountB.steamId64);
    assert.deepStrictEqual(activeSummary?.games.map((game) => game.appid), [202]);
  });
});

test("Steam summary storage write failure retains the previous durable and in-memory summary", async () => {
  await withMockDeckyStorage(async () => {
    const existing: SteamLibraryAchievementScanSummary = {
      steamId64: "12345678901234567",
      scannedAt: "2026-09-01T00:00:00.000Z",
      ownedGameCount: 1,
      scannedGameCount: 1,
      gamesWithAchievements: 1,
      skippedGameCount: 0,
      failedGameCount: 0,
      totalAchievements: 100,
      unlockedAchievements: 50,
      perfectGames: 0,
      completionPercent: 50,
      games: [{
        appid: 1, id: "1", gameId: "1", title: "Known Game", providerId: "steam",
        totalAchievements: 100, unlockedAchievements: 50, completionPercent: 50,
        hasAchievements: true, scanStatus: "scanned",
        achievementSchema: [{ name: "A" }],
      }],
    };
    writeDeckySteamLibraryAchievementScanSummary(existing);
    const summaryKey = "achievement-companion:decky:steam:library-achievement-scan-summary";
    const storedInitial = JSON.parse(readDeckyStorageText(summaryKey) ?? "{}") as {
      games?: Array<Record<string, unknown>>;
    };
    assert.equal(storedInitial.games?.[0]?.["achievementSchema"], undefined);
    assert.equal(writeDeckySteamAchievementSchemaCache(existing.steamId64 ?? "", 1, [{ name: "A" }]), true);
    assert.deepStrictEqual(readDeckySteamAchievementSchemaCache(existing.steamId64 ?? "", 1), [{ name: "A" }]);
    const localStorageObject = globalThis.localStorage as Storage & { setItem: Storage["setItem"] };
    const originalSetItem = localStorageObject.setItem.bind(localStorageObject);
    Object.defineProperty(localStorageObject, "setItem", {
      configurable: true,
      value(key: string, value: string) {
        if (key === summaryKey) throw new Error("simulated storage quota failure");
        originalSetItem(key, value);
      },
    });
    try {
      const attempted = writeDeckySteamLibraryAchievementScanSummary({
        ...existing,
        unlockedAchievements: 40,
        completionPercent: 40,
      });
      assert.equal(attempted, false);
      assert.equal(readDeckySteamLibraryAchievementScanSummary("steam")?.unlockedAchievements, 50);
      assert.equal(JSON.parse(readDeckyStorageText(summaryKey) ?? "{}").unlockedAchievements, 50);
    } finally {
      Object.defineProperty(localStorageObject, "setItem", { configurable: true, value: originalSetItem });
    }
  });
});

test("steam fullscreen completion falls back to loaded games when no cached scan exists", async () => {
  const { appServices, counts } = createHarness({
    providerFactory: (callCounts) => ({
      id: PROVIDER_ID,
      capabilities: PROVIDER_CAPABILITIES,
      async loadProfile() {
        callCounts.profile += 1;
        return DASHBOARD_REFRESH_PROFILE;
      },
      async loadCompletionProgress() {
        callCounts.completionProgress += 1;
        return [
          {
            providerId: PROVIDER_ID,
            gameId: "game-1",
            title: "Steam Test Game",
            platformLabel: "Steam",
            coverImageUrl: "https://cdn.steam.com/game-icon.jpg",
            playtimeForeverMinutes: 42,
            playtimeTwoWeeksMinutes: 12,
            summary: {
              unlockedCount: 1,
              totalCount: 2,
              completionPercent: 50,
            },
            metrics: [],
            status: "in_progress",
          } satisfies NormalizedGame,
        ];
      },
      async loadRecentlyPlayedGames() {
        callCounts.recentlyPlayedGames += 1;
        return [
          {
            providerId: PROVIDER_ID,
            gameId: "game-1",
            title: "Steam Test Game",
            platformLabel: "Steam",
            coverImageUrl: "https://cdn.steam.com/game-icon.jpg",
            summary: {
              unlockedCount: 1,
              totalCount: 2,
              completionPercent: 50,
            },
            playtimeForeverMinutes: 42,
            playtimeTwoWeeksMinutes: 12,
          } satisfies RecentlyPlayedGame,
        ];
      },
      async loadRecentUnlocks() {
        callCounts.recentUnlocks += 1;
        return [];
      },
      async loadGameProgress() {
        callCounts.gameProgress += 1;
        throw new Error("not used");
      },
    }),
    providerConfig: {
      steamId64: "12345678901234567",
      apiKey: "api-key",
      language: "english",
      recentAchievementsCount: 5,
      recentlyPlayedCount: 5,
      includePlayedFreeGames: false,
    },
  });

  const state = await appServices.completionProgress.loadCompletionProgress(PROVIDER_ID);

  assert.equal(state.status, "success");
  assert.equal(state.data?.games.length, 1);
  assert.equal(state.data?.summary.playedCount, 1);
  assert.equal(state.data?.summary.unfinishedCount, 1);
  assert.equal(state.data?.summary.masteredCount, 0);
  assert.equal(counts.completionProgress, 1);
  assert.equal(counts.profile, 0);
  assert.equal(counts.recentlyPlayedGames, 0);
});

test("steam client steam level maps player level and keeps requests simple", async () => {
  const requests: Array<{ readonly url: string; readonly init: RequestInit | undefined }> = [];
  const transport = createFetchSteamTransport({
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        init,
      });

      return new Response(JSON.stringify({ response: { player_level: 29 } } satisfies RawSteamGetSteamLevelResponse), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    },
  });
  const client = createSteamClient(transport);
  const config = normalizeSteamProviderConfig({
    steamId64: "12345678901234567",
    hasApiKey: true,
    language: "english",
    recentAchievementsCount: 5,
    recentlyPlayedCount: 5,
    includePlayedFreeGames: false,
  });

  const response = await client.loadSteamLevel(config);

  assert.equal(response.response?.player_level, 29);
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.ok(request !== undefined);
  const url = new URL(request.url);
  assert.equal(url.pathname.endsWith("/IPlayerService/GetSteamLevel/v1/"), true);
  assert.equal(url.searchParams.get("key"), null);
  assert.equal(url.searchParams.get("steamid"), config.steamId64);
  assert.equal(url.searchParams.get("format"), "json");
  assert.equal(request.init?.method, "GET");
  assert.equal(request.init?.cache, "no-store");
  const headers = new Headers(request.init?.headers);
  assert.equal(headers.get("Accept"), "application/json");
  assert.equal(headers.get("Cache-Control"), null);
  assert.equal(headers.get("Pragma"), null);
  assert.equal(url.searchParams.get("key"), null);
});

test("steam client badges maps badge count and keeps requests simple", async () => {
  const requests: Array<{ readonly url: string; readonly init: RequestInit | undefined }> = [];
  const transport = createFetchSteamTransport({
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        init,
      });

      return new Response(
        JSON.stringify({
          response: {
            badges: [
              { badgeid: 1 },
              { badgeid: 2 },
              { badgeid: 3 },
            ],
            player_xp: 5_740,
          },
        } satisfies RawSteamGetBadgesResponse),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    },
  });
  const client = createSteamClient(transport);
  const config = normalizeSteamProviderConfig({
    steamId64: "12345678901234567",
    hasApiKey: true,
    language: "english",
    recentAchievementsCount: 5,
    recentlyPlayedCount: 5,
    includePlayedFreeGames: false,
  });

  const response = await client.loadBadges(config);

  assert.equal(response.response?.badges?.length, 3);
  assert.equal(response.response?.player_xp, 5_740);
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.ok(request !== undefined);
  const url = new URL(request.url);
  assert.equal(url.pathname.endsWith("/IPlayerService/GetBadges/v1/"), true);
  assert.equal(url.searchParams.get("key"), null);
  assert.equal(url.searchParams.get("steamid"), config.steamId64);
  assert.equal(url.searchParams.get("format"), "json");
  assert.equal(request.init?.method, "GET");
  assert.equal(request.init?.cache, "no-store");
  const headers = new Headers(request.init?.headers);
  assert.equal(headers.get("Accept"), "application/json");
  assert.equal(headers.get("Cache-Control"), null);
  assert.equal(headers.get("Pragma"), null);
  assert.equal(url.searchParams.get("key"), null);
});


test("steam provider persists normalized badge summaries on profile load", async () => {
  const config = normalizeSteamProviderConfig({
    steamId64: "12345678901234567",
    apiKey: "api-key",
    language: "english",
    recentAchievementsCount: 5,
    recentlyPlayedCount: 5,
    includePlayedFreeGames: false,
  });
  const provider = createSteamProvider({
    client: {
      async loadPlayerSummaries(config) {
        return {
          response: {
            players: [
              {
                steamid: config.steamId64,
                personaname: "Steam User",
                avatarfull: "https://cdn.steam.com/avatar.jpg",
              } satisfies RawSteamPlayerSummary,
            ],
          },
        };
      },
      async loadSteamLevel() {
        return { response: { player_level: 29 } satisfies RawSteamGetSteamLevelResponse };
      },
      async loadBadges() {
        return {
          response: {
            badges: [
              {
                badgeid: 1,
                appid: 12345,
                level: 4,
                xp: 250,
                completion_time: 1_700_000_000,
              } satisfies RawSteamBadge,
            ],
            player_xp: 5_740,
          },
        };
      },
      async loadRecentlyPlayedGames() {
        return {
          response: {
            games: [],
          },
        };
      },
      async loadPlayerAchievements() {
        return {
          playerstats: {
            success: true,
            achievements: [],
          },
        };
      },
      async loadSchemaForGame() {
        return {
          game: {
            availableGameStats: {
              achievements: [],
            },
          },
        };
      },
      async loadGlobalAchievementPercentagesForApp() {
        return {
          achievementpercentages: {
            achievements: [],
          },
        };
      },
    },
  });

  const profile = await provider.loadProfile(config);

  assert.equal(profile.steamLevel, 29);
  assert.equal(profile.badgeCount, 1);
  assert.equal(profile.playerXp, 5_740);
  assert.equal(profile.steamBadges?.length, 1);
  assert.equal(profile.steamBadges?.[0]?.badgeId, "1");
  assert.equal(profile.steamBadges?.[0]?.appId, 12345);
  assert.equal(profile.steamBadges?.[0]?.completedAt, "2023-11-14T22:13:20.000Z");
});

test("steam provider tolerates player summary failures without failing the dashboard", async () => {
  const config = normalizeSteamProviderConfig({
    steamId64: "12345678901234567",
    apiKey: "api-key",
    language: "english",
    recentAchievementsCount: 5,
    recentlyPlayedCount: 5,
    includePlayedFreeGames: false,
  });
  const provider = createSteamProvider({
    client: {
      async loadPlayerSummaries() {
        throw new Error("player summaries forbidden");
      },
      async loadSteamLevel() {
        return { response: { player_level: 29 } satisfies RawSteamGetSteamLevelResponse };
      },
      async loadBadges() {
        return {
          response: {
            badges: [
              {
                badgeid: 1,
                appid: 12345,
                level: 4,
                xp: 250,
                completion_time: 1_700_000_000,
              } satisfies RawSteamBadge,
            ],
            player_xp: 5_740,
          },
        };
      },
      async loadRecentlyPlayedGames() {
        return {
          response: {
            games: [
              {
                appid: 220,
                name: "Test Game",
                playtime_forever: 42,
                has_community_visible_stats: true,
              } satisfies RawSteamRecentlyPlayedGame,
            ],
          },
        };
      },
      async loadPlayerAchievements() {
        return {
          playerstats: {
            success: true,
            achievements: [
              {
                apiname: "ACH_WIN",
                achieved: 1,
                unlocktime: 1_700_000_000,
              } satisfies RawSteamPlayerAchievement,
            ],
          },
        };
      },
      async loadSchemaForGame() {
        return {
          game: {
            availableGameStats: {
              achievements: [
                {
                  name: "ACH_WIN",
                  displayName: "Win One",
                  description: "Unlock the first win",
                  icon: "https://cdn.steam.com/icon.png",
                  icongray: "https://cdn.steam.com/icongray.png",
                  hidden: 0,
                } satisfies RawSteamSchemaAchievement,
              ],
            },
          },
        };
      },
      async loadGlobalAchievementPercentagesForApp() {
        return {
          achievementpercentages: {
            achievements: [
              {
                name: "ACH_WIN",
                percent: 12.5,
              },
            ],
          },
        };
      },
    },
  });

  const profile = await provider.loadProfile(config);

  assert.equal(profile.identity.displayName, config.steamId64);
  assert.equal(profile.steamLevel, 29);
  assert.equal(profile.badgeCount, 1);
  assert.equal(profile.playerXp, 5_740);
  assert.equal(profile.steamBadges?.length, 1);
  assert.equal(profile.summary.unlockedCount, 1);
  assert.equal(profile.summary.totalCount, 1);
});

test("steam provider reuses recent game snapshots across one dashboard refresh", async () => {
  const callCounts = {
    recentlyPlayedGames: 0,
    playerAchievements: 0,
    schemaForGame: 0,
    globalPercentages: 0,
  };
  const provider = createSteamProvider({
    client: {
      async loadPlayerSummaries(config) {
        return {
          response: {
            players: [
              {
                steamid: config.steamId64,
                personaname: "Steam User",
                avatarfull: "https://cdn.steam.com/avatar.jpg",
              } satisfies RawSteamPlayerSummary,
            ],
          },
        };
      },
      async loadSteamLevel() {
        return { response: { player_level: 29 } satisfies RawSteamGetSteamLevelResponse };
      },
      async loadBadges() {
        return {
          response: {
            badges: [],
            player_xp: 5_740,
          },
        };
      },
      async loadRecentlyPlayedGames() {
        callCounts.recentlyPlayedGames += 1;
        return {
          response: {
            games: [
              {
                appid: 220,
                name: "Test Game",
                playtime_forever: 42,
                has_community_visible_stats: true,
              } satisfies RawSteamRecentlyPlayedGame,
            ],
          },
        };
      },
      async loadPlayerAchievements() {
        callCounts.playerAchievements += 1;
        return {
          playerstats: {
            success: true,
            achievements: [
              {
                apiname: "ACH_WIN",
                achieved: 1,
                unlocktime: 1_700_000_000,
              } satisfies RawSteamPlayerAchievement,
            ],
          },
        };
      },
      async loadSchemaForGame() {
        callCounts.schemaForGame += 1;
        return {
          game: {
            availableGameStats: {
              achievements: [
                {
                  name: "ACH_WIN",
                  displayName: "Win One",
                  description: "Unlock the first win",
                  icon: "https://cdn.steam.com/icon.png",
                  icongray: "https://cdn.steam.com/icongray.png",
                  hidden: 0,
                } satisfies RawSteamSchemaAchievement,
              ],
            },
          },
        };
      },
      async loadGlobalAchievementPercentagesForApp() {
        callCounts.globalPercentages += 1;
        return {
          achievementpercentages: {
            achievements: [
              {
                name: "ACH_WIN",
                percent: 12.5,
              },
            ],
          },
        };
      },
    },
  });
  const config = normalizeSteamProviderConfig({
    steamId64: "12345678901234567",
    apiKey: "api-key",
    language: "english",
    recentAchievementsCount: 5,
    recentlyPlayedCount: 5,
    includePlayedFreeGames: false,
  });

  const [profile, recentUnlocks, recentlyPlayedGames, completionProgress] = await Promise.all([
    provider.loadProfile(config),
    provider.loadRecentUnlocks(config, {
      limit: 5,
    }),
    provider.loadRecentlyPlayedGames(config, {
      count: 5,
    }),
    provider.loadCompletionProgress(config),
  ]);
  const gameProgress = await provider.loadGameProgress(config, "220");

  assert.equal(profile.identity.displayName, "Steam User");
  assert.equal(recentUnlocks.length, 1);
  assert.equal(recentlyPlayedGames.length, 1);
  assert.equal(completionProgress.length, 1);
  assert.equal(gameProgress.game.gameId, "220");
  assert.equal(callCounts.recentlyPlayedGames, 1);
  assert.equal(callCounts.playerAchievements, 1);
  assert.equal(callCounts.schemaForGame, 1);
  assert.equal(callCounts.globalPercentages, 1);
});

test("steam badge normalization preserves badge details defensively", () => {
  const normalized = normalizeSteamBadges({
    response: {
      badges: [
        {
          badgeid: 42,
          appid: 12345,
          level: 7,
          xp: 320,
          scarcity: 12,
          completion_time: 1_700_000_000,
        } satisfies RawSteamBadge,
        {
          badge_id: 7,
        } satisfies RawSteamBadge,
      ],
      player_xp: 5_740,
    },
  } satisfies RawSteamGetBadgesResponse);

  assert.equal(normalized.badgeCount, 2);
  assert.equal(normalized.playerXp, 5_740);
  assert.equal(normalized.steamBadges?.length, 2);
  assert.equal(normalized.steamBadges?.[0]?.badgeId, "42");
  assert.equal(normalized.steamBadges?.[0]?.appId, 12345);
  assert.equal(normalized.steamBadges?.[0]?.level, 7);
  assert.equal(normalized.steamBadges?.[0]?.xp, 320);
  assert.equal(normalized.steamBadges?.[0]?.scarcity, 12);
  assert.equal(normalized.steamBadges?.[0]?.completedAt, "2023-11-14T22:13:20.000Z");
  assert.equal(normalized.steamBadges?.[1]?.badgeId, "7");
  assert.equal(normalized.steamBadges?.[1]?.completedAt, undefined);
});



test("game page achievement badge formatter shows stage-aware loading and ready states but hides unavailable and error states", () => {
  assert.equal(formatDeckyGamePageAchievementBadgeLoadingText(undefined, {}), "\u{1f3c6} Checking game...");
  assert.equal(
    formatDeckyGamePageAchievementBadgeLoadingText(
      {
        status: "loading",
        appId: "1672970",
      },
      {
        lastSummaryStatus: "loading",
        lastSummaryFetchStartedAt: "2026-07-07T00:00:00.000Z",
        lastRetroAchievementsShortcutAppId: "1672970",
      },
    ),
    "\u{1f3c6} Reading shortcut...",
  );
  assert.equal(
    formatDeckyGamePageAchievementBadgeLoadingText(
      {
        status: "loading",
        appId: "1672970",
      },
      {
        lastSummaryStatus: "loading",
        lastSummaryFetchStartedAt: "2026-07-07T00:00:00.000Z",
        lastRetroAchievementsShortcutAppId: "1672970",
        lastRetroAchievementsShortcutRomPathDetected: true,
      },
    ),
    "\u{1f3c6} Detecting ROM...",
  );
  assert.equal(
    formatDeckyGamePageAchievementBadgeLoadingText(
      {
        status: "loading",
        appId: "1672970",
      },
      {
        lastSummaryStatus: "loading",
        lastSummaryFetchStartedAt: "2026-07-07T00:00:00.000Z",
        lastRetroAchievementsResolutionSource: "rom-hash",
        lastRetroAchievementsRomHashAttempted: true,
      },
    ),
    "\u{1f3c6} Hashing ROM...",
  );
  assert.equal(
    formatDeckyGamePageAchievementBadgeLoadingText(
      {
        status: "loading",
        appId: "1672970",
      },
      {
        lastSummaryStatus: "loading",
        lastSummaryFetchStartedAt: "2026-07-07T00:00:00.000Z",
        lastRetroAchievementsResolutionSource: "ra-hash-game-detail",
      },
    ),
    "\u{1f3c6} RA lookup...",
  );
  assert.equal(
    formatDeckyGamePageAchievementBadgeLoadingText(
      {
        status: "loading",
        appId: "1672970",
      },
      {
        lastSummaryStatus: "loading",
        lastSummaryFetchStartedAt: "2026-07-07T00:00:00.000Z",
      },
    ),
    "\u{1f3c6} Loading...",
  );
  assert.equal(
    formatDeckyGamePageAchievementBadgeLoadingText(
      {
        status: "loading",
        appId: "1672970",
      },
      {
        lastSummaryStatus: "loading",
        lastSummaryFetchStartedAt: "2026-07-07T00:00:00.000Z",
        lastRetroAchievementsResolutionSource: "ra-hash-game-detail",
      },
    ),
    "\u{1f3c6} RA lookup...",
  );
  assert.equal(
    formatDeckyGamePageAchievementBadgeLabel({
      status: "ready",
      provider: "steam",
      appId: "1672970",
      earned: 12,
      total: 45,
      source: "cache",
    }),
    "\u{1f3c6} 12 / 45",
  );
  assert.equal(
    formatDeckyGamePageAchievementBadgeLabel({
      status: "unavailable",
      appId: "2217040867",
      reason: "rom-path-unavailable",
    }),
    undefined,
  );
  assert.equal(
    formatDeckyGamePageAchievementBadgeLabel({
      status: "error",
      appId: "1672970",
      message: "boom",
    }),
    undefined,
  );
});

test("game page achievement badge presentation follows the neon specification variants", () => {
  assert.deepStrictEqual(resolveDeckyGamePageAchievementBadgePresentation(undefined), {
    ariaLabel: "Achievement Companion, please wait",
    variant: "loading",
    statusLabel: "PLEASE WAIT...",
    countLabel: "-- / --",
    progress: 0.18,
  });

  assert.deepStrictEqual(
    resolveDeckyGamePageAchievementBadgePresentation({
      status: "loading",
      appId: "11",
      provider: "retroachievements",
    }),
    {
      ariaLabel: "Achievement Companion, please wait",
      provider: "retroachievements",
      variant: "loading",
      statusLabel: "PLEASE WAIT...",
      countLabel: "-- / --",
      progress: 0.18,
    },
  );

  assert.deepStrictEqual(
    resolveDeckyGamePageAchievementBadgePresentation({
      status: "ready",
      provider: "steam",
      appId: "10",
      earned: 42,
      total: 42,
      source: "cache",
    }),
    {
      ariaLabel: "Open Achievement Companion details for app 10, perfected, 42 / 42",
      provider: "steam",
      variant: "perfected",
      statusLabel: "PERFECTED",
      countLabel: "42 / 42",
      progress: 1,
    },
  );

  assert.deepStrictEqual(
    resolveDeckyGamePageAchievementBadgePresentation({
      status: "ready",
      provider: "retroachievements",
      appId: "11",
      earned: 12,
      total: 15,
      source: "cache",
      completionStatus: "beaten",
    }),
    {
      ariaLabel: "Open Achievement Companion details for app 11, beaten, 12 / 15",
      provider: "retroachievements",
      variant: "beaten",
      statusLabel: "BEATEN",
      countLabel: "12 / 15",
      progress: 0.8,
    },
  );

  assert.deepStrictEqual(
    resolveDeckyGamePageAchievementBadgePresentation({
      status: "ready",
      provider: "retroachievements",
      appId: "12",
      earned: 23,
      total: 23,
      source: "cache",
      completionStatus: "mastered",
    }),
    {
      ariaLabel: "Open Achievement Companion details for app 12, mastered, 23 / 23",
      provider: "retroachievements",
      variant: "mastered",
      statusLabel: "MASTERED",
      countLabel: "23 / 23",
      progress: 1,
    },
  );

  assert.deepStrictEqual(
    resolveDeckyGamePageAchievementBadgePresentation({
      status: "ready",
      provider: "retroachievements",
      appId: "12a",
      gameId: "9300",
      earned: 10,
      total: 10,
      source: "snapshot",
    }),
    {
      ariaLabel: "Achievement Companion, please wait",
      provider: "retroachievements",
      variant: "loading",
      statusLabel: "PLEASE WAIT...",
      countLabel: "-- / --",
      progress: 0.18,
    },
  );

  assert.deepStrictEqual(
    resolveDeckyGamePageAchievementBadgePresentation({
      status: "ready",
      provider: "retroachievements",
      appId: "12b",
      gameId: "9302",
      earned: 2,
      total: 8,
      source: "backend",
      completionStatus: "in-progress",
    }),
    {
      ariaLabel: "Open Achievement Companion details for app 12b, in progress, 2 / 8",
      provider: "retroachievements",
      variant: "in-progress",
      statusLabel: "IN PROGRESS",
      countLabel: "2 / 8",
      progress: 0.25,
    },
  );

  assert.deepStrictEqual(
    resolveDeckyGamePageAchievementBadgePresentation({
      status: "ready",
      provider: "steam",
      appId: "13",
      earned: 8,
      total: 20,
      source: "cache",
    }),
    {
      ariaLabel: "Open Achievement Companion details for app 13, in progress, 8 / 20",
      provider: "steam",
      variant: "in-progress",
      statusLabel: "IN PROGRESS",
      countLabel: "8 / 20",
      progress: 0.4,
    },
  );

  assert.equal(
    resolveDeckyGamePageAchievementBadgePresentation({
      status: "unavailable",
      appId: "14",
      reason: "no-achievements",
    }),
    undefined,
  );
});

test("native game-page summaries fail to loading when the route app identity changes", () => {
  const priorSummary = {
    status: "ready" as const,
    provider: "retroachievements" as const,
    appId: "11",
    gameId: "9300",
    earned: 12,
    total: 15,
    source: "cache" as const,
    completionStatus: "beaten" as const,
  };

  assert.equal(
    selectDeckyGamePageAchievementSummaryForAppId(priorSummary, undefined),
    undefined,
  );
  assert.equal(
    selectDeckyGamePageAchievementSummaryForAppId(priorSummary, "11"),
    priorSummary,
  );
  assert.deepStrictEqual(
    selectDeckyGamePageAchievementSummaryForAppId(priorSummary, "12"),
    {
      status: "loading",
      appId: "12",
    },
  );
});

test("game page achievement badge color preferences preserve defaults and recolor complete variants", () => {
  assert.equal(resolveDeckyGamePageAchievementBadgeColor("perfected"), "purple");
  assert.equal(resolveDeckyGamePageAchievementBadgeColor("mastered"), "gold");
  assert.equal(resolveDeckyGamePageAchievementBadgeColor("beaten"), "blue");
  assert.equal(resolveDeckyGamePageAchievementBadgeColor("in-progress"), "gray");
  assert.equal(
    resolveDeckyGamePageAchievementBadgeColor("loading", {
      perfected: "red",
      mastered: "red",
      beaten: "red",
      inProgress: "red",
    }),
    "gray",
  );

  assert.equal(
    resolveDeckyGamePageAchievementBadgePalette("perfected", {
      perfected: "gold",
      mastered: "green",
      beaten: "blue",
      inProgress: "gray",
    }).accent,
    "#ffc83d",
  );
});

test("game page achievement summary resolves Steam counts from the cached library scan summary first", async () => {
  await withMockDeckyStorage(async () => {
    clearDeckySteamLibraryAchievementScanSummary();
    writeDeckySteamLibraryAchievementScanSummary({
      scannedAt: "2026-06-29T12:00:00.000Z",
      ownedGameCount: 1,
      scannedGameCount: 1,
      gamesWithAchievements: 1,
      unlockedAchievements: 12,
      totalAchievements: 45,
      perfectGames: 0,
      completionPercent: 27,
      games: [
        {
          providerId: STEAM_PROVIDER_ID,
          appid: 1672970,
          gameId: "1672970",
          id: "1672970",
          title: "Minecraft Dungeons",
          unlockedAchievements: 12,
          totalAchievements: 45,
          completionPercent: 27,
          scanStatus: "scanned",
          hasAchievements: true,
        },
      ],
    } as SteamLibraryAchievementScanSummary);

    const summary = await loadDeckyGamePageAchievementSummary("1672970");
    assert.deepStrictEqual(summary, {
      status: "ready",
      provider: "steam",
      appId: "1672970",
      gameId: "1672970",
      title: "Minecraft Dungeons",
      earned: 12,
      total: 45,
      source: "cache",
      updatedAt: "2026-06-29T12:00:00.000Z",
    });
  });
});

test("game page achievement summary keeps Steam results when no shortcut metadata exists even if RetroAchievements data also exists", async () => {
  await withMockDeckyStorage(async () => {
    updateDeckyProviderConfigCache(RETROACHIEVEMENTS_PROVIDER_ID, {
      username: "alice",
      hasApiKey: true,
      recentAchievementsCount: 5,
      recentlyPlayedCount: 5,
    });
    assert.ok(
      writeDeckyDashboardSnapshot({
        ...createDashboardSnapshot(),
        profile: {
          ...createDashboardSnapshot().profile,
          providerId: RETROACHIEVEMENTS_PROVIDER_ID,
          identity: {
            providerId: RETROACHIEVEMENTS_PROVIDER_ID,
            accountId: "alice",
            displayName: "Alice",
          },
        },
        recentlyPlayedGames: [
          {
            providerId: RETROACHIEVEMENTS_PROVIDER_ID,
            gameId: "42",
            title: "Minecraft Dungeons",
            platformLabel: "Xbox",
            summary: {
              unlockedCount: 4,
              totalCount: 10,
            },
          },
        ],
        recentUnlocks: [],
        recentAchievements: [],
        featuredGames: [],
      }),
    );
    writeDeckySteamLibraryAchievementScanSummary({
      scannedAt: "2026-06-29T12:00:00.000Z",
      ownedGameCount: 1,
      scannedGameCount: 1,
      gamesWithAchievements: 1,
      unlockedAchievements: 12,
      totalAchievements: 45,
      perfectGames: 0,
      completionPercent: 27,
      games: [
        {
          providerId: STEAM_PROVIDER_ID,
          appid: 1672970,
          gameId: "1672970",
          id: "1672970",
          title: "Minecraft Dungeons",
          unlockedAchievements: 12,
          totalAchievements: 45,
          completionPercent: 27,
          scanStatus: "scanned",
          hasAchievements: true,
        },
      ],
    } as SteamLibraryAchievementScanSummary);

    const summary = await loadDeckyGamePageAchievementSummary("1672970");
    assert.deepStrictEqual(summary, {
      status: "ready",
      provider: "steam",
      appId: "1672970",
      gameId: "1672970",
      title: "Minecraft Dungeons",
      earned: 12,
      total: 45,
      source: "cache",
      updatedAt: "2026-06-29T12:00:00.000Z",
    });
  });
});

test("decky retroachievements platform labels normalize common SRM and canonical labels", () => {
  assert.equal(normalizeRetroAchievementsPlatformLabel("Nintendo Entertainment System"), "NES/Famicom");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Nintendo SNES (Super Nintendo)"), "SNES/Super Famicom");
  assert.equal(
    normalizeRetroAchievementsPlatformLabel("Nintendo SNES (Super Nintendo) HD - bsnes-hd"),
    "SNES/Super Famicom",
  );
  assert.equal(normalizeRetroAchievementsPlatformLabel("Nintendo SNES"), "SNES/Super Famicom");
  assert.equal(normalizeRetroAchievementsPlatformLabel("SFC"), "SNES/Super Famicom");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Nintendo NES (Nintendo Entertainment System)"), "NES/Famicom");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Nintendo NES"), "NES/Famicom");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Nintendo Game Boy"), "Game Boy");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Nintendo Game Boy Advance"), "Game Boy Advance");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Nintendo Game Boy Color"), "Game Boy Color");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Nintendo GameCube"), "GameCube");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Nintendo 64"), "Nintendo 64");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Nintendo DS"), "Nintendo DS");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Nintendo DS - melonDS (Standalone)"), "Nintendo DS");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Nintendo 3DS - Azahar (Standalone)"), "Nintendo 3DS");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Nintendo Virtual Boy"), "Virtual Boy");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Nintendo Wii"), "Wii");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Nintendo Wii U - Cemu Native"), "Wii U");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Sega CD/Mega CD"), "Sega CD");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Sega Game Gear"), "Game Gear");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Sega Genesis/Mega Drive"), "Genesis/Mega Drive");
  assert.equal(
    normalizeRetroAchievementsPlatformLabel("Sega Genesis/Mega Drive WideScreen"),
    "Genesis/Mega Drive",
  );
  assert.equal(normalizeRetroAchievementsPlatformLabel("Sega Master System"), "Master System");
  assert.equal(normalizeRetroAchievementsPlatformLabel("NEC PC Engine/TurboGrafx 16"), "PC Engine/TurboGrafx-16");
  assert.equal(
    normalizeRetroAchievementsPlatformLabel("NEC PC Engine/TurboGrafx 16 CD"),
    "PC Engine CD/TurboGrafx-CD",
  );
  assert.equal(normalizeRetroAchievementsPlatformLabel("Sony PlayStation 2"), "PlayStation 2");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Sony PlayStation"), "PlayStation");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Sega Dreamcast"), "Dreamcast");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Sony PlayStation Portable"), "PlayStation Portable");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Arcade"), "Arcade");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Arcade - FBNeo"), "Arcade");
  assert.equal(normalizeRetroAchievementsPlatformLabel("SNES/Super Famicom"), "SNES/Super Famicom");
  assert.equal(normalizeRetroAchievementsPlatformLabel("NES/Famicom"), "NES/Famicom");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Game Boy"), "Game Boy");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Game Boy Advance"), "Game Boy Advance");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Game Boy Color"), "Game Boy Color");
  assert.equal(normalizeRetroAchievementsPlatformLabel("GameCube"), "GameCube");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Genesis/Mega Drive"), "Genesis/Mega Drive");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Master System"), "Master System");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Virtual Boy"), "Virtual Boy");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Wii"), "Wii");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Wii U"), "Wii U");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Nintendo 3DS"), "Nintendo 3DS");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Nintendo DS"), "Nintendo DS");
  assert.equal(normalizeRetroAchievementsPlatformLabel("PC Engine/TurboGrafx-16"), "PC Engine/TurboGrafx-16");
  assert.equal(normalizeRetroAchievementsPlatformLabel("PC Engine CD/TurboGrafx-CD"), "PC Engine CD/TurboGrafx-CD");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Sega CD"), "Sega CD");
  assert.equal(normalizeRetroAchievementsPlatformLabel("Game Gear"), "Game Gear");
  assert.equal(normalizeRetroAchievementsPlatformLabel("PlayStation 2"), "PlayStation 2");
});

test("native RA completion status enrichment maps authoritative completed awards to mastered", async () => {
  await withMockDeckyStorage(async () => {
    resetDeckyAppServicesForTests();
    updateDeckyProviderConfigCache(RETROACHIEVEMENTS_PROVIDER_ID, {
      username: "alice",
      hasApiKey: true,
      recentAchievementsCount: 5,
      recentlyPlayedCount: 5,
    });
    deckyBackendTestState.retroAchievements.gameProgressByGameId = {
      "9200": createRetroAchievementsGameProgressResponse({
        gameId: "9200",
        title: "Homebrew Test",
        highestAwardKind: "completed",
        unlockedCount: 57,
        totalCount: 57,
      }),
    };
    const plainSummary = {
      status: "ready" as const,
      provider: "retroachievements" as const,
      appId: "2493414764",
      gameId: "9200",
      title: "Homebrew Test",
      earned: 57,
      total: 57,
      source: "snapshot" as const,
    };

    const enrichedSummary = await enrichDeckyGamePageAchievementSummaryCompletionStatus(plainSummary);
    assert.equal(enrichedSummary.status, "ready");
    if (enrichedSummary.status !== "ready") {
      return;
    }
    assert.equal(enrichedSummary.completionStatus, "mastered");
    assert.equal(deckyBackendTestState.retroAchievements.gameProgressRequestCount, 1);
  });
});

test("native RA completion status enrichment fails closed and never infers status from counts", async () => {
  await withMockDeckyStorage(async () => {
    resetDeckyAppServicesForTests();
    updateDeckyProviderConfigCache(RETROACHIEVEMENTS_PROVIDER_ID, {
      username: "alice",
      hasApiKey: true,
      recentAchievementsCount: 5,
      recentlyPlayedCount: 5,
    });
    deckyBackendTestState.retroAchievements.gameProgressByGameId = {
      "9300": createRetroAchievementsGameProgressResponse({
        gameId: "9300",
        title: "No Award State",
        unlockedCount: 10,
        totalCount: 10,
      }),
    };
    const fullCountsSummary = {
      status: "ready" as const,
      provider: "retroachievements" as const,
      appId: "2493414765",
      gameId: "9300",
      earned: 10,
      total: 10,
      source: "snapshot" as const,
    };

    const unavailableEnrichment = await enrichDeckyGamePageAchievementSummaryCompletionStatus(fullCountsSummary);
    assert.deepStrictEqual(unavailableEnrichment, {
      status: "unavailable",
      appId: fullCountsSummary.appId,
      reason: "ra-completion-status-unresolved",
    });
    assert.equal(
      getAchievementCompanionLastRaShortcutResolutionDebug()?.completionStatusEnrichmentStatus,
      "unavailable",
    );

    clearDeckyGamePageAchievementSummaryCacheForTests();
    const failedSummary = {
      ...fullCountsSummary,
      appId: "2493414766",
      gameId: "9301",
      earned: 2,
      total: 8,
    };
    const failedEnrichment = await enrichDeckyGamePageAchievementSummaryCompletionStatus(failedSummary);
    assert.deepStrictEqual(failedEnrichment, {
      status: "unavailable",
      appId: failedSummary.appId,
      reason: "ra-completion-status-unresolved",
    });
    assert.equal(
      getAchievementCompanionLastRaShortcutResolutionDebug()?.completionStatusEnrichmentStatus,
      "failed",
    );

    assert.deepStrictEqual(
      await enrichDeckyGamePageAchievementSummaryCompletionStatus({
        ...fullCountsSummary,
        appId: "2493414767",
        gameId: undefined,
      }),
      {
        status: "unavailable",
        appId: "2493414767",
        reason: "ra-completion-status-game-id-unavailable",
      },
    );

    deckyBackendTestState.retroAchievements.gameProgressByGameId = {
      "9302": createRetroAchievementsGameProgressResponse({
        gameId: "9302",
        title: "Still Playing",
        unlockedCount: 2,
        totalCount: 8,
      }),
    };
    const inProgressEnrichment = await enrichDeckyGamePageAchievementSummaryCompletionStatus({
      ...fullCountsSummary,
      appId: "2493414768",
      gameId: "9302",
      earned: 2,
      total: 8,
    });
    assert.equal(inProgressEnrichment.status, "ready");
    if (inProgressEnrichment.status === "ready") {
      assert.equal(inProgressEnrichment.completionStatus, "in-progress");
    }
  });
});

test("native completion status enrichment skips summaries that already have RA status or belong to Steam", async () => {
  await withMockDeckyStorage(async () => {
    const hashResolvedSummary = {
      status: "ready" as const,
      provider: "retroachievements" as const,
      appId: "2493414762",
      gameId: "9001",
      earned: 16,
      total: 33,
      source: "backend" as const,
      completionStatus: "beaten" as const,
    };
    const steamSummary = {
      status: "ready" as const,
      provider: "steam" as const,
      appId: "1672970",
      gameId: "1672970",
      earned: 12,
      total: 45,
      source: "cache" as const,
    };

    assert.strictEqual(
      await enrichDeckyGamePageAchievementSummaryCompletionStatus(hashResolvedSummary),
      hashResolvedSummary,
    );
    assert.strictEqual(
      await enrichDeckyGamePageAchievementSummaryCompletionStatus(steamSummary),
      steamSummary,
    );
    assert.equal(deckyBackendTestState.retroAchievements.gameProgressRequestCount ?? 0, 0);
  });
});

test("decky steam shortcut metadata loader preserves platform and path metadata", async () => {
  await withMockDeckyStorage(async () => {
    resetDeckyAppServicesForTests();
    deckyBackendTestState.steam.shortcutMetadataByAppId = {
      "2874315920": {
        title: "Final Fantasy X International",
        platformTag: "Sony PlayStation 2",
        tags: ["Sony PlayStation 2"],
        exe: '"/usr/bin/pcsx2"',
        startDir: "/home/deck/Emulation/roms/ps2",
      },
    };

    const metadata = await loadDeckySteamShortcutMetadata("2874315920");
    assert.deepStrictEqual(metadata, {
      appId: "2874315920",
      title: "Final Fantasy X International",
      platformTag: "Sony PlayStation 2",
      platformLabel: "Sony PlayStation 2",
      tags: ["Sony PlayStation 2"],
      exe: '"/usr/bin/pcsx2"',
      startDir: "/home/deck/Emulation/roms/ps2",
    });
  });
});

test("decky steam shortcut metadata loader accepts a missing display title", async () => {
  await withMockDeckyStorage(async () => {
    resetDeckyAppServicesForTests();
    deckyBackendTestState.steam.shortcutMetadataByAppId = {
      "2874315920": {
        platformTag: "Game Boy Advance",
        exe: '"/usr/bin/retroarch" "/home/deck/roms/game.gba"',
      },
    };

    const metadata = await loadDeckySteamShortcutMetadata("2874315920");
    assert.deepStrictEqual(metadata, {
      appId: "2874315920",
      platformTag: "Game Boy Advance",
      platformLabel: "Game Boy Advance",
      exe: '"/usr/bin/retroarch" "/home/deck/roms/game.gba"',
    });
  });
});

test("decky steam shortcut rom hash loader preserves sanitized hash metadata", async () => {
  await withMockDeckyStorage(async () => {
    resetDeckyAppServicesForTests();
    deckyBackendTestState.steam.shortcutRomHashByAppId = {
      "2874315920": {
        shortcutRomPathDetected: true,
        shortcutRomPathSource: "launchoptions",
        romHashAttempted: true,
        romHashStatus: "resolved",
        romHashAlgorithm: "rcheevos",
        romHash: "ABCDEF1234567890ABCDEF1234567890",
      },
    };

    const hashInfo = await loadDeckySteamShortcutRomHashInfo("2874315920", 18);
    assert.deepStrictEqual(hashInfo, {
      appId: "2874315920",
      shortcutRomPathDetected: true,
      shortcutRomPathSource: "launchoptions",
      romHashAttempted: true,
      romHashStatus: "resolved",
      romHashAlgorithm: "rcheevos",
      romHash: "abcdef1234567890abcdef1234567890",
    });
    assert.deepStrictEqual(deckyBackendTestState.steam.hashRequestedConsoleIds, [18]);
  });
});

test("game page achievement summary resolves a RetroAchievements shortcut from its accepted ROM hash", async () => {
  await withMockDeckyStorage(async () => {
    resetDeckyAppServicesForTests();
    updateDeckyProviderConfigCache(RETROACHIEVEMENTS_PROVIDER_ID, {
      username: "alice",
      hasApiKey: true,
      recentAchievementsCount: 5,
      recentlyPlayedCount: 5,
    });
    deckyBackendTestState.steam.shortcutMetadataByAppId = {
      "2493414762": {
        title: "My Zombie Game",
        platformTag: "Nintendo 64",
        platformLabel: "Nintendo 64",
        tags: ["Nintendo 64"],
      },
    };
    deckyBackendTestState.steam.shortcutRomHashByAppId = {
      "2493414762": {
        shortcutRomPathDetected: true,
        shortcutRomPathSource: "launchoptions",
        romHashAttempted: true,
        romHashStatus: "resolved",
        romHashAlgorithm: "rcheevos",
        romHash: "DEADBEEFDEADBEEFDEADBEEFDEADBEEF",
      },
    };
    deckyBackendTestState.retroAchievements.systems = [
      {
        ID: 2,
        Name: "Nintendo 64",
        IconURL: "https://example.com/n64.png",
      },
    ];
    deckyBackendTestState.retroAchievements.gameListByConsoleId = {
      "2": [
        {
          GameID: 9001,
          Title: "~Homebrew~ Pyoro 64",
          ConsoleID: 2,
          ConsoleName: "Nintendo 64",
          Hashes: ["deadbeefdeadbeefdeadbeefdeadbeef"],
        },
      ],
    };
    deckyBackendTestState.retroAchievements.gameProgressByGameId = {
      "9001": createRetroAchievementsGameProgressResponse({
        gameId: "9001",
        title: "~Homebrew~ Pyoro 64",
        consoleId: 2,
        consoleName: "Nintendo 64",
        highestAwardKind: "beaten",
        unlockedCount: 16,
        totalCount: 33,
      }),
    };

    const summary = await loadDeckyGamePageAchievementSummary("2493414762");
    assert.equal(summary.status, "ready");
    if (summary.status !== "ready") {
      return;
    }

    assert.equal(summary.provider, "retroachievements");
    assert.equal(summary.gameId, "9001");
    assert.equal(summary.title, "~Homebrew~ Pyoro 64");
    assert.equal(summary.earned, 16);
    assert.equal(summary.total, 33);
    assert.equal(summary.completionStatus, "beaten");
    assert.equal(summary.platformLabel, "Nintendo 64");
    assert.equal(summary.systemIconUrl, "https://example.com/n64.png");

    const badgeDebug = getAchievementCompanionLastGamePageBadgeDebug();
    const runtimeDebugState = getAchievementCompanionRuntimeDebugState();
    assert.equal(badgeDebug?.summaryCompletionStatus, "beaten");
    assert.equal(runtimeDebugState.lastRetroAchievementsShortcutAppId, "2493414762");
    assert.equal(runtimeDebugState.lastRetroAchievementsShortcutTitle, "My Zombie Game");
    assert.deepStrictEqual(deckyBackendTestState.steam.hashRequestedConsoleIds, [2]);
    assert.equal(runtimeDebugState.lastRetroAchievementsShortcutPlatform, "Nintendo 64");
    assert.equal(runtimeDebugState.lastRetroAchievementsNormalizedPlatform, "Nintendo 64");
    assert.equal(runtimeDebugState.lastRetroAchievementsHashResolverAttempted, true);
    assert.equal(runtimeDebugState.lastRetroAchievementsRomHashStatus, "resolved");
    assert.equal(runtimeDebugState.lastRetroAchievementsRaHashLookupAttempted, true);
    assert.equal(runtimeDebugState.lastRetroAchievementsRaHashLookupStatus, "matched");
    assert.equal(runtimeDebugState.lastRetroAchievementsRaHashMatchedGameId, "9001");
    assert.equal(runtimeDebugState.lastRetroAchievementsRaHashMatchedTitle, "~Homebrew~ Pyoro 64");
    assert.equal(runtimeDebugState.lastRetroAchievementsResolvedSystemName, "Nintendo 64");
    assert.equal(runtimeDebugState.lastRetroAchievementsResolvedConsoleId, "2");
    assert.equal(runtimeDebugState.lastRetroAchievementsFinalResolverSource, "hash");
    assert.equal(runtimeDebugState.lastRetroAchievementsResolutionSource, "ra-hash-game-detail");
    assert.equal(runtimeDebugState.lastRetroAchievementsResolutionReason, "ra-hash-match");
    assert.equal(runtimeDebugState.lastRetroAchievementsCandidateCount, 1);
  });
});

test("game page badge retries a transient RetroAchievements detail failure before hiding", async () => {
  await withMockDeckyStorage(async () => {
    resetDeckyAppServicesForTests();
    updateDeckyProviderConfigCache(RETROACHIEVEMENTS_PROVIDER_ID, {
      username: "alice", hasApiKey: true, recentAchievementsCount: 5, recentlyPlayedCount: 5,
    });
    const appId = "2493414799";
    const gameId = "9002";
    const romHash = "abcdefabcdefabcdefabcdefabcdefab";
    deckyBackendTestState.steam.shortcutMetadataByAppId = {
      [appId]: { title: "Retry Game", platformTag: "Nintendo 64", tags: ["Nintendo 64"] },
    };
    deckyBackendTestState.steam.shortcutRomHashByAppId = {
      [appId]: { shortcutRomPathDetected: true, romHashAttempted: true, romHashStatus: "resolved", romHashAlgorithm: "rcheevos", romHash },
    };
    deckyBackendTestState.retroAchievements.systems = [{ ID: 2, Name: "Nintendo 64" }];
    deckyBackendTestState.retroAchievements.gameListByConsoleId = {
      "2": [{ GameID: 9002, Title: "Retry Game", ConsoleID: 2, Hashes: [romHash] }],
    };
    const response = createRetroAchievementsGameProgressResponse({
      gameId, title: "Retry Game", consoleId: 2, consoleName: "Nintendo 64", unlockedCount: 1, totalCount: 3,
    });
    let failFirstRequest = true;
    deckyBackendTestState.retroAchievements.gameProgressByGameId = new Proxy({ [gameId]: response }, {
      get(target, key) {
        if (key === gameId && failFirstRequest) {
          failFirstRequest = false;
          throw new Error("Temporary RA detail failure");
        }
        return Reflect.get(target, key);
      },
    });

    const summary = await loadDeckyGamePageAchievementSummary(appId);
    assert.equal(summary.status, "ready");
    if (summary.status === "ready") {
      assert.equal(summary.gameId, gameId);
      assert.equal(summary.earned, 1);
      assert.equal(summary.total, 3);
    }
    assert.equal(deckyBackendTestState.retroAchievements.gameProgressRequestCount, 2);
  });
});

test("direct-ROM identity is invariant under four unrelated Steam shortcut names", async () => {
  await withMockDeckyStorage(async () => {
    resetDeckyAppServicesForTests();
    updateDeckyProviderConfigCache(RETROACHIEVEMENTS_PROVIDER_ID, {
      username: "alice", hasApiKey: true, recentAchievementsCount: 5, recentlyPlayedCount: 5,
    });
    const cases = [
      { appId: "240001", tag: "Nintendo Game Boy Advance", consoleId: 5, name: "Game Boy Advance", hash: "11111111111111111111111111111111", gameId: "5001" },
      { appId: "240002", tag: "Nintendo Game Boy Color", consoleId: 6, name: "Game Boy Color", hash: "11111111111111111111111111111111", gameId: "6001" },
      { appId: "240003", tag: "Sega Genesis/Mega Drive", consoleId: 1, name: "Genesis/Mega Drive", hash: "33333333333333333333333333333333", gameId: "1001" },
      { appId: "240004", tag: "Nintendo NES", consoleId: 7, name: "NES/Famicom", hash: "44444444444444444444444444444444", gameId: "7001" },
      { appId: "240005", tag: "Nintendo DS", consoleId: 18, name: "Nintendo DS", hash: "55555555555555555555555555555555", gameId: "18001" },
    ] as const;
    deckyBackendTestState.retroAchievements.systems = cases.map(({ consoleId, name }) => ({ ID: consoleId, Name: name }));
    deckyBackendTestState.retroAchievements.gameListByConsoleId = Object.fromEntries(cases.map(({ consoleId, name, hash, gameId }) => [String(consoleId), [
      { ID: Number(gameId), Title: `Catalogue ${gameId}`, ConsoleID: consoleId, ConsoleName: name, Hashes: [hash] },
    ]]));
    deckyBackendTestState.retroAchievements.gameProgressByGameId = Object.fromEntries(cases.map(({ consoleId, name, gameId }) => [gameId,
      createRetroAchievementsGameProgressResponse({ gameId, title: `Catalogue ${gameId}`, consoleId, consoleName: name, unlockedCount: 1, totalCount: 3 }),
    ]));
    for (const { appId, tag, consoleId, hash, gameId } of cases) {
      deckyBackendTestState.steam.shortcutRomHashByAppId ??= {};
      deckyBackendTestState.steam.shortcutRomHashByAppId[appId] = {
        shortcutRomPathDetected: true, shortcutRomPathSource: "exe", candidateCount: 1,
        candidateExtension: consoleId === 5 ? ".gba" : consoleId === 6 ? ".gbc" : consoleId === 1 ? ".md" : consoleId === 7 ? ".nes" : ".nds",
        romHashAttempted: true, romHashStatus: "resolved", romHashAlgorithm: "rcheevos", romHash: hash,
      };
      for (const title of ["Correct Game Name", "Wrong Name", "abcdef", "Completely Unrelated Title"]) {
        deckyBackendTestState.steam.shortcutMetadataByAppId ??= {};
        deckyBackendTestState.steam.shortcutMetadataByAppId[appId] = { title, platformTag: tag, tags: [tag] };
        invalidateDeckyGamePageAchievementSummaryCache(appId);
        const summary = await loadDeckyGamePageAchievementSummary(appId);
        assert.equal(summary.status, "ready", `${tag}: ${title}`);
        if (summary.status === "ready") assert.equal(summary.gameId, gameId);
        const debug = getAchievementCompanionLastRaShortcutResolutionDebug();
        assert.equal(debug.finalResolverSource, "hash");
        assert.equal(debug.finalResolutionMethod, "hash");
        assert.equal(debug.romCandidateCount, 1);
        assert.equal(debug.romHashAttempted, true);
        assert.equal(debug.romHashStatus, "resolved");
        assert.equal(debug.romHashPrefix, hash.slice(0, 12));
        assert.equal(debug.catalogueSource, "API_GetGameList");
        assert.equal(debug.raHashCatalogueMatchCount, 1);
        assert.equal(debug.apiSystemsResolvedConsoleId, String(consoleId));
      }
    }
    assert.deepStrictEqual(deckyBackendTestState.retroAchievements.gameListRequestedConsoleIds, ["5", "6", "1", "7", "18"]);
  });
});

test("RA catalogue merges multiple hashes per Game ID and normalizes hash casing", async () => {
  await withMockDeckyStorage(async () => {
    resetDeckyAppServicesForTests();
    updateDeckyProviderConfigCache(RETROACHIEVEMENTS_PROVIDER_ID, {
      username: "alice", hasApiKey: true, recentAchievementsCount: 5, recentlyPlayedCount: 5,
    });
    const firstApp = "250001";
    const secondApp = "250002";
    deckyBackendTestState.steam.shortcutMetadataByAppId = {
      [firstApp]: { title: "banana", platformTag: "Nintendo Game Boy Advance" },
      [secondApp]: { title: "different banana", platformTag: "Nintendo Game Boy Advance" },
    };
    deckyBackendTestState.steam.shortcutRomHashByAppId = {
      [firstApp]: { shortcutRomPathDetected: true, romHashAttempted: true, romHashStatus: "resolved", romHashAlgorithm: "rcheevos", romHash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
      [secondApp]: { shortcutRomPathDetected: true, romHashAttempted: true, romHashStatus: "resolved", romHashAlgorithm: "rcheevos", romHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    };
    deckyBackendTestState.retroAchievements.systems = [{ ID: 5, Name: "Game Boy Advance" }];
    deckyBackendTestState.retroAchievements.gameListByConsoleId = { "5": [
      { ID: 5001, Title: "Canonical catalogue name", ConsoleID: 5, Hashes: ["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"] },
      { ID: 5001, Title: "Canonical catalogue name", ConsoleID: 5, Hashes: ["BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"] },
    ] };
    deckyBackendTestState.retroAchievements.gameProgressByGameId = {
      "5001": createRetroAchievementsGameProgressResponse({ gameId: "5001", title: "Canonical catalogue name", consoleId: 5, consoleName: "Game Boy Advance", unlockedCount: 1, totalCount: 2 }),
    };
    const first = await loadDeckyGamePageAchievementSummary(firstApp);
    assert.equal(first.status, "ready");
    if (first.status === "ready") assert.equal(first.gameId, "5001");
    assert.equal(getAchievementCompanionLastRaShortcutResolutionDebug().catalogueCacheStatus, "fetched");
    const second = await loadDeckyGamePageAchievementSummary(secondApp);
    assert.equal(second.status, "ready");
    if (second.status === "ready") assert.equal(second.gameId, "5001");
    const debug = getAchievementCompanionLastRaShortcutResolutionDebug();
    assert.equal(debug.catalogueCacheStatus, "hit");
    assert.equal(debug.catalogueEntryCount, 1);
    assert.equal(debug.catalogueHashCount, 2);
    assert.equal(deckyBackendTestState.retroAchievements.gameListRequestCount, 1);
  });
});

test("incomplete RA catalogue responses are never cached as complete", async () => {
  await withMockDeckyStorage(async () => {
    resetDeckyAppServicesForTests();
    updateDeckyProviderConfigCache(RETROACHIEVEMENTS_PROVIDER_ID, {
      username: "alice", hasApiKey: true, recentAchievementsCount: 5, recentlyPlayedCount: 5,
    });
    const appId = "250003";
    deckyBackendTestState.steam.shortcutMetadataByAppId = { [appId]: { title: "unrelated", platformTag: "Nintendo Game Boy Advance" } };
    deckyBackendTestState.steam.shortcutRomHashByAppId = { [appId]: { shortcutRomPathDetected: true, romHashAttempted: true, romHashStatus: "resolved", romHashAlgorithm: "rcheevos", romHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } };
    deckyBackendTestState.retroAchievements.systems = [{ ID: 5, Name: "Game Boy Advance" }];
    deckyBackendTestState.retroAchievements.gameListByConsoleId = { "5": [
      { ID: 5001, Title: "Incomplete", ConsoleID: 5 },
    ] };
    const incomplete = await loadDeckyGamePageAchievementSummary(appId);
    assert.deepStrictEqual(incomplete, { status: "unavailable", appId, reason: "catalogue-incomplete" });
    assert.equal(getAchievementCompanionLastRaShortcutResolutionDebug().catalogueCacheStatus, "unavailable");
    deckyBackendTestState.retroAchievements.gameListByConsoleId = { "5": [
      { ID: 5001, Title: "Complete", ConsoleID: 5, Hashes: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] },
    ] };
    deckyBackendTestState.retroAchievements.gameProgressByGameId = {
      "5001": createRetroAchievementsGameProgressResponse({ gameId: "5001", title: "Complete", consoleId: 5, consoleName: "Game Boy Advance", unlockedCount: 1, totalCount: 2 }),
    };
    invalidateDeckyGamePageAchievementSummaryCache(appId);
    const recovered = await loadDeckyGamePageAchievementSummary(appId);
    assert.equal(recovered.status, "ready");
    assert.equal(deckyBackendTestState.retroAchievements.gameListRequestCount, 2);
  });
});

test("expired RA catalogue entries refresh before resolving a newly accepted hash", async () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    await withMockDeckyStorage(async () => {
      resetDeckyAppServicesForTests();
      updateDeckyProviderConfigCache(RETROACHIEVEMENTS_PROVIDER_ID, {
        username: "alice", hasApiKey: true, recentAchievementsCount: 5, recentlyPlayedCount: 5,
      });
      const appId = "250004";
      const firstHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const secondHash = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      deckyBackendTestState.steam.shortcutMetadataByAppId = { [appId]: { title: "Any name", platformTag: "Nintendo Game Boy Advance" } };
      deckyBackendTestState.steam.shortcutRomHashByAppId = { [appId]: {
        shortcutRomPathDetected: true, romHashAttempted: true, romHashStatus: "resolved", romHashAlgorithm: "rcheevos", romHash: firstHash,
      } };
      deckyBackendTestState.retroAchievements.systems = [{ ID: 5, Name: "Game Boy Advance" }];
      deckyBackendTestState.retroAchievements.gameListByConsoleId = { "5": [
        { ID: 5001, Title: "First", ConsoleID: 5, Hashes: [firstHash] },
      ] };
      deckyBackendTestState.retroAchievements.gameProgressByGameId = {
        "5001": createRetroAchievementsGameProgressResponse({ gameId: "5001", title: "First", consoleId: 5, consoleName: "Game Boy Advance", unlockedCount: 1, totalCount: 2 }),
        "5002": createRetroAchievementsGameProgressResponse({ gameId: "5002", title: "Second", consoleId: 5, consoleName: "Game Boy Advance", unlockedCount: 1, totalCount: 2 }),
      };
      assert.equal((await loadDeckyGamePageAchievementSummary(appId)).status, "ready");
      assert.equal(deckyBackendTestState.retroAchievements.gameListRequestCount, 1);

      deckyBackendTestState.steam.shortcutRomHashByAppId[appId] = {
        shortcutRomPathDetected: true, romHashAttempted: true, romHashStatus: "resolved", romHashAlgorithm: "rcheevos", romHash: secondHash,
      };
      deckyBackendTestState.retroAchievements.gameListByConsoleId = { "5": [
        { ID: 5002, Title: "Second", ConsoleID: 5, Hashes: [secondHash] },
      ] };
      now += 60 * 60 * 1000 + 1;
      invalidateDeckyGamePageAchievementSummaryCache(appId);
      const refreshed = await loadDeckyGamePageAchievementSummary(appId);
      assert.equal(refreshed.status, "ready");
      if (refreshed.status === "ready") assert.equal(refreshed.gameId, "5002");
      assert.equal(deckyBackendTestState.retroAchievements.gameListRequestCount, 2);
      assert.equal(getAchievementCompanionLastRaShortcutResolutionDebug().catalogueCacheStatus, "fetched");
    });
  } finally {
    Date.now = originalNow;
  }
});

test("game page mapping invalidation reloads a changed shortcut ROM hash", async () => {
  await withMockDeckyStorage(async () => {
    resetDeckyAppServicesForTests();
    updateDeckyProviderConfigCache(RETROACHIEVEMENTS_PROVIDER_ID, {
      username: "alice",
      hasApiKey: true,
      recentAchievementsCount: 5,
      recentlyPlayedCount: 5,
    });
    const changedAppId = "2493414799";
    deckyBackendTestState.steam.shortcutMetadataByAppId = {
      [changedAppId]: { title: "My ROM", platformTag: "Nintendo 64" },
    };
    deckyBackendTestState.steam.shortcutRomHashByAppId = {
      [changedAppId]: {
        shortcutRomPathDetected: true,
        romHashAttempted: true,
        romHashStatus: "resolved",
        romHashAlgorithm: "rcheevos",
        romHash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
    };
    deckyBackendTestState.retroAchievements.systems = [{ ID: 2, Name: "Nintendo 64" }];
    deckyBackendTestState.retroAchievements.gameListByConsoleId = {
      "2": [
        { GameID: 9001, Title: "First ROM", ConsoleID: 2, ConsoleName: "Nintendo 64", Hashes: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] },
        { GameID: 9002, Title: "Second ROM", ConsoleID: 2, ConsoleName: "Nintendo 64", Hashes: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"] },
      ],
    };
    deckyBackendTestState.retroAchievements.gameProgressByGameId = {
      "9001": createRetroAchievementsGameProgressResponse({
        gameId: "9001", title: "First ROM", consoleId: 2, consoleName: "Nintendo 64", unlockedCount: 1, totalCount: 3,
      }),
      "9002": createRetroAchievementsGameProgressResponse({
        gameId: "9002", title: "Second ROM", consoleId: 2, consoleName: "Nintendo 64", unlockedCount: 2, totalCount: 3,
      }),
    };

    const first = await loadDeckyGamePageAchievementSummary(changedAppId);
    assert.equal(first.status, "ready");
    if (first.status !== "ready") return;
    assert.equal(first.gameId, "9001");

    deckyBackendTestState.steam.shortcutRomHashByAppId = {
      [changedAppId]: {
        shortcutRomPathDetected: true,
        romHashAttempted: true,
        romHashStatus: "resolved",
        romHashAlgorithm: "rcheevos",
        romHash: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      },
    };
    invalidateDeckyGamePageAchievementSummaryCache(changedAppId);
    const second = await loadDeckyGamePageAchievementSummary(changedAppId);
    assert.equal(second.status, "ready");
    if (second.status !== "ready") return;
    assert.equal(second.gameId, "9002");
  });
});

test("game page achievement summary preserves mastered completion status for a hash-resolved RetroAchievements shortcut", async () => {
  await withMockDeckyStorage(async () => {
    resetDeckyAppServicesForTests();
    updateDeckyProviderConfigCache(RETROACHIEVEMENTS_PROVIDER_ID, {
      username: "alice",
      hasApiKey: true,
      recentAchievementsCount: 5,
      recentlyPlayedCount: 5,
    });
    deckyBackendTestState.steam.shortcutMetadataByAppId = {
      "2493414764": {
        title: "~Homebrew~ Minicraft PSP",
        platformTag: "Sony PlayStation Portable",
        platformLabel: "Sony PlayStation Portable",
        tags: ["Sony PlayStation Portable"],
      },
    };
    deckyBackendTestState.steam.shortcutRomHashByAppId = {
      "2493414764": {
        lastRetroAchievementsShortcutRomPathDetected: true,
        shortcutRomPathSource: "exe",
        lastRetroAchievementsRomHashAttempted: true,
        romHashStatus: "resolved",
        romHashAlgorithm: "rcheevos",
        romHash: "BADDCAFEBADDCAFEBADDCAFEBADDCAFE",
      },
    };
    deckyBackendTestState.retroAchievements.systems = [
      {
        ID: 41,
        Name: "PlayStation Portable",
        IconURL: "https://example.com/psp.png",
      },
    ];
    deckyBackendTestState.retroAchievements.gameListByConsoleId = {
      "41": [
        {
          GameID: 9200,
          Title: "~Homebrew~ Minicraft PSP",
          ConsoleID: 41,
          ConsoleName: "PlayStation Portable",
          Hashes: ["baddcafebaddcafebaddcafebaddcafe"],
        },
      ],
    };
    deckyBackendTestState.retroAchievements.gameProgressByGameId = {
      "9200": createRetroAchievementsGameProgressResponse({
        gameId: "9200",
        title: "~Homebrew~ Minicraft PSP",
        consoleId: 41,
        consoleName: "PlayStation Portable",
        highestAwardKind: "mastered",
        unlockedCount: 57,
        totalCount: 57,
        hardcoreUnlockedCount: 57,
      }),
    };

    const summary = await loadDeckyGamePageAchievementSummary("2493414764");
    assert.equal(summary.status, "ready");
    if (summary.status !== "ready") {
      return;
    }

    assert.equal(summary.provider, "retroachievements");
    assert.equal(summary.gameId, "9200");
    assert.equal(summary.title, "~Homebrew~ Minicraft PSP");
    assert.equal(summary.earned, 57);
    assert.equal(summary.total, 57);
    assert.equal(summary.completionStatus, "mastered");
    assert.equal(summary.platformLabel, "PlayStation Portable");
    assert.equal(summary.systemIconUrl, "https://example.com/psp.png");

    const badgeDebug = getAchievementCompanionLastGamePageBadgeDebug();
    const runtimeDebugState = getAchievementCompanionRuntimeDebugState();
    assert.equal(badgeDebug?.summaryCompletionStatus, "mastered");
    assert.equal(runtimeDebugState.lastRetroAchievementsFinalResolverSource, "hash");
    assert.equal(runtimeDebugState.lastRetroAchievementsResolutionSource, "ra-hash-game-detail");
  });
});

test("game page achievement summary rejects a valid hash without a matching game and never title-matches", async () => {
  await withMockDeckyStorage(async () => {
    resetDeckyAppServicesForTests();
    updateDeckyProviderConfigCache(RETROACHIEVEMENTS_PROVIDER_ID, {
      username: "alice",
      hasApiKey: true,
      recentAchievementsCount: 5,
      recentlyPlayedCount: 5,
    });
    deckyBackendTestState.steam.shortcutMetadataByAppId = {
      "2493414763": {
        title: "Pyoro64",
        platformTag: "Nintendo 64",
        platformLabel: "Nintendo 64",
        tags: ["Nintendo 64"],
      },
    };
    deckyBackendTestState.steam.shortcutRomHashByAppId = {
      "2493414763": {
        shortcutRomPathDetected: true,
        shortcutRomPathSource: "launchoptions",
        romHashAttempted: true,
        romHashStatus: "resolved",
        romHashAlgorithm: "rcheevos",
        romHash: "DEADBEEFDEADBEEFDEADBEEFDEADBEEF",
      },
    };
    deckyBackendTestState.retroAchievements.systems = [
      {
        ID: 2,
        Name: "Nintendo 64",
        IconURL: "https://example.com/n64.png",
      },
    ];
    deckyBackendTestState.retroAchievements.gameListByConsoleId = {
      "2": [
        {
          GameID: 9100,
          Title: "~Homebrew~ Pyoro 64",
          ConsoleID: 2,
          ConsoleName: "Nintendo 64",
          Hashes: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
        },
        {
          GameID: 9101,
          Title: "Pyoro64",
          ConsoleID: 2,
          ConsoleName: "Nintendo 64",
          Hashes: [],
        },
      ],
    };
    deckyBackendTestState.retroAchievements.gameProgressByGameId = {
      "9101": createRetroAchievementsGameProgressResponse({
        gameId: "9101",
        title: "Pyoro64",
        consoleId: 2,
        consoleName: "Nintendo 64",
        unlockedCount: 0,
        totalCount: 2,
      }),
    };

    const summary = await loadDeckyGamePageAchievementSummary("2493414763");
    assert.deepStrictEqual(summary, { status: "unavailable", appId: "2493414763", reason: "hash-not-in-ra-catalogue" });

    const runtimeDebugState = getAchievementCompanionRuntimeDebugState();
    assert.equal(runtimeDebugState.lastRetroAchievementsHashResolverAttempted, true);
    assert.equal(runtimeDebugState.lastRetroAchievementsRaHashLookupStatus, "no-match");
    assert.equal(runtimeDebugState.lastRetroAchievementsHashRejectedReason, "hash-not-in-ra-catalogue");
    assert.equal(runtimeDebugState.lastRetroAchievementsFinalResolverSource, "unavailable");
    assert.equal(runtimeDebugState.lastRetroAchievementsResolutionReason, "hash-not-in-ra-catalogue");
  });
});

test("game page achievement summary rejects an ambiguous accepted RA hash", async () => {
  await withMockDeckyStorage(async () => {
    resetDeckyAppServicesForTests();
    updateDeckyProviderConfigCache(RETROACHIEVEMENTS_PROVIDER_ID, {
      username: "alice", hasApiKey: true, recentAchievementsCount: 5, recentlyPlayedCount: 5,
    });
    deckyBackendTestState.steam.shortcutMetadataByAppId = {
      "2493414798": { title: "Completely unrelated", platformTag: "Nintendo DS" },
    };
    deckyBackendTestState.steam.shortcutRomHashByAppId = {
      "2493414798": {
        shortcutRomPathDetected: true,
        romHashAttempted: true,
        romHashStatus: "resolved",
        romHashAlgorithm: "rcheevos",
        romHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    };
    deckyBackendTestState.retroAchievements.systems = [{ ID: 18, Name: "Nintendo DS" }];
    deckyBackendTestState.retroAchievements.gameListByConsoleId = {
      "18": [
        { GameID: 9001, Title: "First", ConsoleID: 18, ConsoleName: "Nintendo DS", Hashes: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] },
        { GameID: 9002, Title: "Second", ConsoleID: 18, ConsoleName: "Nintendo DS", Hashes: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] },
      ],
    };

    const summary = await loadDeckyGamePageAchievementSummary("2493414798");
    assert.deepStrictEqual(summary, {
      status: "unavailable", appId: "2493414798", reason: "ambiguous-hash-match",
    });
    assert.equal(getAchievementCompanionRuntimeDebugState().lastRetroAchievementsRaHashLookupStatus, "ambiguous");
  });
});

test("game page achievement summary stops on distinct candidate hashes and exposes safe diagnostics", async () => {
  await withMockDeckyStorage(async () => {
    resetDeckyAppServicesForTests();
    updateDeckyProviderConfigCache(RETROACHIEVEMENTS_PROVIDER_ID, {
      username: "alice", hasApiKey: true, recentAchievementsCount: 5, recentlyPlayedCount: 5,
    });
    deckyBackendTestState.steam.shortcutMetadataByAppId = {
      "2493414800": { title: "Pyoro64", platformTag: "Favorites", tags: ["Favorites", "Nintendo 64"] },
    };
    deckyBackendTestState.steam.shortcutRomHashByAppId = {
      "2493414800": {
        shortcutRomPathDetected: true,
        shortcutRomPathSource: "launchoptions",
        candidateCount: 2,
        candidateExtension: ".zip",
        candidateResults: [
          { source: "launchoptions", extension: ".zip", status: "resolved", memberExtension: ".n64" },
          { source: "exe", extension: ".n64", status: "resolved" },
        ],
        romHashAttempted: true,
        romHashStatus: "ambiguous",
        hashResolverSkippedReason: "ambiguous-rom-hash-candidates",
      },
    };
    deckyBackendTestState.retroAchievements.systems = [{ ID: 2, Name: "Nintendo 64" }];
    const summary = await loadDeckyGamePageAchievementSummary("2493414800");
    assert.deepStrictEqual(summary, { status: "unavailable", appId: "2493414800", reason: "ambiguous-rom-hash-candidates" });
    assert.deepStrictEqual(deckyBackendTestState.steam.hashRequestedConsoleIds, [2]);
    const debug = getAchievementCompanionLastRaShortcutResolutionDebug();
    assert.equal(debug.normalizedPlatform, "Nintendo 64");
    assert.equal(debug.romCandidateCount, 2);
    assert.equal(debug.candidateExtension, ".zip");
    assert.equal(debug.romHashStatus, "ambiguous");
    assert.equal(debug.finalResolverSource, "unavailable");
  });
});

test("game page achievement summary reports missing console ID without title fallback", async () => {
  await withMockDeckyStorage(async () => {
    resetDeckyAppServicesForTests();
    updateDeckyProviderConfigCache(RETROACHIEVEMENTS_PROVIDER_ID, {
      username: "alice",
      hasApiKey: true,
      recentAchievementsCount: 5,
      recentlyPlayedCount: 5,
    });
    deckyBackendTestState.steam.shortcutMetadataByAppId = {
      "2874315922": {
        title: "Final Fantasy X International",
        platformTag: "Sony PlayStation Portable",
        tags: ["Sony PlayStation Portable"],
      },
    };
    deckyBackendTestState.retroAchievements.systems = [
      {
        ID: 7,
        Name: "PlayStation",
        IconURL: "https://example.com/ps1.png",
      },
      {
        ID: 21,
        Name: "PlayStation 2",
        IconURL: "https://example.com/ps2.png",
      },
    ];
    deckyBackendTestState.retroAchievements.gameListByConsoleId = {
      "21": [
        {
          GameID: 100,
          Title: "Final Fantasy X",
          ConsoleID: 21,
          ConsoleName: "PlayStation 2",
        },
      ],
    };

    const summary = await loadDeckyGamePageAchievementSummary("2874315922");
    assert.deepStrictEqual(summary, {
      status: "unavailable",
      appId: "2874315922",
      reason: "console-id-unavailable",
    });

    const runtimeDebugState = getAchievementCompanionRuntimeDebugState();
    assert.equal(runtimeDebugState.lastRetroAchievementsShortcutAppId, "2874315922");
    assert.equal(runtimeDebugState.lastRetroAchievementsMappingStatus, "unavailable");
    assert.equal(runtimeDebugState.lastRetroAchievementsMappingReason, "console-id-unavailable");
    assert.equal(runtimeDebugState.lastRetroAchievementsResolutionSource, "ra-hash-game-detail");
    assert.equal(runtimeDebugState.lastRetroAchievementsResolutionReason, "console-id-unavailable");
    assert.equal(runtimeDebugState.lastRetroAchievementsShortcutPlatform, "Sony PlayStation Portable");
    assert.equal(runtimeDebugState.lastRetroAchievementsNormalizedPlatform, "PlayStation Portable");
    assert.equal(runtimeDebugState.lastRetroAchievementsResolvedSystemName, undefined);
    assert.equal(runtimeDebugState.lastRetroAchievementsResolvedConsoleId, undefined);
    assert.equal(runtimeDebugState.lastRetroAchievementsCandidateCount, undefined);
  });
});















test("dashboard derives recently played games from recent unlocks when provider omits them", async () => {
  const { appServices, counts } = createHarness({
    providerFactory: (callCounts) => ({
      id: PROVIDER_ID,
      capabilities: PROVIDER_CAPABILITIES,
      async loadProfile() {
        callCounts.profile += 1;
        return DASHBOARD_REFRESH_PROFILE;
      },
      async loadRecentUnlocks() {
        callCounts.recentUnlocks += 1;
        return [
          createRecentUnlockForGame(
            "3215050",
            "Surviving Mars: Relaunched",
            1,
            1_700_000_000_900,
          ),
          createRecentUnlockForGame(
            "3215050",
            "Surviving Mars: Relaunched",
            2,
            1_700_000_000_800,
          ),
        ];
      },
      async loadRecentlyPlayedGames() {
        callCounts.recentlyPlayedGames += 1;
        return [];
      },
      async loadGameProgress() {
        callCounts.gameProgress += 1;
        return createGameDetailSnapshot();
      },
    }),
    providerConfig: {
      username: "alice",
      apiKey: "secret",
    },
  });

  const progressEvents: { stepId: string; status: string }[] = [];
  const state = await appServices.dashboard.loadDashboard(PROVIDER_ID, {
    forceRefresh: true,
    onProgress: (event) => progressEvents.push(event),
  });

  assert.equal(state.status, "success");
  assert.equal(state.error, undefined);
  assert.equal(state.data?.recentAchievements.length, 2);
  assert.equal(state.data?.recentlyPlayedGames.length, 1);
  assert.equal(state.data?.recentlyPlayedGames[0]?.title, "Surviving Mars: Relaunched");
  assert.equal(state.data?.recentlyPlayedGames[0]?.lastPlayedAt, undefined);
  assert.equal(counts.profile, 1);
  assert.equal(counts.recentUnlocks, 1);
  assert.equal(counts.recentlyPlayedGames, 1);
  for (const stepId of ["profile", "recent-achievements", "recent-games", "finalize"]) {
    assert.ok(progressEvents.some((event) => event.stepId === stepId && event.status === "in-progress"));
    assert.ok(progressEvents.some((event) => event.stepId === stepId && event.status === "complete"));
  }
});

test("core platform seam contracts are exported for future platform adapters", () => {
  const platformSource = readFileSync(new URL("../src/core/platform.ts", import.meta.url), "utf-8");

  assert.match(platformSource, /export interface DiagnosticLogger/u);
  assert.match(platformSource, /export interface ProviderConfigStore/u);
  assert.match(platformSource, /export interface AuthenticatedProviderTransportFactory/u);
  assert.match(platformSource, /export interface DashboardSnapshotStore/u);
  assert.match(platformSource, /export interface SteamLibraryScanStore/u);
  assert.match(platformSource, /export interface PlatformCapabilities/u);
});

test("core and providers stay free of Decky implementation imports", () => {
  const coreSource = readSourceTree("src/core");
  const providersSource = readSourceTree("src/providers");

  for (const source of [coreSource, providersSource]) {
    assert.doesNotMatch(source, /\bfrom\s+["'][^"']*platform\/decky[^"']*["']/u);
    assert.doesNotMatch(source, /\bfrom\s+["']@decky\/[^"']+["']/u);
    assert.doesNotMatch(source, /decky-backend-bridge/u);
    assert.doesNotMatch(source, /callDeckyBackendMethod/u);
  }
});

test("decky authenticated transport helpers still route through backend methods", () => {
  const retroAchievementsTransportSource = readFileSync(
    new URL("../src/platform/decky/providers/retroachievements/backend-transport.ts", import.meta.url),
    "utf-8",
  );
  const steamTransportSource = readFileSync(
    new URL("../src/platform/decky/providers/steam/backend-transport.ts", import.meta.url),
    "utf-8",
  );

  assert.match(retroAchievementsTransportSource, /callDeckyBackendMethod<T>\("request_retroachievements_json"/u);
  assert.match(steamTransportSource, /callDeckyBackendMethod<T>\("request_steam_json"/u);
});

test("frontend-facing provider configs stay apiKey-free in their exported shapes", () => {
  const retroAchievementsConfigSource = readFileSync(
    new URL("../src/providers/retroachievements/config.ts", import.meta.url),
    "utf-8",
  );
  const steamConfigSource = readFileSync(
    new URL("../src/providers/steam/config.ts", import.meta.url),
    "utf-8",
  );

  const retroAchievementsInterfaceBlock = retroAchievementsConfigSource.slice(
    retroAchievementsConfigSource.indexOf("export interface RetroAchievementsProviderConfig {"),
    retroAchievementsConfigSource.indexOf("export const DEFAULT_RETROACHIEVEMENTS_PROVIDER_CONFIG:"),
  );
  const steamInterfaceBlock = steamConfigSource.slice(
    steamConfigSource.indexOf("export interface SteamProviderConfig {"),
    steamConfigSource.indexOf("export const DEFAULT_STEAM_PROVIDER_CONFIG:"),
  );

  assert.match(retroAchievementsInterfaceBlock, /readonly hasApiKey: boolean;/u);
  assert.doesNotMatch(retroAchievementsInterfaceBlock, /readonly apiKey:/u);
  assert.match(steamInterfaceBlock, /readonly hasApiKey: boolean;/u);
  assert.doesNotMatch(steamInterfaceBlock, /readonly apiKey:/u);
});

test("decky seam adapters satisfy the new core contracts", () => {
  const providerConfigStore: ProviderConfigStore<DeckyProviderConfigValue> = deckyProviderConfigStore;
  const dashboardSnapshotStore: DashboardSnapshotStore<DashboardSnapshot> = deckyDashboardSnapshotStore;
  const diagnosticLogger: DiagnosticLogger<DeckyDiagnosticEventPayload> = deckyDiagnosticLogger;
  const transportFactory: AuthenticatedProviderTransportFactory =
    deckyAuthenticatedProviderTransportFactory;
  const capabilities: PlatformCapabilities = deckyPlatformCapabilities;
  const steamLibraryScanStore: SteamLibraryScanStore<
    SteamLibraryAchievementScanOverview,
    SteamLibraryAchievementScanSummary
  > = deckySteamLibraryScanStore;

  assert.equal(typeof providerConfigStore.load, "function");
  assert.equal(typeof providerConfigStore.save, "function");
  assert.equal(typeof providerConfigStore.clear, "function");
  assert.equal(typeof dashboardSnapshotStore.read, "function");
  assert.equal(typeof dashboardSnapshotStore.write, "function");
  assert.equal(typeof dashboardSnapshotStore.clear, "function");
  assert.equal(typeof diagnosticLogger.record, "function");
  assert.equal(typeof transportFactory.create, "function");
  assert.equal(capabilities.supportsAuthenticatedProviderTransport, true);
  assert.equal(capabilities.supportsSteamLibraryScan, true);
  assert.equal(typeof steamLibraryScanStore.readOverview, "function");
  assert.equal(typeof steamLibraryScanStore.writeSummary, "function");
  assert.equal(typeof steamLibraryScanStore.clear, "function");
});
