// lib/liveScoring.js
//
// Live projected scoring.
//
// Sleeper's weekly projections are FULL-GAME numbers that do not decay as a game
// is played, so simply summing them mid-Sunday double-counts everyone who has
// already finished. A team's projected final is therefore built player by
// player, using each player's game status:
//
//   pre_game  → the projection (they haven't played yet)
//   complete  → their actual points (nothing left to come)
//   in game   → max(actual, projection)
//
// The in-game rule deserves a word. Sleeper's schedule feed carries a status but
// no game clock, so there is no honest way to decay a projection partway through
// a game. Treating the projection as a floor keeps the number monotonic — it
// never drops as a player accumulates points — and it converges on the truth as
// each game finalises. If a clock source is added later, only this function
// needs to change.

import { buildTeamMeta } from "./teams";

export const GAME_STATE = {
  TO_PLAY: "to_play",
  LIVE: "live",
  DONE: "done",
};

/**
 * Classify a scheduled game into what it means for scoring.
 *
 * A player with no game at all — on bye, inactive, or not carried on any game
 * roster — is DONE rather than "yet to play": nothing further is coming, so they
 * finish on whatever they have. Counting them as pending would leave a finished
 * week looking like it was still being played.
 */
export function gameState(game) {
  if (!game) return GAME_STATE.DONE;
  const s = String(game.status || "").toLowerCase();
  if (s === "complete" || s === "canceled") return GAME_STATE.DONE;
  if (s === "pre_game") return GAME_STATE.TO_PLAY;
  return GAME_STATE.LIVE;
}

/**
 * A single player's projected final score.
 *
 * Once their game is final, what they scored is all there is. Otherwise the
 * projection acts as a floor over what they have already banked: for a player
 * yet to kick off that is simply their projection, and for one mid-game it keeps
 * the number from sagging as points come in. Taking the floor also covers
 * players missing from the projections feed entirely — they keep their actual
 * points instead of silently counting as zero.
 */
export function projectPlayerFinal(actual, projection, state) {
  const a = Number(actual || 0);
  const p = Number(projection || 0);
  if (state === GAME_STATE.DONE) return a;
  return Math.max(a, p);
}

/**
 * Build the live rows for a week: actual points alongside projected finals.
 *
 * @param {object} args
 * @param {Array} args.matchups - /league/{id}/matchups/{week}
 * @param {Array} args.users
 * @param {Array} args.rosters
 * @param {Map} args.projections - from getProjections()
 * @param {object} args.schedule - from getSchedule()
 * @returns {Array<object>} one row per roster, sorted by actual points desc
 */
export function buildLiveRows({ matchups, users, rosters, projections, schedule }) {
  const teamMeta = buildTeamMeta(users, rosters);
  const byGameId = schedule?.byGameId || new Map();
  const projMap = projections || new Map();

  return (Array.isArray(matchups) ? matchups : [])
    .filter((m) => m && m.roster_id != null)
    .map((m) => {
      const starters = Array.isArray(m.starters) ? m.starters : [];
      const playerPoints = m.players_points || {};

      let projected = 0;
      const counts = { [GAME_STATE.TO_PLAY]: 0, [GAME_STATE.LIVE]: 0, [GAME_STATE.DONE]: 0 };

      const players = starters.map((pid) => {
        const key = String(pid);
        const actual = Number(playerPoints[key] || 0);
        const proj = projMap.get(key);
        const game = proj?.gameId ? byGameId.get(proj.gameId) : null;
        const state = gameState(game);
        const projectedFinal = projectPlayerFinal(actual, proj?.points, state);

        projected += projectedFinal;
        counts[state] += 1;

        return {
          id: key,
          actual,
          projection: Number(proj?.points || 0),
          projectedFinal,
          state,
          team: proj?.team || null,
          opponent: proj?.opponent || null,
          injuryStatus: proj?.injuryStatus || null,
        };
      });

      const points = Number(m.points || 0);

      return {
        roster_id: m.roster_id,
        matchup_id: m.matchup_id ?? null,
        points,
        projected,
        // How much of this team's day is still ahead of it.
        startersToPlay: counts[GAME_STATE.TO_PLAY],
        startersLive: counts[GAME_STATE.LIVE],
        startersDone: counts[GAME_STATE.DONE],
        startersTotal: starters.length,
        players,
        ...teamMeta(m.roster_id),
      };
    })
    .sort((a, b) => b.points - a.points);
}

/**
 * Week-level rollup: is this week finished, underway, or still to come?
 */
export function summarizeWeek(rows = []) {
  const totals = rows.reduce(
    (acc, r) => {
      acc.toPlay += r.startersToPlay;
      acc.live += r.startersLive;
      acc.done += r.startersDone;
      return acc;
    },
    { toPlay: 0, live: 0, done: 0 }
  );

  const total = totals.toPlay + totals.live + totals.done;
  let phase = "pending";
  if (total > 0 && totals.done === total) phase = "final";
  else if (totals.done > 0 || totals.live > 0) phase = "in_progress";

  return { ...totals, total, phase };
}
