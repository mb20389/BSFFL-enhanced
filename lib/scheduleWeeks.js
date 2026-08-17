// lib/scheduleWeeks.js
//
// Week turnover derived from the NFL schedule instead of a hand-maintained
// calendar rule.
//
// The rule we shipped first — Thursday 8 PM ET, with a special case for
// Thanksgiving — misses weeks that open on some other day. 2026 week 12, for
// instance, starts with a Wednesday night game on 11/25, a full day before the
// Thursday turnover, so those points would have landed in week 11.
//
// Sleeper publishes the schedule, so we let it decide: a week turns over on the
// date of its own first game. The feed carries dates but no kickoff times, so
// the size of that first slate stands in for the time — a single game that day
// is a standalone prime-time kickoff (turn over at the usual evening anchor),
// while several games mean a daytime slate (turn over in the late morning).
//
// If the schedule can't be fetched we fall back to the pure calendar rule in
// lib/weeks.js, so the site still knows what week it is when Sleeper is down.

import { getSchedule, firstGameOfWeek } from "./sleeper";
import {
  etFields,
  etWallClockToInstant,
  getSeasonWeek,
  EARLY_TURNOVER_HOUR,
  EARLY_TURNOVER_MINUTE,
} from "./weeks";

/**
 * The instant each week begins, derived from the schedule.
 *
 * @returns {Map<number, number>} week → epoch ms, or null if unavailable
 */
export function buildTurnovers(schedule, config) {
  const totalWeeks = config?.totalWeeks || 18;

  // The evening anchor (weekday time-of-day) comes from the season config, so a
  // league that plays by different hours only edits weekTwoDate.
  const anchorSource = config?.weekTwoDate || config?.weekOneDate;
  const anchor = anchorSource ? etFields(new Date(anchorSource)) : null;
  const anchorHour = anchor?.hour ?? 20;
  const anchorMinute = anchor?.minute ?? 0;

  const turnovers = new Map();

  for (let week = 1; week <= totalWeeks; week++) {
    const first = firstGameOfWeek(schedule, week);
    if (!first) continue;

    const [year, month, day] = first.date.split("-").map(Number);
    if (!year || !month || !day) continue;

    const [hour, minute] = first.standalone
      ? [anchorHour, anchorMinute]
      : [EARLY_TURNOVER_HOUR, EARLY_TURNOVER_MINUTE];

    turnovers.set(week, etWallClockToInstant(year, month, day, hour, minute));
  }

  return turnovers.size ? turnovers : null;
}

/** Current week from a turnover map. */
export function weekFromTurnovers(turnovers, now = new Date()) {
  if (!turnovers?.size) return null;
  const ts = now.getTime();

  let current = 0;
  for (const [week, start] of Array.from(turnovers.entries()).sort((a, b) => a[0] - b[0])) {
    if (ts >= start) current = week;
    else break;
  }
  return current;
}

/**
 * The current league week, preferring the schedule and falling back to the
 * calendar rule.
 *
 * @returns {Promise<{week: number, source: "schedule"|"calendar"}>}
 */
export async function resolveSeasonWeek(config) {
  const calendarWeek = getSeasonWeek(config);

  // An archived season is finished; no need to ask the network.
  if (config?.archived) return { week: calendarWeek, source: "calendar" };

  try {
    const schedule = await getSchedule(config.season, { archived: config.archived });
    const turnovers = buildTurnovers(schedule, config);
    const week = weekFromTurnovers(turnovers);
    if (week == null) return { week: calendarWeek, source: "calendar" };
    return { week: Math.min(week, config.totalWeeks || 18), source: "schedule" };
  } catch (err) {
    console.error("schedule week lookup failed, using calendar rule:", err.message);
    return { week: calendarWeek, source: "calendar" };
  }
}
