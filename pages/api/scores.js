// pages/api/scores.js
import NodeCache from "node-cache";

const cache = new NodeCache({ stdTTL: 5 * 60 }); // 5 minutes

export default async function handler(req, res) {
  const { leagueId, week } = req.query;

  const LEAGUE_ID =
    leagueId ||
    process.env.SLEEPER_LEAGUE_ID ||
    process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;

  // Basic validation
  const wk = Number(week);
  if (!LEAGUE_ID || !wk || isNaN(wk) || wk < 1 || wk > 50) {
    return res.status(400).json({ error: "Missing or invalid leagueId/week" });
  }

  const cacheKey = `scores-${LEAGUE_ID}-${wk}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.status(200).json(cached);

  try {
    // Fetch weekly matchups, users (owners), and rosters (roster_id -> owner_id)
    const [matchupsRes, usersRes, rostersRes] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/matchups/${wk}`),
      fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`),
      fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`),
    ]);

    if (!matchupsRes.ok || !usersRes.ok || !rostersRes.ok) {
      throw new Error("Sleeper API error");
    }

    const [matchups, users, rosters] = await Promise.all([
      matchupsRes.json(),
      usersRes.json(),
      rostersRes.json(),
    ]);

    // Enrich each matchup row with team + manager + avatar
    const enriched = (Array.isArray(matchups) ? matchups : [])
      .filter((m) => m && m.roster_id != null)
      .map((m) => {
        const roster = rosters.find((r) => r.roster_id === m.roster_id);
        const owner = users.find((u) => u.user_id === roster?.owner_id);

        return {
          roster_id: m.roster_id,
          matchup_id: m.matchup_id ?? null, // future-proof; not required for current UI
          points: Number(m.points || 0),

          // Team / manager metadata from Sleeper user profile
          sleeper_display_name: owner?.display_name || "Unknown",
          custom_team_name:
            owner?.metadata?.team_name || owner?.display_name || `Roster ${m.roster_id}`,
          manager_name:
            owner?.metadata?.team_nickname ||
            `${owner?.metadata?.first_name || ""} ${owner?.metadata?.last_name || ""}`.trim() ||
            owner?.display_name ||
            null,
          avatar: owner?.avatar ? `https://sleepercdn.com/avatars/${owner.avatar}` : null,
        };
      })
      // Sort by points desc to make the table nice by default
      .sort((a, b) => b.points - a.points);

    cache.set(cacheKey, enriched);
    return res.status(200).json(enriched);
  } catch (err) {
    console.error("scores api error:", err);
    return res.status(500).json({ error: "Failed to fetch scores" });
  }
}
