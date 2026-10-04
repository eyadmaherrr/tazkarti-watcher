"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { armAudio, isAudioArmed, startAlarm, stopAlarm } from "./alarm";

type Match = {
  matchId: number;
  matchStatus: number;
  teamName1: string;
  teamName2: string;
  teamNameAr1?: string;
  teamNameAr2?: string;
  team1Logo?: string | null;
  team2Logo?: string | null;
  matchNumber?: string | null;
  stadiumName: string;
  stadiumCityEn?: string;
  kickOffTime: string;
  gatesOpenTime?: string;
  maxTicketsPerUser?: number;
  roundName?: string | null;
  teamGroupName?: string | null;
  tournament?: { nameEn?: string; nameAr?: string };
};

type ApiResponse = { matches: Match[]; hash: string; lastModified: string | null; fetchedAt: string; error?: string };
type LogEntry = { at: string; text: string; kind: "new" | "update" | "info" | "error" };

const KNOWN_IDS = "tw.knownIds";
const LAST_HASH = "tw.hash";
const INTERVAL = "tw.interval";
const INTERVALS = [15, 30, 60, 120, 300];

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
const fmtClock = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
  const options: NotificationOptions = { body, icon: "/icon.svg", badge: "/icon.svg", tag: "tazkarti-watch", data: { url: "/" } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification(title, { ...options, requireInteraction: true } as NotificationOptions);
  } catch {}
  new Notification(title, options);
}

export default function Home() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [freshIds, setFreshIds] = useState<Set<number>>(new Set());
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [lastModified, setLastModified] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interval, setIntervalSec] = useState(30);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [countdown, setCountdown] = useState(0);
  const nextAt = useRef(0);
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

  const addLog = useCallback((text: string, kind: LogEntry["kind"]) => {
    setLog((l) => [{ at: fmtClock(new Date()), text, kind }, ...l].slice(0, 30));
  }, []);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/matches", { cache: "no-store" });
      const data = (await res.json()) as ApiResponse;
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);

      const known = store.get<number[] | null>(KNOWN_IDS, null);
      const prevHash = store.get<string | null>(LAST_HASH, null);
      const ids = data.matches.map((m) => m.matchId);

      if (known === null) {
        addLog(`Watching started — ${ids.length} match${ids.length === 1 ? "" : "es"} on Tazkarti right now.`, "info");
      } else {
        const knownSet = new Set(known);
        const added = data.matches.filter((m) => !knownSet.has(m.matchId));
        if (added.length) {
          const title = added.length === 1 ? "New match uploaded on Tazkarti" : `${added.length} new matches uploaded on Tazkarti`;
          const body = added.slice(0, 3).map(describe).join("\n") + (added.length > 3 ? `\n+${added.length - 3} more` : "");
          notify(title, body);
          ring(title, added.map(describe));
          setFreshIds((s) => new Set([...s, ...added.map((m) => m.matchId)]));
          added.forEach((m) => addLog(`New: ${describe(m)}`, "new"));
        } else if (prevHash && prevHash !== data.hash) {
          notify("Tazkarti matches updated", "The matches list changed (details, times or removals).");
          addLog("Matches list changed — no new matches, but details were updated.", "update");
        }
      }

      store.set(KNOWN_IDS, Array.from(new Set([...(known ?? []), ...ids])));
      store.set(LAST_HASH, data.hash);
      setMatches(data.matches);
      setLastModified(data.lastModified);
      setError(null);
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      addLog(`Check failed: ${msg}`, "error");
    } finally {
      setLastChecked(new Date());
      setChecking(false);
    }
  }, [addLog, ring]);

  // Initial setup
  useEffect(() => {
    setIntervalSec(store.get(INTERVAL, 30));
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    navigator.serviceWorker?.register("/sw.js").catch(() => {});
  }, []);

  // Polling loop
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const run = async () => {
      await check();
      if (!alive) return;
      nextAt.current = Date.now() + interval * 1000;
      timer = setTimeout(run, interval * 1000);
    };
    run();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [interval, check]);

  // Countdown ticker
  useEffect(() => {
    const t = setInterval(() => setCountdown(Math.max(0, Math.ceil((nextAt.current - Date.now()) / 1000))), 500);
    return () => clearInterval(t);
  }, []);

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
    if (p === "granted") notify("Notifications are on", "You'll be alerted the moment new matches go up on Tazkarti.");
  };

  const changeInterval = (s: number) => {
    setIntervalSec(s);
    store.set(INTERVAL, s);
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
          <div className={`live ${error ? "down" : ""}`}>
            <i />
            {error ? "Connection issue" : checking ? "Checking…" : "Live"}
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
              <strong>{checking ? "…" : `${countdown}s`}</strong>
            </div>
            <div className="stat">
              <span className="label">Last checked</span>
              <strong className="sm">{lastChecked ? fmtClock(lastChecked) : "—"}</strong>
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
                <span>Keep this tab open — you&apos;ll be alerted when matches drop.</span>
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

            <div className="row">
              <label htmlFor="iv">Check every</label>
              <div className="seg" id="iv" role="radiogroup">
                {INTERVALS.map((s) => (
                  <button
                    key={s}
                    role="radio"
                    aria-checked={interval === s}
                    className={interval === s ? "active" : ""}
                    onClick={() => changeInterval(s)}
                  >
                    {s < 60 ? `${s}s` : `${s / 60}m`}
                  </button>
                ))}
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
              <button className="btn" onClick={check} disabled={checking}>
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

        {error && <div className="glass banner">Couldn&apos;t reach Tazkarti: {error}. Retrying automatically.</div>}

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
          {log.length === 0 ? (
            <p className="muted">Nothing yet.</p>
          ) : (
            <ul>
              {log.map((e, i) => (
                <li key={i} className={e.kind}>
                  <time>{e.at}</time>
                  <span>{e.text}</span>
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
