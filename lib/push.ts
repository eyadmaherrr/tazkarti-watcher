import webpush, { type PushSubscription } from "web-push";
import { readJson, writeJson } from "./store";

type Subscribers = { web: PushSubscription[]; expo: string[] };
type Vapid = { publicKey: string; privateKey: string };

export type PushPayload = { title: string; body: string; url?: string; data?: Record<string, unknown> };

const SUBS_FILE = "subscribers.json";
const EXPO_TOKEN = /^(Exponent|Expo)PushToken\[.+\]$/;

let subs: Subscribers | null = null;
let vapid: Vapid | null = null;

const load = () => (subs ??= readJson<Subscribers>(SUBS_FILE, { web: [], expo: [] }));
const save = () => writeJson(SUBS_FILE, load());

/** VAPID keys from env, or generated once and kept in DATA_DIR so existing subscriptions stay valid. */
export function getVapid(): Vapid {
  if (vapid) return vapid;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    vapid = readJson<Vapid | null>("vapid.json", null) ?? webpush.generateVAPIDKeys();
    writeJson("vapid.json", vapid);
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", vapid.publicKey, vapid.privateKey);
  return vapid;
}

export const subscriberCounts = () => ({ web: load().web.length, expo: load().expo.length });

export function addWeb(sub: PushSubscription) {
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error("Invalid web push subscription");
  const s = load();
  s.web = [...s.web.filter((x) => x.endpoint !== sub.endpoint), sub];
  save();
}

export function removeWeb(endpoint: string) {
  const s = load();
  s.web = s.web.filter((x) => x.endpoint !== endpoint);
  save();
}

export function addExpo(token: string) {
  if (!EXPO_TOKEN.test(token)) throw new Error("Invalid Expo push token");
  const s = load();
  if (!s.expo.includes(token)) s.expo.push(token);
  save();
}

export function removeExpo(token: string) {
  const s = load();
  s.expo = s.expo.filter((t) => t !== token);
  save();
}

async function sendWeb(payload: PushPayload) {
  getVapid();
  const dead: string[] = [];
  await Promise.all(
    load().web.map((sub) =>
      webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 60 * 60, urgency: "high" }).catch((err) => {
        // 404/410 = the browser dropped this subscription; forget it.
        if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(sub.endpoint);
        else console.error("[push] web push failed:", err?.statusCode, err?.body || err?.message);
      }),
    ),
  );
  dead.forEach(removeWeb);
}

async function sendExpo(payload: PushPayload) {
  const tokens = load().expo;
  for (let i = 0; i < tokens.length; i += 100) {
    const batch = tokens.slice(i, i + 100);
    try {
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(
          batch.map((to) => ({
            to,
            title: payload.title,
            body: payload.body,
            data: payload.data,
            sound: "default",
            priority: "high",
            channelId: "new-matches",
          })),
        ),
      });
      const json = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
      json.data?.forEach((ticket, j) => {
        if (ticket.details?.error === "DeviceNotRegistered") removeExpo(batch[j]);
      });
    } catch (err) {
      console.error("[push] expo push failed:", (err as Error).message);
    }
  }
}

export async function broadcast(payload: PushPayload) {
  await Promise.all([sendWeb(payload), sendExpo(payload)]);
}
