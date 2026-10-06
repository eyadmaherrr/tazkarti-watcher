import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Persistence for the watcher (state, change history, push subscribers, reminders).
//
// - Redis (Upstash / Vercel KV) when its REST credentials are set. Needed on serverless hosts like Vercel,
//   where every request may hit a fresh instance and the disk is wiped between cold starts.
// - Otherwise JSON files in DATA_DIR (Docker / a VPS / local dev).

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
export const usingRedis = Boolean(REDIS_URL && REDIS_TOKEN);
const PREFIX = "tazkarti-watch:";

const DATA_DIR = path.resolve(
  /*turbopackIgnore: true*/ process.env.DATA_DIR || (process.env.VERCEL ? path.join(os.tmpdir(), "tazkarti-watch") : "data"),
);

async function redis<T = unknown>(...command: (string | number)[]): Promise<T> {
  const res = await fetch(REDIS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json()) as { result?: T; error?: string };
  if (!res.ok || json.error) throw new Error(`Redis ${command[0]} failed: ${json.error ?? res.status}`);
  return json.result as T;
}

function readFile<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path.join(DATA_DIR, `${name}.json`), "utf8")) as T;
  } catch {
    return fallback;
  }
}

let warned = false;
function writeFile(name: string, data: unknown) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const file = path.join(DATA_DIR, `${name}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, file); // atomic replace, so a crash never leaves a half-written file
  } catch (e) {
    // Best-effort: a read-only disk must never take the watcher (or the API) down with it.
    if (!warned) console.error(`[store] can't write to ${DATA_DIR} — state will not persist:`, (e as Error).message);
    warned = true;
  }
}

export async function load<T>(name: string, fallback: T): Promise<T> {
  if (!usingRedis) return readFile(name, fallback);
  try {
    const raw = await redis<string | null>("GET", PREFIX + name);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch (e) {
    console.error("[store]", (e as Error).message);
    return fallback;
  }
}

export async function save(name: string, data: unknown): Promise<void> {
  if (!usingRedis) return writeFile(name, data);
  try {
    await redis("SET", PREFIX + name, JSON.stringify(data));
  } catch (e) {
    console.error("[store]", (e as Error).message);
  }
}

/**
 * Run `fn` while holding a short cross-instance lock, so two serverless invocations can't check at the
 * same time and both report the same change. Returns null if another instance holds the lock.
 * Without Redis there's only one process, so it just runs.
 */
export async function withLock<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
  if (!usingRedis) return fn();
  const key = `${PREFIX}lock:${name}`;
  const owner = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  let got: string | null = null;
  try {
    got = await redis<string | null>("SET", key, owner, "NX", "PX", ttlMs);
  } catch (e) {
    console.error("[store]", (e as Error).message);
    return fn(); // Redis hiccup: better to check than to stall
  }
  if (got !== "OK") return null;
  try {
    return await fn();
  } finally {
    // Only release our own lock.
    const current = await redis<string | null>("GET", key).catch(() => null);
    if (current === owner) await redis("DEL", key).catch(() => {});
  }
}
