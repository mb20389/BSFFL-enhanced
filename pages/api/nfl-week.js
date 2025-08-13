// pages/api/nfl-week.js
// Derives current/prior NFL week using Sleeper state.
// Adds "capped" values for your standings (max week 14).

import NodeCache from "node-cache";
const cache = new NodeCache({ stdTTL: 60 }); // 1 minute

export default async function handler(req, res) {
  const cacheKey = "nfl-week-state";
  const cached = cache.get(cacheKey);
  if (cached) return res.status(200).json(cached);

  try {
    const r = await fetch("https://api.sleeper.app/v1/state/nfl");
    if (!r.ok) throw new Error(`state fetch failed ${r.status}`);
    const state = await r.json();

    // Sleeper state fields:
    // season (e.g., "2025"), season_type ("regular"|"post"|"pre"|"off"), week (number or null)
    const season = String(state.season || "");
    const season_type = String(state.season_type || "off");
    const rawWeek = Number(state.week || 1); // guard against null/undefined

    // Reasonable bounds: NFL regular season typically up to 18
    const currentWeek = Math.min(Math.max(rawWeek, 1), 18);
    const priorWeek = currentWeek > 1 ? currentWeek - 1 : null;

    // Your standings cap at week 14
    const cappedMaxWeekForStandings = Math.min(currentWeek, 14);
    const cappedPriorForStandings =
      cappedMaxWeekForStandings > 1 ? cappedMaxWeekForStandings - 1 : null;

    const payload = {
      season,
      season_type,
      rawWeek: Number.isFinite(rawWeek) ? rawWeek : null,
      currentWeek,
      priorWeek,
      cappedMaxWeekForStandings,
      cappedPriorForStandings,
      // also include a list for dropdowns
      weeksArrayAll: Array.from({ length: 18 }, (_, i) => i + 1),
      weeksArrayStandings: Array.from(
        { length: Math.max(cappedMaxWeekForStandings, 1) },
        (_, i) => i + 1
      ),
    };

    cache.set(cacheKey, payload);
    res.status(200).json(payload);
  } catch (err) {
    console.error("nfl-week api error:", err);
    // Safe fallback if state fails
    res.status(200).json({
      season: "",
      season_type: "off",
      rawWeek: 1,
      currentWeek: 1,
      priorWeek: null,
      cappedMaxWeekForStandings: 1,
      cappedPriorForStandings: null,
      weeksArrayAll: Array.from({ length: 18 }, (_, i) => i + 1),
      weeksArrayStandings: [1],
    });
  }
}