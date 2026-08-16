// lib/weeks.js

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Get BSFFL current week based on Thursday 8pm → next Thursday 7:59pm intervals.
 *
 * When a season opens on something other than a Thursday (2026 starts with a
 * Wednesday night game on 9/9), pass `weekTwoDate` to say where the normal
 * Thursday cadence resumes. Week 1 then simply runs long — every later week
 * still rolls over on Thursday, so TNF always lands at the start of its week.
 *
 * @param {string} weekOneDate - ISO string for the 8pm ET kickoff of Week 1
 * @param {number} totalWeeks - maximum weeks in the season (default 18)
 * @param {string|null} weekTwoDate - optional ISO string for the start of Week 2
 *   (defaults to one week after Week 1)
 */
export function getBsfflWeek(weekOneDate, totalWeeks = 18, weekTwoDate = null) {
  const now = new Date();
  const start = new Date(weekOneDate); // e.g. "2026-09-10T00:00:00Z"

  if (isNaN(start.getTime())) {
    console.error("Invalid weekOneDate provided:", weekOneDate);
    return 0;
  }

  if (now < start) return 0; // season hasn’t started

  const parsedWeekTwo = weekTwoDate ? new Date(weekTwoDate) : null;
  const weekTwoStart =
    parsedWeekTwo && !isNaN(parsedWeekTwo.getTime())
      ? parsedWeekTwo
      : new Date(start.getTime() + WEEK_MS);

  if (now < weekTwoStart) return 1;

  const weekIndex = Math.floor((now - weekTwoStart) / WEEK_MS);
  return Math.min(weekIndex + 2, totalWeeks);
}

/**
 * Season-aware wrapper around getBsfflWeek.
 * An archived season is finished by definition, so it always reports its final
 * week — that keeps completed-week logic (high/low weeks) counting every week.
 *
 * @param {object} config - a season config from lib/leagues.js
 */
export function getSeasonWeek(config) {
  if (!config) return 0;
  const totalWeeks = config.totalWeeks || 18;
  if (config.archived) return totalWeeks;
  return getBsfflWeek(config.weekOneDate, totalWeeks, config.weekTwoDate);
}

/** Has Week 1 kicked off for this season yet? */
export function hasSeasonStarted(config) {
  return getSeasonWeek(config) > 0;
}

/**
 * Highest week the standings should include: the current week, capped at the
 * end of the regular season.
 */
export function getStandingsMaxWeek(config) {
  const cap = config?.regularSeasonWeeks || 14;
  return Math.min(getSeasonWeek(config), cap);
}
