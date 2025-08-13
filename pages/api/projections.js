// pages/api/projections.js
// Returns [{ roster_id, projected_points }] for a given league + week
// Uses an UNDOCUMENTED Sleeper projections endpoint; may change without notice.

export default async function handler(req, res) {
  const leagueId =
    req.query.leagueId || process.env.SLEEPER_LEAGUE_ID || process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;
  const week = Number(req.query.week);

  if (!leagueId || !week) {
    return res.status(400).json({ error: "Missing leagueId or week" });
  }

  try {
    // 1) Get NFL season from state (e.g., 2025)
    const stateRes = await fetch("https://api.sleeper.app/v1/state/nfl");
    if (!stateRes.ok) throw new Error("Failed to fetch NFL state");
    const state = await stateRes.json();
    const season = Number(state.season);

    // 2) League matchups for the week (to know each roster's starters)
    const matchupsRes = await fetch(
      `https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`
    );
    if (!matchupsRes.ok) throw new Error("Failed to fetch matchups");
    const matchups = await matchupsRes.json();

    // 3) Pull per-player projections for that season/week (UNDOCUMENTED)
    // Tip: restrict positions to common fantasy roster positions to keep payload reasonable.
    const projUrl =
      `https://api.sleeper.app/projections/nfl/${season}/${week}` +
      `?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF&position[]=FLEX`;

    const projRes = await fetch(projUrl);
    if (!projRes.ok) throw new Error("Failed to fetch projections");
    const projections = await projRes.json();
    // Projections typically keyed by player_id => { pts_ppr: <number>, ... }
    // Fallback to 0 if missing.
    const projPoints = new Map(
      Object.entries(projections || {}).map(([pid, p]) => [String(pid), Number(p?.pts_ppr || 0)])
    );

    // 4) Sum starters' projected points per roster
    const byRoster = new Map(); // roster_id => projected_points
    for (const m of matchups) {
      const rid = String(m.roster_id);
      const starters = Array.isArray(m.starters) ? m.starters : [];
      const total = starters.reduce((sum, pid) => sum + (projPoints.get(String(pid)) || 0), 0);
      byRoster.set(rid, (byRoster.get(rid) || 0) + total);
    }

    const result = Array.from(byRoster.entries()).map(([rid, total]) => ({
      roster_id: Number(rid),
      projected_points: Number(total.toFixed(2)),
    }));

    res.status(200).json(result);
  } catch (err) {
    console.error("projections api error:", err);
    res.status(500).json({ error: "Error fetching projections" });
  }
}