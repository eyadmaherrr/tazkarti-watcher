"use client";

import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Match, MatchesResponse, Team, WatchEvent, WatcherStatus } from "@/lib/types";
import { armAudio, isAudioArmed, startAlarm, stopAlarm } from "../alarm";
import { ackAlarm, describe, getJson, Keys, notify, playsIn, store, subscribePush } from "./client";

// The website's state, mirroring the Expo app's src/lib/watch.tsx.

type Alarm = { title: string; lines: string[] };
export type Permission = NotificationPermission | "unsupported";

type WatchValue = {
  ready: boolean;
  matches: Match[];
  status: WatcherStatus | null;
  events: WatchEvent[];
  error: string | null;
  streamUp: boolean;
  checking: boolean;
  countdown: number | null;
  lastModified: string | null;
  freshIds: Set<number>;
  clearFresh: () => void;
  checkNow: () => Promise<void>;
  alarm: Alarm | null;
  ring: (a: Alarm) => void;
  silence: () => void;
  armed: boolean;
  arm: () => Promise<boolean>;
  alarmEnabled: boolean;
  setAlarmEnabled: (v: boolean) => void;
  keepAwake: boolean;
  setKeepAwake: (v: boolean) => void;
  checkEvery: number;
  setCheckEvery: (s: number) => void;
  permission: Permission;
  pushOn: boolean;
  enableNotifications: () => Promise<void>;
  onboarded: boolean;
  completeOnboarding: () => void;
  favorite: Team | null;
  setFavorite: (t: Team | null) => void;
};

const WatchContext = createContext<WatchValue | null>(null);

export function useWatch() {
  const ctx = use(WatchContext);
  if (!ctx) throw new Error("useWatch must be used inside <WatchProvider>");
  return ctx;
}

export const MIN_CHECK_SECONDS = 10;
export const MAX_CHECK_SECONDS = 3600;
const DEFAULT_CHECK_SECONDS = 30;
export const clampCheck = (n: number) =>
  Number.isFinite(n) ? Math.min(MAX_CHECK_SECONDS, Math.max(MIN_CHECK_SECONDS, Math.round(n))) : DEFAULT_CHECK_SECONDS;

