// pages/api/rivalries.js
//
// "What-if" head-to-head records between every pair of managers.
//
// Every week, each manager's score is compared with every other manager's
// score — the same comparison that drives all-play standings. A manager's
// record against a rival is simply how many weeks they outscored that rival.
//
// Managers are keyed by Sleeper user ID (owner_id), not roster ID, so a
// rivalry follows the person across seasons. Only completed regular-season
// weeks count (see completedRegularSeasonWeeks in lib/sleeper.js).
//
// Response:
//   {
//     seasons: [{ season, weeks }],          // what was counted
//     managers: [{ owner_id, custom_team_name, ... }],
//     records: { all: {...}, "2026": {...}, "2025": {...} }
//   }
// where records[scope][ownerA][ownerB] = {
//   w, l, t, games, pf, pa,
//   bestWin: { margin, season, week } | null,
//   worstLoss: { margin, season, week } | null,
// }

import NodeCache from "node-cache";
import { listSeasons } from "../../lib/leagues";
import {
  completedRegularSeasonWeeks,
  identityFor,
  loadSeasonScores,
} from "../../lib/sleeper";

const cache = new NodeCache({ stdTTL: 10 * 60 });

function emptyPair() {
  return { w: 0, l: 0, t: 0, games: 0, pf: 0, pa: 0, bestWin: null, worstLoss: null };
}

function bump(records, scope, a, b) {
  records[scope] ||= {};
  records[scope][a] ||= {};
  records[scope][a][b] ||= emptyPair();
  return records[scope][a][b];
}

function recordGame(pair, mine, theirs, season, week) {
  const margin = mine - theirs;
  pair.games += 1;
  pair.pf += mine;
  pair.pa += theirs;
  if (margin > 0) {
    pair.w += 1;
    if (!pair.bestWin || margin > pair.bestWin.margin) pair.bestWin = { margin, season, week };
  } else if (margin < 0) {
    pair.l += 1;
    if (!pair.worstLoss || -margin > pair.worstLoss.margin) {
      pair.worstLoss = { margin: -margin, season, week };
    }
  } else {
    pair.t += 1;
  }
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

export default async function handler(req, res) {
  const cacheKey = "rivalries-all";
  const cached = cache.get(cacheKey);
  if (cached) return res.status(200).json(cached);

  try {
    // Oldest first, so the newest season's names/avatars win below.
    const seasons = listSeasons().slice().reverse();
    const loaded = await Promise.all(
      seasons.map(async (config) => {
        const through = completedRegularSeasonWeeks(config);
        const data = await loadSeasonScores(config, through);
        return { config, ...data };
      })
    );

    const managers = new Map();
    const records = {};
    const counted = [];

    for (const { config, weeks, users } of loaded) {
      const season = String(config.season);
      const userById = new Map(users.map((u) => [u.user_id, u]));

      for (const { week, rows } of weeks) {
        const scored = rows.filter((r) => r.owner_id);

        scored.forEach((r) => {
          const user = userById.get(r.owner_id);
          if (user) {
            managers.set(r.owner_id, {
              owner_id: r.owner_id,
              ...identityFor(user, `Roster ${r.roster_id}`),
            });
          }
        });

        for (const a of scored) {
          for (const b of scored) {
            if (a.owner_id === b.owner_id) continue;
            recordGame(bump(records, "all", a.owner_id, b.owner_id), a.points, b.points, season, week);
            recordGame(bump(records, season, a.owner_id, b.owner_id), a.points, b.points, season, week);
          }
        }
      }

      counted.push({ season, weeks: weeks.length });
    }

    // Trim floats so the payload stays small and readable.
    for (const scope of Object.values(records)) {
      for (const row of Object.values(scope)) {
        for (const pair of Object.values(row)) {
          pair.pf = round1(pair.pf);
          pair.pa = round1(pair.pa);
          if (pair.bestWin) pair.bestWin.margin = round1(pair.bestWin.margin);
          if (pair.worstLoss) pair.worstLoss.margin = round1(pair.worstLoss.margin);
        }
      }
    }

    const payload = {
      seasons: counted.slice().reverse(), // newest first for the UI
      managers: Array.from(managers.values()).sort((x, y) =>
        String(x.custom_team_name).localeCompare(String(y.custom_team_name))
      ),
      records,
    };

    cache.set(cacheKey, payload);
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=3600");
    return res.status(200).json(payload);
  } catch (err) {
    console.error("rivalries api error:", err);
    return res.status(500).json({ error: "Failed to build rivalry records" });
  }
}
