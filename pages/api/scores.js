import NodeCache from "node-cache";

const cache = new NodeCache({ stdTTL: 21600 }); // 6 hours
const LEAGUE_ID = process.env.SLEEPER_LEAGUE_ID || process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;

export default async function handler(req, res) {
  const { week } = req.query;
  if (!LEAGUE_ID) return res.status(400).json({ error: "Missing SLEEPER_LEAGUE_ID env var" });
  if (!week) return res.status(400).json({ error: "Missing week query param" });

  const cacheKey = `scores-${LEAGUE_ID}-${week}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.status(200).json(cached);

  try {
    const fetchWeek = async (w) => {
      const r = await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/matchups/${w}`);
      if (!r.ok) return null;
      const json = await r.json();
      if (!Array.isArray(json) || json.length === 0) return [];
      if (json[0] && json[0].hasOwnProperty("roster_id") && json[0].hasOwnProperty("points")) {
        return json.map(row => ({ roster_id: row.roster_id, points: row.points ?? 0 }));
      }
      return json.flatMap(m => {
        if (Array.isArray(m) && m[0]?.roster_id) return m.map(x => ({ roster_id: x.roster_id, points: x.points ?? 0 }));
        else if (m?.roster_id && m?.points !== undefined) return { roster_id: m.roster_id, points: m.points ?? 0 };
        return [];
      });
    };

    if (week === "season") {
      const allWeeks = [];
      for (let w = 1; w <= 18; w++) {
        const data = await fetchWeek(w);
        if (!data || data.length === 0) {
          if (w === 1) continue;
          break;
        }
        allWeeks.push({ week: w, data });
      }

      const totals = {};
      allWeeks.forEach(({ data }) => {
        data.forEach(row => {
          if (!totals[row.roster_id]) totals[row.roster_id] = { totalPoints: 0, totalWins: 0, totalLosses: 0 };
          totals[row.roster_id].totalPoints += Number(row.points || 0);
        });
        data.forEach(row => {
          const wins = data.filter(t => Number(t.points || 0) < Number(row.points || 0)).length;
          const losses = data.filter(t => Number(t.points || 0) > Number(row.points || 0)).length;
          totals[row.roster_id].totalWins += wins;
          totals[row.roster_id].totalLosses += losses;
        });
      });

      const result = Object.entries(totals).map(([roster_id, vals]) => ({
        roster_id,
        totalPoints: vals.totalPoints,
        totalWins: vals.totalWins,
        totalLosses: vals.totalLosses,
      }));

      cache.set(cacheKey, result);
      res.status(200).json(result);
    } else {
      const wk = Number(week);
      if (isNaN(wk) || wk < 1 || wk > 50) return res.status(400).json({ error: "Invalid week" });

      const weekData = await fetchWeek(wk);
      const cleaned = (weekData || []).map(r => ({ roster_id: r.roster_id, points: r.points ?? 0 }));
      cache.set(cacheKey, cleaned);
      res.status(200).json(cleaned);
    }
  } catch (err) {
    console.error("scores api error:", err);
    res.status(500).json({ error: "Error fetching scores" });
  }
}
