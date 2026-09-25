// lib/recap/data.js
//
// Gathers every number the weekly recap email needs for one finished week:
//
//   • All-play results for the week and all-play standings for the season.
//   • The top and bottom scores, with the starters who drove them.
//   • For the bottom score, the lineup decisions behind it: points left on the
//     bench, which bench players should have started, empty or zero-point
//     starters, and how the optimal lineup would have finished.
//   • Playoff odds before and after the week (same model and seeds as
//     /playoffs, so the email matches the site), plus recent form.
//
// Everything here is plain data; lib/recap/narrative.js turns it into prose
// and lib/recap/email.js renders it.

import { DEFAULT_SIMULATIONS, allPlayWeek } from "../playoffOdds";
import { loadOddsInputs, oddsThroughWeek, preseasonOdds, standingsThrough } from "../seasonOdds";
import { getLeague, getLeagueRosters, getNflPlayers, getWeekMatchups } from "../sleeper";

const RECENT_WEEKS = 3;

const round1 = (x) => Math.round(x * 10) / 10;
const round3 = (x) => Math.round(x * 1000) / 1000;

/* ---------------- standings ---------------- */

/** Rank team indexes by all-play wins, then total points (the BSFFL tiebreak). */
function rankOrder(wins, points) {
  return wins.map((_, i) => i).sort((a, b) => wins[b] - wins[a] || points[b] - points[a] || a - b);
}

function rankMap(wins, points) {
  const ranks = new Array(wins.length);
  rankOrder(wins, points).forEach((team, pos) => {
    ranks[team] = pos + 1;
  });
  return ranks;
}

/** Each team's finish (1 = high score) in every week played so far. */
function weeklyFinishes(weekScores) {
  return weekScores.map((scores) => {
    const order = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
    const finish = new Array(scores.length);
    order.forEach((team, pos) => {
      finish[team] = pos + 1;
    });
    return finish;
  });
}

/** How many weeks in a row, ending with the latest, a team finished in the top/bottom half. */
function halfStreak(finishes, team, teamCount) {
  const half = teamCount / 2;
  const top = (w) => finishes[w][team] <= half;
  const last = finishes.length - 1;
  if (last < 0) return null;
  const inTop = top(last);
  let length = 0;
  for (let w = last; w >= 0 && top(w) === inTop; w--) length++;
  return { half: inTop ? "top" : "bottom", weeks: length };
}

/* ---------------- lineups ---------------- */

// Which player positions can fill each Sleeper lineup slot.
const SLOT_ELIGIBILITY = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  DEF: ["DEF"],
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  DL: ["DL", "DE", "DT"],
  LB: ["LB"],
  DB: ["DB", "CB", "S"],
  IDP_FLEX: ["DL", "DE", "DT", "LB", "DB", "CB", "S"],
};

const NON_STARTING_SLOTS = new Set(["BN", "IR", "TAXI"]);

function playerInfo(players, id, pointsMap, projections) {
  const meta = players?.[id] || {};
  const name =
    meta.full_name ||
    (meta.first_name && meta.last_name ? `${meta.first_name} ${meta.last_name}` : null) ||
    (meta.position === "DEF" ? `${id} D/ST` : `Player ${id}`);
  const positions = Array.isArray(meta.fantasy_positions) && meta.fantasy_positions.length
    ? meta.fantasy_positions
    : [meta.position || (/^[A-Z]{2,3}$/.test(id) ? "DEF" : "")];
  const projection = projections?.get(String(id));
  return {
    id,
    name,
    pos: meta.position || positions[0] || "",
    positions,
    nflTeam: meta.team || (positions[0] === "DEF" ? id : ""),
    points: round1(Number(pointsMap?.[id] || 0)),
    projected: projection ? round1(projection.points) : null,
    opponent: projection?.opponent || null,
    injuryStatus: meta.injury_status || null,
  };
}

/**
 * Best possible lineup from the players on the roster that week. Slots with the
 * fewest eligible positions are filled first, which is optimal for the usual
 * nested flex layouts (FLEX ⊂ SUPER_FLEX, etc.).
 */
