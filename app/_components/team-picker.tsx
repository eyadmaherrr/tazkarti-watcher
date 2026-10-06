"use client";

import { useEffect, useMemo, useState } from "react";
import type { Team } from "@/lib/types";
import { getJson, teamLogoUrls } from "../_lib/client";
import { useWatch } from "../_lib/watch";
import { TeamLogo } from "./ui";

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

type Row = { kind: "header"; title: string } | { kind: "team"; team: Team; playing: boolean };

/** Searchable list of every team on Tazkarti; teams with matches on sale right now come first. */
export function TeamPicker({ selectedId, onSelect }: { selectedId?: number | null; onSelect: (t: Team) => void }) {
  const { matches } = useWatch();
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [limit, setLimit] = useState(60);

  useEffect(() => {
    let alive = true;
    getJson<{ teams: Team[] }>("/api/teams")
      .then((d) => alive && setTeams(d.teams))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [attempt]);

  const rows = useMemo<Row[]>(() => {
    if (!teams) return [];
    const playingIds = new Set(matches.flatMap((m) => [m.teamId1, m.teamId2]));
    const q = norm(query.trim());
    const hit = (t: Team) => !q || [t.name, t.nameAr, t.shortName].some((v) => v && norm(v).includes(q));
    const filtered = teams.filter(hit);
    const playing = filtered.filter((t) => playingIds.has(t.id));
    const rest = filtered.filter((t) => !playingIds.has(t.id));
    return [
      ...(playing.length ? [{ kind: "header", title: "Playing on Tazkarti now" } as Row] : []),
      ...playing.map((team) => ({ kind: "team", team, playing: true }) as Row),
      ...(rest.length ? [{ kind: "header", title: q ? "Other teams" : "All teams" } as Row] : []),
      ...rest.map((team) => ({ kind: "team", team, playing: false }) as Row),
    ];
  }, [teams, matches, query]);

  if (error) {
    return (
      <div className="picker-empty">
        <p>Couldn&apos;t load teams: {error}</p>
        <button
          className="btn green"
          onClick={() => {
            setError(null);
            setAttempt((a) => a + 1);
          }}>
          Try again
        </button>
      </div>
    );
  }

  const visible = rows.slice(0, limit);
  return (
    <div className="picker">
      <input
        className="picker-search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLimit(60);
        }}
        placeholder="Search teams (English or عربي)"
        aria-label="Search teams"
        autoComplete="off"
        spellCheck={false}
      />
      {!teams ? (
        <div className="spinner" aria-label="Loading teams" />
      ) : (
        <div className="picker-list" role="radiogroup" aria-label="Teams">
          {visible.length === 0 && <p className="picker-none">No team matches “{query}”.</p>}
          {visible.map((r) =>
            r.kind === "header" ? (
              <div key={`h-${r.title}`} className="picker-header">
                {r.title}
              </div>
            ) : (
              <button
                key={r.team.id}
                role="radio"
                aria-checked={r.team.id === selectedId}
                className={`picker-row ${r.team.id === selectedId ? "selected" : ""}`}
                onClick={() => onSelect(r.team)}>
                <TeamLogo sources={teamLogoUrls(r.team.icon)} name={r.team.name} size={40} />
                <span className="picker-names">
                  <b>{r.team.name}</b>
                  {r.team.nameAr && <small dir="rtl">{r.team.nameAr}</small>}
                </span>
                {r.playing && <span className="on-sale">ON SALE</span>}
                <span className="radio" aria-hidden />
              </button>
            ),
          )}
          {rows.length > limit && (
            <button className="btn picker-more" onClick={() => setLimit((l) => l + 120)}>
              Show more teams ({rows.length - limit} left)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
