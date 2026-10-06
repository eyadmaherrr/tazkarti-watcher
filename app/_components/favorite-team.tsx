"use client";

import { useEffect, useState } from "react";
import { fmtDay, fmtTime, logoUrl, playsIn, TAZKARTI_MATCHES_URL, teamLogoUrls } from "../_lib/client";
import { useWatch } from "../_lib/watch";
import { TeamPicker } from "./team-picker";
import { Label, TeamLogo } from "./ui";

/** Full-screen sheet for choosing (or clearing) the favourite team. */
export function TeamPickerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { favorite, setFavorite } = useWatch();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Favourite team">
      <div className="sheet-inner">
        <div className="sheet-head">
          <h2>Favourite team</h2>
          <button className="btn green sm" onClick={onClose}>
            Done
          </button>
        </div>
        {favorite && (
          <button
            className="link-danger"
            onClick={() => {
              setFavorite(null);
              onClose();
            }}>
            Remove {favorite.name} as favourite
          </button>
        )}
        <div className="glass sheet-body">
          <TeamPicker
            selectedId={favorite?.id}
            onSelect={(t) => {
              setFavorite(t);
              onClose();
            }}
          />
        </div>
      </div>
    </div>
  );
}

/** Top-of-Matches card for your team: crest, name and its next match on sale. */
export function FavoriteTeamCard() {
  const { favorite, matches } = useWatch();
  const [picking, setPicking] = useState(false);

  if (!favorite) {
    return (
      <>
        <button className="glass fav-prompt" onClick={() => setPicking(true)}>
          <span className="fav-star" aria-hidden>
            ⭐
          </span>
          <span>
            <b>Pick your team</b>
            <small>See their matches first, right here.</small>
          </span>
          <span className="fav-choose">Choose</span>
        </button>
        <TeamPickerSheet open={picking} onClose={() => setPicking(false)} />
      </>
    );
  }

  const theirs = matches.filter((m) => playsIn(m, favorite)).sort((a, b) => +new Date(a.kickOffTime) - +new Date(b.kickOffTime));
  const next = theirs[0];
  const opp = next ? (next.teamId1 === favorite.id ? 2 : 1) : null;

  return (
    <>
      <section className="glass tint-green fav-card">
        <div className="fav-head">
          <TeamLogo sources={teamLogoUrls(favorite.icon)} name={favorite.name} size={64} />
          <div className="fav-names">
            <Label>Your team</Label>
            <b>{favorite.name}</b>
            {favorite.nameAr && <small dir="rtl">{favorite.nameAr}</small>}
          </div>
          <button className="chip-btn" onClick={() => setPicking(true)}>
            Change
          </button>
        </div>
        {next && opp ? (
          <div className="fav-next">
            <div className="fav-opp">
              <span className="muted-sm">NEXT · vs</span>
              <TeamLogo
                sources={[logoUrl(opp === 1 ? next.team1Logo : next.team2Logo)]}
                name={opp === 1 ? next.teamName1 : next.teamName2}
                size={28}
              />
              <b>{opp === 1 ? next.teamName1 : next.teamName2}</b>
            </div>
            <span className="muted">
              {fmtDay(next.kickOffTime)} · {fmtTime(next.kickOffTime)} · {next.stadiumName}
            </span>
            {theirs.length > 1 && (
              <span className="muted-sm">
                +{theirs.length - 1} more {theirs.length - 1 === 1 ? "match" : "matches"} on sale
              </span>
            )}
            <a className="book rounded" href={TAZKARTI_MATCHES_URL} target="_blank" rel="noreferrer">
              Book Ticket
            </a>
          </div>
        ) : (
          <p className="muted">
            No {favorite.name} matches on sale right now. You&apos;ll hear the alarm the moment one is uploaded.
          </p>
        )}
      </section>
      <TeamPickerSheet open={picking} onClose={() => setPicking(false)} />
    </>
  );
}