function optimalLineup(slots, candidates) {
  const order = slots
    .map((slot, i) => ({ slot, i, width: (SLOT_ELIGIBILITY[slot] || []).length || 99 }))
    .sort((a, b) => a.width - b.width || a.i - b.i);
  const pool = [...candidates].sort((a, b) => b.points - a.points);
  const used = new Set();
  const picks = new Array(slots.length).fill(null);

  for (const { slot, i } of order) {
    const eligible = SLOT_ELIGIBILITY[slot];
    const pick = pool.find(
      (p) => !used.has(p.id) && (!eligible || p.positions.some((pos) => eligible.includes(pos)))
    );
    if (pick) {
      used.add(pick.id);
      picks[i] = pick;
    }
  }
  return picks;
}

/** Starters, bench and lineup-decision analysis for one team's week. */
function lineupDetail({ matchup, roster, slots, players, projections }) {
  const pointsMap = matchup.players_points || {};
  const starterIds = Array.isArray(matchup.starters) ? matchup.starters : [];
  const reserved = new Set([...(roster?.reserve || []), ...(roster?.taxi || [])]);

  const starters = slots.map((slot, i) => {
    const id = starterIds[i];
    if (!id || id === "0") return { slot, empty: true, name: "(empty slot)", points: 0 };
    return { slot, ...playerInfo(players, id, pointsMap, projections) };
  });

  const starterSet = new Set(starterIds.filter((id) => id && id !== "0"));
  const bench = (Array.isArray(matchup.players) ? matchup.players : [])
    .filter((id) => !starterSet.has(id) && !reserved.has(id))
    .map((id) => playerInfo(players, id, pointsMap, projections))
    .sort((a, b) => b.points - a.points);

  const actual = round1(Number(matchup.points || 0));
  const filled = starters.filter((s) => !s.empty);
  const optimal = optimalLineup(slots, [...filled, ...bench]);
  const optimalPoints = round1(optimal.reduce((s, p) => s + (p?.points || 0), 0));
  const optimalIds = new Set(optimal.filter(Boolean).map((p) => p.id));

  // Pair each bench player who belonged in the lineup with the lowest-scoring
  // benched-in-hindsight starter whose slot he could actually have filled.
  const shouldHaveStarted = bench.filter((p) => optimalIds.has(p.id));
  const shouldHaveSat = [
    ...starters.filter((s) => s.empty),
    ...filled.filter((s) => !optimalIds.has(s.id)),
  ].sort((a, b) => a.points - b.points);
  const swaps = shouldHaveStarted.map((benchPlayer) => {
    const fits = (s) => {
      const eligible = SLOT_ELIGIBILITY[s.slot];
      return !eligible || benchPlayer.positions.some((pos) => eligible.includes(pos));
    };
    const idx = shouldHaveSat.findIndex(fits);
    const insteadOf = idx >= 0 ? shouldHaveSat.splice(idx, 1)[0] : shouldHaveSat.shift() || null;
    return {
      start: benchPlayer,
      insteadOf,
      gain: round1(benchPlayer.points - (insteadOf?.points || 0)),
    };
  });

  return {
    points: actual,
    starters,
    topContributors: [...filled]
      .sort((a, b) => b.points - a.points)
      .slice(0, 3)
      .map((p) => ({ ...p, shareOfTotal: actual > 0 ? round3(p.points / actual) : 0 })),
    bench: bench.slice(0, 6),
    optimalPoints,
    pointsLeftOnBench: round1(Math.max(optimalPoints - actual, 0)),
    swaps,
    emptySlots: starters.filter((s) => s.empty).map((s) => s.slot),
    zeroPointStarters: filled.filter((s) => s.points <= 0),
    // No projection usually means the player was on bye or ruled out before kickoff.
    startersWithNoGame: projections ? filled.filter((s) => s.projected == null) : [],
    biggestDisappointments: filled
      .filter((s) => s.projected != null)
      .map((s) => ({ ...s, vsProjection: round1(s.points - s.projected) }))
      .sort((a, b) => a.vsProjection - b.vsProjection)
      .slice(0, 3),
  };
}

