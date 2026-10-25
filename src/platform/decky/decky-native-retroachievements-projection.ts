import type { ResourceState } from "@core/cache";
import type { GameCommunityStats, GameDetailSnapshot, NormalizedAchievement } from "@core/domain";
import type { RetroAchievementsAchievementMode } from "@core/settings";
import { RETROACHIEVEMENTS_PROVIDER_ID } from "../../providers/retroachievements";
import {
  invalidateDeckyGamePageAchievementSummaryCache,
  loadDeckyGamePageAchievementSummary,
  type GamePageAchievementSummary,
} from "./decky-game-page-achievement-summary";
import { projectRetroAchievementsFullScreenAchievements } from "./decky-retroachievements-full-screen-achievement-data";
import { getRetroAchievementsAvailabilityDate } from "./decky-native-retroachievements-community-model";
import {
  loadDeckySteamShortcutMetadata,
  type DeckySteamShortcutMetadata,
} from "./decky-steam-shortcut-metadata";

export interface NativeRetroAchievementsProjection {
  readonly status: "ready";
  readonly appId: string;
  readonly raGameId: string;
  readonly title: string;
  readonly boxArtImageUrl?: string;
  readonly platformLabel?: string;
  readonly releaseDate?: string;
  readonly releaseDateGranularity?: GameDetailSnapshot["game"]["releaseDateGranularity"];
  readonly developer?: string;
  readonly publisher?: string;
  readonly genre?: string;
  readonly mode: RetroAchievementsAchievementMode;
  readonly achievements: readonly NormalizedAchievement[];
  readonly earned: number;
  readonly total: number;
  readonly totalPlayers?: number;
  readonly communityStats?: GameCommunityStats;
  readonly achievementsAvailableSince?: string;
  readonly refreshedAt?: number;
}

export type NativeRetroAchievementsProjectionResult =
  | NativeRetroAchievementsProjection
  | {
      readonly status: "unavailable";
      readonly appId: string;
      readonly reason:
        | "not-shortcut"
        | "shortcut-metadata-error"
        | "unmapped"
        | "resolution-error"
        | "detail-unavailable"
        | "detail-error"
        | "invalid-detail"
        | "stale-request"
        | "disposed";
    };

export interface NativeRetroAchievementsProjectionDependencies {
  readonly loadShortcutMetadata: (appId: string) => Promise<DeckySteamShortcutMetadata | undefined>;
  readonly loadSummary: (appId: string) => Promise<GamePageAchievementSummary>;
  readonly loadDetail: (
    raGameId: string,
    options: { readonly forceRefresh: boolean },
  ) => Promise<ResourceState<GameDetailSnapshot>>;
  readonly invalidateSummary: (appId: string, options?: { readonly preserveVisible?: boolean }) => void;
  /** Called once a projection is published and can be shown. */
  readonly onPublished?: (projection: NativeRetroAchievementsProjection) => void;
}

export interface NativeRetroAchievementsProjectionLoader {
  load(
    appId: string,
    mode: RetroAchievementsAchievementMode,
    options?: { readonly forceRefresh?: boolean },
  ): Promise<NativeRetroAchievementsProjectionResult>;
  read(appId: string, mode: RetroAchievementsAchievementMode): NativeRetroAchievementsProjection | undefined;
  invalidate(appId?: string): void;
  dispose(): void;
  /** Adds late community stats to published projections of a game; true when one changed. */
  applyCommunityStats(raGameId: string, stats: GameCommunityStats): boolean;
}

// Community stats that arrived after their game detail (see deferDeckyRetroAchievementsCommunityStats).
// Projections built later from that cached detail still pick them up.
const lateCommunityStatsByGameId = new Map<string, GameCommunityStats>();

function unavailable(
  appId: string,
  reason: Extract<NativeRetroAchievementsProjectionResult, { status: "unavailable" }>["reason"],
): NativeRetroAchievementsProjectionResult {
  return { status: "unavailable", appId, reason };
}

function shortcutIdentity(metadata: DeckySteamShortcutMetadata): string {
  return JSON.stringify([
    metadata.appId,
    metadata.platformTag,
    metadata.platformLabel,
    metadata.tags,
    metadata.exe,
    metadata.startDir,
  ]);
}

