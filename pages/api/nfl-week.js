// pages/api/nfl-week.js
// Derives current/prior NFL week using Sleeper state.
// Adds "capped" values for the standings (regular season only).
// Also adds the BSFFL custom week calculation (Thursday→Thursday) for the
// requested season, which comes from the registry in lib/leagues.js.

import NodeCache from "node-cache";
import { resolveLeagueContextFromQuery } from "../../lib/leagues";
import { getSeasonWeek } from "../../lib/weeks";

const cache = new NodeCache({ stdTTL: 60 }); // 1 minute

function buildPayload(config, { currentWeek, priorWeek, rawWeek, season, season_type }) {
  const totalWeeks = config.totalWeeks || 18;
  const regularSeasonWeeks = config.regularSeasonWeeks || 14;

  // BSFFL week (Thursday→Thursday from the season's kickoff anchor)
  const bsfflWeek = getSeasonWeek(config);
  const bsfflPrior = bsfflWeek > 1 ? bsfflWeek - 1 : null;
  const bsfflCapped = Math.min(bsfflWeek, regularSeasonWeeks);

  const cappedMaxWeekForStandings = Math.min(currentWeek, regularSeasonWeeks);
  const cappedPriorForStandings =
    cappedMaxWeekForStandings > 1 ? cappedMaxWeekForStandings - 1 : null;

  return {
    // league/season context
    leagueSeason: config.season,
    leagueId: config.leagueId,
    archived: Boolean(config.archived),
    seasonStarted: bsfflWeek > 0,
    totalWeeks,
    regularSeasonWeeks,

    // NFL state (live seasons only; archived seasons report their final state)
    season,
    season_type,
    rawWeek: Number.isFinite(rawWeek) ? rawWeek : null,
    currentWeek,
    priorWeek,
    cappedMaxWeekForStandings,
    cappedPriorForStandings,
    weeksArrayAll: Array.from({ length: totalWeeks }, (_, i) => i + 1),
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
}

export default async function handler(req, res) {
  const config = resolveLeagueContextFromQuery(req.query);

  // An archived season never changes — answer from the registry, no network.
  if (config.archived) {
    const finalWeek = config.regularSeasonWeeks || 14;
    return res.status(200).json(
      buildPayload(config, {
        currentWeek: finalWeek,
        priorWeek: finalWeek > 1 ? finalWeek - 1 : null,
        rawWeek: finalWeek,
        season: config.season,
        season_type: "complete",
      })
    );
  }

  const cacheKey = `nfl-week-state-${config.season}-${config.leagueId}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.status(200).json(cached);

  try {
    const r = await fetch("https://api.sleeper.app/v1/state/nfl");
    if (!r.ok) throw new Error(`state fetch failed ${r.status}`);
    const state = await r.json();

    const season = String(state.season || "");
    const season_type = String(state.season_type || "off");
    const rawWeek = Number(state.week || 1);

    // NFL week (official)
    const totalWeeks = config.totalWeeks || 18;
    const currentWeek = Math.min(Math.max(rawWeek, 1), totalWeeks);
    const priorWeek = currentWeek > 1 ? currentWeek - 1 : null;

    const payload = buildPayload(config, {
      currentWeek,
      priorWeek,
      rawWeek,
      season,
      season_type,
    });

    cache.set(cacheKey, payload);
    res.status(200).json(payload);
  } catch (err) {
    console.error("nfl-week api error:", err);
    // Fall back to the locally computed BSFFL week — it needs no network.
    res.status(200).json(
      buildPayload(config, {
        currentWeek: 1,
        priorWeek: null,
        rawWeek: 1,
        season: config.season,
        season_type: "off",
      })
    );
  }
}
