// All teams Tazkarti knows about (for "pick your favourite team" in the app), trimmed from ~300 KB to
// the fields a client needs and cached in memory — the list changes rarely.
const SOURCE = "https://tazkarti.com/booksprt/teams/getTeams?hasActiveMatches=false";
const TTL_MS = 6 * 60 * 60 * 1000;

type RawTeam = {
  id: number;
  name: string;
  nameAr?: string | null;
  shortName?: string | null;
  icon?: string | null;
  gameId?: number | null;
  isDeleted?: boolean;
  teamStatus?: number;
};

export type Team = { id: number; name: string; nameAr: string | null; shortName: string | null; icon: string | null; gameId: number | null };

let cache: { at: number; teams: Team[] } | null = null;

export async function GET() {
  try {
    if (!cache || Date.now() - cache.at > TTL_MS) {
      const res = await fetch(SOURCE, {
        cache: "no-store",
        headers: { "User-Agent": "Mozilla/5.0 (TazkartiWatcher)", Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Tazkarti responded ${res.status}`);
      const raw = (await res.json()) as RawTeam[];
      const teams = raw
        .filter((t) => !t.isDeleted && t.teamStatus !== 0)
        .map((t) => ({
          id: t.id,
          name: t.name.trim(),
          nameAr: t.nameAr?.trim() || null,
          shortName: t.shortName?.trim() || null,
          icon: t.icon?.toLowerCase() || null,
          gameId: t.gameId ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      cache = { at: Date.now(), teams };
    }
    return Response.json({ teams: cache.teams }, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch (e) {
    // Serve a stale list rather than nothing if Tazkarti hiccups.
    if (cache) return Response.json({ teams: cache.teams, error: (e as Error).message });
    return Response.json({ teams: [], error: (e as Error).message }, { status: 502 });
  }
}
