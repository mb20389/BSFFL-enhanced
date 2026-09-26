// lib/sleeper.js
//
// Small shared helpers for the Sleeper API, used by the rivalries and playoff
// odds routes. Responses are cached in-process; archived seasons never change,
// so their data is cached for much longer than a live season's.

import NodeCache from "node-cache";
import { getSeasonWeek } from "./weeks";

const cache = new NodeCache();

const LIVE_TTL = 5 * 60; // 5 minutes
const ARCHIVED_TTL = 12 * 60 * 60; // 12 hours

const SLEEPER = "https://api.sleeper.app/v1";

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed: ${url} (${r.status})`);
  return r.json();
}

async function cachedJson(url, ttl) {
  const hit = cache.get(url);
  if (hit !== undefined) return hit;
  const data = await fetchJson(url);
  cache.set(url, data, ttl);
  return data;
}

export function ttlFor(config) {
  return config?.archived ? ARCHIVED_TTL : LIVE_TTL;
}

export function getLeague(config) {
  return cachedJson(`${SLEEPER}/league/${config.leagueId}`, ttlFor(config));
}

/** Every NFL player Sleeper knows about (large — cached for 12 hours). */
export function getNflPlayers() {
  return cachedJson(`${SLEEPER}/players/nfl`, ARCHIVED_TTL);
}

export function getLeagueUsers(config) {
  return cachedJson(`${SLEEPER}/league/${config.leagueId}/users`, ttlFor(config));
}

export function getLeagueRosters(config) {
  return cachedJson(`${SLEEPER}/league/${config.leagueId}/rosters`, ttlFor(config));
}

export async function getWeekMatchups(config, week) {
  try {
    const data = await cachedJson(
      `${SLEEPER}/league/${config.leagueId}/matchups/${week}`,
      ttlFor(config)
    );
    return Array.isArray(data) ? data.filter((m) => m && m.roster_id != null) : [];
  } catch {
    return [];
  }
}

/**
 * Half-PPR projections for a week (the league's scoring), keyed by player ID:
 * Map<player_id, { points, opponent }>. Returns null when Sleeper has none.
 *
 * The v1 projections endpoint (api.sleeper.app/v1/projections) no longer
 * returns stats, so this uses the one Sleeper's own app calls. Not cached
 * here: projections move through game day, and callers cache their results.
 */
export async function getWeekProjections(season, week) {
  try {
    const positions = ["QB", "RB", "WR", "TE", "K", "DEF"].map((p) => `position[]=${p}`).join("&");
    const data = await fetchJson(
      `https://api.sleeper.com/projections/nfl/${season}/${week}?season_type=regular&${positions}`
    );
    const map = new Map();
    for (const p of Array.isArray(data) ? data : []) {
      if (!p?.player_id) continue;
      const pts = p.stats?.pts_half_ppr ?? p.stats?.pts_ppr ?? p.stats?.pts_std;
      if (pts != null) map.set(String(p.player_id), { points: Number(pts), opponent: p.opponent || null });
    }
    return map.size ? map : null;
  } catch {
    return null;
  }
}

/**
 * Regular-season weeks that are fully in the books.
 *
 * A live season counts only weeks before the current BSFFL week, so a week in
 * progress never moves the numbers mid-game. An archived season counts every
 * regular-season week.
 */
export function completedRegularSeasonWeeks(config) {
  const cap = config.regularSeasonWeeks || 14;
  if (config.archived) return cap;
  return Math.max(0, Math.min(getSeasonWeek(config) - 1, cap));
}

/** Display info for a Sleeper user, matching the fields the rest of the site uses. */
export function identityFor(owner, fallbackLabel) {
  return {
    custom_team_name: owner?.metadata?.team_name || owner?.display_name || fallbackLabel,
    sleeper_display_name: owner?.display_name || "Unknown",
    manager_name:
      owner?.metadata?.team_nickname ||
      `${owner?.metadata?.first_name || ""} ${owner?.metadata?.last_name || ""}`.trim() ||
      owner?.display_name ||
      null,
    avatar: owner?.avatar ? `https://sleepercdn.com/avatars/${owner.avatar}` : null,
  };
}

/**
 * Load a season's regular-season scores, week by week.
 * Returns { weeks: [{ week, rows: [{ roster_id, owner_id, points }] }], users, rosters }.
 * Weeks where nobody has scored yet are dropped.
 */
export async function loadSeasonScores(config, throughWeek) {
  const [users, rosters] = await Promise.all([getLeagueUsers(config), getLeagueRosters(config)]);
  const ownerByRoster = new Map(rosters.map((r) => [Number(r.roster_id), r.owner_id]));

  const weekNums = Array.from({ length: Math.max(throughWeek, 0) }, (_, i) => i + 1);
  const raw = await Promise.all(weekNums.map((w) => getWeekMatchups(config, w)));

  const weeks = raw
    .map((matchups, i) => ({
      week: weekNums[i],
      rows: matchups.map((m) => ({
        roster_id: Number(m.roster_id),
        owner_id: ownerByRoster.get(Number(m.roster_id)) || null,
        points: Number(m.points || 0),
      })),
    }))
    .filter(({ rows }) => rows.length > 1 && rows.some((r) => r.points > 0));

  return { weeks, users, rosters };
}
