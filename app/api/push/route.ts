import type { PushSubscription } from "web-push";
import { addExpo, addWeb, getVapid, removeExpo, removeWeb } from "@/lib/push";

type Body = { type: "web"; subscription: PushSubscription } | { type: "expo"; token: string };

// GET → VAPID public key for browser Web Push.
export async function GET() {
  return Response.json({ publicKey: (await getVapid()).publicKey });
}

// POST { type: "web", subscription } | { type: "expo", token } → register a device.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (body.type === "web") await addWeb(body.subscription);
    else if (body.type === "expo") await addExpo(body.token);
    else throw new Error('type must be "web" or "expo"');
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

// DELETE with the same body → unregister.
export async function DELETE(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (body.type === "web") await removeWeb(body.subscription?.endpoint);
    else if (body.type === "expo") await removeExpo(body.token);
    else throw new Error('type must be "web" or "expo"');
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
