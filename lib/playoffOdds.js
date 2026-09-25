// lib/playoffOdds.js
//
// Monte Carlo playoff odds under BSFFL rules:
//   • Standings are all-play: each week every team plays every other team.
//   • Ties in all-play wins are broken by total points scored.
//   • The top 8 make the playoffs, seeded straight down that order (1 vs 8, 2 vs 7…).
//
// How the model works
// -------------------
// Each team gets an estimated weekly scoring average. Early in the season a
// team has only a week or two of games, so its average is pulled toward the
// league average (PRIOR_WEEKS acts like that many "average" weeks already on
// its record). Weekly spread comes from how much scores have varied around each
// team's own average, blended the same way with a league-wide default.
//
// Each simulation first draws how good every team "really" is (a team with few
// weeks played has more uncertainty), then plays out every remaining week with
// random scores around that level, scores the all-play games, and ranks the
// final standings. Counting where each team finishes across all simulations
// gives the odds.
//
// Simulations use a seeded random generator, so the same completed weeks always
// produce the same odds — the numbers only move when a week is finished.

export const PLAYOFF_TEAMS = 8;
export const DEFAULT_SIMULATIONS = 10000;

const PRIOR_WEEKS = 4;
const PRIOR_SPREAD_WEIGHT = 10;

/* ---------------- random numbers ---------------- */

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNormal(rand) {
  let spare = null;
  return function normal() {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };
}

/* ---------------- all-play scoring ---------------- */

/**
 * All-play wins/losses for one week.
 * scores: number[] indexed by team. Returns { wins, losses } arrays.
 * Equal scores are a tie (neither a win nor a loss), matching /api/scores.
 */
export function allPlayWeek(scores) {
  const n = scores.length;
  const order = scores.map((s, i) => i).sort((a, b) => scores[a] - scores[b]);
  const wins = new Array(n).fill(0);
  const losses = new Array(n).fill(0);

  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && scores[order[j + 1]] === scores[order[i]]) j++;
    const below = i;
    const above = n - 1 - j;
    for (let k = i; k <= j; k++) {
      wins[order[k]] = below;
      losses[order[k]] = above;
    }
    i = j + 1;
  }
  return { wins, losses };
}

/** Rank teams by wins, then points. Returns team indexes, best first. */
function rankTeams(wins, points) {
  return wins
    .map((_, i) => i)
    .sort((a, b) => wins[b] - wins[a] || points[b] - points[a] || a - b);
}

/* ---------------- model fitting ---------------- */

function mean(arr) {
  return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;
}

/**
 * Estimate each team's weekly scoring level and the league's weekly spread.
 * teamScores: number[][] — each team's completed weekly scores.
 */
export function fitModel(teamScores) {
  const all = teamScores.flat();
  const leagueMean = mean(all);
  const leagueVar = all.length > 1 ? all.reduce((s, x) => s + (x - leagueMean) ** 2, 0) / (all.length - 1) : 0;

  // Spread around each team's own average, blended with a league default.
  let residualSq = 0;
  let dof = 0;
  teamScores.forEach((scores) => {
    if (scores.length < 2) return;
    const m = mean(scores);
    scores.forEach((x) => {
      residualSq += (x - m) ** 2;
    });
    dof += scores.length - 1;
  });
  const priorVar = leagueVar * 0.8;
  const weeklySd = Math.sqrt((residualSq + PRIOR_SPREAD_WEIGHT * priorVar) / (dof + PRIOR_SPREAD_WEIGHT)) || 1;

  const teams = teamScores.map((scores) => {
    const n = scores.length;
    const shrunkMean = (scores.reduce((s, x) => s + x, 0) + PRIOR_WEEKS * leagueMean) / (n + PRIOR_WEEKS);
    return {
      mean: shrunkMean,
      // Uncertainty about the team's true level shrinks as weeks pile up.
      meanSd: weeklySd / Math.sqrt(n + PRIOR_WEEKS),
    };
  });

  return { leagueMean, weeklySd, teams };
}

/* ---------------- guaranteed outcomes ---------------- */

