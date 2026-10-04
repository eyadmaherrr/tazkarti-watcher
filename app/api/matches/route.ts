import { checkNow, getMatches, startWatcher } from "@/lib/watcher";

// Current matches as last seen by the server watcher (cheap — doesn't hit Tazkarti).
// ?fresh=1 forces a check against Tazkarti first.
export async function GET(req: Request) {
  try {
    const w = startWatcher();
    const fresh = new URL(req.url).searchParams.get("fresh") === "1";
    if (fresh || !w.state.lastSuccess) await checkNow();
    return Response.json(getMatches(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    // Always answer with JSON so clients get a readable error instead of an empty 500.
    console.error("[api/matches]", e);
    return Response.json(
      { matches: [], hash: null, lastModified: null, fetchedAt: null, error: (e as Error).message },
      { status: 500 },
    );
  }
}
