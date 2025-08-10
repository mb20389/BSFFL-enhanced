// pages/api/users.js
import NodeCache from "node-cache";

const cache = new NodeCache({ stdTTL: 43200 }); // 12 hours

export default async function handler(req, res) {
  const { leagueId } = req.query;
  const LEAGUE_ID =
    leagueId ||
    process.env.SLEEPER_LEAGUE_ID ||
    process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID;

  if (!LEAGUE_ID) {
    return res.status(400).json({ error: "Missing leagueId" });
  }

  const cacheKey = `users-${LEAGUE_ID}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.status(200).json(cached);

  try {
    const apiRes = await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`);
    if (!apiRes.ok) throw new Error("Failed fetching users");
    const data = await apiRes.json();
    cache.set(cacheKey, data);
    res.status(200).json(data);
  } catch (err) {
    console.error("users api error:", err);
    res.status(500).json({ error: "Error fetching users" });
  }
}