/**
 * Clinched / eliminated, from the standings alone (no simulation).
 * Each remaining week a team can win at most (teams − 1) all-play games.
 *   • Clinched: fewer than 8 other teams can even reach this team's current win total.
 *   • Eliminated: 8 or more teams already have more wins than this team's best possible total.
 * These are conservative — a team is only flagged when the result is certain.
 */
export function guaranteedStatus(wins, remainingWeeks) {
  const n = wins.length;
  const maxGain = remainingWeeks * (n - 1);
  return wins.map((w, i) => {
    let canReach = 0;
    let alreadyAhead = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      if (wins[j] + maxGain >= w) canReach++;
      if (wins[j] > w + maxGain) alreadyAhead++;
    }
    if (canReach < PLAYOFF_TEAMS) return "clinched";
    if (alreadyAhead >= PLAYOFF_TEAMS) return "eliminated";
    return null;
  });
}

/* ---------------- simulation ---------------- */

/**
 * @param {object} input
 * @param {number[][]} input.teamScores  completed weekly scores per team
 * @param {number[]}   input.wins        current all-play wins per team
 * @param {number[]}   input.losses      current all-play losses per team
 * @param {number[]}   input.points      current points for per team
 * @param {number}     input.remainingWeeks
 * @param {number}     [input.simulations]
 * @param {string}     [input.seedKey]   anything stable (league + week) to seed the RNG
 */
export function simulatePlayoffOdds({
  teamScores,
  wins,
  losses,
  points,
  remainingWeeks,
  simulations = DEFAULT_SIMULATIONS,
  seedKey = "bsffl",
}) {
  const n = wins.length;
  const model = fitModel(teamScores);
  const seedCounts = Array.from({ length: n }, () => new Array(n).fill(0));
  const winTotals = new Array(n).fill(0);
  const lossTotals = new Array(n).fill(0);

  // Nothing left to play: the standings are the answer.
  const sims = remainingWeeks > 0 ? simulations : 1;
  const rand = mulberry32(hashString(`${seedKey}:${remainingWeeks}:${sims}`));
  const normal = makeNormal(rand);

  const simWins = new Array(n);
  const simLosses = new Array(n);
  const simPoints = new Array(n);
  const level = new Array(n);
  const weekScores = new Array(n);

  for (let s = 0; s < sims; s++) {
    for (let i = 0; i < n; i++) {
      simWins[i] = wins[i];
      simLosses[i] = losses[i];
      simPoints[i] = points[i];
      level[i] = model.teams[i].mean + normal() * model.teams[i].meanSd;
    }

    for (let w = 0; w < remainingWeeks; w++) {
      for (let i = 0; i < n; i++) {
        weekScores[i] = Math.max(0, level[i] + normal() * model.weeklySd);
      }
      const week = allPlayWeek(weekScores);
      for (let i = 0; i < n; i++) {
        simWins[i] += week.wins[i];
        simLosses[i] += week.losses[i];
        simPoints[i] += weekScores[i];
      }
    }

    const ranked = rankTeams(simWins, simPoints);
    ranked.forEach((team, seedIdx) => {
      seedCounts[team][seedIdx] += 1;
    });
    for (let i = 0; i < n; i++) {
      winTotals[i] += simWins[i];
      lossTotals[i] += simLosses[i];
    }
  }

  const status = guaranteedStatus(wins, remainingWeeks);

  const teams = Array.from({ length: n }, (_, i) => {
    const dist = seedCounts[i].map((c) => c / sims);
    const sum = (from, to) => dist.slice(from, to).reduce((a, b) => a + b, 0);
    let playoffPct = sum(0, PLAYOFF_TEAMS);
    // Never show a guaranteed result as anything but certain, or vice versa.
    if (status[i] === "clinched") playoffPct = 1;
    if (status[i] === "eliminated") playoffPct = 0;
    return {
      index: i,
      playoffPct,
      top4Pct: sum(0, 4),
      firstSeedPct: dist[0],
      avgSeed: dist.reduce((acc, p, k) => acc + p * (k + 1), 0),
      projWins: winTotals[i] / sims,
      projLosses: lossTotals[i] / sims,
      weeklyAvg: model.teams[i].mean,
      seedDist: dist,
      status: status[i],
    };
  });

  return {
    simulations: sims,
    weeklySd: model.weeklySd,
    leagueMean: model.leagueMean,
    teams,
  };
}
