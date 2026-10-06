"use client";

import { useState, type ReactNode } from "react";
import { fmtClock, fmtDay, fmtSeconds, fmtStamp, fmtTime, playsIn, teamLogoUrls } from "../_lib/client";
import { MAX_CHECK_SECONDS, MIN_CHECK_SECONDS, useWatch } from "../_lib/watch";
import { FavoriteTeamCard, TeamPickerSheet } from "./favorite-team";
import { MatchCard } from "./match-card";
import { Label, TeamLogo } from "./ui";

function Hero({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="hero">
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="stat">
      <Label>{label}</Label>
      <strong className={small ? "sm" : ""}>{value}</strong>
    </div>
  );
}

export function MatchesTab() {
  const { matches, status, countdown, lastModified, error, checking, freshIds, clearFresh, favorite, ready } = useWatch();
  const sorted = [...matches].sort(
    (a, b) => Number(playsIn(b, favorite)) - Number(playsIn(a, favorite)) || +new Date(a.kickOffTime) - +new Date(b.kickOffTime),
  );

  return (
    <>
      <FavoriteTeamCard />
      <Hero title="What's your next match?" subtitle="We watch Tazkarti around the clock and ring the moment new matches are uploaded." />
      <section className="glass tint-green stats">
        <Stat label="On sale" value={String(matches.length)} />
        <Stat label="Next check" value={countdown == null || checking ? "…" : `${countdown}s`} />
        <Stat label="Last checked" value={status?.lastChecked ? fmtClock(status.lastChecked) : "—"} small />
        <Stat label="Source updated" value={lastModified ? `${fmtDay(lastModified)}, ${fmtTime(lastModified)}` : "—"} small />
      </section>

      {error && (
        <div className="glass tint-red banner">
          Couldn&apos;t reach Tazkarti: {error}. {matches.length ? "Showing the last list the server got." : "Retrying…"}
        </div>
      )}

      <div className="section-head">
        <h2>Matches</h2>
        {freshIds.size > 0 && (
          <button className="chip" onClick={clearFresh}>
            {freshIds.size} new · mark seen
          </button>
        )}
      </div>

      {!ready || (!matches.length && !error && !lastModified) ? (
        <div className="spinner" aria-label="Loading matches" />
      ) : sorted.length === 0 ? (
        <div className="glass empty">No matches listed right now. You&apos;ll hear the alarm when some appear.</div>
      ) : (
        <div className="cards">
          {sorted.map((m) => (
            <MatchCard key={m.matchId} match={m} fresh={freshIds.has(m.matchId)} mine={playsIn(m, favorite)} />
          ))}
        </div>
      )}
    </>
  );
}

