// lib/weeks.js

/**
 * Get BSFFL current week based on Thursday 8pm → next Thursday 7:59pm intervals
 * @param {string} weekOneDate - ISO string for the Thursday 8pm kickoff of Week 1
 * @param {number} totalWeeks - maximum weeks in the season (default 18)
 */
export function getBsfflWeek(weekOneDate, totalWeeks = 18) {
  const now = new Date();
  const start = new Date(weekOneDate); // e.g. "2025-09-04T20:00:00Z"

  if (isNaN(start.getTime())) {
    console.error("Invalid weekOneDate provided:", weekOneDate);
    return 0;
  }

  const diffMs = now - start;
  if (diffMs < 0) return 0; // season hasn’t started

  const weekIndex = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  return Math.min(weekIndex + 1, totalWeeks);
}
