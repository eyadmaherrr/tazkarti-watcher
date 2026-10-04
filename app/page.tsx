"use client";

import { useCallback, useEffect, useState } from "react";
import type { Match, MatchesResponse, WatchEvent, WatcherStatus } from "@/lib/types";
import { armAudio, isAudioArmed, startAlarm, stopAlarm } from "./alarm";

const KNOWN_IDS = "tw.knownIds";

const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

const fmtDay = (s: string) =>
  new Date(s).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const fmtTime = (s: string) => new Date(s).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const fmtClock = (s: string) =>
  new Date(s).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtStamp = (s: string) => `${fmtDay(s)} ${fmtClock(s)}`;
const initials = (name: string) =>
  name
    .replace(/[^\p{L}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";
const logoUrl = (file?: string | null) =>
  file ? `https://tazkarti.com/assets/images/imagesref/${file.toLowerCase()}` : null;

function Flag({ file, name }: { file?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const src = logoUrl(file);
  return (
    <div className="flag">
      {src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} /> : <span>{initials(name)}</span>}
    </div>
  );
}

const describe = (m: Match) => `${m.teamName1} vs ${m.teamName2} · ${fmtDay(m.kickOffTime)} ${fmtTime(m.kickOffTime)}`;

async function notify(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  // Same tag as server Web Push, so a push + local notification for one event collapse into one.
  const options: NotificationOptions = { body, icon: "/icon.svg", badge: "/icon.svg", tag: "tazkarti-watch", data: { url: "/" } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification(title, { ...options, requireInteraction: true } as NotificationOptions);
  } catch {}
  new Notification(title, options);
}

const b64ToBytes = (b64: string) => {
  const raw = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Subscribe this browser to server Web Push, so alerts arrive even with the tab closed. */
async function subscribePush(): Promise<boolean> {
  try {
    if (!("PushManager" in window) || Notification.permission !== "granted") return false;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { publicKey } = (await fetch("/api/push").then((r) => r.json())) as { publicKey: string };
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    }
    const res = await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "web", subscription: sub }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export default function Home() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [freshIds, setFreshIds] = useState<Set<number>>(new Set());
  const [lastModified, setLastModified] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [pushOn, setPushOn] = useState(false);
  const [status, setStatus] = useState<WatcherStatus | null>(null);
  const [streamUp, setStreamUp] = useState(false);
  const [events, setEvents] = useState<WatchEvent[]>([]);
  const [countdown, setCountdown] = useState(0);
  const [armed, setArmed] = useState(false);
  const [alarm, setAlarm] = useState<{ title: string; lines: string[] } | null>(null);

  const ring = useCallback((title: string, lines: string[]) => {
    setAlarm({ title, lines });
    startAlarm();
  }, []);

  const silence = () => {
    stopAlarm();
    setAlarm(null);
  };

  // Pull the server's current list and diff it against what *this browser* has already seen,
  // so you still get the alarm for matches that dropped while the page was closed.
  const sync = useCallback(
    async (fresh = false) => {
      if (fresh) setChecking(true);
      try {
        const res = await fetch(`/api/matches${fresh ? "?fresh=1" : ""}`, { cache: "no-store" });
        const text = await res.text();
        let data: MatchesResponse;
        try {
          data = JSON.parse(text) as MatchesResponse;
        } catch {
          throw new Error(`Server returned HTTP ${res.status}${text ? "" : " with an empty body"}`);
        }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setError(data.error ?? null);

        const known = store.get<number[] | null>(KNOWN_IDS, null);
        if (known !== null) {
          const knownSet = new Set(known);
          const added = data.matches.filter((m) => !knownSet.has(m.matchId));
          if (added.length) {
            const title =
              added.length === 1 ? "New match uploaded on Tazkarti" : `${added.length} new matches uploaded on Tazkarti`;
            notify(title, added.slice(0, 3).map(describe).join("\n"));
            ring(title, added.map(describe));
            setFreshIds((s) => new Set([...s, ...added.map((m) => m.matchId)]));
          }
        }
        store.set(KNOWN_IDS, Array.from(new Set([...(known ?? []), ...data.matches.map((m) => m.matchId)])));
        setMatches(data.matches);
        setLastModified(data.lastModified);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        if (fresh) setChecking(false);
      }
    },
    [ring],
  );

  // Initial setup
  useEffect(() => {
    const perm = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
    setPermission(perm);
    navigator.serviceWorker
      ?.register("/sw.js")
      .then(() => (perm === "granted" ? subscribePush().then(setPushOn) : undefined))
      .catch(() => {});
    fetch("/api/events?limit=30")
      .then((r) => r.json())
      .then((d: { events: WatchEvent[] }) => setEvents(d.events))
      .catch(() => {});
    sync();
  }, [sync]);

  // Live link to the server watcher. The server checks Tazkarti on its own schedule;
  // we just react to its `change` events (plus a slow fallback refresh in case the stream drops).
  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.onopen = () => setStreamUp(true);
    es.onerror = () => setStreamUp(false);
    es.addEventListener("status", (e) => {
      const s = JSON.parse((e as MessageEvent).data) as WatcherStatus;
      setStatus(s);
      setError(s.lastError);
    });
    es.addEventListener("change", (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as WatchEvent;
      setEvents((list) => [ev, ...list.filter((x) => x.id !== ev.id)].slice(0, 30));
      sync();
    });
    const fallback = setInterval(() => sync(), 60_000);
    return () => {
      es.close();
      clearInterval(fallback);
    };
  }, [sync]);

  // Countdown to the server's next check
  useEffect(() => {
    const t = setInterval(() => {
      const next = status?.nextCheckAt ? Date.parse(status.nextCheckAt) : 0;
      setCountdown(Math.max(0, Math.ceil((next - Date.now()) / 1000)));
    }, 500);
    return () => clearInterval(t);
  }, [status]);

  // Audio can only start after a user gesture, so arm it on the first click/key anywhere on the page.
  useEffect(() => {
    const arm = async () => {
      if (await armAudio()) {
        setArmed(true);
        window.removeEventListener("pointerdown", arm);
        window.removeEventListener("keydown", arm);
      }
    };
    window.addEventListener("pointerdown", arm);
    window.addEventListener("keydown", arm);
    setArmed(isAudioArmed());
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, []);

  // Keep the screen awake while armed, so the machine doesn't sleep through the night.
  useEffect(() => {
    if (!armed || !("wakeLock" in navigator)) return;
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
  }, [armed]);

  // Flash the tab title while the alarm is ringing.
  useEffect(() => {
    if (!alarm) return;
    let on = false;
    const t = setInterval(() => {
      on = !on;
      document.title = on ? "🚨 NEW MATCHES 🚨" : "⚠️ WAKE UP ⚠️";
    }, 500);
    return () => clearInterval(t);
  }, [alarm]);

  // Tab title badge
  useEffect(() => {
    if (alarm) return;
    document.title = freshIds.size ? `(${freshIds.size}) New matches · Tazkarti Watch` : "Tazkarti Watch";
  }, [freshIds, alarm]);

  const enableNotifications = async () => {
    if (typeof Notification === "undefined") return;
    const p = await Notification.requestPermission();
    setPermission(p);
    if (p !== "granted") return;
    const ok = await subscribePush();
    setPushOn(ok);
    notify("Notifications are on", ok ? "You'll get alerts even with this tab closed." : "You'll be alerted while this tab is open.");
  };

  const sorted = [...matches].sort((a, b) => +new Date(a.kickOffTime) - +new Date(b.kickOffTime));

  return (
    <>
      {alarm && (
        <div className="alarm" role="alertdialog" aria-modal="true" aria-labelledby="alarm-title">
          <div className="alarm-box">
            <div className="alarm-icon" aria-hidden>🚨</div>
            <h2 id="alarm-title">{alarm.title}</h2>
            <ul>
              {alarm.lines.slice(0, 5).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <button className="alarm-stop" onClick={silence} autoFocus>
              STOP
            </button>
            <a className="alarm-book" href="https://tazkarti.com/#/matches" target="_blank" rel="noreferrer" onClick={silence}>
              Stop &amp; open Tazkarti
            </a>
          </div>
        </div>
      )}
      <div className="bg" aria-hidden>
        <span className="glow g1" />
        <span className="glow g2" />
      </div>

      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="ticket-logo">
              tazkarti<i />
            </span>
            <span className="brand-tag">Watch</span>
          </div>
          <div className={`live ${error || !streamUp ? "down" : ""}`}>
            <i />
            {!streamUp ? "Reconnecting…" : error ? "Tazkarti unreachable" : checking ? "Checking…" : "Live"}
          </div>
        </div>
      </header>

      <main className="shell">
        <section className="hero">
          <h1>What&apos;s your next match?</h1>
          <p>We watch Tazkarti for you and ping you the moment new matches are uploaded.</p>
        </section>

        <section className="grid-top">
          <div className="glass tile green stats">
            <div className="stat">
              <span className="label">Matches on sale</span>
              <strong>{matches.length}</strong>
            </div>
            <div className="stat">
              <span className="label">Next check</span>
              <strong>{checking || !status ? "…" : `${countdown}s`}</strong>
            </div>
            <div className="stat">
              <span className="label">Last checked</span>
              <strong className="sm">{status?.lastChecked ? fmtClock(status.lastChecked) : "—"}</strong>
            </div>
            <div className="stat">
              <span className="label">Source updated</span>
              <strong className="sm">{lastModified ? `${fmtDay(lastModified)}, ${fmtTime(lastModified)}` : "—"}</strong>
            </div>
          </div>

          <div className="glass tile orange controls">
            {permission === "granted" ? (
              <div className="notif on">
                <b>Notifications on</b>
                <span>
                  {pushOn
                    ? "Push is set up — you'll get alerts even with this tab closed."
                    : "You'll be alerted while this tab is open."}
                </span>
              </div>
            ) : permission === "denied" ? (
              <div className="notif off">
                <b>Notifications blocked</b>
                <span>Allow them for this site in your browser&apos;s address-bar settings.</span>
              </div>
            ) : permission === "unsupported" ? (
              <div className="notif off">
                <b>Not supported</b>
                <span>This browser can&apos;t show notifications. In-page alerts still work.</span>
              </div>
            ) : (
              <button className="btn green" onClick={enableNotifications}>
                Enable notifications
              </button>
            )}

            <div className="server">
              <span className={`dot ${status?.running ? "ok" : ""}`} />
              <div>
                <b>Server watcher {status?.running ? "running 24/7" : "starting…"}</b>
                <span>
                  {status
                    ? `Checks Tazkarti every ${status.intervalSeconds}s · up since ${fmtStamp(status.startedAt)}`
                    : "Connecting…"}
                </span>
              </div>
            </div>

            <div className={`notif ${armed ? "on" : "off"}`}>
              <b>{armed ? "Alarm armed" : "Alarm not armed"}</b>
              <span>
                {armed
                  ? "A loud siren will ring until you press STOP. Keep volume up."
                  : "Click anywhere on the page once so the browser lets the alarm play."}
              </span>
            </div>

            <div className="row buttons">
              <button className="btn" onClick={() => sync(true)} disabled={checking}>
                Check now
              </button>
              <button
                className="btn"
                disabled={permission !== "granted"}
                onClick={() => notify("Test: new match uploaded", "Egypt vs Somewhere · this is just a test")}
              >
                Test alert
              </button>
              <button
                className="btn alarm-test"
                onClick={async () => {
                  setArmed(await armAudio());
                  ring("Test alarm", ["This is what you'll hear when new matches drop."]);
                }}
              >
                Test alarm
              </button>
            </div>
          </div>
        </section>

        {error && (
          <div className="glass banner">
            Couldn&apos;t reach Tazkarti: {error}. The server keeps retrying
            {matches.length ? " — showing the last list it got." : "."}
          </div>
        )}

        <section>
          <div className="section-head">
            <h2>Matches</h2>
            {freshIds.size > 0 && (
              <button className="chip" onClick={() => setFreshIds(new Set())}>
                {freshIds.size} new · mark seen
              </button>
            )}
          </div>

          {sorted.length === 0 && !error && (
            <div className="glass empty">
              {checking ? "Loading matches…" : "No matches listed right now. We'll tell you when some appear."}
            </div>
          )}

          <div className="cards">
            {sorted.map((m) => (
              <article key={m.matchId} className={`glass match ${freshIds.has(m.matchId) ? "fresh" : ""}`}>
                {freshIds.has(m.matchId) && <em className="new-badge">NEW</em>}
                <div className="teams">
                  <div className="team">
                    <Flag file={m.team1Logo} name={m.teamName1} />
                    <div>
                      <b>{m.teamName1}</b>
                      {m.teamNameAr1 && <small dir="rtl">{m.teamNameAr1}</small>}
                    </div>
                  </div>
                  <span className="vs">vs</span>
                  <div className="team right">
                    <div>
                      <b>{m.teamName2}</b>
                      {m.teamNameAr2 && <small dir="rtl">{m.teamNameAr2}</small>}
                    </div>
                    <Flag file={m.team2Logo} name={m.teamName2} />
                  </div>
                </div>

                <div className="facts">
                  <div className="fact">
                    <svg viewBox="0 0 24 24" aria-hidden>
                      <path d="M3 21V9l3-2V4h2v2h2V4h4v2h2V4h2v3l3 2v12h-7v-5h-4v5H3Zm2-2h3v-5h8v5h3v-9l-2-1.3V9H7v-.3L5 10v9Z" />
                    </svg>
                    <div>
                      <b>{m.stadiumName}</b>
                      <span>{m.stadiumCityEn}</span>
                    </div>
                  </div>
                  <div className="fact">
                    <svg viewBox="0 0 24 24" aria-hidden>
                      <path d="M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3V2Zm12 8H5v9h14v-9ZM7 12h2v2H7v-2Zm4 0h2v2h-2v-2Zm4 0h2v2h-2v-2Z" />
                    </svg>
                    <div>
                      <b>{fmtDay(m.kickOffTime)}</b>
                      <span>
                        Kick-off {fmtTime(m.kickOffTime)}
                        {m.gatesOpenTime ? ` · Gates ${fmtTime(m.gatesOpenTime)}` : ""}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="meta">
                  <span>
                    <small>Tournament</small> {m.tournament?.nameEn?.replace(/\.$/, "") || "—"}
                  </span>
                  <span className="meta-right">
                    {m.matchNumber && (
                      <span>
                        <small>Match No.</small> {m.matchNumber}
                      </span>
                    )}
                    <span className={`status ${m.matchStatus === 1 ? "ok" : ""}`}>
                      <i />
                      {m.matchStatus === 1 ? "Available" : "Unavailable"}
                    </span>
                  </span>
                </div>

                <a className="book" href="https://tazkarti.com/#/matches" target="_blank" rel="noreferrer">
                  Book Ticket
                </a>
              </article>
            ))}
          </div>
        </section>

        <section className="glass tile activity">
          <h2>Activity</h2>
          {events.length === 0 ? (
            <p className="muted">No changes on Tazkarti since the server started watching.</p>
          ) : (
            <ul>
              {events.map((e) => (
                <li key={e.id} className={e.type === "new-matches" ? "new" : "update"}>
                  <time>{fmtStamp(e.at)}</time>
                  <span>{e.message}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="foot">
          Unofficial watcher, not affiliated with Tazkarti. Data and team flags come from tazkarti.com.
        </footer>
      </main>
    </>
  );
}
