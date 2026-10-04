# Tazkarti Watch

Unofficial watcher for [tazkarti.com](https://tazkarti.com) — polls the public matches feed and sets off a loud alarm + browser notification the moment new matches are uploaded. Not affiliated with Tazkarti.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000, then:

1. Click anywhere on the page once — browsers only allow sound after an interaction ("Alarm armed" appears).
2. Click **Enable notifications**.
3. Press **Test alarm** with your volume up.

Keep the tab open. New matches trigger a looping siren that only stops when you press **STOP**; other list changes send a normal notification.

## How it works

- `app/api/matches/route.ts` proxies `https://tazkarti.com/data/matches-list-json.json` (the browser can't fetch it directly due to CORS).
- `app/page.tsx` polls every 15s–5m, remembers seen match IDs in `localStorage`, and diffs each response.
- `app/alarm.ts` builds the siren from Web Audio oscillators, so it keeps playing in background tabs.
