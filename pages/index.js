import React, { useState, useEffect, useMemo, useRef } from "react";
import "/styles/styles.css"; // We'll create this in a moment

export default function Home() {
  const [activeTab, setActiveTab] = useState("weekly");

  return (
    <div style={{ padding: 16, fontFamily: "Inter, system-ui, sans-serif" }}>
      <h1 style={{ marginBottom: 16 }}>Fantasy Football — All-Play Standings</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button
          onClick={() => setActiveTab("weekly")}
          className={`tab-btn ${activeTab === "weekly" ? "active" : ""}`}
        >
          Weekly
        </button>
        <button
          onClick={() => setActiveTab("season")}
          className={`tab-btn ${activeTab === "season" ? "active" : ""}`}
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
  const [projections, setProjections] = useState({});
  const [loading, setLoading] = useState(false);
  const [openRoster, setOpenRoster] = useState(null);
  const [lineups, setLineups] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);
  const [weeksList, setWeeksList] = useState(Array.from({ length: 18 }, (_, i) => i + 1));

  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("desc");

  const lineupFetchedAtRef = useRef({});
  const prevProjectionsRef = useRef({});
  const [projDeltas, setProjDeltas] = useState({});

  const controllerRef = useRef(null);
  const intervalRef = useRef(null);

  const LEAGUE_ID = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID || "";

  // Default to current BSFFL week
  useEffect(() => {
    const loadWeek = async () => {
      try {
        const r = await fetch("/api/nfl-week");
        const wk = await r.json();

        // Ensure we always set a numeric week (fallback to 1)
        setWeek(Number(wk?.bsfflWeek) || 1);

        if (Array.isArray(wk?.weeksArrayAll)) {
          setWeeksList(wk.weeksArrayAll);
        }
      } catch {
        setWeek(1);
      }
    };
    loadWeek();
  }, []);

  const fetchWeekly = async (currentWeek) => {
    const wkNum = Number(currentWeek);
    if (!LEAGUE_ID || !wkNum) return;

    if (controllerRef.current) controllerRef.current.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    try {
      const [scoresRes, projRes] = await Promise.all([
        fetch(`/api/scores?week=${wkNum}`, { signal: controller.signal }),
        fetch(`/api/projections?week=${wkNum}`, { signal: controller.signal }),
      ]);

      const [scoresJson, projJson] = await Promise.all([
        scoresRes.json(),
        projRes.ok ? projRes.json() : Promise.resolve([]),
      ]);

      setScores(Array.isArray(scoresJson) ? scoresJson : []);

      const nextProj = {};
      (Array.isArray(projJson) ? projJson : []).forEach((p) => {
        nextProj[String(p.roster_id)] = Number(p.projected_points || 0);
      });

      const prev = prevProjectionsRef.current || {};
      const deltas = {};
      Object.keys(nextProj).forEach((rid) => {
        const before = Number(prev[rid] ?? nextProj[rid]);
        const after = Number(nextProj[rid]);
        deltas[rid] = after - before;
      });
      setProjDeltas(deltas);
      prevProjectionsRef.current = nextProj;

      setProjections(nextProj);
      setLastUpdated(new Date());
    } catch (e) {
      if (e.name !== "AbortError") {
        console.error("Failed to load weekly data", e);
        setScores([]);
        setProjections({});
        setProjDeltas({});
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!LEAGUE_ID) return;
    fetchWeekly(week);
    setOpenRoster(null);
    setLineups({});
    setSortKey(null);
    setSortDir("desc");
  }, [week, LEAGUE_ID]);

  useEffect(() => {
    const startPolling = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        if (!document.hidden) {
          fetchWeekly(week);
        }
      }, POLL_MS);
    };

    const handleVisibility = () => {
      if (!document.hidden) fetchWeekly(week);
    };

    startPolling();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (controllerRef.current) controllerRef.current.abort();
    };
  }, [week]);


  const rowsBase = useMemo(() => {
    if (!scores.length) return [];
    const max = Math.max(...scores.map((s) => Number(s.points || 0)));
    const min = Math.min(...scores.map((s) => Number(s.points || 0)));
    return scores.map((t) => {
      const pts = Number(t.points || 0);
      const wins = scores.filter((o) => Number(o.points || 0) < pts).length;
      const losses = scores.filter((o) => Number(o.points || 0) > pts).length;
      // Count equal points as ties, excluding the team itself
      const equalsCount = scores.filter((o) => Number(o.points || 0) === pts).length;
      const ties = Math.max(0, equalsCount - 1);

      const projected = projections[String(t.roster_id)];
      const delta = projDeltas[String(t.roster_id)] || 0;
      return {
        ...t,
        wins,
        losses,
        ties, // NEW
        isHighest: pts === max,
        isLowest: pts === min,
        projected,
        delta,
      };
    });
  }, [scores, projections, projDeltas]);

  const rows = useMemo(() => {
    if (!sortKey) return rowsBase;
    const sorted = [...rowsBase];
    sorted.sort((a, b) => {
      const aVal = sortKey === "proj" ? (a.projected ?? Number.NEGATIVE_INFINITY) : Number(a.points || 0);
      const bVal = sortKey === "proj" ? (b.projected ?? Number.NEGATIVE_INFINITY) : Number(b.points || 0);
      if (aVal === bVal) return 0;
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    });
    return sorted;
  }, [rowsBase, sortKey, sortDir]);

  const clickSort = (key) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("desc");
    } else {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    }
  };
  const headerSortIcon = (key) => (sortKey !== key ? "↕" : sortDir === "desc" ? "↓" : "↑");

  const toggleRoster = async (roster_id) => {
    const willOpen = openRoster !== roster_id;
    setOpenRoster(willOpen ? roster_id : null);
    if (!willOpen) return;

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
      <div className="panel">
        <div className="panel-row">
          <div className="input-group">
            <label htmlFor="week">Week</label>
            <select id="week" value={week} onChange={(e) => setWeek(Number(e.target.value))}>
              {weeksList.map((w) => (
                <option key={w} value={w}>Week {w}</option>
              ))}
            </select>
          </div>
          <small className="muted">{lastUpdated ? `Last updated: ${lastUpdated.toLocaleTimeString()}` : ""}</small>
        </div>
      </div>

      {/* Table remains same as your version */}
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
        // Use the dedicated season API which now includes totalTies
        const res = await fetch(`/api/season`);
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
                <th>Total Wins</th>
                <th>Total Losses</th>
                <th>Total Ties</th>
                <th>Total Points</th>
              </tr>
            </thead>
            <tbody>
              {season.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 12 }}>Season totals not available yet.</td></tr>
              )}
              {season
                // Sort by all-play result: wins + 0.5 * ties, then total points
                .sort((a, b) => {
                  const aScore = (a.totalWins || 0) + ((a.totalTies || 0) * 0.5);
                  const bScore = (b.totalWins || 0) + ((b.totalTies || 0) * 0.5);
                  if (bScore !== aScore) return bScore - aScore;
                  return (b.totalPoints || 0) - (a.totalPoints || 0);
                })
                .map((s, idx) => (
                  <React.Fragment key={s.roster_id}>
                    <tr>
                      <td>{idx + 1}</td>
                      <td>
                        <div className="cell-team">
                          {s.avatar && (
                            <img className="avatar" src={s.avatar} alt={s.custom_team_name || s.sleeper_display_name} />
                          )}
                          <div style={{ fontWeight: 600 }}>
                            {s.custom_team_name || s.sleeper_display_name || `Roster ${s.roster_id}`}
                          </div>
                        </div>
                      </td>
                      <td>{s.manager_name || "—"}</td>
                      <td>{s.totalWins}</td>
                      <td>{s.totalLosses}</td>
                      <td>{s.totalTies || 0}</td>
                      <td>{Number(s.totalPoints || 0).toFixed(1)}</td>
                    </tr>
                  </React.Fragment>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
