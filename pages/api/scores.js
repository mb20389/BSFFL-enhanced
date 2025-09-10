// pages/api/scores.js
import NodeCache from "node-cache";

const cache = new NodeCache({ stdTTL: 300 }); // 5 minutes

export default async function handler(req, res) {
  const { leagueId, week, maxWeek } = req.query;
  const LEAGUE_ID =
    leagueId ||
    process.env.SLEEPER_LEAGUE_ID ||
    process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;

  if (!LEAGUE_ID) {
    return res.status(400).json({ error: "Missing league ID" });
  }

  try {
    const cacheKey = `scores-${LEAGUE_ID}-${week}-${maxWeek}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.status(200).json(cached);

    // get current NFL state (to know the current week)
    const stateRes = await fetch("https://api.sleeper.app/v1/state/nfl");
    if (!stateRes.ok) throw new Error("Failed to fetch state");
    const state = await stateRes.json();
    const currentWeek = Number(state.week);

    // handle weekly scores
    if (week && week !== "season") {
      const url = `https://api.sleeper.app/v1/league/${LEAGUE_ID}/matchups/${week}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("Failed to fetch weekly matchups");
      const data = await resp.json();
      cache.set(cacheKey, data);
      return res.status(200).json(data);
    }

    // handle season totals
    const limitWeek = Number(maxWeek) || currentWeek;
    const cappedMaxWeek = Math.min(limitWeek, currentWeek);

    const totals = {};
    const weekMap = {};

    for (let w = 1; w <= cappedMaxWeek; w++) {
      const url = `https://api.sleeper.app/v1/league/${LEAGUE_ID}/matchups/${w}`;
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const weekData = await resp.json();
      if (!Array.isArray(weekData) || weekData.length === 0) continue;
      weekMap[w] = weekData;

      const topScore = Math.max(...weekData.map((t) => Number(t.points || 0)));
      const lowScore = Math.min(...weekData.map((t) => Number(t.points || 0)));

      weekData.forEach((t) => {
        const rid = String(t.roster_id);
        if (!totals[rid]) {
          totals[rid] = {
            roster_id: t.roster_id,
            totalWins: 0,
            totalLosses: 0,
            totalPoints: 0,
            highWeeks: 0,
            lowWeeks: 0,
          };
        }

        const pts = Number(t.points || 0);
        totals[rid].totalPoints += pts;

        // all-play wins/losses
        const wins = weekData.filter((o) => Number(o.points || 0) < pts).length;
        const losses = weekData.filter((o) => Number(o.points || 0) > pts).length;
        totals[rid].totalWins += wins;
        totals[rid].totalLosses += losses;

        // high / low week counts
        if (pts === topScore) totals[rid].highWeeks += 1;
        if (pts === lowScore) totals[rid].lowWeeks += 1;
      });
    }

    // figure out games back
    const arr = Object.values(totals);
    const maxWins = Math.max(...arr.map((t) => t.totalWins));
    arr.forEach((t) => {
      t.gamesBack = (maxWins - t.totalWins) / (arr.length - 1);
    });

    cache.set(cacheKey, arr);
    return res.status(200).json(arr);
  } catch (err) {
    console.error("scores api error:", err);
    res.status(500).json({ error: "Error fetching scores" });
  }
}
