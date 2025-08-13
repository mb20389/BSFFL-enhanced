import React, { useState, useEffect, useMemo, useRef } from "react";

const POLL_MS = Number(process.env.NEXT_PUBLIC_POLL_MS || 60000); // optional override
const LINEUP_COOLDOWN_MS = 120000; // 2 minutes throttle per roster

export default function Home() {
  const [activeTab, setActiveTab] = useState("weekly");

  return (
    <div style={{ padding: 24, fontFamily: "Inter, system-ui, sans-serif" }}>
      <h1 style={{ marginBottom: 16 }}>Fantasy Football — All-Play Standings</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button
          onClick={() => setActiveTab("weekly")}
          style={{
            padding: "8px 16px",
            fontWeight: 600,
            borderRadius: 8,
            border: "1px solid #ccc",
            background: activeTab === "weekly" ? "#111827" : "#f3f4f6",
            color: activeTab === "weekly" ? "#fff" : "#111827",
          }}
        >
          Weekly
        </button>
        <button
          onClick={() => setActiveTab("season")}
          style={{
            padding: "8px 16px",
            fontWeight: 600,
            borderRadius: 8,
            border: "1px solid #ccc",
            background: activeTab === "season" ? "#111827" : "#f3f4f6",
            color: activeTab === "season" ? "#fff" : "#111827",
          }}
        >
          Season
        </button>
      </div>

      {activeTab === "weekly" ? <WeeklyView /> : <SeasonView />}
    </div>
  );
}

