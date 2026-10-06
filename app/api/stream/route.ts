import { getStatus, onWatcher, startWatcher } from "@/lib/watcher";

// Server-Sent Events: `status` after every check, `change` when the matches list changes.
export async function GET(req: Request) {
  startWatcher();
  const enc = new TextEncoder();
  let cleanup = () => {};

  const initial = await getStatus();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      send("status", initial);
      const offChange = onWatcher("change", (e) => send("change", e));
      const offChecked = onWatcher("checked", (s) => send("status", s));
      const ping = setInterval(() => controller.enqueue(enc.encode(": ping\n\n")), 25_000);
      cleanup = () => {
        offChange();
        offChecked();
        clearInterval(ping);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
