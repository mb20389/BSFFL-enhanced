// pages/api/nfl-week.js
// Derives current/prior NFL week using Sleeper state.
// Adds "capped" values for your standings (max week 14).
// Also adds BSFFL custom week calculation (Thursday→Thursday).

import NodeCache from "node-cache";
const cache = new NodeCache({ stdTTL: 60 }); // 1 minute

function getBsfflWeek(weekOneDate, totalWeeks = 18) {
  const now = new Date();
  const start = new Date(weekOneDate); // e.g. "2025-09-04T20:00:00Z"

  if (isNaN(start.getTime())) {
    console.error("Invalid weekOneDate provided:", weekOneDate);
    return 0;
  }

  const diffMs = now - start;
  if (diffMs < 0) return 0; // season hasn’t started yet

  const weekIndex = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  return Math.min(weekIndex + 1, totalWeeks);
}

export default async function handler(req, res) {
  const cacheKey = "nfl-week-state";
  const cached = cache.get(cacheKey);
  if (cached) return res.status(200).json(cached);

  try {
    const r = await fetch("https://api.sleeper.app/v1/state/nfl");
    if (!r.ok) throw new Error(`state fetch failed ${r.status}`);
    const state = await r.json();

    // Sleeper state fields:
    const season = String(state.season || "");
    const season_type = String(state.season_type || "off");
    const rawWeek = Number(state.week || 1);

    // NFL week (official)
    const currentWeek = Math.min(Math.max(rawWeek, 1), 18);
    const priorWeek = currentWeek > 1 ? currentWeek - 1 : null;

    // Your standings cap at week 14
    const cappedMaxWeekForStandings = Math.min(currentWeek, 14);
    const cappedPriorForStandings =
      cappedMaxWeekForStandings > 1 ? cappedMaxWeekForStandings - 1 : null;

    // BSFFL week (Thursday→Thursday, kickoff week must be set)
    const weekOneDate = "2025-09-04T20:00:00Z"; // adjust for season kickoff
    const bsfflWeek = getBsfflWeek(weekOneDate, 18);
    const bsfflPrior = bsfflWeek > 1 ? bsfflWeek - 1 : null;
    const bsfflCapped = Math.min(bsfflWeek, 14);

    const payload = {
      season,
      season_type,
      rawWeek: Number.isFinite(rawWeek) ? rawWeek : null,
      currentWeek,
      priorWeek,
      cappedMaxWeekForStandings,
      cappedPriorForStandings,
      weeksArrayAll: Array.from({ length: 18 }, (_, i) => i + 1),
      weeksArrayStandings: Array.from(
        { length: Math.max(cappedMaxWeekForStandings, 1) },
        (_, i) => i + 1
      ),
      // BSFFL custom weeks
      bsfflWeek,
      bsfflPrior,
      bsfflCappedMaxWeekForStandings: bsfflCapped,
      bsfflWeeksArrayStandings: Array.from(
        { length: Math.max(bsfflCapped, 1) },
        (_, i) => i + 1
      ),
    };

    cache.set(cacheKey, payload);
    res.status(200).json(payload);
  } catch (err) {
    console.error("nfl-week api error:", err);
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
      bsfflWeek: 1,
      bsfflPrior: null,
      bsfflCappedMaxWeekForStandings: 1,
      bsfflWeeksArrayStandings: [1],
    });
  }
}
