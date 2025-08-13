// pages/api/scores.js
import NodeCache from "node-cache";

const cache = new NodeCache({ stdTTL: 5 * 60 }); // 5 minutes default

// helpers
const getLeagueId = (req) =>
  req.query.leagueId ||
  process.env.SLEEPER_LEAGUE_ID ||
  process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed: ${url} (${r.status})`);
  return r.json();
}

function enrichWeeklyRows(matchups, users, rosters) {
  const byOwner = new Map(users.map((u) => [u.user_id, u]));
  const byRoster = new Map(rosters.map((r) => [String(r.roster_id), r]));

  return (Array.isArray(matchups) ? matchups : [])
    .filter((m) => m && m.roster_id != null)
    .map((m) => {
      const roster = byRoster.get(String(m.roster_id));
      const owner = roster ? byOwner.get(roster.owner_id) : null;

      return {
        roster_id: m.roster_id,
        matchup_id: m.matchup_id ?? null,
        points: Number(m.points || 0),

        // team/manager metadata
        sleeper_display_name: owner?.display_name || "Unknown",
        custom_team_name:
          owner?.metadata?.team_name || owner?.display_name || `Roster ${m.roster_id}`,
        manager_name:
          owner?.metadata?.team_nickname ||
          `${owner?.metadata?.first_name || ""} ${owner?.metadata?.last_name || ""}`.trim() ||
          owner?.display_name ||
          null,
        avatar: owner?.avatar ? `https://sleepercdn.com/avatars/${owner.avatar}` : null,
      };
    })
    .sort((a, b) => b.points - a.points);
}

// Accumulate season (all-play) and compute high/low weeks
function accumulateSeason(allWeeks, users, rosters) {
  const byOwner = new Map(users.map((u) => [u.user_id, u]));
  const byRoster = new Map(rosters.map((r) => [String(r.roster_id), r]));

  // roster_id -> tallies
  const totals = new Map(); // { totalPoints, totalWins, totalLosses, highWeeks, lowWeeks }

  for (const { rows } of allWeeks) {
    if (!rows.length) continue;

    // Points add-up
    rows.forEach(({ roster_id, points }) => {
      const key = String(roster_id);
      if (!totals.has(key)) {
        totals.set(key, {
          totalPoints: 0,
          totalWins: 0,
          totalLosses: 0,
          highWeeks: 0,
          lowWeeks: 0,
        });
      }
      const t = totals.get(key);
      t.totalPoints += Number(points || 0);
    });

    // All-play wins/losses for the week
    rows.forEach(({ roster_id, points }) => {
      const pts = Number(points || 0);
      const wins = rows.filter((x) => Number(x.points || 0) < pts).length;
      const losses = rows.filter((x) => Number(x.points || 0) > pts).length;
      const t = totals.get(String(roster_id));
      t.totalWins += wins;
      t.totalLosses += losses;
    });

    // Weekly high/low awards (ties give credit to all tied teams)
    const maxPts = Math.max(...rows.map((r) => Number(r.points || 0)));
    const minPts = Math.min(...rows.map((r) => Number(r.points || 0)));
    rows.forEach(({ roster_id, points }) => {
      const t = totals.get(String(roster_id));
      if (Number(points || 0) === maxPts) t.highWeeks += 1;
      if (Number(points || 0) === minPts) t.lowWeeks += 1;
    });
  }

  // Format + enrich user/roster metadata
  const out = Array.from(totals.entries()).map(([roster_id, t]) => {
    const roster = byRoster.get(roster_id);
    const owner = roster ? byOwner.get(roster.owner_id) : null;

    return {
      roster_id: Number(roster_id),
      totalPoints: t.totalPoints,
      totalWins: t.totalWins,
      totalLosses: t.totalLosses,
      highWeeks: t.highWeeks,
      lowWeeks: t.lowWeeks,

      custom_team_name:
        owner?.metadata?.team_name || owner?.display_name || `Roster ${roster_id}`,
      sleeper_display_name: owner?.display_name || "Unknown",
      manager_name:
        owner?.metadata?.team_nickname ||
        `${owner?.metadata?.first_name || ""} ${owner?.metadata?.last_name || ""}`.trim() ||
        owner?.display_name ||
        null,
      avatar: owner?.avatar ? `https://sleepercdn.com/avatars/${owner.avatar}` : null,
    };
  });

  // Sort primarily by wins desc, then points desc
  out.sort((a, b) => b.totalWins - a.totalWins || b.totalPoints - a.totalPoints);

  // Compute Games Back (GB) vs first place using classic formula:
  // GB = ((leaderWins - wins) + (losses - leaderLosses)) / 2
  if (out.length > 0) {
    const leaderWins = out[0].totalWins;
    const leaderLosses = out[0].totalLosses;
    out.forEach((t) => {
      t.gamesBack = ((leaderWins - t.totalWins) + (t.totalLosses - leaderLosses)) / 2;
    });
  }

  return out;
}

export default async function handler(req, res) {
  const LEAGUE_ID = getLeagueId(req);
  const { week, maxWeek } = req.query;

  if (!LEAGUE_ID) {
    return res.status(400).json({ error: "Missing leagueId" });
  }

  try {
    const isSeason = String(week).toLowerCase() === "season";
    const maxWk = isSeason
      ? Math.min(Math.max(Number(maxWeek || 14), 1), 50)
      : Number(week);

    if (!isSeason && (!maxWk || isNaN(maxWk) || maxWk < 1 || maxWk > 50)) {
      return res.status(400).json({ error: "Invalid week" });
    }

    const cacheKey = isSeason
      ? `scores-season-${LEAGUE_ID}-${maxWk}`
      : `scores-week-${LEAGUE_ID}-${maxWk}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.status(200).json(cached);

    // preload users + rosters
    const [users, rosters] = await Promise.all([
      fetchJson(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`),
      fetchJson(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`),
    ]);

    if (!isSeason) {
      // single week
      const matchups = await fetchJson(
        `https://api.sleeper.app/v1/league/${LEAGUE_ID}/matchups/${maxWk}`
      );
      const enriched = enrichWeeklyRows(matchups, users, rosters);
      cache.set(cacheKey, enriched, 60 * 5);
      return res.status(200).json(enriched);
    }

    // season aggregation 1..maxWk
    const allWeeks = [];
    for (let w = 1; w <= maxWk; w++) {
      try {
        const arr = await fetchJson(
          `https://api.sleeper.app/v1/league/${LEAGUE_ID}/matchups/${w}`
        );
        const rows = (Array.isArray(arr) ? arr : [])
          .filter((m) => m && m.roster_id != null)
          .map((m) => ({ roster_id: m.roster_id, points: Number(m.points || 0) }));
        allWeeks.push({ week: w, rows });
      } catch {
        // ignore missing weeks
      }
    }

    const seasonRows = accumulateSeason(allWeeks, users, rosters);
    cache.set(cacheKey, seasonRows, 60 * 30); // 30 min
    return res.status(200).json(seasonRows);
  } catch (err) {
    console.error("scores api error:", err);
    return res.status(500).json({ error: "Failed to fetch scores" });
  }
}