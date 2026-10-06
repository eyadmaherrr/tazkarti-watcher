import type { Match, Team } from "@/lib/types";

// Browser helpers shared by the website's components (mirrors the Expo app's lib/ folder).

export const Keys = {
  knownIds: "tw.knownIds",
  lastHash: "tw.lastHash",
  lastFetchedAt: "tw.lastFetchedAt",
  favoriteTeam: "tw.favoriteTeam",
  onboarded: "tw.onboarded",
  alarmEnabled: "tw.alarmEnabled",
  keepAwake: "tw.keepAwake",
  checkEvery: "tw.checkEvery",
} as const;

export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

export const fmtDay = (s: string) =>
  new Date(s).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
export const fmtTime = (s: string) =>
  new Date(s).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
export const fmtClock = (s: string) =>
  new Date(s).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const fmtStamp = (s: string) => `${fmtDay(s)} · ${fmtTime(s)}`;
export const fmtSeconds = (s: number) =>
  s < 60 ? `${s}s` : s % 60 === 0 ? `${s / 60}m` : `${Math.floor(s / 60)}m ${s % 60}s`;

export const initials = (name: string) =>
  name
    .replace(/[^\p{L}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";

export const describe = (m: Match) =>
  `${m.teamName1} vs ${m.teamName2} · ${fmtDay(m.kickOffTime)} ${fmtTime(m.kickOffTime)}`;
export const tournamentName = (m: Match) => m.tournament?.nameEn?.replace(/\.$/, "") || "Match";
export const playsIn = (m: Match, team: Team | null) => !!team && (m.teamId1 === team.id || m.teamId2 === team.id);

const IMAGES = "https://tazkarti.com/assets/images/imagesref";
/** Logo from a match (file name incl. extension). */
export const logoUrl = (file?: string | null) => (file ? `${IMAGES}/${file.toLowerCase()}` : null);
/** Logo candidates from the team list, which only gives the GUID. */
export const teamLogoUrls = (icon?: string | null) =>
  icon ? [`${IMAGES}/${icon.toLowerCase()}.png`, `${IMAGES}/${icon.toLowerCase()}.jpeg`] : [];

export const TAZKARTI_MATCHES_URL = "https://tazkarti.com/#/matches";

/** Fetch JSON from our own API with a readable error when the server returns something else. */
export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  let data: T & { error?: string };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server returned HTTP ${res.status}${text ? "" : " with an empty body"}`);
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function notify(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  // Same tag as the server's Web Push, so a push + local notification for one event collapse into one.
  const options: NotificationOptions = { body, icon: "/icon.svg", badge: "/icon.svg", tag: "tazkarti-watch", data: { url: "/" } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification(title, { ...options, requireInteraction: true } as NotificationOptions);
  } catch {}
  new Notification(title, options);
}

const b64ToBytes = (b64: string) => {
  const raw = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Subscribe this browser to server Web Push, so alerts arrive even with the tab closed. */
export async function subscribePush(): Promise<boolean> {
  try {
    if (!("PushManager" in window) || Notification.permission !== "granted") return false;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { publicKey } = await getJson<{ publicKey: string }>("/api/push");
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    }
    const res = await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "web", subscription: sub }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Tell the server this browser stopped the alarm, so it stops re-sending the pending alerts here. */
export async function ackAlarm() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await fetch("/api/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "web", endpoint: sub.endpoint }),
    });
  } catch {}
}
