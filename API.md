# Tazkarti Watch API

The server watches `https://tazkarti.com/data/matches-list-json.json` 24/7 (default every 30s) and exposes what it sees here. A mobile app should talk to this API, never to Tazkarti directly.

All endpoints return JSON and send CORS headers (`Access-Control-Allow-Origin: *` unless `CORS_ORIGIN` is set).

## `GET /api/matches`

Current matches list as the server last saw it. Served from memory, so polling it doesn't hit Tazkarti.

| Query | Meaning |
| --- | --- |
| `fresh=1` | Make the server check Tazkarti first, then respond. |

```json
{
  "matches": [{ "matchId": 2601, "teamName1": "Egypt", "teamName2": "South Africa", "kickOffTime": "2026-10-04T21:00:00", "team1Logo": "FE26…png", "...": "every field Tazkarti returns" }],
  "hash": "sha1 of Tazkarti's raw response",
  "lastModified": "Sat, 03 Oct 2026 21:00:04 GMT",
  "fetchedAt": "2026-10-04T15:26:30.377Z",
  "error": "only present if the most recent check failed"
}
```

- Times like `kickOffTime` are Cairo local time with no timezone suffix, exactly as Tazkarti sends them.
- Team logo URL: `https://tazkarti.com/assets/images/imagesref/<team1Logo lowercased>`.

## `GET /api/status`

```json
{
  "running": true,
  "intervalSeconds": 30,
  "startedAt": "…",
  "lastChecked": "…",
  "lastSuccess": "…",
  "nextCheckAt": "…",
  "lastError": null,
  "sourceLastModified": "…",
  "matchCount": 1,
  "subscribers": { "web": 0, "expo": 2 }
}
```

## `GET /api/events`

Change history, newest first, kept across restarts (last 200).

| Query | Meaning |
| --- | --- |
| `since=<ISO date>` | Only events after this time. Store the newest `at` you've seen and pass it next time. |
| `limit=N` | Default 50, max 200. |

```json
{
  "events": [
    {
      "id": "uuid",
      "at": "2026-10-04T15:26:30.377Z",
      "type": "new-matches",
      "message": "1 new match: Egypt vs South Africa · Sun 4 Oct, 21:00",
      "matches": [{ "matchId": 2601, "...": "…" }],
      "removedIds": []
    }
  ]
}
```

`type` is `"new-matches"` (matches never seen before appeared; `matches` holds them) or `"updated"` (the list changed some other way, such as times edited or matches removed; see `removedIds`).

## `GET /api/stream`

Server-Sent Events for live updates while the app is open.

- `event: status`: a status object (same shape as `/api/status`). Sent on connect and after every check.
- `event: change`: an event object (same shape as in `/api/events`). Sent the moment the list changes.

A comment ping is sent every 25s to keep the connection open. In React Native, use a library such as `react-native-sse`.

## Push notifications

### Expo app

Register the device's Expo push token after asking for notification permission:

```http
POST /api/push
Content-Type: application/json

{ "type": "expo", "token": "ExponentPushToken[xxxxxxxx]" }
```

Unregister by sending a `DELETE` request with the same body. The server sends to every token on each change:

```json
{
  "title": "New match uploaded on Tazkarti",
  "body": "Egypt vs South Africa · Sun 4 Oct, 21:00",
  "sound": "default",
  "priority": "high",
  "channelId": "new-matches",
  "data": { "type": "new-matches", "eventId": "…", "matchIds": [2601] }
}
```

- **Android channel:** create a notification channel with id `new-matches` and max importance so the alert can break through.
- **Dead tokens:** tokens Expo reports as `DeviceNotRegistered` are removed automatically.

### Browser (Web Push)

- `GET /api/push` returns `{ "publicKey": "<VAPID key>" }`.
- `POST /api/push` with `{ "type": "web", "subscription": <PushSubscription JSON> }` registers the browser.

The website does both of these automatically when you press **Enable notifications**.

## `POST /api/check` (also `GET`)

Forces an immediate check and returns status. If `CRON_SECRET` is set, callers must send `Authorization: Bearer <CRON_SECRET>`. This is useful as a cron target on hosts that sleep between requests.
