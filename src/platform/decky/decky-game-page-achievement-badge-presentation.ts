import type { GamePageAchievementSummary } from "./decky-game-page-achievement-summary";

export type DeckyGamePageAchievementBadgeVariant =
  | "perfected"
  | "beaten"
  | "mastered"
  | "in-progress"
  | "loading"
  /** A shortcut that resolved to no achievements (unsupported platform, unknown ROM, ...). */
  | "unavailable";

export type DeckyGamePageAchievementBadgeProvider = "steam" | "retroachievements";

export interface DeckyGamePageAchievementBadgePresentation {
  readonly ariaLabel: string;
  readonly provider?: DeckyGamePageAchievementBadgeProvider;
  readonly variant: DeckyGamePageAchievementBadgeVariant;
  /** Fixed English labels, or a platform-provided title for the unavailable variant. */
  readonly statusLabel: string;
  readonly countLabel: string;
  readonly progress: number;
}

export interface DeckyGamePageAchievementBadgeUnavailableLabel {
  /** First line, short and upper case to match the other badge states. */
  readonly title: string;
  /** Second line, in place of the achievement count. */
  readonly detail: string;
}

type UnavailableLabelResolver = (reason: string) => DeckyGamePageAchievementBadgeUnavailableLabel | undefined;
let unavailableLabelResolver: UnavailableLabelResolver | undefined;

/**
 * Lets a platform show the badge for unavailable summaries, labelled by reason code. Without a
 * resolver (Decky's default) those summaries keep hiding the badge.
 */
export function setDeckyGamePageAchievementBadgeUnavailableLabels(resolver: UnavailableLabelResolver | undefined): void {
  unavailableLabelResolver = resolver;
}

export function resolveDeckyGamePageAchievementBadgeUnavailableLabel(
  reason: string,
): DeckyGamePageAchievementBadgeUnavailableLabel | undefined {
  return unavailableLabelResolver?.(reason);
}

let showsLoadedGames = true;

/** Whether the badge stays visible once a game's achievements have loaded (Decky's default). */
export function setDeckyGamePageAchievementBadgeShowsLoadedGames(show: boolean): void {
  showsLoadedGames = show;
}

export function deckyGamePageAchievementBadgeShowsLoadedGames(): boolean {
  return showsLoadedGames;
}

function clampProgress(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function resolveDeckyGamePageAchievementBadgePresentation(
  summary: GamePageAchievementSummary | undefined,
): DeckyGamePageAchievementBadgePresentation | undefined {
  if (summary === undefined || summary.status === "loading") {
    return {
      ariaLabel: "Achievement Companion, please wait",
      ...(summary?.provider !== undefined ? { provider: summary.provider } : {}),
      variant: "loading",
      statusLabel: "PLEASE WAIT...",
      countLabel: "-- / --",
      progress: 0.18,
    };
  }

  if (summary.status === "unavailable") {
    const label = resolveDeckyGamePageAchievementBadgeUnavailableLabel(summary.reason);
    if (label === undefined) return undefined;
    return {
      ariaLabel: `Achievement Companion, ${label.title}, ${label.detail}`,
      provider: "retroachievements",
      variant: "unavailable",
      statusLabel: label.title,
      countLabel: label.detail,
      progress: 0,
    };
  }

  if (summary.status !== "ready" || !showsLoadedGames) {
    return undefined;
  }

  if (summary.provider === "retroachievements" && summary.completionStatus === undefined) {
    return {
      ariaLabel: "Achievement Companion, please wait",
      provider: "retroachievements",
      variant: "loading",
      statusLabel: "PLEASE WAIT...",
      countLabel: "-- / --",
      progress: 0.18,
    };
  }

  const provider = summary.provider;
  const progress = summary.total > 0 ? clampProgress(summary.earned / summary.total) : 0;
  const countLabel = `${String(summary.earned)} / ${String(summary.total)}`;

  if (provider === "steam" && summary.total > 0 && summary.earned >= summary.total) {
    return {
      ariaLabel: `Open Achievement Companion details for app ${summary.appId}, perfected, ${countLabel}`,
      provider,
      variant: "perfected",
      statusLabel: "PERFECTED",
      countLabel,
      progress: 1,
    };
  }

  if (provider === "retroachievements" && summary.completionStatus === "mastered") {
    return {
      ariaLabel: `Open Achievement Companion details for app ${summary.appId}, mastered, ${countLabel}`,
      provider,
      variant: "mastered",
      statusLabel: "MASTERED",
      countLabel,
      progress: 1,
    };
  }

  if (provider === "retroachievements" && summary.completionStatus === "beaten") {
    return {
      ariaLabel: `Open Achievement Companion details for app ${summary.appId}, beaten, ${countLabel}`,
      provider,
      variant: "beaten",
      statusLabel: "BEATEN",
      countLabel,
      progress,
    };
  }

  return {
    ariaLabel: `Open Achievement Companion details for app ${summary.appId}, in progress, ${countLabel}`,
    provider,
    variant: "in-progress",
    statusLabel: "IN PROGRESS",
    countLabel,
    progress,
  };
}