export function WatchProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [status, setStatus] = useState<WatcherStatus | null>(null);
  const [events, setEvents] = useState<WatchEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [streamUp, setStreamUp] = useState(false);
  const [checking, setChecking] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [lastModified, setLastModified] = useState<string | null>(null);
  const [freshIds, setFreshIds] = useState<Set<number>>(new Set());
  const [alarm, setAlarm] = useState<Alarm | null>(null);
  const [armed, setArmed] = useState(false);
  const [alarmEnabled, setAlarmEnabledState] = useState(true);
  const [keepAwake, setKeepAwakeState] = useState(true);
  const [checkEvery, setCheckEveryState] = useState(DEFAULT_CHECK_SECONDS);
  const [permission, setPermission] = useState<Permission>("default");
  const [pushOn, setPushOn] = useState(false);
  const [onboarded, setOnboarded] = useState(true);
  const [favorite, setFavoriteState] = useState<Team | null>(null);

  const favoriteRef = useRef<Team | null>(null);
  const alarmEnabledRef = useRef(true);
  const nextAt = useRef(0);
  const syncQueue = useRef<Promise<void>>(Promise.resolve());
  const lastFetchedAt = useRef<string | null>(null);

  const ring = useCallback((a: Alarm) => {
    setAlarm(a);
    startAlarm();
  }, []);

  const silence = useCallback(() => {
    stopAlarm();
    setAlarm(null);
    void ackAlarm(); // stop the server's reminder pushes to this browser
  }, []);

  // Pull the server's list and diff it against what *this browser* has already seen, so matches that
  // dropped while the page was closed still ring the next time it opens. Every other change notifies too.
  const runSync = useCallback(
    async (fresh: boolean) => {
      try {
        const data = await getJson<MatchesResponse>(`/api/matches${fresh ? "?fresh=1" : ""}`);
        setError(data.error ?? null);
        if (lastFetchedAt.current === null) {
          const saved = store.get<string | null>(Keys.lastFetchedAt, null);
          // A saved time from the future (clock skew / another server) must not freeze updates.
          lastFetchedAt.current = saved && Date.parse(saved) <= Date.now() + 5 * 60_000 ? saved : "";
        }
        if (data.fetchedAt && lastFetchedAt.current && data.fetchedAt < lastFetchedAt.current) {
          // Older snapshot from another serverless instance: show it if we have nothing, never diff it.
          setMatches((prev) => (prev.length ? prev : data.matches));
          return;
        }
        const known = store.get<number[] | null>(Keys.knownIds, null);
        const prevHash = store.get<string | null>(Keys.lastHash, null);
        if (known !== null) {
          const knownSet = new Set(known);
          const added = data.matches.filter((m) => !knownSet.has(m.matchId));
          const fav = favoriteRef.current;
          if (added.length) {
            setFreshIds((s) => new Set([...s, ...added.map((m) => m.matchId)]));
            const favMatch = added.some((m) => playsIn(m, fav));
            const title = favMatch
              ? `${fav!.name} match on Tazkarti!`
              : added.length === 1
                ? "New match on Tazkarti"
                : `${added.length} new matches on Tazkarti`;
            const lines = [...added].sort((a, b) => Number(playsIn(b, fav)) - Number(playsIn(a, fav))).map(describe);
            notify(title, lines.slice(0, 3).join("\n"));
            if (alarmEnabledRef.current) ring({ title, lines });
          } else if (prevHash && data.hash && prevHash !== data.hash) {
            notify("Tazkarti matches updated", "The matches list changed — times, details or removals.");
          }
        }
        if (data.fetchedAt) lastFetchedAt.current = data.fetchedAt;
        store.set(Keys.knownIds, Array.from(new Set([...(known ?? []), ...data.matches.map((m) => m.matchId)])));
        if (data.hash) store.set(Keys.lastHash, data.hash);
        if (data.fetchedAt) store.set(Keys.lastFetchedAt, data.fetchedAt);
        setMatches(data.matches);
        setLastModified(data.lastModified);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [ring],
  );

  // One sync at a time, so overlapping triggers (timer, stream, button) can't double-alert.
  const sync = useCallback(
    (fresh = false) => {
      const run = syncQueue.current.then(() => runSync(fresh));
      syncQueue.current = run.catch(() => {});
      return run;
    },
    [runSync],
  );

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await getJson<WatcherStatus>("/api/status"));
    } catch {}
  }, []);

  const checkNow = useCallback(async () => {
    setChecking(true);
    nextAt.current = Date.now() + checkEvery * 1000;
    await sync(true);
    await loadStatus();
    setChecking(false);
  }, [sync, loadStatus, checkEvery]);

  // Saved settings first (synchronous localStorage), then the first sync — so a disabled alarm stays disabled.
  useEffect(() => {
    const fav = store.get<Team | null>(Keys.favoriteTeam, null);
    favoriteRef.current = fav;
    setFavoriteState(fav);
    const a = store.get(Keys.alarmEnabled, true);
    alarmEnabledRef.current = a;
    setAlarmEnabledState(a);
    setKeepAwakeState(store.get(Keys.keepAwake, true));
    setCheckEveryState(clampCheck(store.get(Keys.checkEvery, DEFAULT_CHECK_SECONDS)));
    setOnboarded(store.get(Keys.onboarded, false));
    const perm: Permission = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
    setPermission(perm);
    setArmed(isAudioArmed());
    setReady(true);
    navigator.serviceWorker
      ?.register("/sw.js")
      .then(() => (perm === "granted" ? subscribePush().then(setPushOn) : undefined))
      .catch(() => {});
    getJson<{ events: WatchEvent[] }>("/api/events?limit=50")
      .then((d) => setEvents(d.events))
      .catch(() => {});
    sync();
    loadStatus();
  }, [sync, loadStatus]);

  // Live link to the server watcher: status after each server check, `change` the moment the list changes.
  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.onopen = () => setStreamUp(true);
    es.onerror = () => setStreamUp(false);
    es.addEventListener("status", (e) => setStatus(JSON.parse((e as MessageEvent).data) as WatcherStatus));
    es.addEventListener("change", (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as WatchEvent;
      setEvents((list) => [ev, ...list.filter((x) => x.id !== ev.id)].slice(0, 50));
      sync();
    });
    return () => es.close();
  }, [sync]);

  // While the page is open it asks the server to check Tazkarti every `checkEvery` seconds (your choice in
  // Settings). With the page closed, the server's own loop + Web Push take over.
  useEffect(() => {
    nextAt.current = Date.now() + checkEvery * 1000;
    const t = setInterval(() => {
      const left = nextAt.current - Date.now();
      setCountdown(Math.max(0, Math.ceil(left / 1000)));
      if (left > 0) return;
      nextAt.current = Date.now() + checkEvery * 1000;
      sync(true).then(loadStatus);
    }, 500);
    return () => clearInterval(t);
  }, [checkEvery, sync, loadStatus]);

  // Browsers only allow sound after a gesture: arm on the first click/key anywhere.
  const arm = useCallback(async () => {
    const ok = await armAudio();
    setArmed(ok);
    return ok;
  }, []);

  useEffect(() => {
    if (armed) return;
    const onGesture = () => void arm();
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [armed, arm]);

  // "Always awake": hold a screen wake lock so the computer doesn't sleep through the alarm.
  useEffect(() => {
    if (!armed || !keepAwake || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {}
    };
    const onVisible = () => document.visibilityState === "visible" && acquire();
    acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch(() => {});
    };
  }, [armed, keepAwake]);

  // Tab title: flashes while ringing, otherwise a badge with the number of new matches.
  useEffect(() => {
    if (!alarm) {
      document.title = freshIds.size ? `(${freshIds.size}) New matches · Tazkarti Watch` : "Tazkarti Watch";
      return;
    }
    let on = false;
    const t = setInterval(() => {
      on = !on;
      document.title = on ? "🚨 NEW MATCHES 🚨" : "⚠️ WAKE UP ⚠️";
    }, 500);
    return () => clearInterval(t);
  }, [alarm, freshIds]);

  const enableNotifications = async () => {
    await arm(); // this click is a gesture, so it can unlock sound too
    if (typeof Notification === "undefined") return;
    const p = await Notification.requestPermission();
    setPermission(p);
    if (p !== "granted") return;
    const ok = await subscribePush();
    setPushOn(ok);
    notify("Notifications are on", ok ? "You'll get alerts even with this tab closed." : "You'll be alerted while this tab is open.");
  };

  return (
    <WatchContext
      value={{
        ready,
        matches,
        status,
        events,
        error,
        streamUp,
        checking,
        countdown,
        lastModified,
        freshIds,
        clearFresh: () => setFreshIds(new Set()),
        checkNow,
        alarm,
        ring,
        silence,
        armed,
        arm,
        alarmEnabled,
        setAlarmEnabled: (v) => {
          alarmEnabledRef.current = v;
          setAlarmEnabledState(v);
          store.set(Keys.alarmEnabled, v);
        },
        keepAwake,
        setKeepAwake: (v) => {
          setKeepAwakeState(v);
          store.set(Keys.keepAwake, v);
        },
        checkEvery,
        setCheckEvery: (s) => {
          const v = clampCheck(s);
          setCheckEveryState(v);
          store.set(Keys.checkEvery, v);
          nextAt.current = Date.now() + v * 1000;
        },
        permission,
        pushOn,
        enableNotifications,
        onboarded,
        completeOnboarding: () => {
          setOnboarded(true);
          store.set(Keys.onboarded, true);
        },
        favorite,
        setFavorite: (t) => {
          favoriteRef.current = t;
          setFavoriteState(t);
          store.set(Keys.favoriteTeam, t);
        },
      }}>
      {children}
    </WatchContext>
  );
}