function projectDetail(
  appId: string,
  raGameId: string,
  mode: RetroAchievementsAchievementMode,
  detail: GameDetailSnapshot,
): NativeRetroAchievementsProjectionResult {
  if (detail.game.providerId !== RETROACHIEVEMENTS_PROVIDER_ID || detail.game.gameId !== raGameId) {
    return unavailable(appId, "invalid-detail");
  }

  const achievements = projectRetroAchievementsFullScreenAchievements(detail, mode);
  if (achievements.length === 0) {
    return unavailable(appId, "invalid-detail");
  }

  const ids = new Set<string>();
  for (const achievement of achievements) {
    const id = achievement.achievementId.trim();
    if (
      id.length === 0 ||
      ids.has(id) ||
      achievement.providerId !== RETROACHIEVEMENTS_PROVIDER_ID ||
      achievement.gameId !== raGameId
    ) {
      return unavailable(appId, "invalid-detail");
    }
    ids.add(id);
  }

  const totalPlayersValue = detail.game.metrics.find((metric) => metric.key === "total-players")?.value;
  const parsedTotalPlayers = totalPlayersValue === undefined ? NaN : Number(totalPlayersValue);
  const totalPlayers = Number.isSafeInteger(parsedTotalPlayers) && parsedTotalPlayers > 0
    ? parsedTotalPlayers
    : undefined;
  const achievementsAvailableSince = getRetroAchievementsAvailabilityDate(detail.achievements);
  const metric = (key: string): string | undefined => {
    const value = detail.game.metrics.find((item) => item.key === key)?.value.trim();
    return value || undefined;
  };
  const releaseDate = metric("released");
  const developer = metric("developer");
  const publisher = metric("publisher");
  const genre = metric("genre");
  const communityStats = detail.game.communityStats ?? lateCommunityStatsByGameId.get(raGameId);

  return {
    status: "ready",
    appId,
    raGameId,
    title: detail.game.title,
    ...(detail.game.boxArtImageUrl ? { boxArtImageUrl: detail.game.boxArtImageUrl } : {}),
    ...(detail.game.platformLabel ? { platformLabel: detail.game.platformLabel } : {}),
    ...(releaseDate ? { releaseDate } : {}),
    ...(detail.game.releaseDateGranularity ? { releaseDateGranularity: detail.game.releaseDateGranularity } : {}),
    ...(developer ? { developer } : {}),
    ...(publisher ? { publisher } : {}),
    ...(genre ? { genre } : {}),
    mode,
    achievements,
    earned: achievements.filter((achievement) => achievement.isUnlocked).length,
    total: achievements.length,
    ...(totalPlayers !== undefined ? { totalPlayers } : {}),
    ...(communityStats !== undefined ? { communityStats } : {}),
    ...(achievementsAvailableSince !== undefined ? { achievementsAvailableSince } : {}),
    ...(detail.refreshedAt !== undefined ? { refreshedAt: detail.refreshedAt } : {}),
  };
}

