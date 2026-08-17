// pages/api/projections.js
//
// Projected final score per roster. These are LIVE projections: a player who has
// already played contributes what they actually scored, not their preseason
// number, so the total converges on the real score as the week plays out. See
// lib/liveScoring.js for the model.

import NodeCache from "node-cache";
import { resolveLeagueContextFromQuery } from "../../lib/leagues";
import { fetchJson, getProjections, getSchedule } from "../../lib/sleeper";
import { buildLiveRows } from "../../lib/liveScoring";

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
    const opts = { archived: config.archived };
    const [matchups, users, rosters, projections, schedule] = await Promise.all([
      fetchJson(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/matchups/${week}`),
      fetchJson(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`),
      fetchJson(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`),
      getProjections(config.season, week, opts).catch(() => new Map()),
      getSchedule(config.season, opts).catch(() => ({ byGameId: new Map(), byWeek: new Map() })),
    ]);

    const rows = buildLiveRows({ matchups, users, rosters, projections, schedule });

    const results = rows.map((r) => ({
      roster_id: r.roster_id,
      projected_points: r.projected,
      points: r.points,
      startersToPlay: r.startersToPlay,
      startersLive: r.startersLive,
      startersDone: r.startersDone,
    }));

    cache.set(cacheKey, results, config.archived ? 12 * 60 * 60 : 60);
    return res.status(200).json(results);
  } catch (err) {
    console.error("projections api error:", err);
    return res.status(500).json({ error: "Failed to fetch projections" });
  }
}
