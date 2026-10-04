import { checkNow, getMatches, startWatcher } from "@/lib/watcher";

// Current matches as last seen by the server watcher (cheap — doesn't hit Tazkarti).
// ?fresh=1 forces a check against Tazkarti first.
export async function GET(req: Request) {
  const w = startWatcher();
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  if (fresh || !w.state.lastSuccess) await checkNow();
  return Response.json(getMatches(), { headers: { "Cache-Control": "no-store" } });
}
