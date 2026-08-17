// pages/api/nfl-week.js
// Derives current/prior NFL week using Sleeper state.
// Adds "capped" values for the standings (regular season only).
//
// The league's own week comes from the NFL schedule where possible — each week
// turns over on the date of its first game — falling back to the calendar rule
// in lib/weeks.js when the schedule can't be fetched. See lib/scheduleWeeks.js.

import NodeCache from "node-cache";
import { resolveLeagueContextFromQuery } from "../../lib/leagues";
import { getSeasonWeek } from "../../lib/weeks";
import { resolveSeasonWeek, buildTurnovers } from "../../lib/scheduleWeeks";
import { getSchedule, firstGameOfWeek } from "../../lib/sleeper";

const cache = new NodeCache({ stdTTL: 60 }); // 1 minute

function buildPayload(
  config,
  { currentWeek, priorWeek, rawWeek, season, season_type, bsfflWeek, weekSource }
) {
  const totalWeeks = config.totalWeeks || 18;
  const regularSeasonWeeks = config.regularSeasonWeeks || 14;

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
    // "schedule" when derived from the NFL schedule, "calendar" when the
    // fallback rule was used.
    weekSource,
  };
}

/** Turnover instants for every week, for debugging the week boundaries. */
async function debugTurnovers(config) {
  try {
    const schedule = await getSchedule(config.season, { archived: config.archived });
    const turnovers = buildTurnovers(schedule, config);
    if (!turnovers) return null;
    return Array.from(turnovers.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([week, ts]) => {
        const first = firstGameOfWeek(schedule, week);
        return {
          week,
          turnsOverAt: new Date(ts).toISOString(),
          turnsOverEt: new Date(ts).toLocaleString("en-US", {
            timeZone: "America/New_York",
            weekday: "short",
            month: "numeric",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }),
          firstGameDate: first?.date || null,
          gamesOnFirstDate: first?.gamesOnDate ?? null,
        };
      });
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const config = resolveLeagueContextFromQuery(req.query);
  const wantsDebug = req.query.debug === "1";

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
        bsfflWeek: getSeasonWeek(config),
        weekSource: "calendar",
      })
    );
  }

  const cacheKey = `nfl-week-state-${config.season}-${config.leagueId}`;
  const cached = cache.get(cacheKey);
  if (cached && !wantsDebug) return res.status(200).json(cached);

  try {
    const [stateRes, leagueWeek] = await Promise.all([
      fetch("https://api.sleeper.app/v1/state/nfl"),
      resolveSeasonWeek(config),
    ]);
    if (!stateRes.ok) throw new Error(`state fetch failed ${stateRes.status}`);
    const state = await stateRes.json();

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
      bsfflWeek: leagueWeek.week,
      weekSource: leagueWeek.source,
    });

    cache.set(cacheKey, payload);

    if (wantsDebug) {
      return res.status(200).json({ ...payload, turnovers: await debugTurnovers(config) });
    }
    return res.status(200).json(payload);
  } catch (err) {
    console.error("nfl-week api error:", err);
    // Fall back to the locally computed week — it needs no network.
    res.status(200).json(
      buildPayload(config, {
        currentWeek: 1,
        priorWeek: null,
        rawWeek: 1,
        season: config.season,
        season_type: "off",
        bsfflWeek: getSeasonWeek(config),
        weekSource: "calendar",
      })
    );
  }
}
