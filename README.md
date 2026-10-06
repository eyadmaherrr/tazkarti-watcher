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

### On Vercel

Vercel can't keep a background loop running, so two extra pieces keep it "always on":

1. **A database.** In the Vercel dashboard go to **Storage → Create → Upstash (Redis)**, connect it to this project, and redeploy. This sets `KV_REST_API_URL` / `KV_REST_API_TOKEN`, and the server switches from files to Redis automatically. `/api/status` shows `"storage": "redis"`.
2. **Something calling `/api/check` every minute.**
   - `.github/workflows/keep-checking.yml` does this from GitHub Actions. It's free for public repos, but GitHub can delay scheduled runs.
   - For a strict 1-minute schedule, also create a free job at [cron-job.org](https://cron-job.org): `POST https://watch-tazkarti.vercel.app/api/check`, every minute.
   - If you set `CRON_SECRET`, send it as `Authorization: Bearer <secret>`. Add the same value as a GitHub Actions secret named `CRON_SECRET`.

### Reminders until STOP

New-match alerts are re-sent to each phone or browser every `REMIND_EVERY_SECONDS` (default 60), up to `REMIND_MAX` times (default 30), until that device presses STOP or taps the notification. Either one calls `POST /api/ack`.

## How it works

| File | Role |
| --- | --- |
| `instrumentation.ts` | Starts the watcher once when the server boots. |
| `lib/watcher.ts` | Polling loop, change detection (new match IDs vs. other edits), event history, live event emitter. |
| `lib/push.ts` | Web Push (VAPID) and Expo push delivery; drops dead subscriptions. |
| `lib/store.ts` | Persistence: Redis when configured (serverless), otherwise JSON files in `DATA_DIR`; cross-instance lock. |
| `app/api/*` | Public API: `matches`, `status`, `events`, `stream` (SSE), `push`, `ack`, `check`, `teams`. |
| `app/page.tsx` | Website shell: header, tabs (Matches / Activity / Settings), first-visit onboarding. |
| `app/_lib/watch.tsx` | Website state: follows the server, rings the alarm for matches this browser hasn't seen, notifies on every change, favourite team, settings. |
| `app/_components/*` | Screens and pieces shared with the app's design: match cards, team picker, favourite-team card, alarm overlay. |
| `app/alarm.ts` | Web Audio siren that loops until STOP (a watchdog restarts it if the browser suspends audio). |
