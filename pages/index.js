import { useEffect, useState } from "react";

const LEAGUE_ID = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID || "";

export default function Home() {
  const [week, setWeek] = useState(1);
  const [maxWeeks] = useState(18); // adjust if needed
  const [users, setUsers] = useState([]);
  const [rosters, setRosters] = useState([]);
  const [scores, setScores] = useState([]); // current week scores
  const [season, setSeason] = useState([]); // cumulative season standings
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadBase() {
      try {
        const [usersRes, rostersRes] = await Promise.all([
          fetch(`/api/users?leagueId=${LEAGUE_ID}`),
          fetch(`/api/rosters?leagueId=${LEAGUE_ID}`),
        ]);
        const usersJson = await usersRes.json();
        const rostersJson = await rostersRes.json();
        setUsers(Array.isArray(usersJson) ? usersJson : []);
        setRosters(Array.isArray(rostersJson) ? rostersJson : []);
      } catch (err) {
        console.error("Error loading league base data", err);
      }
    }
    loadBase();
  }, []);

  useEffect(() => {
    if (!LEAGUE_ID) return;
    async function loadScoresAndSeason() {
      setLoading(true);
      try {
        const [scoresRes, seasonRes] = await Promise.all([
          fetch(`/api/scores?leagueId=${LEAGUE_ID}&week=${week}`),
          fetch(`/api/scores?leagueId=${LEAGUE_ID}&week=season`),
        ]);
        const scoresJson = await scoresRes.json();
        const seasonJson = await seasonRes.json();

        setScores(Array.isArray(scoresJson) ? scoresJson : []);
        setSeason(Array.isArray(seasonJson) ? seasonJson : []);
      } catch (err) {
        console.error("Error loading scores/season", err);
      } finally {
        setLoading(false);
      }
    }
    loadScoresAndSeason();
  }, [week, LEAGUE_ID]);

  // Helpers to find roster and user by roster_id
  const getRosterById = (rid) => rosters.find((r) => String(r.roster_id) === String(rid));
  const getUserByRosterId = (rid) => {
    const r = getRosterById(rid);
    if (!r) return null;
    return users.find((u) => u.user_id === r.owner_id) || null;
  };

  const getAvatarUrl = (user) => {
    if (!user) return null;
    return user.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : null;
  };

  const winnerRosterIds = (() => {
    if (!scores || scores.length === 0) return [];
    const maxScore = Math.max(...scores.map((s) => Number(s.points || 0)));
    return scores.filter((s) => Number(s.points || 0) === maxScore).map((s) => String(s.roster_id));
  })();

  return (
    <div style={{ padding: 24, fontFamily: "Inter, system-ui, sans-serif" }}>
      <h1 style={{ marginBottom: 12 }}>Fantasy Football — All-Play Standings</h1>

      <div style={{ marginBottom: 16 }}>
        <label style={{ marginRight: 8, fontWeight: 600 }}>Week</label>
        <select value={week} onChange={(e) => setWeek(Number(e.target.value))}>
          {Array.from({ length: maxWeeks }, (_, i) => i + 1).map((w) => (
            <option key={w} value={w}>Week {w}</option>
          ))}
        </select>
      </div>

      {loading && <div style={{ marginBottom: 12 }}>Loading data…</div>}

      <h2>Week {week} Results</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 20 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #eee" }}>
            <th style={{ padding: 8 }}>Team</th>
            <th style={{ padding: 8 }}>Manager</th>
            <th style={{ padding: 8 }}>Score</th>
            <th style={{ padding: 8 }}>All-Play W-L</th>
          </tr>
        </thead>
        <tbody>
          {scores.length === 0 && (
            <tr><td colSpan="4" style={{ padding: 8 }}>No scores found for this week yet.</td></tr>
          )}
          {scores.map((row) => {
            const roster = getRosterById(row.roster_id);
            const user = getUserByRosterId(row.roster_id);
            const avatar = getAvatarUrl(user);
            const wins = scores.filter((s) => Number(s.points || 0) < Number(row.points || 0)).length;
            const losses = scores.filter((s) => Number(s.points || 0) > Number(row.points || 0)).length;
            const isWinner = winnerRosterIds.includes(String(row.roster_id));
            return (
              <tr key={row.roster_id} style={{ background: isWinner ? "#e6ffed" : "transparent", borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  <img src={avatar || "/logos/default.png"} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} />
                  <div>
                    <div style={{ fontWeight: 600 }}>{roster?.settings?.team_name || `Roster ${row.roster_id}`}</div>
                    <div style={{ fontSize: 12, color: "#666" }}>{roster?.metadata?.t?.division || ""}</div>
                  </div>
                </td>
                <td style={{ padding: 8 }}>{user?.display_name || user?.username || "Unknown"}</td>
                <td style={{ padding: 8 }}>{Number(row.points || 0).toFixed(1)}</td>
                <td style={{ padding: 8 }}>{wins} - {losses}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2>Season Standings (Cumulative All-Play)</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #eee" }}>
            <th style={{ padding: 8 }}>Team</th>
            <th style={{ padding: 8 }}>Manager</th>
            <th style={{ padding: 8 }}>Total Wins</th>
            <th style={{ padding: 8 }}>Total Losses</th>
            <th style={{ padding: 8 }}>Total Points</th>
          </tr>
        </thead>
        <tbody>
          {season.length === 0 && <tr><td colSpan="5" style={{ padding: 8 }}>Season totals not available yet.</td></tr>}
          {season
            .sort((a, b) => b.totalWins - a.totalWins || b.totalPoints - a.totalPoints)
            .map((s) => {
              const roster = getRosterById(s.roster_id);
              const user = getUserByRosterId(s.roster_id);
              const avatar = getAvatarUrl(user);
              return (
                <tr key={s.roster_id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: 8, display: "flex", alignItems: "center", gap: 8 }}>
                    <img src={avatar || "/logos/default.png"} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} />
                    <div>
                      <div style={{ fontWeight: 600 }}>{roster?.settings?.team_name || `Roster ${s.roster_id}`}</div>
                    </div>
                  </td>
                  <td style={{ padding: 8 }}>{user?.display_name || user?.username || "Unknown"}</td>
                  <td style={{ padding: 8 }}>{s.totalWins}</td>
                  <td style={{ padding: 8 }}>{s.totalLosses}</td>
                  <td style={{ padding: 8 }}>{Number(s.totalPoints || 0).toFixed(1)}</td>
                </tr>
              );
            })}
        </tbody>
      </table>

      <div style={{ marginTop: 20 }}>
        <small style={{ color: "#666" }}>
          Data is pulled live from Sleeper. If you see stale data, try refreshing the page or wait a few minutes (API responses are cached server-side).
        </small>
      </div>
    </div>
  );
}
