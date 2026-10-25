// Millennium entry point. Wires RetroAchievements into Steam's native achievement views and the
// game page badge for non-Steam shortcuts; everything else stays Decky-only for now.
import { useEffect, useState } from "react";
import { ButtonItem, definePlugin, Field, PanelSection, PanelSectionRow, TextField, ToggleField } from "@steambrew/client";
import {
  ensureDeckyNativeSteamAchievementsRegistered,
  refreshDeckyNativeSteamAchievementsPage,
} from "@platform/decky/decky-native-steam-achievements";
import {
  applyDeckyNativeRetroAchievementsCommunityStats,
  setDeckyNativeRetroAchievementsProjectionPublishedListener,
} from "@platform/decky/decky-native-retroachievements-projection";
import {
  ensureDeckyGamePageAchievementRoutePatchRegistered,
  overrideDeckyGamePageAchievementBadgeActivation,
} from "@platform/decky/decky-game-page-achievement-bubble";
import {
  deckyGamePageAchievementBadgeShowsLoadedGames,
  setDeckyGamePageAchievementBadgeShowsLoadedGames,
  setDeckyGamePageAchievementBadgeUnavailableLabels,
  type DeckyGamePageAchievementBadgeUnavailableLabel,
} from "@platform/decky/decky-game-page-achievement-badge-presentation";
import {
  deferDeckyRetroAchievementsCommunityStats,
  loadDeferredDeckyRetroAchievementsCommunityStats,
} from "@platform/decky/decky-app-services";
import { readDeckyStorageText, writeDeckyStorageText } from "@platform/decky/storage";

// Off by default: once a game's achievements load, the native views show them and the badge
// only repeats them. The badge still shows while loading and for shortcuts without achievements.
const BADGE_SHOWS_LOADED_GAMES_STORAGE_KEY = "achievement-companion:millennium:badge-shows-loaded-games";

function readBadgeShowsLoadedGames(): boolean {
  return readDeckyStorageText(BADGE_SHOWS_LOADED_GAMES_STORAGE_KEY) === "true";
}

function BadgeSettings(): JSX.Element {
  const [showsLoadedGames, setShowsLoadedGames] = useState(deckyGamePageAchievementBadgeShowsLoadedGames());
  return (
    <PanelSection title="Selo na página do jogo">
      <PanelSectionRow>
        <ToggleField
          label="Mostrar selo em jogos já carregados"
          description="Quando desligado, o selo aparece só enquanto carrega e em jogos sem conquistas. Vale ao abrir a próxima página."
          checked={showsLoadedGames}
          onChange={(value: boolean) => {
            writeDeckyStorageText(BADGE_SHOWS_LOADED_GAMES_STORAGE_KEY, String(value));
            setDeckyGamePageAchievementBadgeShowsLoadedGames(value);
            setShowsLoadedGames(value);
          }}
        />
      </PanelSectionRow>
    </PanelSection>
  );
}
import {
  clearDeckyRetroAchievementsAccountState,
  loadDeckyProviderConfig,
  useDeckyProviderConfig,
  writeDeckyRetroAchievementsProviderConfig,
} from "@platform/decky/providers/retroachievements/config";
import { RETROACHIEVEMENTS_PROVIDER_ID } from "../../src/providers/retroachievements";
// The shared source lazy-loads these with import(); ttc emits a single IIFE, so they are pulled
// into the entry chunk here to keep rollup from code-splitting.
import { call } from "@decky/api";
import {
  prewarmDeckyRetroAchievementsShortcutMapping,
  RA_GAME_WITHOUT_ACHIEVEMENTS_REASON,
} from "@platform/decky/decky-game-page-achievement-summary";

// Badge text for shortcuts without RetroAchievements, by summary reason code. Codes not listed
// (network or credential problems) keep the badge hidden rather than claim the game has none.
const NOT_RECOGNIZED: DeckyGamePageAchievementBadgeUnavailableLabel = { title: "ROM", detail: "Não identificada" };
const UNAVAILABLE_BADGE_LABELS: Readonly<Record<string, DeckyGamePageAchievementBadgeUnavailableLabel>> = {
  "hash-not-in-ra-catalogue": { title: "SEM SUPORTE", detail: "Jogo fora do RA" },
  [RA_GAME_WITHOUT_ACHIEVEMENTS_REASON]: { title: "NO RA", detail: "Sem conquistas" },
  "ra-platform-unsupported": { title: "SEM SUPORTE", detail: "Console fora do RA" },
  "console-id-unavailable": { title: "SEM SUPORTE", detail: "Console fora do RA" },
  "rom-path-unavailable": { title: "ROM", detail: "Não encontrada" },
  "rom-file-unreadable": { title: "ROM", detail: "Não encontrada" },
  "rom-unreadable": { title: "ROM", detail: "Não encontrada" },
  "archive-unsupported-on-windows": { title: "ROM", detail: "ZIP não suportado" },
  "ambiguous-hash-match": NOT_RECOGNIZED,
  "ambiguous-rom-hash-candidates": NOT_RECOGNIZED,
  "too-many-game-path-candidates": NOT_RECOGNIZED,
  "invalid-file": NOT_RECOGNIZED,
  "unsupported-console": NOT_RECOGNIZED,
};

// Identifies every shortcut's RetroAchievements game in the background, well after Steam has
// settled, so the first visit to a game page does not wait for the console catalogue.
const PREWARM_DELAY_MS = 30_000;
const PREWARM_GAP_MS = 250;

