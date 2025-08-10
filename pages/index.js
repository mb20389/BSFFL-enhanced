// pages/index.js
import { useEffect, useMemo, useState } from "react";

export default function Home() {
  const [week, setWeek] = useState(1);
  const [scores, setScores] = useState([]);
  const [loading, setLoading] = useState(false);
  const LEAGUE_ID = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID || "";

  // fetch enriched weekly scores
  useEffect(() => {
    if (!LEAGUE_ID) return;
    const fetchScores = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/scores?week=${week}`);
        const data = await res.json();
        setScores(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error("Failed to load scores", e);
        setScores([]);
      } finally {
        setLoading(false);
      }
    };
    fetchScores();
  }, [week, LEAGUE_ID]);

  // compute all-play W-L per team for the current week
  const rows = useMemo(() => {
    if (!scores.length) return [];
    const max = Math.max(...scores.map((s) => Number(s.points || 0)));
    return scores.map((t) => {
      const pts = Number(t.points || 0);
      const wins = scores.filter((o) => Number(o.points || 0) < pts).length;
      const losses = scores.filter((o) => Number(o.points || 0) > pts).length;
      return { ...t, wins, losses, isWinner: pts === max };
    });
  }, [scores]);

  return (
    <main style={{ padding: 24, fontFamily: "Inter, system-ui, sans-serif" }}>
      <h1 style={{ marginBottom: 12, fontSize: 24, fontWeight: 700 }}>
        Fantasy Football — Week {week}
      </h1>

      {!LEAGUE_ID && (
        <div style={{ marginBottom: 12, color: "#b91c1c" }}>
          Missing NEXT_PUBLIC_SLEEPER_LEAGUE_ID. Add it in your environment variables.
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <label htmlFor="week" style={{ marginRight: 8, fontWeight: 600 }}>
          Week
        </label>
        <select
          id="week"
          value={week}
          onChange={(e) => setWeek(Number(e.target.value))}
          style={{ border: "1px solid #ddd", padding: "6px 8px", borderRadius: 6 }}
        >
          {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
            <option key={w} value={w}>
              Week {w}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p>Loading scores…</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid #eee" }}>
                <th style={{ padding: 8 }}>#</th>
                <th style={{ padding: 8 }}>Team</th>
                <th style={{ padding: 8 }}>Manager</th>
                <th style={{ padding: 8 }}>Points</th>
                <th style={{ padding: 8 }}>All-Play (W-L)</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 12 }}>
                    No scores found yet for this week.
                  </td>
                </tr>
              )}
              {rows.map((t, idx) => (
                <tr
                  key={t.roster_id}
                  style={{
                    borderBottom: "1px solid #f0f0f0",
                    background: t.isWinner ? "#e6ffed" : "transparent",
                  }}
                >
                  <td style={{ padding: 8 }}>{idx + 1}</td>
                  <td style={{ padding: 8, display: "flex", alignItems: "center", gap: 8 }}>
                    {t.avatar && (
                      <img
                        src={t.avatar}
                        alt={t.custom_team_name || t.sleeper_display_name}
                        style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }}
                      />
                    )}
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        {t.custom_team_name || t.sleeper_display_name || `Roster ${t.roster_id}`}
                      </div>
                      {/* add any subtext if you like */}
                    </div>
                  </td>
                  <td style={{ padding: 8 }}>{t.manager_name || "—"}</td>
                  <td style={{ padding: 8 }}>{Number(t.points || 0).toFixed(1)}</td>
                  <td style={{ padding: 8 }}>
                    {t.wins}-{t.losses}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <small style={{ color: "#666" }}>
          Data comes from Sleeper. If it looks stale, refresh — server results are briefly cached.
        </small>
      </div>
    </main>
  );
}
