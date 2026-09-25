// pages/api/playoff-odds-history.js
//
// How each team's playoff odds have moved, week by week. Point k is the odds
// as they stood once week k was final (the same numbers /api/playoff-odds
// showed that week). Point 0 is the preseason, when every team is even.
//
// Query: ?season=2026 (optional), ?sims=10000 (optional; match the table)
//
// Response:
//   {
//     season, weeks: [0, 1, 2, …], playoffTeams,
//     teams: [{ roster_id, custom_team_name, avatar, …,
//               playoffPct: number[], top4Pct: number[], firstSeedPct: number[] }]
//   }
// Each array is indexed like `weeks`.

import { resolveLeagueContextFromQuery } from "../../lib/leagues";
import { parseSims, PLAYOFF_TEAMS } from "../../lib/playoffOdds";
import { loadOddsInputs, oddsThroughWeek, preseasonOdds } from "../../lib/seasonOdds";

export const config = { maxDuration: 60 };

const round4 = (p) => Math.round(p * 10000) / 10000;

export default async function handler(req, res) {
  const season = resolveLeagueContextFromQuery(req.query);
  if (!season?.leagueId) return res.status(400).json({ error: "Missing leagueId" });

  const sims = parseSims(req.query.sims);

  try {
    const inputs = await loadOddsInputs(season);
    const n = inputs.teamIds.length;
    const weeksPlayed = inputs.weekScores.length;
    const pre = preseasonOdds(n);

    const teams = inputs.identities.map((id) => ({
      ...id,
      playoffPct: [round4(pre.playoffPct)],
      top4Pct: [round4(pre.top4Pct)],
      firstSeedPct: [round4(pre.firstSeedPct)],
    }));

    for (let k = 1; k <= weeksPlayed; k++) {
      const { odds } = oddsThroughWeek(season, inputs, k, sims);
      odds.teams.forEach((t) => {
        teams[t.index].playoffPct.push(round4(t.playoffPct));
        teams[t.index].top4Pct.push(round4(t.top4Pct));
        teams[t.index].firstSeedPct.push(round4(t.firstSeedPct));
      });
    }

    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");
    return res.status(200).json({
      season: season.season,
      archived: Boolean(season.archived),
      playoffTeams: PLAYOFF_TEAMS,
      weeks: Array.from({ length: weeksPlayed + 1 }, (_, i) => i),
      teams,
    });
  } catch (err) {
    console.error("playoff-odds-history api error:", err);
    return res.status(500).json({ error: "Failed to build playoff odds history" });
  }
}
