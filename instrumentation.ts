// Runs once when the Next.js server boots: start the always-on Tazkarti watcher.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return; // don't poll during `next build`
  if (process.env.WATCHER_DISABLED === "1") return;
  const { startWatcher } = await import("./lib/watcher");
  startWatcher();
}
