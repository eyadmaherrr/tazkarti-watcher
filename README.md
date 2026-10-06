# Tazkarti Watch

Unofficial watcher for [tazkarti.com](https://tazkarti.com). Not affiliated with Tazkarti.

A server process checks Tazkarti's public matches feed around the clock. When new matches are uploaded it:

- sends push notifications to every registered browser and Expo app, even if nobody has the site open;
- sets off a loud alarm on any open copy of the website, which keeps ringing until you press **STOP**.

The same server exposes an API for a mobile app. See **[API.md](API.md)**.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000, then:

1. Click anywhere on the page once. Browsers only allow sound after you interact with the page, and "Alarm armed" appears when it's ready.
2. Click **Enable notifications**. This also turns on push notifications, so alerts arrive even with the tab closed.
3. Press **Test alarm** with your volume up.

Settings live in environment variables. See [.env.example](.env.example).

## Deploying (always on)

The watcher runs inside the Next.js server process, so it needs a host that **keeps the server running**: a VPS, Railway, Render, Fly.io, or Docker.

```bash
docker build -t tazkarti-watcher .
docker run -d --restart unless-stopped -p 3000:3000 -v tazkarti-data:/data tazkarti-watcher
```

Keep `DATA_DIR` (the `/data` volume above) on persistent storage. It holds:

- which matches have already been seen;
- the change history;
- push subscribers;
- the auto-generated VAPID keys. If these are lost, every browser has to re-subscribe.

On serverless hosts (e.g. Vercel), the background loop can't stay alive. Set `WATCHER_DISABLED=1` and `CRON_SECRET`, then call `POST /api/check` from a cron job instead.

## How it works

| File | Role |
| --- | --- |
| `instrumentation.ts` | Starts the watcher once when the server boots. |
| `lib/watcher.ts` | Polling loop, change detection (new match IDs vs. other edits), event history, live event emitter. |
| `lib/push.ts` | Web Push (VAPID) and Expo push delivery; drops dead subscriptions. |
| `lib/store.ts` | JSON-file persistence in `DATA_DIR`. |
| `app/api/*` | Public API: `matches`, `status`, `events`, `stream` (SSE), `push`, `check`. |
| `app/page.tsx` | Website shell: header, tabs (Matches / Activity / Settings), first-visit onboarding. |
| `app/_lib/watch.tsx` | Website state: follows the server, rings the alarm for matches this browser hasn't seen, notifies on every change, favourite team, settings. |
| `app/_components/*` | Screens and pieces shared with the app's design: match cards, team picker, favourite-team card, alarm overlay. |
| `app/alarm.ts` | Web Audio siren that loops until STOP (a watchdog restarts it if the browser suspends audio). |
