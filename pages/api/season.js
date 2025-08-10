// pages/api/season.js
import NodeCache from "node-cache";

const cache = new NodeCache({ stdTTL: 6 * 60 * 60 }); // 6 hours

export default async function handler(req, res) {
  const { leagueId } = req.query;
  const LEAGUE_ID =
    leagueId ||
    process.env.SLEEPER_LEAGUE_ID ||
    process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;

  if (!LEAGUE_ID) {
    return res.status(400).json({ error: "Missing leagueId" });
  }

  const cacheKey = `season-${LEAGUE_ID}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.status(200).json(cached);

  try {
    // load owner + roster info for names/avatars
    const [usersRes, rostersRes] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`),
      fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`),
    ]);
    if (!usersRes.ok || !rostersRes.ok) throw new Error("Sleeper API error");
    const [users, rosters] = await Promise.all([usersRes.json(), rostersRes.json()]);

    // map for quick roster->owner lookup
    const ownerByRosterId = {};
    rosters.forEach((r) => {
      const owner = users.find((u) => u.user_id === r.owner_id);
      ownerByRosterId[r.roster_id] = owner || null;
    });

    // iterate weeks and accumulate
    const totals = {}; // { [roster_id]: { totalPoints, totalWins, totalLosses } }
    for (let w = 1; w <= 18; w++) {
      const r = await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/matchups/${w}`);
      if (!r.ok) break;
      const arr = await r.json();
      if (!Array.isArray(arr) || arr.length === 0) {
        // stop when we hit an empty week (post-season or pre-season)
        if (w > 3) break;
        continue;
      }

      // normalize
      const weekRows = arr
        .filter((m) => m && m.roster_id != null)
        .map((m) => ({ roster_id: m.roster_id, points: Number(m.points || 0) }));

      if (weekRows.length === 0) continue;

      // add points
      weekRows.forEach(({ roster_id, points }) => {
        if (!totals[roster_id]) totals[roster_id] = { totalPoints: 0, totalWins: 0, totalLosses: 0 };
        totals[roster_id].totalPoints += points;
      });

      // all-play W/L for the week
      weekRows.forEach(({ roster_id, points }) => {
        const wins = weekRows.filter((x) => x.points < points).length;
        const losses = weekRows.filter((x) => x.points > points).length;
        totals[roster_id].totalWins += wins;
        totals[roster_id].totalLosses += losses;
      });
    }

    // format + enrich with names/avatars
    const rows = Object.entries(totals).map(([roster_id, t]) => {
      const owner = ownerByRosterId[roster_id];
      return {
        roster_id: Number(roster_id),
        totalPoints: t.totalPoints,
        totalWins: t.totalWins,
        totalLosses: t.totalLosses,
        custom_team_name: owner?.metadata?.team_name || owner?.display_name || `Roster ${roster_id}`,
        manager_name:
          owner?.metadata?.team_nickname ||
          `${owner?.metadata?.first_name || ""} ${owner?.metadata?.last_name || ""}`.trim() ||
          owner?.display_name ||
          "—",
        avatar: owner?.avatar ? `https://sleepercdn.com/avatars/${owner.avatar}` : null,
      };
    });

    // sort by wins desc, then points desc
    rows.sort((a, b) => b.totalWins - a.totalWins || b.totalPoints - a.totalPoints);

    cache.set(cacheKey, rows);
    return res.status(200).json(rows);
  } catch (err) {
    console.error("season api error:", err);
    return res.status(500).json({ error: "Failed to compute season standings" });
  }
}
