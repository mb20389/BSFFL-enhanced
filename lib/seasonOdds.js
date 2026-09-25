// lib/seasonOdds.js
//
// Loads a season's completed weeks once and computes playoff odds "as of" any
// completed week. Both /api/playoff-odds (the table) and
// /api/playoff-odds-history (the chart) go through here, so the chart's latest
// point always matches the table exactly.
//
// Odds as of a finished week can never change (the simulation is seeded), so
// each week's result is cached for a long time.

import NodeCache from "node-cache";
import { completedRegularSeasonWeeks, identityFor, loadSeasonScores } from "./sleeper";
import { allPlayWeek, PLAYOFF_TEAMS, simulatePlayoffOdds } from "./playoffOdds";

const cache = new NodeCache();
const PAST_WEEK_TTL = 12 * 60 * 60; // 12 hours

/**
 * Everything the simulation needs, for weeks 1..throughWeek (default: the last
 * completed week). The weekly recap passes the week that just ended, which the
 * site doesn't count as completed until the next week turns over on Thursday.
 * Returns { teamIds, identities, weekScores: number[][] (week → team), regularSeasonWeeks }.
 */
export async function loadOddsInputs(config, throughWeek = completedRegularSeasonWeeks(config)) {
  const completed = throughWeek;
  const { weeks, users, rosters } = await loadSeasonScores(config, completed);

  const userById = new Map(users.map((u) => [u.user_id, u]));
  const teamIds = rosters.map((r) => Number(r.roster_id)).sort((a, b) => a - b);
  const indexOf = new Map(teamIds.map((id, i) => [id, i]));
  const ownerByRoster = new Map(rosters.map((r) => [Number(r.roster_id), r.owner_id]));

  const identities = teamIds.map((id) => ({
    roster_id: id,
    ...identityFor(userById.get(ownerByRoster.get(id)), `Roster ${id}`),
  }));

  const weekScores = weeks.map(({ rows }) => {
    const scores = new Array(teamIds.length).fill(0);
    rows.forEach((r) => {
      const i = indexOf.get(r.roster_id);
      if (i != null) scores[i] = r.points;
    });
    return scores;
  });

  return {
    teamIds,
    identities,
    weekScores,
    regularSeasonWeeks: config.regularSeasonWeeks || 14,
  };
}

/** Standings after the first k weeks. */
export function standingsThrough(inputs, k) {
  const n = inputs.teamIds.length;
  const teamScores = Array.from({ length: n }, () => []);
  const wins = new Array(n).fill(0);
  const losses = new Array(n).fill(0);
  const points = new Array(n).fill(0);

  for (let w = 0; w < k; w++) {
    const scores = inputs.weekScores[w];
    const result = allPlayWeek(scores);
    for (let i = 0; i < n; i++) {
      teamScores[i].push(scores[i]);
      wins[i] += result.wins[i];
      losses[i] += result.losses[i];
      points[i] += scores[i];
    }
  }
  return { teamScores, wins, losses, points };
}

/**
 * Playoff odds as of the end of week k (k ≥ 1).
 * Cached per league/week/simulation count. Pass { useCache: false } for a week
 * that isn't final yet (stat corrections can still move it), so a provisional
 * result is never served later as that week's final odds.
 */
export function oddsThroughWeek(config, inputs, k, sims, { useCache = true } = {}) {
  const key = `odds-${config.leagueId}-${k}-${sims}-${inputs.teamIds.length}`;
  const hit = useCache ? cache.get(key) : undefined;
  if (hit) return hit;

  const standings = standingsThrough(inputs, k);
  const remainingWeeks = Math.max(inputs.regularSeasonWeeks - k, 0);
  const odds = simulatePlayoffOdds({
    ...standings,
    remainingWeeks,
    simulations: sims,
    seedKey: `${config.leagueId}:${k}`,
  });

  const result = { ...standings, remainingWeeks, odds };
  if (useCache) cache.set(key, result, PAST_WEEK_TTL);
  return result;
}

/** Before Week 1 every team is identical, so the odds are exact. */
export function preseasonOdds(teamCount) {
  return {
    playoffPct: Math.min(PLAYOFF_TEAMS / teamCount, 1),
    top4Pct: Math.min(4 / teamCount, 1),
    firstSeedPct: 1 / teamCount,
  };
}
