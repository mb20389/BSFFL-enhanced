// pages/api/league.js
// League metadata (name, status, size) for the requested season, so the UI can
// title itself from Sleeper instead of a hardcoded league name.

import NodeCache from "node-cache";
import { resolveLeagueContextFromQuery } from "../../lib/leagues";

const cache = new NodeCache({ stdTTL: 60 * 60 }); // 1 hour

export default async function handler(req, res) {
  const config = resolveLeagueContextFromQuery(req.query);
  const LEAGUE_ID = config.leagueId;

  if (!LEAGUE_ID) {
    return res.status(400).json({ error: "Missing leagueId" });
  }

  const fallback = {
    leagueId: LEAGUE_ID,
    season: config.season,
    name: config.name || "League",
    status: config.archived ? "complete" : null,
    totalRosters: null,
    playoffWeekStart: (config.regularSeasonWeeks || 14) + 1,
    archived: Boolean(config.archived),
  };

  const cacheKey = `league-${LEAGUE_ID}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.status(200).json(cached);

  try {
    const r = await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}`);
    if (!r.ok) throw new Error(`league fetch failed ${r.status}`);
    const league = await r.json();

    const payload = {
      leagueId: LEAGUE_ID,
      season: String(league?.season || config.season),
      name: league?.name || fallback.name,
      status: league?.status || fallback.status,
      totalRosters: Number(league?.total_rosters) || null,
      playoffWeekStart: Number(league?.settings?.playoff_week_start) || fallback.playoffWeekStart,
      archived: Boolean(config.archived),
      avatar: league?.avatar ? `https://sleepercdn.com/avatars/${league.avatar}` : null,
    };

    cache.set(cacheKey, payload, config.archived ? 12 * 60 * 60 : 60 * 60);
    return res.status(200).json(payload);
  } catch (err) {
    console.error("league api error:", err);
    // Registry data is enough to render the page without Sleeper.
    return res.status(200).json(fallback);
  }
}
