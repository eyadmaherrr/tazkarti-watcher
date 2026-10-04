import { checkNow, getStatus } from "@/lib/watcher";

// Force an immediate check. Also usable as a cron target on hosts that sleep between requests.
// If CRON_SECRET is set, callers must send `Authorization: Bearer <CRON_SECRET>`.
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await checkNow();
  return Response.json(getStatus());
}

export const GET = handle;
export const POST = handle;
