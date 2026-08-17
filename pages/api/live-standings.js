// pages/api/live-standings.js
//
// The two standings side by side for a single week:
//
//   live      — all-play record from points actually on the board right now
//   projected — all-play record from each team's projected final score
//
// Both are computed over the same set of teams, so the difference between a
// team's two ranks is exactly "ground I am about to gain or lose if the
// projections hold".

import NodeCache from "node-cache";
import { resolveLeagueContextFromQuery } from "../../lib/leagues";
import { fetchJson, getProjections, getSchedule } from "../../lib/sleeper";
import { buildLiveRows, summarizeWeek } from "../../lib/liveScoring";
import { allPlayStandings } from "../../lib/allPlay";

const cache = new NodeCache({ stdTTL: 60 });

export default async function handler(req, res) {
  const config = resolveLeagueContextFromQuery(req.query);
  const LEAGUE_ID = config.leagueId;
  const week = Number(req.query.week);

  if (!LEAGUE_ID) return res.status(400).json({ error: "Missing leagueId" });
  if (!week || isNaN(week) || week < 1 || week > 50) {
    return res.status(400).json({ error: "Invalid week" });
  }

  const cacheKey = `live-standings-${LEAGUE_ID}-${week}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.status(200).json(cached);

  try {
    const opts = { archived: config.archived };
    const [matchups, users, rosters, projections, schedule] = await Promise.all([
      fetchJson(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/matchups/${week}`),
      fetchJson(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`),
      fetchJson(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`),
      getProjections(config.season, week, opts).catch(() => new Map()),
      getSchedule(config.season, opts).catch(() => ({ byGameId: new Map(), byWeek: new Map() })),
    ]);

    const rows = buildLiveRows({ matchups, users, rosters, projections, schedule });

    if (!rows.length) {
      const empty = {
        season: config.season,
        leagueId: LEAGUE_ID,
        week,
        teams: [],
        summary: { toPlay: 0, live: 0, done: 0, total: 0, phase: "pending" },
        updatedAt: new Date().toISOString(),
      };
      cache.set(cacheKey, empty, 60);
      return res.status(200).json(empty);
    }

    const liveRanked = allPlayStandings(rows, "points");
    const projRanked = allPlayStandings(rows, "projected");
    const projByRoster = new Map(projRanked.map((r) => [String(r.roster_id), r]));

    const teams = liveRanked
      .map((r) => {
        const p = projByRoster.get(String(r.roster_id));
        return {
          roster_id: r.roster_id,
          custom_team_name: r.custom_team_name,
          sleeper_display_name: r.sleeper_display_name,
          manager_name: r.manager_name,
          avatar: r.avatar,

          points: r.points,
          projected: r.projected,

          liveWins: r.wins,
          liveLosses: r.losses,
          liveRank: r.rank,

          projWins: p?.wins ?? r.wins,
          projLosses: p?.losses ?? r.losses,
          projRank: p?.rank ?? r.rank,

          // Positive means climbing the standings if projections hold.
          winsDelta: (p?.wins ?? r.wins) - r.wins,
          rankDelta: r.rank - (p?.rank ?? r.rank),

          startersToPlay: r.startersToPlay,
          startersLive: r.startersLive,
          startersDone: r.startersDone,
          startersTotal: r.startersTotal,
        };
      })
      .sort((a, b) => a.liveRank - b.liveRank);

    const payload = {
      season: config.season,
      leagueId: LEAGUE_ID,
      week,
      teams,
      summary: summarizeWeek(rows),
      updatedAt: new Date().toISOString(),
    };

    cache.set(cacheKey, payload, config.archived ? 12 * 60 * 60 : 60);
    return res.status(200).json(payload);
  } catch (err) {
    console.error("live-standings api error:", err);
    return res.status(500).json({ error: "Failed to build live standings" });
  }
}
