import NodeCache from "node-cache";

const cache = new NodeCache({ stdTTL: 43200 }); // 12 hours
const LEAGUE_ID = process.env.SLEEPER_LEAGUE_ID || process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;

export default async function handler(req, res) {
  const cacheKey = `rosters-${LEAGUE_ID}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.status(200).json(cached);

  try {
    const apiRes = await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`);
    if (!apiRes.ok) throw new Error("Failed fetching rosters");
    const data = await apiRes.json();
    cache.set(cacheKey, data);
    res.status(200).json(data);
  } catch (err) {
    console.error("rosters api error:", err);
    res.status(500).json({ error: "Error fetching rosters" });
  }
}
