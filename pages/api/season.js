// pages/api/season.js
import NodeCache from "node-cache";
import { resolveLeagueContextFromQuery } from "../../lib/leagues";
import { getStandingsMaxWeek } from "../../lib/weeks";

const cache = new NodeCache({ stdTTL: 43200 }); // 12 hours

export default async function handler(req, res) {
  const config = resolveLeagueContextFromQuery(req.query);
  const LEAGUE_ID = config.leagueId;
  // Regular season only (weeks 1–14 in both the 2025 and 2026 leagues)
  const MAX_WEEK = Math.max(getStandingsMaxWeek(config), 1);

  if (!LEAGUE_ID) {
    return res.status(400).json({ error: "Missing leagueId" });
  }

  const cacheKey = `season-${LEAGUE_ID}-${MAX_WEEK}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.status(200).json(cached);

  try {
    const seasonTotals = {};
    const rostersRes = await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`);
    const rosters = await rostersRes.json();

    const usersRes = await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`);
    const users = await usersRes.json();

    for (let week = 1; week <= MAX_WEEK; week++) {
      const matchupsRes = await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/matchups/${week}`);
      const matchups = await matchupsRes.json();
      if (!Array.isArray(matchups)) continue;

      matchups.forEach((m) => {
        const roster = rosters.find((r) => r.roster_id === m.roster_id);
        const user = users.find((u) => u.user_id === roster?.owner_id);

        if (!seasonTotals[m.roster_id]) {
          seasonTotals[m.roster_id] = {
            roster_id: m.roster_id,
            custom_team_name: roster?.metadata?.team_name || null,
            manager_name: user?.display_name || null,
            avatar: user?.avatar ? `https://sleepercdn.com/avatars/${user.avatar}` : null,
            totalPoints: 0,
            totalWins: 0,
            totalLosses: 0,
          };
        }

        const pts = Number(m.points || 0);
        seasonTotals[m.roster_id].totalPoints += pts;

        const wins = matchups.filter((o) => Number(o.points || 0) < pts).length;
        const losses = matchups.filter((o) => Number(o.points || 0) > pts).length;
        seasonTotals[m.roster_id].totalWins += wins;
        seasonTotals[m.roster_id].totalLosses += losses;
      });
    }

    const results = Object.values(seasonTotals).sort(
      (a, b) =>
        b.totalWins - a.totalWins || b.totalPoints - a.totalPoints
    );

    cache.set(cacheKey, results);
    res.status(200).json(results);
  } catch (err) {
    console.error("season api error:", err);
    res.status(500).json({ error: "Error fetching season standings" });
  }
}
