// lib/weeks.js
//
// League weeks turn over shortly before the first kickoff of each week, so the
// site is already showing week N when week N's first game starts.
//
//   • Normal week      → Thursday 8:00 PM ET, ahead of the 8:15 PM TNF kickoff.
//   • Thanksgiving     → 11:00 AM ET, ahead of the 12:30 PM early game.
//   • Non-Thursday openers (2026 starts Wednesday 9/9) → see weekOneDate /
//     weekTwoDate in lib/leagues.js.
//
// Boundaries are resolved against the America/New_York wall clock rather than
// fixed 7-day arithmetic, so they stay at the same local time when DST ends in
// November instead of sliding an hour earlier.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ET_ZONE = "America/New_York";

// Thanksgiving's early game kicks off at 12:30 PM ET.
export const EARLY_TURNOVER_HOUR = 11;
export const EARLY_TURNOVER_MINUTE = 0;

const etFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ET_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Calendar fields of an instant as read off an Eastern-time clock. */
export function etFields(instant) {
  const parts = etFormatter.formatToParts(instant);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset in ms between the ET wall clock and UTC at a given instant. */
function etOffset(instant) {
  const f = etFields(instant);
  return Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second) - instant.getTime();
}

/** The instant at which the ET wall clock reads the given local date/time. */
export function etWallClockToInstant(year, month, day, hour, minute) {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const guess = naive - etOffset(new Date(naive));
  // Re-resolve once, in case the first guess landed on the far side of a DST shift.
  return naive - etOffset(new Date(guess));
}

/** Thanksgiving is the fourth Thursday in November. */
function isThanksgiving(year, month, day) {
  if (month !== 11 || day < 22 || day > 28) return false;
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 4;
}

function toIsoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The instant week `weekNumber` (2 or later) begins.
 *
 * The recurring turnover takes its weekday and time of day from `weekTwoStart`,
 * then repeats every 7 calendar days on the ET clock — except on days that kick
 * off early, which turn over in the morning instead.
 */
function turnoverInstant(weekTwoStart, weekNumber, earlyTurnoverDates = []) {
  const anchor = etFields(weekTwoStart);
  const shifted = new Date(
    Date.UTC(anchor.year, anchor.month - 1, anchor.day + 7 * (weekNumber - 2))
  );
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();

  const isEarly =
    isThanksgiving(year, month, day) || earlyTurnoverDates.includes(toIsoDate(year, month, day));

  return isEarly
    ? etWallClockToInstant(year, month, day, EARLY_TURNOVER_HOUR, EARLY_TURNOVER_MINUTE)
    : etWallClockToInstant(year, month, day, anchor.hour, anchor.minute);
}

/**
 * Get the current league week.
 *
 * @param {string} weekOneDate - ISO instant at which Week 1 begins
 * @param {number} totalWeeks - maximum weeks in the season (default 18)
 * @param {string|null} weekTwoDate - ISO instant at which Week 2 begins, which
 *   also sets the weekday and time of every later turnover. Defaults to one
 *   week after Week 1; pass it when the season opens on a non-Thursday.
 * @param {string[]} earlyTurnoverDates - extra `YYYY-MM-DD` dates (ET) that
 *   should turn over in the morning because that week kicks off early.
 *   Thanksgiving is detected automatically.
 */
export function getBsfflWeek(
  weekOneDate,
  totalWeeks = 18,
  weekTwoDate = null,
  earlyTurnoverDates = []
) {
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

  // Estimate from even 7-day spacing, then walk to the true boundary. DST and
  // early-turnover days move a boundary by at most a few hours, so this settles
  // in an iteration or two.
  let week = Math.floor((now - weekTwoStart) / WEEK_MS) + 2;
  while (week > 2 && now < turnoverInstant(weekTwoStart, week, earlyTurnoverDates)) week -= 1;
  while (now >= turnoverInstant(weekTwoStart, week + 1, earlyTurnoverDates)) week += 1;

  return Math.min(week, totalWeeks);
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
  return getBsfflWeek(
    config.weekOneDate,
    totalWeeks,
    config.weekTwoDate,
    config.earlyTurnoverDates || []
  );
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
