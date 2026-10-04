import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

// Small JSON-file persistence so the watcher survives restarts. Point DATA_DIR at a persistent volume in production.
const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || "data");

export function readJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path.join(DATA_DIR, name), "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(name: string, data: unknown) {
  mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, name);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file); // atomic replace, so a crash never leaves a half-written file
}
