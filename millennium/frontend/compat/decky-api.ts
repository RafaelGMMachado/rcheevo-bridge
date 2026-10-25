// Millennium build alias for "@decky/api".
import {
  callable,
  definePlugin,
  EUIMode,
  routerHook as millenniumRouterHook,
  toaster,
  useQuickAccessVisible,
} from "@steambrew/client";

export { definePlugin, toaster, useQuickAccessVisible };

type RoutePatch = Parameters<typeof millenniumRouterHook.addPatch>[1];

// Decky patches the single gamepad router; Millennium keeps one router per UI mode, so the
// same patch is registered for desktop and Big Picture.
const UI_MODES = [EUIMode.Desktop, EUIMode.GamePad] as const;

export const routerHook = {
  addPatch(path: string, patch: RoutePatch): RoutePatch {
    for (const mode of UI_MODES) millenniumRouterHook.addPatch(path, patch, mode);
    return patch;
  },
  removePatch(path: string, patch: RoutePatch): void {
    for (const mode of UI_MODES) millenniumRouterHook.removePatch(path, patch, mode);
  },
  addRoute: millenniumRouterHook.addRoute.bind(millenniumRouterHook),
  removeRoute: millenniumRouterHook.removeRoute.bind(millenniumRouterHook),
};

export type RouterHook = typeof routerHook;

export const fetchNoCors = (input: string, init?: RequestInit): Promise<Response> => fetch(input, init);

// Millennium IPC only carries strings, numbers and booleans. Arguments travel as one JSON
// string and the Lua backend answers with JSON; {"__error": {...}} becomes a rejection, which
// is what Decky's call() does when the Python method raises.
const callables = new Map<string, (params: { payload: string }) => Promise<unknown>>();

interface BackendFailure {
  readonly message?: string;
  readonly category?: string;
  readonly statusCode?: number;
}

function toError(route: string, failure: BackendFailure): Error {
  return Object.assign(new Error(failure.message ?? `${route} failed`), {
    ...(failure.category !== undefined ? { category: failure.category } : {}),
    ...(failure.statusCode !== undefined ? { statusCode: failure.statusCode } : {}),
  });
}

async function invoke(route: string, arg: unknown): Promise<unknown> {
  let method = callables.get(route);
  if (method === undefined) {
    method = callable<[{ payload: string }], string>(route) as (params: { payload: string }) => Promise<unknown>;
    callables.set(route, method);
  }
  const raw = await method({ payload: JSON.stringify(arg ?? null) });
  const value = typeof raw === "string" && raw !== "" ? JSON.parse(raw) : raw;
  if (typeof value === "object" && value !== null && "__error" in value) {
    throw toError(route, (value as { __error: BackendFailure }).__error);
  }
  return value ?? undefined;
}

// The Lua backend handles one IPC call at a time and its HTTP client is synchronous, so the
// RetroAchievements requests a game page fires together (community stats, latest masters'
// profiles) are collected for a moment and sent as one batch the backend fetches in parallel.
const RA_REQUEST_ROUTE = "request_retroachievements_json";
const RA_BATCH_ROUTE = "request_retroachievements_json_batch";
const RA_BATCH_WINDOW_MS = 15;

interface QueuedRaRequest {
  readonly arg: unknown;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
}

type RaBatchEntry =
  | { readonly body?: string }
  | { readonly value: unknown }
  | { readonly error: BackendFailure };

let raQueue: QueuedRaRequest[] = [];
let raFlushTimer: ReturnType<typeof setTimeout> | undefined;

async function flushRaQueue(): Promise<void> {
  const queued = raQueue;
  raQueue = [];
  raFlushTimer = undefined;
  if (queued.length === 1) {
    const [only] = queued as [QueuedRaRequest];
    invoke(RA_REQUEST_ROUTE, only.arg).then(only.resolve, only.reject);
    return;
  }
  try {
    const entries = await invoke(RA_BATCH_ROUTE, { requests: queued.map((item) => item.arg) }) as readonly RaBatchEntry[];
    queued.forEach((item, index) => {
      const entry = entries[index];
      if (entry !== undefined && "error" in entry) item.reject(toError(RA_REQUEST_ROUTE, entry.error));
      else if (entry !== undefined && "value" in entry) item.resolve(entry.value);
      else {
        const body = entry?.body;
        item.resolve(typeof body === "string" && body !== "" ? JSON.parse(body) : undefined);
      }
    });
  } catch (error) {
    for (const item of queued) item.reject(error);
  }
}

function enqueueRaRequest(arg: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    raQueue.push({ arg, resolve, reject });
    raFlushTimer ??= setTimeout(() => void flushRaQueue(), RA_BATCH_WINDOW_MS);
  });
}

export async function call<Args extends unknown[] = [], Return = void>(
  route: string,
  ...args: Args
): Promise<Return> {
  const value = route === RA_REQUEST_ROUTE ? await enqueueRaRequest(args[0]) : await invoke(route, args[0]);
  return value as Return;
}
