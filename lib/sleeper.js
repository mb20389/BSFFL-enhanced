// lib/sleeper.js
//
// Shared Sleeper API access. Two of these endpoints are easy to get wrong:
//
//   • Projections must come from the UN-versioned host path. The /v1/ variant
//     still responds 200 but returns { player_id: {} } for every player — no
//     stats at all — which silently produces zero projections everywhere.
//   • The schedule feed is what tells us whether a player's game has kicked off
//     yet. Projection entries carry a game_id that joins straight to it.

import NodeCache from "node-cache";

const cache = new NodeCache({ stdTTL: 60 });

// Projections move during the day; the schedule barely moves.
const PROJECTIONS_TTL = 5 * 60; // 5 minutes
const SCHEDULE_TTL = 30 * 60; // 30 minutes
const FINAL_TTL = 12 * 60 * 60; // completed weeks/seasons never change

export async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed: ${url} (${r.status})`);
  return r.json();
}

/**
 * Weekly player projections, keyed by player_id.
 *
 * Team defenses are keyed by team abbreviation ("HOU"), matching how they
 * appear in a roster's starters, so no special-casing is needed.
 *
 * @returns {Promise<Map<string, {points: number, gameId: string|null, team: string|null, opponent: string|null, injuryStatus: string|null}>>}
 */
export async function getProjections(season, week, { archived = false } = {}) {
  const key = `projections-map-${season}-${week}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const url =
    `https://api.sleeper.app/projections/nfl/${season}/${week}` +
    `?season_type=regular&order_by=ppr`;

  const raw = await fetchJson(url);
  const rows = Array.isArray(raw) ? raw : [];

  const map = new Map();
  for (const row of rows) {
    if (!row?.player_id) continue;
    const stats = row.stats || {};
    const points = Number(stats.pts_half_ppr ?? stats.pts_ppr ?? stats.pts_std ?? 0);
    map.set(String(row.player_id), {
      points: Number.isFinite(points) ? points : 0,
      gameId: row.game_id ? String(row.game_id) : null,
      team: row.team || null,
      opponent: row.opponent || null,
      injuryStatus: row.player?.injury_status || null,
    });
  }

  cache.set(key, map, archived ? FINAL_TTL : PROJECTIONS_TTL);
  return map;
}

/**
 * The season schedule, as a lookup of game_id → game and a per-week summary.
 *
 * `status` is Sleeper's own: "pre_game", "complete", "canceled", and an
 * in-progress value once a game kicks off. Anything we don't recognise as
 * pre-game or complete is treated as in progress.
 */
export async function getSchedule(season, { archived = false } = {}) {
  const key = `schedule-${season}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const games = await fetchJson(`https://api.sleeper.app/schedule/nfl/regular/${season}`);
  const rows = (Array.isArray(games) ? games : []).filter((g) => g?.game_id);

  const byGameId = new Map();
  const byWeek = new Map();

  for (const g of rows) {
    const game = {
      gameId: String(g.game_id),
      status: String(g.status || "pre_game"),
      date: g.date || null,
      week: Number(g.week) || null,
      home: g.home || null,
      away: g.away || null,
    };
    byGameId.set(game.gameId, game);
    if (game.week) {
      if (!byWeek.has(game.week)) byWeek.set(game.week, []);
      byWeek.get(game.week).push(game);
    }
  }

  const schedule = { byGameId, byWeek };
  cache.set(key, schedule, archived ? FINAL_TTL : SCHEDULE_TTL);
  return schedule;
}

/**
 * When does a week's play actually begin, and is that first slot a standalone
 * night game or a full daytime slate?
 *
 * The schedule gives dates but no kickoff times, so the number of games sharing
 * the first date stands in for the time: one game is a standalone prime-time
 * kickoff, several means a daytime slate that starts around lunchtime.
 */
export function firstGameOfWeek(schedule, week) {
  const games = (schedule?.byWeek?.get(Number(week)) || []).filter(
    (g) => g.status !== "canceled" && g.date
  );
  if (!games.length) return null;

  const date = games.reduce((min, g) => (g.date < min ? g.date : min), games[0].date);
  const gamesOnDate = games.filter((g) => g.date === date).length;
  return { date, gamesOnDate, standalone: gamesOnDate === 1 };
}
