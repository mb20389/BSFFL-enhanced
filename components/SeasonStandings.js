// components/SeasonStandings.js
import { useEffect, useState } from "react";

export default function SeasonStandings() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const LEAGUE_ID = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID || "";

  useEffect(() => {
    if (!LEAGUE_ID) return;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/season`);
        const data = await res.json();
        setRows(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error("Failed to load season standings", e);
        setRows([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [LEAGUE_ID]);

  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ marginBottom: 12, fontSize: 20, fontWeight: 700 }}>Season Standings (All-Play)</h2>
      {loading ? (
        <p>Loading season standings…</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid #eee" }}>
                <th style={{ padding: 8 }}>#</th>
                <th style={{ padding: 8 }}>Team</th>
                <th style={{ padding: 8 }}>Manager</th>
                <th style={{ padding: 8 }}>W</th>
                <th style={{ padding: 8 }}>L</th>
                <th style={{ padding: 8 }}>Total Points</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 12 }}>No season data yet.</td>
                </tr>
              )}
              {rows.map((r, idx) => (
                <tr key={r.roster_id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: 8 }}>{idx + 1}</td>
                  <td style={{ padding: 8, display: "flex", alignItems: "center", gap: 8 }}>
                    {r.avatar && (
                      <img
                        src={r.avatar}
                        alt={r.custom_team_name}
                        style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }}
                      />
                    )}
                    <div style={{ fontWeight: 600 }}>{r.custom_team_name}</div>
                  </td>
                  <td style={{ padding: 8 }}>{r.manager_name || "—"}</td>
                  <td style={{ padding: 8 }}>{r.totalWins}</td>
                  <td style={{ padding: 8 }}>{r.totalLosses}</td>
                  <td style={{ padding: 8 }}>{Number(r.totalPoints || 0).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