/** Resolves one visible shortcut through the existing game-page mapping pipeline. */
export function createNativeRetroAchievementsProjectionLoader(
  dependencies: NativeRetroAchievementsProjectionDependencies,
): NativeRetroAchievementsProjectionLoader {
  const generations = new Map<string, number>();
  const modes = new Map<string, RetroAchievementsAchievementMode>();
  const identities = new Map<string, string>();
  const committed = new Map<string, NativeRetroAchievementsProjection>();
  const inFlight = new Map<string, Promise<NativeRetroAchievementsProjectionResult>>();
  const needsFreshDetail = new Set<string>();
  let disposed = false;

  function generation(appId: string): number {
    return generations.get(appId) ?? 0;
  }

  function invalidateOne(appId: string, invalidateMapping: boolean, preserveVisible = false): void {
    generations.set(appId, generation(appId) + 1);
    committed.delete(appId);
    inFlight.delete(appId);
    if (invalidateMapping) {
      needsFreshDetail.add(appId);
      dependencies.invalidateSummary(appId, preserveVisible ? { preserveVisible: true } : undefined);
    }
  }

  function isCurrent(appId: string, mode: RetroAchievementsAchievementMode, requestGeneration: number): boolean {
    return !disposed && generation(appId) === requestGeneration && modes.get(appId) === mode;
  }

  async function load(
    appId: string,
    mode: RetroAchievementsAchievementMode,
    options?: { readonly forceRefresh?: boolean },
  ): Promise<NativeRetroAchievementsProjectionResult> {
    if (disposed) {
      return unavailable(appId, "disposed");
    }

    if (modes.has(appId) && modes.get(appId) !== mode) {
      invalidateOne(appId, false);
    }
    modes.set(appId, mode);
    if (options?.forceRefresh === true) {
      invalidateOne(appId, true, true);
    }

    const existing = inFlight.get(appId);
    if (existing !== undefined) {
      return existing;
    }

    let requestGeneration = generation(appId);
    const request = (async (): Promise<NativeRetroAchievementsProjectionResult> => {
      let metadata: DeckySteamShortcutMetadata | undefined;
      try {
        metadata = await dependencies.loadShortcutMetadata(appId);
      } catch {
        invalidateOne(appId, false);
        return unavailable(appId, "shortcut-metadata-error");
      }
      if (!isCurrent(appId, mode, requestGeneration)) {
        return unavailable(appId, "stale-request");
      }
      if (metadata === undefined || metadata.appId !== appId) {
        invalidateOne(appId, true);
        identities.delete(appId);
        return unavailable(appId, "not-shortcut");
      }

      const identity = shortcutIdentity(metadata);
      if (!identities.has(appId) && options?.forceRefresh !== true) {
        // The badge's older appId-only cache cannot prove it belongs to this shortcut path.
        dependencies.invalidateSummary(appId);
      } else if (identities.has(appId) && identities.get(appId) !== identity) {
        invalidateOne(appId, true);
        requestGeneration = generation(appId);
      }
      identities.set(appId, identity);

      const cached = committed.get(appId);
      if (cached !== undefined && cached.mode === mode) {
        return cached;
      }

      let summary: GamePageAchievementSummary;
      try {
        summary = await dependencies.loadSummary(appId);
      } catch {
        return unavailable(appId, "resolution-error");
      }
      if (!isCurrent(appId, mode, requestGeneration)) {
        return unavailable(appId, "stale-request");
      }
      if (
        summary.status !== "ready" ||
        summary.provider !== "retroachievements" ||
        summary.appId !== appId ||
        summary.gameId === undefined ||
        summary.gameId.trim().length === 0
      ) {
        return unavailable(appId, "unmapped");
      }

      let detailState: ResourceState<GameDetailSnapshot>;
      try {
        detailState = await dependencies.loadDetail(summary.gameId, {
          forceRefresh: options?.forceRefresh === true || needsFreshDetail.has(appId),
        });
      } catch {
        return unavailable(appId, "detail-error");
      }
      if (!isCurrent(appId, mode, requestGeneration)) {
        return unavailable(appId, "stale-request");
      }
      if (detailState.status !== "success" || detailState.isStale || detailState.data === undefined) {
        return unavailable(appId, "detail-unavailable");
      }

      const result = projectDetail(appId, summary.gameId, mode, detailState.data);
      if (result.status !== "ready") {
        return result;
      }

      // A shortcut can be edited while its RA detail is loading. Recheck before publication.
      let currentMetadata: DeckySteamShortcutMetadata | undefined;
      try {
        currentMetadata = await dependencies.loadShortcutMetadata(appId);
      } catch {
        return unavailable(appId, "shortcut-metadata-error");
      }
      if (!isCurrent(appId, mode, requestGeneration)) {
        return unavailable(appId, "stale-request");
      }
      if (currentMetadata === undefined || currentMetadata.appId !== appId || shortcutIdentity(currentMetadata) !== identity) {
        invalidateOne(appId, true);
        identities.delete(appId);
        return unavailable(appId, "stale-request");
      }

      committed.set(appId, result);
      needsFreshDetail.delete(appId);
      dependencies.onPublished?.(result);
      if (options?.forceRefresh === true) {
        // Badge resolution may have read the previous detail while this request was loading.
        dependencies.invalidateSummary(appId, { preserveVisible: true });
      }
      return result;
    })();

    inFlight.set(appId, request);
    try {
      return await request;
    } finally {
      if (inFlight.get(appId) === request) {
        inFlight.delete(appId);
      }
    }
  }

  function read(appId: string, mode: RetroAchievementsAchievementMode): NativeRetroAchievementsProjection | undefined {
    const value = committed.get(appId);
    return !disposed && value?.mode === mode ? value : undefined;
  }

  function invalidate(appId?: string): void {
    if (appId !== undefined) {
      invalidateOne(appId, true);
      return;
    }
    const appIds = new Set([...generations.keys(), ...modes.keys(), ...identities.keys(), ...committed.keys(), ...inFlight.keys()]);
    for (const knownAppId of appIds) {
      invalidateOne(knownAppId, true);
    }
  }

  function dispose(): void {
    if (disposed) {
      return;
    }
    invalidate();
    disposed = true;
    modes.clear();
    identities.clear();
    needsFreshDetail.clear();
  }

  function applyCommunityStats(raGameId: string, stats: GameCommunityStats): boolean {
    let changed = false;
    for (const [appId, projection] of committed) {
      if (projection.raGameId !== raGameId || projection.communityStats === stats) continue;
      committed.set(appId, { ...projection, communityStats: stats });
      changed = true;
    }
    return changed;
  }

  return { load, read, invalidate, dispose, applyCommunityStats };
}

