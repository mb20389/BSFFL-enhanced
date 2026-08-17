// lib/allPlay.js
//
// All-play scoring: every team is matched against every other team each week,
// so a week's record is "teams you outscored" – "teams that outscored you".
// Ties count for neither side.

/**
 * Build the win/loss lookups for one week's set of scores.
 *
 * @param {Array<{points: number}>} entries
 * @returns {{higherCountByPoints: Map<number, number>, lowerCountByPoints: Map<number, number>, max: number, min: number}}
 */
export function buildAllPlayRecord(entries = []) {
  const totalTeams = entries.length;

  const pointFrequency = new Map();
  entries.forEach((e) => {
    const pts = Number(e?.points || 0);
    pointFrequency.set(pts, (pointFrequency.get(pts) || 0) + 1);
  });

  const uniquePointsDesc = Array.from(pointFrequency.keys()).sort((a, b) => b - a);

  const higherCountByPoints = new Map();
  let teamsAbove = 0;
  uniquePointsDesc.forEach((pts) => {
    higherCountByPoints.set(pts, teamsAbove);
    teamsAbove += pointFrequency.get(pts) || 0;
  });

  const lowerCountByPoints = new Map();
  uniquePointsDesc.forEach((pts) => {
    const equalCount = pointFrequency.get(pts) || 0;
    const higherCount = higherCountByPoints.get(pts) || 0;
    lowerCountByPoints.set(pts, totalTeams - higherCount - equalCount);
  });

  return {
    higherCountByPoints,
    lowerCountByPoints,
    max: uniquePointsDesc[0] ?? 0,
    min: uniquePointsDesc[uniquePointsDesc.length - 1] ?? 0,
  };
}

/**
 * Attach an all-play record to each entry, ranked by the given score field.
 *
 * @param {Array<object>} entries
 * @param {string} pointsKey - which field on each entry holds the score
 * @returns {Array<{wins: number, losses: number, rank: number}>} keyed by roster_id order of input
 */
export function allPlayStandings(entries = [], pointsKey = "points") {
  const scored = entries.map((e) => ({ ...e, points: Number(e?.[pointsKey] || 0) }));
  const { higherCountByPoints, lowerCountByPoints } = buildAllPlayRecord(scored);

  const withRecord = scored.map((e) => ({
    ...e,
    wins: lowerCountByPoints.get(e.points) || 0,
    losses: higherCountByPoints.get(e.points) || 0,
  }));

  // Rank by all-play wins, breaking ties on points — the same ordering the
  // season standings use.
  const order = [...withRecord].sort((a, b) => b.wins - a.wins || b.points - a.points);
  const rankByRoster = new Map(order.map((e, i) => [String(e.roster_id), i + 1]));

  return withRecord.map((e) => ({ ...e, rank: rankByRoster.get(String(e.roster_id)) || null }));
}
