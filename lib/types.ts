// Shape of one entry in https://tazkarti.com/data/matches-list-json.json (fields we use; the rest pass through).
export type Team = {
  id: number;
  name: string;
  nameAr: string | null;
  shortName: string | null;
  /** Logo GUID without extension (Tazkarti serves .png for most, .jpeg for some) */
  icon: string | null;
  gameId: number | null;
};

export type Match = {
  matchId: number;
  matchStatus: number;
  teamId1: number;
  teamId2: number;
  teamName1: string;
  teamName2: string;
  teamNameAr1?: string;
  teamNameAr2?: string;
  team1Logo?: string | null;
  team2Logo?: string | null;
  matchNumber?: string | null;
  stadiumName: string;
  stadiumCityEn?: string;
  kickOffTime: string;
  gatesOpenTime?: string;
  maxTicketsPerUser?: number;
  roundName?: string | null;
  teamGroupName?: string | null;
  tournament?: { nameEn?: string; nameAr?: string };
  [key: string]: unknown;
};

export type WatchEvent = {
  id: string;
  at: string;
  /** "new-matches": matches appeared that were never seen before. "updated": list changed otherwise (times, removals…). */
  type: "new-matches" | "updated";
  message: string;
  matches: Match[];
  removedIds: number[];
};

export type WatcherStatus = {
  running: boolean;
  intervalSeconds: number;
  startedAt: string;
  lastChecked: string | null;
  lastSuccess: string | null;
  nextCheckAt: string | null;
  lastError: string | null;
  sourceLastModified: string | null;
  matchCount: number;
  subscribers: { web: number; expo: number };
  /** New-match alerts still being re-sent to devices that haven't pressed STOP */
  pendingAlerts: number;
  storage: "redis" | "file";
};

/** A new-match alert that keeps being re-sent until each device acknowledges it (POST /api/ack). */
export type PendingAlert = {
  eventId: string;
  title: string;
  body: string;
  firstAt: string;
  lastSentAt: string;
  sends: number;
  /** Expo push tokens / Web Push endpoints that pressed STOP */
  acked: string[];
};

export type MatchesResponse = {
  matches: Match[];
  hash: string | null;
  lastModified: string | null;
  fetchedAt: string | null;
  error?: string;
};
