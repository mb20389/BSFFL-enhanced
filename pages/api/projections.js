// pages/api/projections.js
import NodeCache from "node-cache";
import { resolveLeagueContextFromQuery } from "../../lib/leagues";

const cache = new NodeCache({ stdTTL: 60 }); // cache 1 minute

// Helper to fetch JSON safely
async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed: ${url} (${r.status})`);
  return r.json();
}

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
    // Step 1. Get rosters for league
    const rosters = await fetchJson(
      `https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`
    );

    // Step 2. Projections belong to the league's own season, not whatever
    // season the NFL is currently in (an archive page asks for a past year).
    const season = config.season || new Date().getFullYear();

    // Step 3. Get player projections for that week
    const projData = await fetchJson(
      `https://api.sleeper.app/v1/projections/nfl/${season}/${week}`
    );

    // Build quick lookup: player_id → projected fantasy points
    const projByPlayer = new Map();
    for (const p of Array.isArray(projData) ? projData : []) {
      if (!p?.player_id) continue;
      // Use half_ppr points, fallback to ppts if available
      const pts =
        p.stats?.pts_half_ppr ??
        p.stats?.pts_ppr ??
        p.stats?.pts_standard ??
        0;
      projByPlayer.set(String(p.player_id), Number(pts));
    }

    // Step 4. Sum projections for each roster's starters
    const results = (Array.isArray(rosters) ? rosters : []).map((r) => {
      const starters = Array.isArray(r.starters) ? r.starters : [];
      let projected_points = 0;
      starters.forEach((pid) => {
        projected_points += projByPlayer.get(String(pid)) || 0;
      });
      return {
        roster_id: r.roster_id,
        projected_points,
      };
    });

    cache.set(cacheKey, results);
    return res.status(200).json(results);
  } catch (err) {
    console.error("projections api error:", err);
    return res.status(500).json({ error: "Failed to fetch projections" });
  }
}