async function prewarmShortcutMappings(isCancelled: () => boolean): Promise<void> {
  const config = await loadDeckyProviderConfig(RETROACHIEVEMENTS_PROVIDER_ID);
  if (config?.hasApiKey !== true) return;
  const appIds = await call<[], string[]>("list_steam_shortcut_app_ids");
  for (const appId of appIds ?? []) {
    if (isCancelled()) return;
    try {
      await prewarmDeckyRetroAchievementsShortcutMapping(appId);
    } catch (error) {
      console.warn("[Rcheevo Bridge] prewarm failed for shortcut", appId, error);
    }
    await new Promise((resolve) => setTimeout(resolve, PREWARM_GAP_MS));
  }
}

function RetroAchievementsSettings(): JSX.Element {
  const config = useDeckyProviderConfig(RETROACHIEVEMENTS_PROVIDER_ID);
  const [username, setUsername] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadDeckyProviderConfig(RETROACHIEVEMENTS_PROVIDER_ID);
  }, []);

  useEffect(() => {
    if (config?.username !== undefined) setUsername(config.username);
  }, [config?.username]);

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await writeDeckyRetroAchievementsProviderConfig({ username: username.trim() }, apiKey);
      setMessage(result.userMessage);
      if (result.saved) setApiKey("");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    setBusy(true);
    try {
      await clearDeckyRetroAchievementsAccountState();
      setUsername("");
      setApiKey("");
      setMessage("RetroAchievements account removed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PanelSection title="RetroAchievements">
      <PanelSectionRow>
        <Field label="Status">
          {config?.hasApiKey === true ? `Connected as ${config.username}` : "Not connected"}
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <TextField label="Username" value={username} onChange={(event) => setUsername(event.currentTarget.value)} />
      </PanelSectionRow>
      <PanelSectionRow>
        <TextField
          label="Web API key"
          description="retroachievements.org → Settings → Keys"
          bIsPassword
          value={apiKey}
          onChange={(event) => setApiKey(event.currentTarget.value)}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={busy} onClick={() => void save()}>Save</ButtonItem>
      </PanelSectionRow>
      {config?.hasApiKey === true && (
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={busy} onClick={() => void disconnect()}>Disconnect</ButtonItem>
        </PanelSectionRow>
      )}
      {message !== undefined && (
        <PanelSectionRow>
          <Field>{message}</Field>
        </PanelSectionRow>
      )}
    </PanelSection>
  );
}

function TrophyIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path
        fill="currentColor"
        d="M5 2h14v2h3v4a4 4 0 0 1-4 4h-.5A6 6 0 0 1 13 15.9V19h4v3H7v-3h4v-3.1A6 6 0 0 1 6.5 12H6a4 4 0 0 1-4-4V4h3V2zm0 4H4v2a2 2 0 0 0 1 1.7V6zm14 0v3.7A2 2 0 0 0 20 8V6h-1z"
      />
    </svg>
  );
}

// Millennium only lists a settings panel when title, icon and content are all set; its Plugin
// type does not declare title, so the object is widened instead of annotated.
const pluginTitle = { title: "Rcheevo Bridge" };

// Registration patches Steam internals; a failure there must leave the client usable.
function registerSafely(label: string, register: () => () => void): () => void {
  try {
    return register();
  } catch (error) {
    console.error(`[Rcheevo Bridge] ${label} registration failed`, error);
    return () => undefined;
  }
}

export default definePlugin(() => {
  // Show achievements as soon as they load; community stats fill the Community section later.
  // The backend serves one call at a time, so the stats requests start only once the
  // achievements are published; earlier they would queue ahead of the page's last calls.
  deferDeckyRetroAchievementsCommunityStats((gameId, stats) => {
    if (applyDeckyNativeRetroAchievementsCommunityStats(gameId, stats)) refreshDeckyNativeSteamAchievementsPage();
  });
  setDeckyNativeRetroAchievementsProjectionPublishedListener(loadDeferredDeckyRetroAchievementsCommunityStats);
  setDeckyGamePageAchievementBadgeShowsLoadedGames(readBadgeShowsLoadedGames());
  setDeckyGamePageAchievementBadgeUnavailableLabels((reason) => UNAVAILABLE_BADGE_LABELS[reason]);
  // The badge's default action opens Decky's full-screen views, which this build does not register.
  overrideDeckyGamePageAchievementBadgeActivation(() => undefined);

  const removeNativeSteamAchievements = registerSafely("native achievements", ensureDeckyNativeSteamAchievementsRegistered);
  const removeGamePageBadge = registerSafely("game page badge", ensureDeckyGamePageAchievementRoutePatchRegistered);
  let dismounted = false;
  const prewarmTimer = setTimeout(() => {
    void prewarmShortcutMappings(() => dismounted).catch((error) =>
      console.warn("[Rcheevo Bridge] shortcut prewarm stopped", error));
  }, PREWARM_DELAY_MS);
  return {
    ...pluginTitle,
    icon: <TrophyIcon />,
    content: (
      <>
        <RetroAchievementsSettings />
        <BadgeSettings />
      </>
    ),
    onDismount() {
      dismounted = true;
      clearTimeout(prewarmTimer);
      removeGamePageBadge();
      removeNativeSteamAchievements();
      deferDeckyRetroAchievementsCommunityStats(undefined);
      setDeckyNativeRetroAchievementsProjectionPublishedListener(undefined);
      setDeckyGamePageAchievementBadgeUnavailableLabels(undefined);
      overrideDeckyGamePageAchievementBadgeActivation(undefined);
    },
  };
});
