// pages/api/lineup.js
import NodeCache from "node-cache";
const cache = new NodeCache({ stdTTL: 12 * 60 * 60 }); // 12h

export default async function handler(req, res) {
  const { leagueId, week, rosterId } = req.query;
  const LEAGUE_ID =
    leagueId ||
    process.env.SLEEPER_LEAGUE_ID ||
    process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;

  if (!LEAGUE_ID || !week || !rosterId) {
    return res.status(400).json({ error: "Missing leagueId, week, or rosterId" });
  }

  try {
    // Cache players map (big payload)
    const playersKey = "players-nfl";
    let players = cache.get(playersKey);
    if (!players) {
      const pRes = await fetch("https://api.sleeper.app/v1/players/nfl");
      if (!pRes.ok) throw new Error("Failed players map");
      players = await pRes.json();
      cache.set(playersKey, players);
    }

    // Grab the week's matchups and find this roster's entry
    const mRes = await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/matchups/${week}`);
    if (!mRes.ok) throw new Error("Failed matchups");
    const matchups = await mRes.json();

    const row = Array.isArray(matchups)
      ? matchups.find((m) => String(m.roster_id) === String(rosterId))
      : null;

    if (!row) return res.status(404).json({ error: "Roster not found for this week" });

    const starters = Array.isArray(row.starters) ? row.starters : [];
    const pointsMap = row.players_points || {};

    const lineup = starters.map((pid) => {
      const meta = players[pid] || {};
      const full =
        meta.full_name ||
        (meta.first_name && meta.last_name ? `${meta.first_name} ${meta.last_name}` : "Unknown");
      return {
        id: pid,
        name: full,
        pos: meta.position || "",
        team: meta.team || meta.player_team || "",
        points: Number(pointsMap[pid] || 0),
        headshot: meta.player_id
          ? `https://sleepercdn.com/content/nfl/players/${meta.player_id}.jpg`
          : null,
      };
    });

    const total = Number(row.points || 0);

    return res.status(200).json({ roster_id: Number(rosterId), week: Number(week), total, starters: lineup });
  } catch (e) {
    console.error("lineup api error:", e);
    return res.status(500).json({ error: "Failed to fetch lineup" });
  }
}
