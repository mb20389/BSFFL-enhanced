// pages/api/scores.js
import NodeCache from "node-cache";

const cache = new NodeCache({ stdTTL: 300 }); // 5 minutes

export default async function handler(req, res) {
  const { leagueId, week } = req.query;
  const LEAGUE_ID =
    leagueId ||
    process.env.SLEEPER_LEAGUE_ID ||
    process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;

  if (!LEAGUE_ID || !week) {
    return res.status(400).json({ error: "Missing leagueId or week" });
  }

  const cacheKey = `scores-${LEAGUE_ID}-${week}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.status(200).json(cached);

  try {
    // Matchups / Users / Rosters
    const [matchupsRes, usersRes, rostersRes] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/matchups/${week}`),
      fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`),
      fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`)
    ]);

    if (!matchupsRes.ok || !usersRes.ok || !rostersRes.ok) {
      throw new Error("Sleeper API error");
    }

    const [matchups, users, rosters] = await Promise.all([
      matchupsRes.json(),
      usersRes.json(),
      rostersRes.json()
    ]);

    // Merge team info into each score row
    const enriched = (Array.isArray(matchups) ? matchups : []).map((m) => {
      const roster = rosters.find((r) => r.roster_id === m.roster_id);
      const owner = users.find((u) => u.user_id === roster?.owner_id);
      return {
        roster_id: m.roster_id,
        points: Number(m.points || 0),
        sleeper_display_name: owner?.display_name || "Unknown",
        custom_team_name: owner?.metadata?.team_name || owner?.display_name || "Unnamed Team",
        manager_name:
          owner?.metadata?.team_nickname ||
          `${owner?.metadata?.first_name || ""} ${owner?.metadata?.last_name || ""}`.trim(),
        avatar: owner?.avatar ? `https://sleepercdn.com/avatars/${owner.avatar}` : null
      };
    }).sort((a, b) => b.points - a.points);

    cache.set(cacheKey, enriched);
    return res.status(200).json(enriched);
  } catch (error) {
    console.error("scores api error:", error);
    return res.status(500).json({ error: "Failed to fetch scores" });
  }
}