export function ActivityTab() {
  const { events } = useWatch();
  return (
    <>
      <Hero title="Activity" subtitle="Every change the server has seen on Tazkarti." />
      {events.length === 0 ? (
        <div className="glass empty">No changes on Tazkarti since the server started watching.</div>
      ) : (
        <ul className="glass tint-dark activity">
          {events.map((e) => {
            const isNew = e.type === "new-matches";
            return (
              <li key={e.id} className={isNew ? "new" : "update"}>
                <span className={`pill ${isNew ? "pill-new" : "pill-upd"}`}>{isNew ? "NEW" : "UPDATE"}</span>
                <div>
                  <p>{e.message}</p>
                  <time>{fmtStamp(e.at)}</time>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function Card({ label, tint, children }: { label: string; tint?: string; children: ReactNode }) {
  return (
    <section className={`glass settings-card ${tint ? `tint-${tint}` : "tint-dark"}`}>
      <Label>{label}</Label>
      {children}
    </section>
  );
}

function Row({ title, detail, right }: { title: string; detail?: string; right?: ReactNode }) {
  return (
    <div className="row">
      <div className="row-text">
        <b>{title}</b>
        {detail && <span>{detail}</span>}
      </div>
      {right}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)}>
      <i />
    </button>
  );
}

const PRESETS = [10, 15, 30, 60, 120, 300];

export function SettingsTab() {
  const w = useWatch();
  const [picking, setPicking] = useState(false);
  const [custom, setCustom] = useState("");

  const applyCustom = () => {
    const n = Number(custom);
    if (custom.trim() && !Number.isNaN(n)) w.setCheckEvery(n);
    setCustom("");
  };

  return (
    <>
      <Hero title="Settings" />

      <Card label="Notifications" tint="green">
        <Row
          title={
            w.permission === "granted"
              ? w.pushOn
                ? "On — alerts even with this tab closed"
                : "On — while this tab is open"
              : w.permission === "denied"
                ? "Blocked"
                : w.permission === "unsupported"
                  ? "Not supported in this browser"
                  : "Off"
          }
          detail={
            w.permission === "denied"
              ? "Allow notifications for this site in your browser's address-bar settings."
              : "You're notified for every change to the matches list. New matches also ring the alarm."
          }
        />
        {w.permission === "default" && (
          <button className="btn green" onClick={w.enableNotifications}>
            Enable notifications
          </button>
        )}
      </Card>

      <Card label="Favourite team">
        <div className="row">
          {w.favorite && <TeamLogo sources={teamLogoUrls(w.favorite.icon)} name={w.favorite.name} size={44} />}
          <div className="row-text">
            <b>{w.favorite ? w.favorite.name : "None picked"}</b>
            <span>Shown at the top of Matches. You still get notified for every update, not just this team.</span>
          </div>
        </div>
        <button className="btn" onClick={() => setPicking(true)}>
          {w.favorite ? "Change team" : "Pick a team"}
        </button>
        <TeamPickerSheet open={picking} onClose={() => setPicking(false)} />
      </Card>

      <Card label="Next check">
        <Row
          title={`Check every ${fmtSeconds(w.checkEvery)}`}
          detail={`How often this page checks Tazkarti while it's open. With it closed, the server checks every ${w.status?.intervalSeconds ?? 30}s and pushes alerts.`}
        />
        <div className="chips" role="radiogroup" aria-label="Check interval">
          {PRESETS.map((p) => (
            <button key={p} role="radio" aria-checked={p === w.checkEvery} className={p === w.checkEvery ? "active" : ""} onClick={() => w.setCheckEvery(p)}>
              {fmtSeconds(p)}
            </button>
          ))}
        </div>
        <form
          className="custom-row"
          onSubmit={(e) => {
            e.preventDefault();
            applyCustom();
          }}>
          <input
            inputMode="numeric"
            value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
            placeholder={PRESETS.includes(w.checkEvery) ? "Custom seconds" : `${w.checkEvery} seconds`}
            aria-label={`Custom interval in seconds, ${MIN_CHECK_SECONDS} to ${MAX_CHECK_SECONDS}`}
            className={!PRESETS.includes(w.checkEvery) ? "active" : ""}
          />
          <button className="btn green" type="submit" disabled={!custom}>
            Set
          </button>
        </form>
        <span className="muted-sm">
          Between {MIN_CHECK_SECONDS} and {MAX_CHECK_SECONDS} seconds.
        </span>
      </Card>

      <Card label="Alarm" tint="orange">
        <Row
          title={w.armed ? "Wake-up alarm · armed" : "Wake-up alarm · click anywhere to arm"}
          detail="New matches set off a looping siren until you press STOP. Browsers only allow sound after you click the page once."
          right={<Toggle on={w.alarmEnabled} onChange={w.setAlarmEnabled} label="Wake-up alarm" />}
        />
        <Row
          title="Keep screen awake"
          detail="Stops the computer from sleeping while this tab is open — leave it on overnight."
          right={<Toggle on={w.keepAwake} onChange={w.setKeepAwake} label="Keep screen awake" />}
        />
        <button
          className="btn red"
          onClick={async () => {
            await w.arm();
            w.ring({ title: "Test alarm", lines: ["This is what you'll hear when new matches drop."] });
          }}>
          Test alarm
        </button>
      </Card>

      <Card label="Server">
        <Row
          title={w.status?.running ? "Watching Tazkarti 24/7" : "Connecting…"}
          detail={
            w.status
              ? `Checks every ${w.status.intervalSeconds}s · up since ${fmtStamp(w.status.startedAt)} · ${w.status.subscribers.expo} phone(s), ${w.status.subscribers.web} browser(s) subscribed`
              : undefined
          }
        />
        <button className="btn" onClick={w.checkNow} disabled={w.checking}>
          {w.checking ? "Checking…" : "Check now"}
        </button>
      </Card>
    </>
  );
}
