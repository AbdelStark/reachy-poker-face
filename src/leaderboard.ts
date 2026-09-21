export interface LeaderboardEntry { name: string; rounds: number; fooled: number }
export const LEADERBOARD_KEY = "reachy-poker-face.leaderboard.v1";
const MAX_PLAYERS = 20;

export function playerName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > 24 || /[\u0000-\u001f\u007f]/.test(name)) throw new TypeError("nickname must be 1–24 printable characters");
  return name;
}

function ranked(entries: readonly LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort((a, b) => b.fooled - a.fooled || b.rounds - a.rounds || a.name.localeCompare(b.name)).slice(0, MAX_PLAYERS);
}

export function parseLeaderboard(serialized: string | null): LeaderboardEntry[] {
  if (!serialized) return [];
  try {
    const value: unknown = JSON.parse(serialized);
    if (!Array.isArray(value) || value.length > MAX_PLAYERS) return [];
    const seen = new Set<string>();
    const entries: LeaderboardEntry[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") return [];
      const entry = item as Record<string, unknown>;
      if (typeof entry.name !== "string" || !Number.isSafeInteger(entry.rounds) || !Number.isSafeInteger(entry.fooled) || (entry.rounds as number) < 1 || (entry.fooled as number) < 0 || (entry.fooled as number) > (entry.rounds as number)) return [];
      const name = playerName(entry.name);
      const key = name.toLocaleLowerCase();
      if (seen.has(key)) return [];
      seen.add(key);
      entries.push({ name, rounds: entry.rounds as number, fooled: entry.fooled as number });
    }
    return ranked(entries);
  } catch { return []; }
}

/** No statements, model outputs, or other player data enter this record. */
export function recordRound(entries: readonly LeaderboardEntry[], rawName: string, fooledRobot: boolean): LeaderboardEntry[] {
  const name = playerName(rawName);
  const key = name.toLocaleLowerCase();
  const next = entries.map((entry) => ({ ...entry }));
  const existing = next.find((entry) => entry.name.toLocaleLowerCase() === key);
  if (existing) {
    if (!Number.isSafeInteger(existing.rounds + 1) || !Number.isSafeInteger(existing.fooled + Number(fooledRobot))) throw new RangeError("score overflow");
    existing.name = name;
    existing.rounds++;
    if (fooledRobot) existing.fooled++;
  } else next.push({ name, rounds: 1, fooled: Number(fooledRobot) });
  return ranked(next);
}
