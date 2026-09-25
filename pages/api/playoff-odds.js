// pages/api/playoff-odds.js
//
// Simulated playoff odds for a season (defaults to the current one).
// Uses completed regular-season weeks as the real results and simulates the
// rest. See lib/playoffOdds.js for the model and the BSFFL rules it follows.
//
// Query: ?season=2026 (optional), ?sims=10000 (optional, 1,000–50,000)

import { resolveLeagueContextFromQuery } from "../../lib/leagues";
import { parseSims, PLAYOFF_TEAMS } from "../../lib/playoffOdds";
import { loadOddsInputs, oddsThroughWeek } from "../../lib/seasonOdds";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const season = resolveLeagueContextFromQuery(req.query);
  if (!season?.leagueId) return res.status(400).json({ error: "Missing leagueId" });

  const sims = parseSims(req.query.sims);

  try {
    const inputs = await loadOddsInputs(season);
    const weeksPlayed = inputs.weekScores.length;

    const base = {
      season: season.season,
      leagueId: season.leagueId,
      archived: Boolean(season.archived),
      playoffTeams: PLAYOFF_TEAMS,
      regularSeasonWeeks: inputs.regularSeasonWeeks,
      weeksPlayed,
      remainingWeeks: Math.max(inputs.regularSeasonWeeks - weeksPlayed, 0),
    };

    if (weeksPlayed === 0) {
      return res.status(200).json({ ...base, simulations: 0, teams: [] });
    }

    const { wins, losses, points, odds } = oddsThroughWeek(season, inputs, weeksPlayed, sims);

    // Current standings order (wins, then points) for the "now" rank.
    const currentOrder = inputs.teamIds
      .map((_, i) => i)
      .sort((a, b) => wins[b] - wins[a] || points[b] - points[a]);
    const currentRank = new Map(currentOrder.map((i, k) => [i, k + 1]));

    const teams = odds.teams
      .map((t) => ({
        ...inputs.identities[t.index],
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
      }))
      .sort((a, b) => a.avgSeed - b.avgSeed || a.currentRank - b.currentRank);

    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");
    return res.status(200).json({
      ...base,
      simulations: odds.simulations,
      weeklySd: Math.round(odds.weeklySd * 10) / 10,
      leagueMean: Math.round(odds.leagueMean * 10) / 10,
      teams,
    });
  } catch (err) {
    console.error("playoff-odds api error:", err);
    return res.status(500).json({ error: "Failed to simulate playoff odds" });
  }
}
