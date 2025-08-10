// pages/index.js
import { useEffect, useMemo, useState } from "react";

function Tabs({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
      {[
        { key: "weekly", label: "Weekly Scores" },
        { key: "season", label: "Season Standings" },
      ].map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            background: value === tab.key ? "#111827" : "#f3f4f6",
            color: value === tab.key ? "white" : "#111827",
            fontWeight: 600,
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function WeeklyView() {
  const [week, setWeek] = useState(1);
  const [scores, setScores] = useState([]);
  const [loading, setLoading] = useState(false);
  const LEAGUE_ID = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID || "";

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
    <section>
      <div style={{ marginBottom: 12 }}>
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
                    No scores found yet.
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
                    <div style={{ fontWeight: 600 }}>
                      {t.custom_team_name || t.sleeper_display_name || `Roster ${t.roster_id}`}
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
    </section>
  );
}

function SeasonView() {
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
    <section>
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

export default function Home() {
  const [tab, setTab] = useState("weekly");

  // Sync tab with URL (?view=weekly|season) and remember last tab
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initial = params.get("view");
    const saved = localStorage.getItem("ff_view");
    if (initial === "weekly" || initial === "season") {
      setTab(initial);
    } else if (saved === "weekly" || saved === "season") {
      setTab(saved);
    }
  }, []);

  useEffect(() => {
    // update URL (shallow) + persist
    const params = new URLSearchParams(window.location.search);
    params.set("view", tab);
    window.history.replaceState(null, "", `?${params.toString()}`);
    localStorage.setItem("ff_view", tab);
  }, [tab]);

  return (
    <main style={{ padding: 16, maxWidth: 960, margin: "0 auto", fontFamily: "Inter, system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12, lineHeight: 1.2 }}>
        BSFFL — All-Play Dashboard
      </h1>

      <Tabs value={tab} onChange={setTab} />

      {/* Lazy render SeasonView: mount only after selected once */}
      {tab === "weekly" && <WeeklyView />}
      {tab === "season" && <SeasonView />}
    </main>
  );
}
