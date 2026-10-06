"use client";

import type { Match } from "@/lib/types";
import { fmtDay, fmtTime, logoUrl, TAZKARTI_MATCHES_URL, tournamentName } from "../_lib/client";
import { TeamLogo } from "./ui";

function Team({ name, ar, logo }: { name: string; ar?: string; logo?: string | null }) {
  return (
    <div className="team">
      <TeamLogo sources={[logoUrl(logo)]} name={name} />
      <div>
        <b>{name}</b>
        {ar && <small dir="rtl">{ar}</small>}
      </div>
    </div>
  );
}

/** Mirrors tazkarti.com's match card (and the app's): teams, venue | kick-off, tournament + status, Book Ticket. */
export function MatchCard({ match: m, fresh, mine }: { match: Match; fresh?: boolean; mine?: boolean }) {
  const available = m.matchStatus === 1;
  return (
    <article className={`glass match ${fresh ? "fresh" : ""} ${mine ? "mine" : ""}`}>
      {fresh && <em className="new-badge">NEW</em>}
      <div className="teams">
        <Team name={m.teamName1} ar={m.teamNameAr1} logo={m.team1Logo} />
        <span className="vs">vs</span>
        <Team name={m.teamName2} ar={m.teamNameAr2} logo={m.team2Logo} />
      </div>

      <div className="facts">
        <div className="fact">
          <small>STADIUM</small>
          <b>{m.stadiumName}</b>
          {m.stadiumCityEn && <span>{m.stadiumCityEn}</span>}
        </div>
        <div className="fact">
          <small>KICK-OFF</small>
          <b>
            {fmtDay(m.kickOffTime)} · {fmtTime(m.kickOffTime)}
          </b>
          {m.gatesOpenTime && <span>Gates {fmtTime(m.gatesOpenTime)}</span>}
        </div>
      </div>

      <div className="meta">
        <span className="meta-left">
          <small>Tournament</small> {tournamentName(m)}
        </span>
        <span className="meta-right">
          {m.matchNumber && (
            <span>
              <small>No.</small> {m.matchNumber}
            </span>
          )}
          <span className={`status ${available ? "ok" : ""}`}>
            <i />
            {available ? "Available" : "Unavailable"}
          </span>
        </span>
      </div>

      <a className="book" href={TAZKARTI_MATCHES_URL} target="_blank" rel="noreferrer">
        Book Ticket
      </a>
    </article>
  );
}
