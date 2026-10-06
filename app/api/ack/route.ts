import { acknowledge } from "@/lib/watcher";

// A device pressed STOP: stop re-sending it the pending new-match alerts.
// Body: { type: "expo", token } | { type: "web", endpoint }
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { type?: string; token?: string; endpoint?: string };
    const recipient = body.type === "expo" ? body.token : body.type === "web" ? body.endpoint : undefined;
    if (!recipient) throw new Error('Send { type: "expo", token } or { type: "web", endpoint }');
    return Response.json({ ok: true, acknowledged: await acknowledge(recipient) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
