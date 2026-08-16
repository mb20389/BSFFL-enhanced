// lib/weeks.js

/**
 * Get BSFFL current week based on Thursday 8pm → next Thursday 7:59pm intervals
 * @param {string} weekOneDate - ISO string for the Thursday 8pm kickoff of Week 1
 * @param {number} totalWeeks - maximum weeks in the season (default 18)
 */
export function getBsfflWeek(weekOneDate, totalWeeks = 18) {
  const now = new Date();
  const start = new Date(weekOneDate); // e.g. "2026-09-11T00:00:00Z"

  if (isNaN(start.getTime())) {
    console.error("Invalid weekOneDate provided:", weekOneDate);
    return 0;
  }

  const diffMs = now - start;
  if (diffMs < 0) return 0; // season hasn’t started

  const weekIndex = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  return Math.min(weekIndex + 1, totalWeeks);
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
  return getBsfflWeek(config.weekOneDate, totalWeeks);
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
