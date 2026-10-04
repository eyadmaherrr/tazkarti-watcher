import { createHash } from "node:crypto";

const SOURCE = "https://tazkarti.com/data/matches-list-json.json";

export async function GET() {
  try {
    const res = await fetch(SOURCE, {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 (TazkartiWatcher)", Accept: "application/json" },
    });
    if (!res.ok) {
      return Response.json({ error: `Upstream responded ${res.status}` }, { status: 502 });
    }
    const body = await res.text();
    const matches = JSON.parse(body);
    return Response.json(
      {
        matches,
        hash: createHash("sha1").update(body).digest("hex"),
        lastModified: res.headers.get("last-modified"),
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
