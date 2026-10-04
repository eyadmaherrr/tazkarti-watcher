// Shape of one entry in https://tazkarti.com/data/matches-list-json.json (fields we use; the rest pass through).
export type Match = {
  matchId: number;
  matchStatus: number;
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
};

export type MatchesResponse = {
  matches: Match[];
  hash: string | null;
  lastModified: string | null;
  fetchedAt: string | null;
  error?: string;
};
