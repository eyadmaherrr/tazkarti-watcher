import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { broadcast, subscriberCounts } from "./push";
import { load, save, usingRedis, withLock } from "./store";
import type { Match, MatchesResponse, PendingAlert, WatchEvent, WatcherStatus } from "./types";

// Server-side watcher: checks Tazkarti around the clock, independent of any open browser tab,
// fans out changes to push subscribers + live SSE listeners, and keeps re-sending new-match alerts
// to each device until that device stops the alarm (POST /api/ack).
//
// Always-on hosts (Docker/VPS) run the loop below. Serverless hosts (Vercel) can't keep a loop alive,
// so something must call /api/check every minute (see README), and state lives in Redis.

export const SOURCE = "https://tazkarti.com/data/matches-list-json.json";
export const INTERVAL_SECONDS = Math.max(10, Number(process.env.WATCH_INTERVAL_SECONDS) || 30);
const REMIND_EVERY_SECONDS = Math.max(30, Number(process.env.REMIND_EVERY_SECONDS) || 60);
const REMIND_MAX = Math.max(0, Number(process.env.REMIND_MAX ?? 30));
const STATE_KEY = "state";
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
  pending: PendingAlert[];
};

const emptyState = (): State => ({
  knownIds: null,
  hash: null,
  matches: [],
  sourceLastModified: null,
  lastChecked: null,
  lastSuccess: null,
  lastError: null,
  events: [],
  pending: [],
});

type Watcher = {
  state: State;
  loaded: boolean;
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
      state: emptyState(),
      loaded: false,
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

/**
 * The current state. With Redis every call re-reads it, because another serverless instance may have
 * checked since; with files this process is the only writer, so memory is the source of truth.
 */
async function state(): Promise<State> {
  const w = watcher();
  if (usingRedis || !w.loaded) {
    w.state = { ...emptyState(), ...(await load<Partial<State>>(STATE_KEY, {})) };
    w.loaded = true;
  }
  return w.state;
}

async function runCheck(w: Watcher) {
  const ran = await withLock("check", 25_000, async () => {
    const s = await state();
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
        const title = isNew
          ? event.matches.length === 1
            ? "New match uploaded on Tazkarti"
            : `${event.matches.length} new matches uploaded on Tazkarti`
          : "Tazkarti matches updated";
        const body = isNew ? event.matches.slice(0, 3).map(describe).join("\n") : event.message;
        await broadcast({
          title,
          body,
          url: "/",
          data: { type: event.type, eventId: event.id, matchIds: event.matches.map((m) => m.matchId) },
        }).catch((e) => console.error("[watcher] broadcast failed:", e));
        // New matches keep nagging each device until it stops the alarm.
        if (isNew && REMIND_MAX > 0) {
          s.pending.push({ eventId: event.id, title, body, firstAt: s.lastChecked, lastSentAt: s.lastChecked, sends: 1, acked: [] });
        }
      }
    } catch (e) {
      s.lastError = (e as Error).message;
      console.error("[watcher] check failed:", s.lastError);
    }

    await remind(s);
    await save(STATE_KEY, s);
    return true;
  });

  // Schedule the next check *before* announcing this one, so listeners get a future nextCheckAt.
  if (w.looping) {
    if (w.timer) clearTimeout(w.timer);
    w.nextCheckAt = Date.now() + INTERVAL_SECONDS * 1000;
    w.timer = setTimeout(() => void checkNow(), INTERVAL_SECONDS * 1000);
  }
  if (ran) w.emitter.emit("checked", await getStatus());
}

/** Re-send unacknowledged new-match alerts to every device that hasn't stopped them yet. */
async function remind(s: State) {
  const now = Date.now();
  const keep: PendingAlert[] = [];
  for (const p of s.pending) {
    if (p.sends > REMIND_MAX) continue; // gave up
    if (now - Date.parse(p.lastSentAt) >= REMIND_EVERY_SECONDS * 1000) {
      const sent = await broadcast(
        {
          title: `⏰ ${p.title}`,
          body: `${p.body}\nStill not stopped — open Tazkarti Watch and press STOP.`,
          url: "/",
          data: { type: "reminder", eventId: p.eventId },
        },
        { exclude: new Set(p.acked) },
      ).catch(() => 0);
      if (sent === 0) continue; // everyone acknowledged (or nobody is subscribed) — done
      p.sends += 1;
      p.lastSentAt = new Date(now).toISOString();
      console.log(`[watcher] reminder ${p.sends - 1}/${REMIND_MAX} for ${p.eventId} → ${sent} device(s)`);
    }
    keep.push(p);
  }
  s.pending = keep;
}

/**
 * A device stopped the alarm: stop reminding it about every pending alert.
 * `recipient` is the Expo push token or the Web Push endpoint.
 */
export async function acknowledge(recipient: string): Promise<number> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const done = await withLock("check", 25_000, async () => {
      const s = await state();
      let n = 0;
      for (const p of s.pending) {
        if (!p.acked.includes(recipient)) {
          p.acked.push(recipient);
          n++;
        }
      }
      await save(STATE_KEY, s);
      return n;
    });
    if (done !== null) return done;
    await new Promise((r) => setTimeout(r, 500)); // a check is running; try again shortly
  }
  throw new Error("Busy, try again");
}

/** Run a check now (deduped within this process; across instances the Redis lock dedupes). */
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
  console.log(`[watcher] started — checking ${SOURCE} every ${INTERVAL_SECONDS}s${usingRedis ? " (state in Redis)" : ""}`);
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

export async function getStatus(): Promise<WatcherStatus> {
  const w = watcher();
  const s = await state();
  // On serverless the loop can't be trusted, so derive "next check" from the last one.
  const next = w.nextCheckAt ?? (s.lastChecked ? Date.parse(s.lastChecked) + INTERVAL_SECONDS * 1000 : null);
  return {
    running: w.looping,
    intervalSeconds: INTERVAL_SECONDS,
    startedAt: w.startedAt,
    lastChecked: s.lastChecked,
    lastSuccess: s.lastSuccess,
    nextCheckAt: next ? new Date(next).toISOString() : null,
    lastError: s.lastError,
    sourceLastModified: s.sourceLastModified,
    matchCount: s.matches.length,
    subscribers: await subscriberCounts(),
    pendingAlerts: s.pending.length,
    storage: usingRedis ? "redis" : "file",
  };
}

export async function getMatches(): Promise<MatchesResponse> {
  const s = await state();
  return {
    matches: s.matches,
    hash: s.hash,
    lastModified: s.sourceLastModified,
    fetchedAt: s.lastSuccess,
    ...(s.lastError ? { error: s.lastError } : {}),
  };
}

export async function getEvents(since?: string | null, limit = 50): Promise<WatchEvent[]> {
  const events = (await state()).events;
  const t = since ? Date.parse(since) : NaN;
  return (Number.isNaN(t) ? events : events.filter((e) => Date.parse(e.at) > t)).slice(0, limit);
}