function WeeklyView() {
  const [week, setWeek] = useState(1);
  const [scores, setScores] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openRoster, setOpenRoster] = useState(null);
  const [lineups, setLineups] = useState({}); // roster_id -> lineup payload
  const [lastUpdated, setLastUpdated] = useState(null);

  // per-roster fetch timestamps for throttle
  const lineupFetchedAtRef = useRef({}); // { [roster_id]: timestamp }

  const controllerRef = useRef(null);
  const intervalRef = useRef(null);

  const LEAGUE_ID = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID || "";

  // shared fetcher (aborts any in-flight request first)
  const fetchScores = async (currentWeek) => {
    if (!LEAGUE_ID || !currentWeek) return;

    if (controllerRef.current) controllerRef.current.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    try {
      const res = await fetch(`/api/scores?week=${currentWeek}`, {
        signal: controller.signal,
      });
      const data = await res.json();
      setScores(Array.isArray(data) ? data : []);
      setLastUpdated(new Date());
    } catch (e) {
      if (e.name !== "AbortError") {
        console.error("Failed to load scores", e);
        setScores([]);
      }
    } finally {
      setLoading(false);
    }
  };

  // initial load + when week changes
  useEffect(() => {
    if (!LEAGUE_ID) return;
    fetchScores(week);
    setOpenRoster(null);
    setLineups({});
  }, [week, LEAGUE_ID]);

  // polling every POLL_MS (paused when tab hidden)
  useEffect(() => {
    const startPolling = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        if (!document.hidden) {
          fetchScores(week);
        }
      }, POLL_MS);
    };

    const handleVisibility = () => {
      if (!document.hidden) fetchScores(week);
    };

    startPolling();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (controllerRef.current) controllerRef.current.abort();
    };
  }, [week]);

  const rows = useMemo(() => {
    if (!scores.length) return [];
    const max = Math.max(...scores.map((s) => Number(s.points || 0)));
    const min = Math.min(...scores.map((s) => Number(s.points || 0)));
    return scores.map((t) => {
      const pts = Number(t.points || 0);
      const wins = scores.filter((o) => Number(o.points || 0) < pts).length;
      const losses = scores.filter((o) => Number(o.points || 0) > pts).length;
      return {
        ...t,
        wins,
        losses,
        isHighest: pts === max,
        isLowest: pts === min,
      };
    });
  }, [scores]);

  // lineup fetch with throttle per roster
  const toggleRoster = async (roster_id) => {
    const willOpen = openRoster !== roster_id;
    setOpenRoster(willOpen ? roster_id : null);

    if (!willOpen) return; // just closing

    // if we already have lineup, and last fetch was recent, don't refetch
    const lastTs = lineupFetchedAtRef.current[roster_id] || 0;
    const now = Date.now();
    const shouldThrottle = now - lastTs < LINEUP_COOLDOWN_MS;

    if (lineups[roster_id] && shouldThrottle) return;

    try {
      const res = await fetch(`/api/lineup?week=${week}&rosterId=${roster_id}`);
      const data = await res.json();
      setLineups((m) => ({ ...m, [roster_id]: data }));
      lineupFetchedAtRef.current[roster_id] = now;
    } catch (e) {
      console.error("Failed to load lineup", e);
    }
  };

  return (
    <section>
      <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 12 }}>
        <div>
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
        <small style={{ color: "#666" }}>
          {lastUpdated ? `Last updated: ${lastUpdated.toLocaleTimeString()}` : ""}
        </small>
      </div>

      {loading ? (
        <p>Loading scores…</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th>Manager</th>
                <th>Points</th>
                <th>All-Play</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 12 }}>
                    No scores found yet.
                  </td>
                </tr>
              )}
              {rows.map((t, idx) => {
                const isOpen = openRoster === t.roster_id;
                const lineup = lineups[t.roster_id]?.starters || [];
                const rowClass =
                  t.isHighest ? "badge-winner" : t.isLowest ? "badge-lowest" : "";
                return (
                  <React.Fragment key={t.roster_id}>
                    <tr className={rowClass}>
                      <td>{idx + 1}</td>
                      <td>
                        <div className="cell-team">
                          {t.avatar && (
                            <img
                              className="avatar"
                              src={t.avatar}
                              alt={t.custom_team_name || t.sleeper_display_name}
                            />
                          )}
                          <div style={{ fontWeight: 600 }}>
                            {t.custom_team_name ||
                              t.sleeper_display_name ||
                              `Roster ${t.roster_id}`}
                          </div>
                        </div>
                      </td>
                      <td>{t.manager_name || "—"}</td>
                      <td>{Number(t.points || 0).toFixed(1)}</td>
                      <td>
                        {t.wins}-{t.losses}
                      </td>
                      <td>
                        <button
                          onClick={() => toggleRoster(t.roster_id)}
                          style={{
                            padding: "6px 10px",
                            border: "1px solid #e5e7eb",
                            borderRadius: 8,
                            background: isOpen ? "#111827" : "#f3f4f6",
                            color: isOpen ? "#fff" : "#111827",
                            fontWeight: 600,
                          }}
                        >
                          {isOpen ? "Hide lineup" : "View lineup"}
                        </button>
                      </td>
                    </tr>

                    {isOpen && (
                      <tr>
                        <td colSpan={6} style={{ padding: 8, background: "#fafafa" }}>
                          {lineup.length === 0 ? (
                            <div>Loading lineup…</div>
                          ) : (
                            <div className="table-wrap">
                              <table className="table">
                                <thead>
                                  <tr>
                                    <th>#</th>
                                    <th>Player</th>
                                    <th>Pos</th>
                                    <th>Team</th>
                                    <th style={{ textAlign: "right" }}>Points</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {lineup.map((p, i) => (
                                    <tr key={p.id}>
                                      <td>{i + 1}</td>
                                      <td>
                                        <div className="cell-team">
                                          {p.headshot && (
                                            <img
                                              className="headshot"
                                              src={p.headshot}
                                              alt={p.name}
                                            />
                                          )}
                                          <span style={{ fontWeight: 600 }}>{p.name}</span>
                                        </div>
                                      </td>
                                      <td>{p.pos || "—"}</td>
                                      <td>{p.team || "—"}</td>
                                      <td style={{ textAlign: "right" }}>
                                        {p.points.toFixed(1)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SeasonView() {
  const [season, setSeason] = useState([]);
  const [loading, setLoading] = useState(false);
  const LEAGUE_ID = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID || "";

  useEffect(() => {
    if (!LEAGUE_ID) return;
    const fetchSeason = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/scores?week=season&maxWeek=14`);
        const data = await res.json();
        setSeason(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error("Failed to load season standings", e);
        setSeason([]);
      } finally {
        setLoading(false);
      }
    };
    fetchSeason();
  }, [LEAGUE_ID]);

  return (
    <section>
      <h2>Season Standings (Weeks 1–14)</h2>
      {loading ? (
        <p>Loading standings…</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th>Manager</th>
                <th>W</th>
                <th>L</th>
                <th>Pts</th>
                <th>High Weeks</th>
                <th>Low Weeks</th>
                <th>GB</th>
              </tr>
            </thead>
            <tbody>
              {season.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ padding: 12 }}>
                    Season totals not available yet.
                  </td>
                </tr>
              )}
              {season.map((s, idx) => (
                <tr key={s.roster_id}>
                  <td>{idx + 1}</td>
                  <td>
                    <div className="cell-team">
                      {s.avatar && (
                        <img
                          className="avatar"
                          src={s.avatar}
                          alt={s.custom_team_name || s.sleeper_display_name}
                        />
                      )}
                      <div style={{ fontWeight: 600 }}>
                        {s.custom_team_name ||
                          s.sleeper_display_name ||
                          `Roster ${s.roster_id}`}
                      </div>
                    </div>
                  </td>
                  <td>{s.manager_name || "—"}</td>
                  <td>{s.totalWins}</td>
                  <td>{s.totalLosses}</td>
                  <td>{Number(s.totalPoints || 0).toFixed(1)}</td>
                  <td>{s.highWeeks ?? 0}</td>
                  <td>{s.lowWeeks ?? 0}</td>
                  <td>{Number(s.gamesBack ?? 0).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}