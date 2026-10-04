import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { broadcast, subscriberCounts } from "./push";
import { readJson, writeJson } from "./store";
import type { Match, MatchesResponse, WatchEvent, WatcherStatus } from "./types";

// Server-side watcher: polls Tazkarti around the clock, independent of any open browser tab,
// and fans out changes to push subscribers + live SSE listeners.

export const SOURCE = "https://tazkarti.com/data/matches-list-json.json";
export const INTERVAL_SECONDS = Math.max(10, Number(process.env.WATCH_INTERVAL_SECONDS) || 30);
const STATE_FILE = "state.json";
const MAX_EVENTS = 200;

type State = {
  knownIds: number[] | null;
  hash: string | null;
  matches: Match[];
  sourceLastModified: string | null;
  lastChecked: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  events: WatchEvent[];
};

type Watcher = {
  state: State;
  emitter: EventEmitter;
  startedAt: string;
  looping: boolean;
  timer: NodeJS.Timeout | null;
  nextCheckAt: number | null;
  inFlight: Promise<void> | null;
};

// Survive dev-mode hot reloads without starting a second loop.
const g = globalThis as unknown as { __tazkartiWatcher?: Watcher };

const fmt = (s: string) =>
  new Date(s).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const describe = (m: Match) => `${m.teamName1} vs ${m.teamName2} · ${fmt(m.kickOffTime)}`;

function watcher(): Watcher {
  if (!g.__tazkartiWatcher) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0); // one listener per open SSE connection
    g.__tazkartiWatcher = {
      state: readJson<State>(STATE_FILE, {
        knownIds: null,
        hash: null,
        matches: [],
        sourceLastModified: null,
        lastChecked: null,
        lastSuccess: null,
        lastError: null,
        events: [],
      }),
      emitter,
      startedAt: new Date().toISOString(),
      looping: false,
      timer: null,
      nextCheckAt: null,
      inFlight: null,
    };
  }
  return g.__tazkartiWatcher;
}

async function runCheck(w: Watcher) {
  const s = w.state;
  s.lastChecked = new Date().toISOString();
  try {
    const res = await fetch(SOURCE, {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 (TazkartiWatcher)", Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Tazkarti responded ${res.status}`);
    const body = await res.text();
    const matches = JSON.parse(body) as Match[];
    if (!Array.isArray(matches)) throw new Error("Unexpected response shape");
    const hash = createHash("sha1").update(body).digest("hex");

    let event: WatchEvent | null = null;
    if (s.knownIds !== null && hash !== s.hash) {
      const known = new Set(s.knownIds);
      const current = new Set(matches.map((m) => m.matchId));
      const added = matches.filter((m) => !known.has(m.matchId));
      const removedIds = s.matches.map((m) => m.matchId).filter((id) => !current.has(id));
      event = {
        id: randomUUID(),
        at: s.lastChecked,
        type: added.length ? "new-matches" : "updated",
        message: added.length
          ? `${added.length} new match${added.length === 1 ? "" : "es"}: ${added.map(describe).join("; ")}`
          : removedIds.length
            ? `${removedIds.length} match${removedIds.length === 1 ? "" : "es"} removed / list updated`
            : "Match details updated",
        matches: added,
        removedIds,
      };
    }

    s.knownIds = Array.from(new Set([...(s.knownIds ?? []), ...matches.map((m) => m.matchId)]));
    s.hash = hash;
    s.matches = matches;
    s.sourceLastModified = res.headers.get("last-modified");
    s.lastSuccess = s.lastChecked;
    s.lastError = null;

    if (event) {
      s.events = [event, ...s.events].slice(0, MAX_EVENTS);
      console.log(`[watcher] ${event.type}: ${event.message}`);
      w.emitter.emit("change", event);
      const isNew = event.type === "new-matches";
      broadcast({
        title: isNew
          ? event.matches.length === 1
            ? "New match uploaded on Tazkarti"
            : `${event.matches.length} new matches uploaded on Tazkarti`
          : "Tazkarti matches updated",
        body: isNew ? event.matches.slice(0, 3).map(describe).join("\n") : event.message,
        url: "/",
        data: { type: event.type, eventId: event.id, matchIds: event.matches.map((m) => m.matchId) },
      }).catch((e) => console.error("[watcher] broadcast failed:", e));
    }
  } catch (e) {
    s.lastError = (e as Error).message;
    console.error("[watcher] check failed:", s.lastError);
  } finally {
    // Schedule the next check *before* announcing this one, so listeners get a future nextCheckAt.
    // Any check (loop, manual, ?fresh=1) restarts the countdown.
    if (w.looping) {
      if (w.timer) clearTimeout(w.timer);
      w.nextCheckAt = Date.now() + INTERVAL_SECONDS * 1000;
      w.timer = setTimeout(() => void checkNow(), INTERVAL_SECONDS * 1000);
    }
    writeJson(STATE_FILE, s);
    w.emitter.emit("checked", getStatus());
  }
}

/** Run a check now (deduped if one is already in flight). */
export function checkNow(): Promise<void> {
  const w = watcher();
  w.inFlight ??= runCheck(w).finally(() => (w.inFlight = null));
  return w.inFlight;
}

/** Start the polling loop once per server process. Safe to call from anywhere. */
export function startWatcher() {
  const w = watcher();
  if (w.looping) return w;
  w.looping = true;
  w.nextCheckAt = Date.now();
  console.log(`[watcher] started — checking ${SOURCE} every ${INTERVAL_SECONDS}s`);
  void checkNow();
  return w;
}

export function onWatcher(event: "change", fn: (e: WatchEvent) => void): () => void;
export function onWatcher(event: "checked", fn: (s: WatcherStatus) => void): () => void;
export function onWatcher(event: string, fn: (payload: never) => void) {
  const { emitter } = watcher();
  const listener = fn as (...args: unknown[]) => void;
  emitter.on(event, listener);
  return () => emitter.off(event, listener);
}

export function getStatus(): WatcherStatus {
  const w = watcher();
  return {
    running: w.looping,
    intervalSeconds: INTERVAL_SECONDS,
    startedAt: w.startedAt,
    lastChecked: w.state.lastChecked,
    lastSuccess: w.state.lastSuccess,
    nextCheckAt: w.nextCheckAt ? new Date(w.nextCheckAt).toISOString() : null,
    lastError: w.state.lastError,
    sourceLastModified: w.state.sourceLastModified,
    matchCount: w.state.matches.length,
    subscribers: subscriberCounts(),
  };
}

export function getMatches(): MatchesResponse {
  const s = watcher().state;
  return {
    matches: s.matches,
    hash: s.hash,
    lastModified: s.sourceLastModified,
    fetchedAt: s.lastSuccess,
    ...(s.lastError ? { error: s.lastError } : {}),
  };
}

export function getEvents(since?: string | null, limit = 50): WatchEvent[] {
  const events = watcher().state.events;
  const t = since ? Date.parse(since) : NaN;
  return (Number.isNaN(t) ? events : events.filter((e) => Date.parse(e.at) > t)).slice(0, limit);
}