/**
 * Half-PPR projections for a week (the league's scoring), keyed by player ID.
 * The v1 projections endpoint no longer returns stats, so this uses the one
 * Sleeper's own app calls.
 */
async function loadProjections(season, week) {
  try {
    const positions = ["QB", "RB", "WR", "TE", "K", "DEF"].map((p) => `position[]=${p}`).join("&");
    const r = await fetch(
      `https://api.sleeper.com/projections/nfl/${season}/${week}?season_type=regular&${positions}`
    );
    if (!r.ok) return null;
    const data = await r.json();
    const map = new Map();
    for (const p of Array.isArray(data) ? data : []) {
      if (!p?.player_id) continue;
      const pts = p.stats?.pts_half_ppr ?? p.stats?.pts_ppr ?? p.stats?.pts_std;
      if (pts != null) map.set(String(p.player_id), { points: Number(pts), opponent: p.opponent || null });
    }
    return map.size ? map : null;
  } catch {
    return null;
  }
}

/* ---------------- main ---------------- */

/**
 * @param {object} config  a season config from lib/leagues.js
 * @param {number} week    the finished regular-season week to recap
 */
export async function buildRecapData(config, week) {
  const inputs = await loadOddsInputs(config, week);
  if (inputs.weekScores.length < week) {
    throw new Error(`Week ${week} has no scores yet`);
  }

  const n = inputs.teamIds.length;
  const sims = DEFAULT_SIMULATIONS;
  const w = week - 1; // index into weekScores
  const scores = inputs.weekScores[w];
  const team = (i) => ({
    roster_id: inputs.identities[i].roster_id,
    team: inputs.identities[i].custom_team_name,
    manager: inputs.identities[i].manager_name,
  });

  /* ---- this week ---- */
  const weekResult = allPlayWeek(scores);
  const weekOrder = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
  const weekStandings = weekOrder.map((i, pos) => ({
    rank: pos + 1,
    ...team(i),
    points: round1(scores[i]),
    wins: weekResult.wins[i],
    losses: weekResult.losses[i],
  }));
  const sortedScores = [...scores].sort((a, b) => a - b);
  const leagueWeek = {
    average: round1(scores.reduce((s, x) => s + x, 0) / n),
    median: round1((sortedScores[Math.floor((n - 1) / 2)] + sortedScores[Math.ceil((n - 1) / 2)]) / 2),
    high: round1(sortedScores[n - 1]),
    low: round1(sortedScores[0]),
  };

  /* ---- season standings + odds ---- */
  const now = standingsThrough(inputs, week);
  const before = standingsThrough(inputs, week - 1);
  const rankNow = rankMap(now.wins, now.points);
  const rankBefore = week > 1 ? rankMap(before.wins, before.points) : null;

  const oddsNow = oddsThroughWeek(config, inputs, week, sims, { useCache: false }).odds.teams;
  const pre = preseasonOdds(n);
  const oddsFor = (k) =>
    k >= 1
      ? oddsThroughWeek(config, inputs, k, sims).odds.teams
      : Array.from({ length: n }, () => ({ ...pre, status: null }));
  const oddsBefore = oddsFor(week - 1);
  const trendStart = Math.max(week - RECENT_WEEKS, 0);
  const oddsTrendStart = oddsFor(trendStart);

  const order = rankOrder(now.wins, now.points);
  const leader = order[0];
  const finishes = weeklyFinishes(inputs.weekScores.slice(0, week));
  const recentFrom = Math.max(week - RECENT_WEEKS, 0);

  const seasonStandings = order.map((i) => {
    let recentWins = 0;
    let recentLosses = 0;
    for (let k = recentFrom; k < week; k++) {
      const r = allPlayWeek(inputs.weekScores[k]);
      recentWins += r.wins[i];
      recentLosses += r.losses[i];
    }
    const games = now.wins[i] + now.losses[i];
    return {
      rank: rankNow[i],
      previousRank: rankBefore ? rankBefore[i] : null,
      ...team(i),
      wins: now.wins[i],
      losses: now.losses[i],
      winPct: games ? round3(now.wins[i] / games) : 0,
      pointsFor: round1(now.points[i]),
      avgPoints: round1(now.points[i] / week),
      gamesBack: (now.wins[leader] - now.wins[i] + (now.losses[i] - now.losses[leader])) / 2,
      highWeeks: finishes.filter((f) => f[i] === 1).length,
      lowWeeks: finishes.filter((f) => f[i] === n).length,
      recent: {
        weeks: week - recentFrom,
        wins: recentWins,
        losses: recentLosses,
        finishes: finishes.slice(recentFrom).map((f) => f[i]),
      },
      streak: halfStreak(finishes, i, n),
      odds: {
        playoffPct: round3(oddsNow[i].playoffPct),
        previousPlayoffPct: round3(oddsBefore[i].playoffPct),
        change: round3(oddsNow[i].playoffPct - oddsBefore[i].playoffPct),
        changeSinceWeek: trendStart,
        changeOverRecentWeeks: round3(oddsNow[i].playoffPct - oddsTrendStart[i].playoffPct),
        top4Pct: round3(oddsNow[i].top4Pct),
        firstSeedPct: round3(oddsNow[i].firstSeedPct),
        status: oddsNow[i].status || null,
      },
    };
  });

  const oddsMovers = [...seasonStandings]
    .sort((a, b) => Math.abs(b.odds.change) - Math.abs(a.odds.change))
    .map((t) => ({
      team: t.team,
      manager: t.manager,
      from: t.odds.previousPlayoffPct,
      to: t.odds.playoffPct,
      change: t.odds.change,
      status: t.odds.status,
    }));

  /* ---- top and bottom lineups ---- */
  const [matchups, rosters, league, players, projections] = await Promise.all([
    getWeekMatchups(config, week),
    getLeagueRosters(config),
    getLeague(config),
    getNflPlayers().catch(() => ({})),
    loadProjections(config.season, week),
  ]);
  const slots = (league?.roster_positions || []).filter((s) => !NON_STARTING_SLOTS.has(s));
  const matchupByRoster = new Map(matchups.map((m) => [Number(m.roster_id), m]));
  const rosterById = new Map(rosters.map((r) => [Number(r.roster_id), r]));

  const detailFor = (i) => {
    const rid = inputs.teamIds[i];
    const matchup = matchupByRoster.get(rid);
    if (!matchup) return null;
    return lineupDetail({ matchup, roster: rosterById.get(rid), slots, players, projections });
  };

  const topIdx = weekOrder[0];
  const bottomIdx = weekOrder[n - 1];
  const bottomDetail = detailFor(bottomIdx);

  // How the bottom team would have fared with its best possible lineup.
  let optimalWouldHave = null;
  if (bottomDetail) {
    const others = scores.filter((_, i) => i !== bottomIdx);
    const opt = bottomDetail.optimalPoints;
    optimalWouldHave = {
      allPlayWins: others.filter((s) => s < opt).length,
      allPlayLosses: others.filter((s) => s > opt).length,
      weeklyFinish: others.filter((s) => s > opt).length + 1,
      stillLowest: others.every((s) => s > opt),
    };
  }

  return {
    season: config.season,
    leagueName: config.name || "BSFFL",
    week,
    regularSeasonWeeks: inputs.regularSeasonWeeks,
    weeksRemaining: Math.max(inputs.regularSeasonWeeks - week, 0),
    playoffTeams: 8,
    leagueWeek,
    weekStandings,
    seasonStandings,
    oddsMovers,
    topScore: {
      ...team(topIdx),
      points: round1(scores[topIdx]),
      marginOverSecond: round1(scores[topIdx] - scores[weekOrder[1]]),
      lineup: detailFor(topIdx),
    },
    bottomScore: {
      ...team(bottomIdx),
      points: round1(scores[bottomIdx]),
      marginBelowNext: round1(scores[weekOrder[n - 2]] - scores[bottomIdx]),
      lineup: bottomDetail,
      optimalWouldHave,
    },
  };
}
