import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Small JSON-file persistence so the watcher survives restarts. Point DATA_DIR at a persistent volume in production.
// Serverless hosts (Vercel) only allow writes under /tmp, and even that is wiped between cold starts.
const DATA_DIR = path.resolve(
  /*turbopackIgnore: true*/ process.env.DATA_DIR || (process.env.VERCEL ? path.join(os.tmpdir(), "tazkarti-watch") : "data"),
);

export function readJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path.join(DATA_DIR, name), "utf8")) as T;
  } catch {
    return fallback;
  }
}

let warned = false;

/** Best-effort: a read-only or missing disk must never take the watcher (or the API) down with it. */
export function writeJson(name: string, data: unknown) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const file = path.join(DATA_DIR, name);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, file); // atomic replace, so a crash never leaves a half-written file
  } catch (e) {
    if (!warned) console.error(`[store] can't write to ${DATA_DIR} — state will not persist:`, (e as Error).message);
    warned = true;
  }
}