const RECENT_DETAIL_REUSE_MS = 15_000;

const deckyDependencies: NativeRetroAchievementsProjectionDependencies = {
  loadShortcutMetadata: loadDeckySteamShortcutMetadata,
  loadSummary: loadDeckyGamePageAchievementSummary,
  async loadDetail(raGameId, options) {
    const { loadDeckyGameDetailState } = await import("./decky-app-services");
    if (options.forceRefresh) {
      // A page visit forces a refresh, but resolving the shortcut moments earlier already
      // fetched this game's progress; reusing it spares a duplicate request on every visit.
      const cached = await loadDeckyGameDetailState(RETROACHIEVEMENTS_PROVIDER_ID, raGameId, { forceRefresh: false });
      if (
        cached.status === "success" &&
        !cached.isStale &&
        cached.lastUpdatedAt !== undefined &&
        Date.now() - cached.lastUpdatedAt < RECENT_DETAIL_REUSE_MS
      ) {
        return cached;
      }
    }
    return loadDeckyGameDetailState(RETROACHIEVEMENTS_PROVIDER_ID, raGameId, options);
  },
  invalidateSummary: invalidateDeckyGamePageAchievementSummaryCache,
  onPublished: (projection) => projectionPublishedListener?.(projection.raGameId),
};

let projectionPublishedListener: ((raGameId: string) => void) | undefined;

/** Notifies when a game's achievements are ready to show, e.g. to start deferred loads after them. */
export function setDeckyNativeRetroAchievementsProjectionPublishedListener(
  listener: ((raGameId: string) => void) | undefined,
): void {
  projectionPublishedListener = listener;
}

let deckyNativeRetroAchievementsProjectionLoader = createNativeRetroAchievementsProjectionLoader(deckyDependencies);

export function loadDeckyNativeRetroAchievementsProjection(
  appId: string,
  mode: RetroAchievementsAchievementMode,
  options?: { readonly forceRefresh?: boolean },
): Promise<NativeRetroAchievementsProjectionResult> {
  return deckyNativeRetroAchievementsProjectionLoader.load(appId, mode, options);
}

export function readDeckyNativeRetroAchievementsProjection(
  appId: string,
  mode: RetroAchievementsAchievementMode,
): NativeRetroAchievementsProjection | undefined {
  return deckyNativeRetroAchievementsProjectionLoader.read(appId, mode);
}

export function invalidateDeckyNativeRetroAchievementsProjection(appId?: string): void {
  deckyNativeRetroAchievementsProjectionLoader.invalidate(appId);
}

export function disposeDeckyNativeRetroAchievementsProjection(): void {
  deckyNativeRetroAchievementsProjectionLoader.dispose();
  deckyNativeRetroAchievementsProjectionLoader = createNativeRetroAchievementsProjectionLoader(deckyDependencies);
}

/** Records community stats that arrived after their game detail; true when a visible projection changed. */
export function applyDeckyNativeRetroAchievementsCommunityStats(raGameId: string, stats: GameCommunityStats): boolean {
  lateCommunityStatsByGameId.set(raGameId, stats);
  return deckyNativeRetroAchievementsProjectionLoader.applyCommunityStats(raGameId, stats);
}
