// pages/api/projections.js
import NodeCache from "node-cache";
import { resolveLeagueContextFromQuery } from "../../lib/leagues";
import { getLeagueRosters, getWeekMatchups, getWeekProjections } from "../../lib/sleeper";

const cache = new NodeCache({ stdTTL: 60 }); // cache 1 minute

export default async function handler(req, res) {
  const config = resolveLeagueContextFromQuery(req.query);
  const LEAGUE_ID = config.leagueId;
  const { week } = req.query;

  if (!LEAGUE_ID || !week) {
    return res.status(400).json({ error: "Missing leagueId or week" });
  }

  const cacheKey = `projections-${LEAGUE_ID}-${week}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.status(200).json(cached);

  try {
    // Projections belong to the league's own season, not whatever season the
    // NFL is currently in (an archive page asks for a past year).
    const season = config.season || new Date().getFullYear();

    const [projections, matchups, rosters] = await Promise.all([
      getWeekProjections(season, week),
      getWeekMatchups(config, week),
      getLeagueRosters(config),
    ]);

    // No projections for this week (yet): return nothing so the dashboard
    // shows a dash rather than a column of zeros.
    if (!projections) {
      return res.status(200).json([]);
    }

    // Sum over that week's lineup. rosters[].starters is the *current*
    // lineup, so it's only a fallback for a week with no matchups yet.
    const startersByRoster = new Map(
      matchups.map((m) => [Number(m.roster_id), Array.isArray(m.starters) ? m.starters : []])
    );
    const results = (Array.isArray(rosters) ? rosters : []).map((r) => {
      const starters =
        startersByRoster.get(Number(r.roster_id)) ?? (Array.isArray(r.starters) ? r.starters : []);
      let projected_points = 0;
      for (const pid of starters) {
        projected_points += projections.get(String(pid))?.points || 0;
      }
      return {
        roster_id: r.roster_id,
        projected_points: Math.round(projected_points * 100) / 100,
      };
    });

    cache.set(cacheKey, results);
    return res.status(200).json(results);
  } catch (err) {
    console.error("projections api error:", err);
    return res.status(500).json({ error: "Failed to fetch projections" });
  }
}
