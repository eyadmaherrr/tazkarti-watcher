import { getStatus, startWatcher } from "@/lib/watcher";

export async function GET() {
  startWatcher();
  return Response.json(await getStatus(), { headers: { "Cache-Control": "no-store" } });
}
