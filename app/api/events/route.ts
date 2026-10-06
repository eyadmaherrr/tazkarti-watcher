import { getEvents, startWatcher } from "@/lib/watcher";

// Change history, newest first. ?since=<ISO date> returns only newer events; ?limit=N (max 200).
export async function GET(req: Request) {
  startWatcher();
  const params = new URL(req.url).searchParams;
  const limit = Math.min(200, Math.max(1, Number(params.get("limit")) || 50));
  return Response.json({ events: await getEvents(params.get("since"), limit) }, { headers: { "Cache-Control": "no-store" } });
}
