import { checkNow, getStatus } from "@/lib/watcher";

// Force an immediate check (and send any due reminders). This is what keeps a serverless deployment
// "always on": call it every minute from a scheduler (see README).
// If CRON_SECRET is set, callers must send `Authorization: Bearer <CRON_SECRET>`.
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await checkNow();
  return Response.json(await getStatus(), { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
