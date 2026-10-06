import webpush, { type PushSubscription } from "web-push";
import { load, save, usingRedis } from "./store";

type Subscribers = { web: PushSubscription[]; expo: string[] };
type Vapid = { publicKey: string; privateKey: string };

export type PushPayload = { title: string; body: string; url?: string; data?: Record<string, unknown> };

const SUBS_KEY = "subscribers";
const EXPO_TOKEN = /^(Exponent|Expo)PushToken\[.+\]$/;

let cache: Subscribers | null = null;
let vapid: Vapid | null = null;

// With Redis another instance may have changed the list, so always re-read; with files, memory is canonical.
async function subscribers(): Promise<Subscribers> {
  if (usingRedis || !cache) cache = { web: [], expo: [], ...(await load<Partial<Subscribers>>(SUBS_KEY, {})) };
  return cache;
}

async function update(fn: (s: Subscribers) => void) {
  const s = await subscribers();
  fn(s);
  await save(SUBS_KEY, s);
}

/** VAPID keys from env, or generated once and stored so existing browser subscriptions stay valid. */
export async function getVapid(): Promise<Vapid> {
  if (!vapid) {
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    } else {
      vapid = await load<Vapid | null>("vapid", null);
      if (!vapid) {
        vapid = webpush.generateVAPIDKeys();
        await save("vapid", vapid);
      }
    }
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", vapid.publicKey, vapid.privateKey);
  }
  return vapid;
}

export async function subscriberCounts() {
  const s = await subscribers();
  return { web: s.web.length, expo: s.expo.length };
}

export async function addWeb(sub: PushSubscription) {
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error("Invalid web push subscription");
  await update((s) => {
    s.web = [...s.web.filter((x) => x.endpoint !== sub.endpoint), sub];
  });
}

export async function removeWeb(endpoint: string) {
  await update((s) => {
    s.web = s.web.filter((x) => x.endpoint !== endpoint);
  });
}

export async function addExpo(token: string) {
  if (!EXPO_TOKEN.test(token)) throw new Error("Invalid Expo push token");
  await update((s) => {
    if (!s.expo.includes(token)) s.expo.push(token);
  });
}

export async function removeExpo(token: string) {
  await update((s) => {
    s.expo = s.expo.filter((t) => t !== token);
  });
}

async function sendWeb(targets: PushSubscription[], payload: PushPayload) {
  if (!targets.length) return;
  await getVapid();
  const dead: string[] = [];
  await Promise.all(
    targets.map((sub) =>
      webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 60 * 60, urgency: "high" }).catch((err) => {
        // 404/410 = the browser dropped this subscription; forget it.
        if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(sub.endpoint);
        else console.error("[push] web push failed:", err?.statusCode, err?.body || err?.message);
      }),
    ),
  );
  if (dead.length) await update((s) => (s.web = s.web.filter((x) => !dead.includes(x.endpoint))));
}

async function sendExpo(tokens: string[], payload: PushPayload) {
  // New matches (and their reminders) use the app's alarm channel + siren; other changes the quieter one.
  const alarm = payload.data?.type !== "updated";
  const dead: string[] = [];
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
            // alarm.wav ships with the Tazkarti Watch app (expo-notifications "sounds"); falls back to default.
            sound: alarm ? "alarm.wav" : "default",
            interruptionLevel: alarm ? "time-sensitive" : "active",
            priority: "high",
            channelId: alarm ? "new-matches" : "matches-updated",
          })),
        ),
      });
      const json = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
      json.data?.forEach((ticket, j) => {
        if (ticket.details?.error === "DeviceNotRegistered") dead.push(batch[j]);
      });
    } catch (err) {
      console.error("[push] expo push failed:", (err as Error).message);
    }
  }
  if (dead.length) await update((s) => (s.expo = s.expo.filter((t) => !dead.includes(t))));
}

/**
 * Send to every subscribed browser and phone, except `exclude` (Web Push endpoints / Expo tokens).
 * Returns how many devices it was sent to.
 */
export async function broadcast(payload: PushPayload, opts: { exclude?: Set<string> } = {}): Promise<number> {
  const s = await subscribers();
  const skip = opts.exclude ?? new Set<string>();
  const web = s.web.filter((x) => !skip.has(x.endpoint));
  const expo = s.expo.filter((t) => !skip.has(t));
  await Promise.all([sendWeb(web, payload), sendExpo(expo, payload)]);
  return web.length + expo.length;
}
