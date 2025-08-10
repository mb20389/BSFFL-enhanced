// pages/api/scores.js
import fetch from "node-fetch";

export default async function handler(req, res) {
  const { leagueId, week } = req.query;

  if (!leagueId || !week) {
    return res.status(400).json({ error: "Missing leagueId or week" });
  }

  try {
    // 1️⃣ Get matchup scores for the given week
    const matchupsRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`);
    const matchups = await matchupsRes.json();

    // 2️⃣ Get all users in the league (team info)
    const usersRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`);
    const users = await usersRes.json();

    // 3️⃣ Get all rosters (links owners to rosters)
    const rostersRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`);
    const rosters = await rostersRes.json();

    // 4️⃣ Merge: Each score now has team info
    const enriched = matchups.map(m => {
      const roster = rosters.find(r => r.roster_id === m.roster_id);
      const owner = users.find(u => u.user_id === roster?.owner_id);

      return {
        roster_id: m.roster_id,
        points: m.points || 0,
        sleeper_display_name: owner?.display_name || "Unknown",
        custom_team_name: owner?.metadata?.team_name || owner?.display_name || "Unnamed Team",
        manager_name:
          owner?.metadata?.team_nickname ||
          `${owner?.metadata?.first_name || ""} ${owner?.metadata?.last_name || ""}`.trim(),
        avatar: owner?.avatar
          ? `https://sleepercdn.com/avatars/${owner.avatar}`
          : null
      };
    });

    // 5️⃣ Sort by points descending
    enriched.sort((a, b) => b.points - a.points);

    res.status(200).json(enriched);
  } catch (error) {
    console.error("Error fetching scores:", error);
    res.status(500).json({ error: "Failed to fetch scores" });
  }
}
