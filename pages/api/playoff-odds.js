// pages/api/playoff-odds.js
//
// Simulated playoff odds for a season (defaults to the current one).
// Uses completed regular-season weeks as the real results and simulates the
// rest. See lib/playoffOdds.js for the model and the BSFFL rules it follows.
//
// Query: ?season=2026 (optional), ?sims=10000 (optional, 1,000–50,000)

import NodeCache from "node-cache";
import { resolveLeagueContextFromQuery } from "../../lib/leagues";
import { completedRegularSeasonWeeks, identityFor, loadSeasonScores } from "../../lib/sleeper";
import { allPlayWeek, DEFAULT_SIMULATIONS, PLAYOFF_TEAMS, simulatePlayoffOdds } from "../../lib/playoffOdds";

const cache = new NodeCache({ stdTTL: 30 * 60 });

export default async function handler(req, res) {
  const config = resolveLeagueContextFromQuery(req.query);
  if (!config?.leagueId) return res.status(400).json({ error: "Missing leagueId" });

  const requested = Number(req.query.sims);
  const sims = Number.isFinite(requested)
    ? Math.min(Math.max(Math.round(requested), 1000), 50000)
    : DEFAULT_SIMULATIONS;

  const regularSeasonWeeks = config.regularSeasonWeeks || 14;
  const completedWeeks = completedRegularSeasonWeeks(config);
  const cacheKey = `odds-${config.leagueId}-${completedWeeks}-${sims}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.status(200).json(cached);

  try {
    const { weeks, users, rosters } = await loadSeasonScores(config, completedWeeks);
    const userById = new Map(users.map((u) => [u.user_id, u]));

    const teamIds = rosters.map((r) => Number(r.roster_id)).sort((a, b) => a - b);
    const indexOf = new Map(teamIds.map((id, i) => [id, i]));
    const n = teamIds.length;

    const teamScores = Array.from({ length: n }, () => []);
    const wins = new Array(n).fill(0);
    const losses = new Array(n).fill(0);
    const points = new Array(n).fill(0);

    for (const { rows } of weeks) {
      const weekScores = new Array(n).fill(0);
      rows.forEach((r) => {
        const i = indexOf.get(r.roster_id);
        if (i != null) weekScores[i] = r.points;
      });
      const result = allPlayWeek(weekScores);
      for (let i = 0; i < n; i++) {
        teamScores[i].push(weekScores[i]);
        wins[i] += result.wins[i];
        losses[i] += result.losses[i];
        points[i] += weekScores[i];
      }
    }

    const weeksPlayed = weeks.length;
    const remainingWeeks = Math.max(regularSeasonWeeks - weeksPlayed, 0);

    const base = {
      season: config.season,
      leagueId: config.leagueId,
      archived: Boolean(config.archived),
      playoffTeams: PLAYOFF_TEAMS,
      regularSeasonWeeks,
      weeksPlayed,
      remainingWeeks,
    };

    if (weeksPlayed === 0) {
      const payload = { ...base, simulations: 0, teams: [] };
      cache.set(cacheKey, payload, 5 * 60);
      return res.status(200).json(payload);
    }

    const odds = simulatePlayoffOdds({
      teamScores,
      wins,
      losses,
      points,
      remainingWeeks,
      simulations: sims,
      seedKey: `${config.leagueId}:${weeksPlayed}`,
    });

    // Current standings order (wins, then points) for the "now" rank.
    const currentOrder = teamIds
      .map((_, i) => i)
      .sort((a, b) => wins[b] - wins[a] || points[b] - points[a]);
    const currentRank = new Map(currentOrder.map((i, k) => [i, k + 1]));

    const rosterById = new Map(rosters.map((r) => [Number(r.roster_id), r]));

    const teams = odds.teams
      .map((t) => {
        const rosterId = teamIds[t.index];
        const owner = userById.get(rosterById.get(rosterId)?.owner_id);
        return {
          roster_id: rosterId,
          ...identityFor(owner, `Roster ${rosterId}`),
          currentRank: currentRank.get(t.index),
          wins: wins[t.index],
          losses: losses[t.index],
          points: Math.round(points[t.index] * 10) / 10,
          weeklyAvg: Math.round(t.weeklyAvg * 10) / 10,
          projWins: Math.round(t.projWins * 10) / 10,
          projLosses: Math.round(t.projLosses * 10) / 10,
          playoffPct: t.playoffPct,
          top4Pct: t.top4Pct,
          firstSeedPct: t.firstSeedPct,
          avgSeed: Math.round(t.avgSeed * 100) / 100,
          seedDist: t.seedDist.map((p) => Math.round(p * 10000) / 10000),
          status: t.status,
        };
      })
      .sort((a, b) => a.avgSeed - b.avgSeed || a.currentRank - b.currentRank);

    const payload = {
      ...base,
      simulations: odds.simulations,
      weeklySd: Math.round(odds.weeklySd * 10) / 10,
      leagueMean: Math.round(odds.leagueMean * 10) / 10,
      teams,
    };

    cache.set(cacheKey, payload, config.archived ? 12 * 60 * 60 : 30 * 60);
    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");
    return res.status(200).json(payload);
  } catch (err) {
    console.error("playoff-odds api error:", err);
    return res.status(500).json({ error: "Failed to simulate playoff odds" });
  }
}
