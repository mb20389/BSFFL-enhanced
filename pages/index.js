import React, { useState, useEffect, useMemo, useRef } from "react";

const POLL_MS = Number(process.env.NEXT_PUBLIC_POLL_MS || 60000); // optional override
const LINEUP_COOLDOWN_MS = 120000; // 2 minutes throttle per roster

export default function Home() {
  const [activeTab, setActiveTab] = useState("weekly");

  return (
    <div className="container">
      <header className="header">
        <h1 className="title">BSFFL All-Play Standings</h1>
        <p className="subtitle">Live data from Sleeper • Weekly & season totals</p>
      </header>

      <div className="tabs">
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

/* -------------------- WEEKLY -------------------- */

function WeeklyView() {
  const [week, setWeek] = useState(1);
  const [scores, setScores] = useState([]);
  const [projections, setProjections] = useState({}); // { [roster_id]: projected_points }
  const [loading, setLoading] = useState(false);
  const [openRoster, setOpenRoster] = useState(null);
  const [lineups, setLineups] = useState({}); // roster_id -> lineup payload
  const [lastUpdated, setLastUpdated] = useState(null);
  const [weeksList, setWeeksList] = useState(Array.from({ length: 18 }, (_, i) => i + 1));

  // sorting
  const [sortKey, setSortKey] = useState(null); // 'proj' | 'points' | null
  const [sortDir, setSortDir] = useState("desc"); // 'asc' | 'desc'

  // throttle helpers
  const lineupFetchedAtRef = useRef({}); // { [roster_id]: timestamp }
  const prevProjectionsRef = useRef({}); // { [roster_id]: projected_points }
  const [projDeltas, setProjDeltas] = useState({}); // { [roster_id]: delta }

  const controllerRef = useRef(null);
  const intervalRef = useRef(null);

  const LEAGUE_ID = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID || "";

  // Get current NFL week for defaults
  useEffect(() => {
    const loadWeek = async () => {
      try {
        const r = await fetch("/api/nfl-week");
        const wk = await r.json();
        if (wk?.currentWeek) setWeek(Number(wk.currentWeek));
        if (Array.isArray(wk?.weeksArrayAll)) setWeeksList(wk.weeksArrayAll);
      } catch {
        // fall back to defaults silently
      }
    };
    loadWeek();
  }, []);

  // shared fetcher (aborts any in-flight request first)
  const fetchWeekly = async (currentWeek) => {
    if (!LEAGUE_ID || !currentWeek) return;

    if (controllerRef.current) controllerRef.current.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    try {
      const [scoresRes, projRes] = await Promise.all([
        fetch(`/api/scores?week=${currentWeek}`, { signal: controller.signal }),
        fetch(`/api/projections?week=${currentWeek}`, { signal: controller.signal }),
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

      // deltas vs previous poll
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

  // initial load + when week changes
  useEffect(() => {
    if (!LEAGUE_ID) return;
    fetchWeekly(week);
    setOpenRoster(null);
    setLineups({});
    setSortKey(null);
    setSortDir("desc");
  }, [week, LEAGUE_ID]);

  // polling every POLL_MS (paused when tab hidden)
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
      const projected = projections[String(t.roster_id)];
      const delta = projDeltas[String(t.roster_id)] || 0;
      return {
        ...t,
        wins,
        losses,
        isHighest: pts === max,
        isLowest: pts === min,
        projected: projected != null ? Number(projected) : null,
        projDelta: projected != null ? Number(delta) : 0,
      };
    });
  }, [scores, projections, projDeltas]);

  // sorting (weekly)
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

  // lineup fetch with throttle per roster
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

      {loading ? (
        <p className="muted">Loading scores…</p>
      ) : (
        <div className="table-wrap card">
          <div className="table-title">Weekly Results</div>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th>Manager</th>
                <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => clickSort("proj")} title="Sort by projected points">
                  Proj <span className="muted">{headerSortIcon("proj")}</span>
                </th>
                <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => clickSort("points")} title="Sort by actual points">
                  Points <span className="muted">{headerSortIcon("points")}</span>
                </th>
                <th>All-Play</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={7} className="empty-cell">No scores found yet.</td></tr>
              )}
              {rows.map((t, idx) => {
                const isOpen = openRoster === t.roster_id;
                const lineup = lineups[t.roster_id]?.starters || [];
                const rowClass = t.isHighest ? "badge-winner" : t.isLowest ? "badge-lowest" : "";
                const projClass = t.projected == null ? "" : t.projDelta > 0 ? "delta-up" : t.projDelta < 0 ? "delta-down" : "";
                return (
                  <React.Fragment key={t.roster_id}>
                    <tr className={rowClass}>
                      <td>{idx + 1}</td>
                      <td>
                        <div className="cell-team">
                          {t.avatar && <img className="avatar" src={t.avatar} alt={t.custom_team_name || t.sleeper_display_name} />}
                          <div className="team-name">{t.custom_team_name || t.sleeper_display_name || `Roster ${t.roster_id}`}</div>
                        </div>
                      </td>
                      <td>{t.manager_name || "—"}</td>
                      <td className={projClass}>{t.projected != null ? t.projected.toFixed(1) : "—"}</td>
                      <td>{Number(t.points || 0).toFixed(1)}</td>
                      <td>{t.wins}-{t.losses}</td>
                      <td>
                        <button onClick={() => toggleRoster(t.roster_id)} className={`btn ${isOpen ? "btn-dark" : "btn-light"}`}>
                          {isOpen ? "Hide lineup" : "View lineup"}
                        </button>
                      </td>
                    </tr>

                    {isOpen && (
                      <tr>
                        <td colSpan={7} className="expand-cell">
                          {lineup.length === 0 ? (
                            <div>Loading lineup…</div>
                          ) : (
                            <div className="table-wrap inner">
                              <table className="table">
                                <thead>
                                  <tr>
                                    <th>#</th>
                                    <th>Player</th>
                                    <th>Pos</th>
                                    <th>Team</th>
                                    <th className="align-right">Points</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {lineup.map((p, i) => (
                                    <tr key={p.id}>
                                      <td>{i + 1}</td>
                                      <td>
                                        <div className="cell-team">
                                          {p.headshot && <img className="headshot" src={p.headshot} alt={p.name} />}
                                          <span className="player-name">{p.name}</span>
                                        </div>
                                      </td>
                                      <td>{p.pos || "—"}</td>
                                      <td>{p.team || "—"}</td>
                                      <td className="align-right">{p.points.toFixed(1)}</td>
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

/* -------------------- SEASON -------------------- */

function SeasonView() {
  const [season, setSeason] = useState([]);
  const [prevSeason, setPrevSeason] = useState([]); // standings through compareWeek
  const [loading, setLoading] = useState(false);

  // dynamic week info
  const [capMaxWeek, setCapMaxWeek] = useState(14);
  const [compareWeek, setCompareWeek] = useState(null);
  const [compareOptions, setCompareOptions] = useState([]);

  const LEAGUE_ID = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID || "";

  // Load current/prior weeks for standings
  useEffect(() => {
    const boot = async () => {
      try {
        const r = await fetch("/api/nfl-week");
        const w = await r.json();
        const maxW = Number(w?.cappedMaxWeekForStandings || 14);
        const priorW = w?.cappedPriorForStandings ?? null;

        setCapMaxWeek(maxW);
        setCompareWeek(priorW); // default to prior capped week (or null)
        // options are 1..(maxW-1)
        const opts = Array.from({ length: Math.max(maxW - 1, 0) }, (_, i) => i + 1);
        setCompareOptions(opts);
      } catch {
        setCapMaxWeek(14);
        setCompareWeek(13);
        setCompareOptions(Array.from({ length: 13 }, (_, i) => i + 1));
      }
    };
    boot();
  }, []);

  // Fetch current season and comparison season when inputs ready
  useEffect(() => {
    if (!LEAGUE_ID || !capMaxWeek) return;

    const load = async () => {
      setLoading(true);
      try {
        const currUrl = `/api/scores?week=season&maxWeek=${capMaxWeek}`;
        const currRes = await fetch(currUrl);
        const curr = await currRes.json();

        let prev = [];
        if (compareWeek && compareWeek >= 1) {
          const prevUrl = `/api/scores?week=season&maxWeek=${compareWeek}`;
          const prevRes = await fetch(prevUrl);
          if (prevRes.ok) prev = await prevRes.json();
        }

        setSeason(Array.isArray(curr) ? curr : []);
        setPrevSeason(Array.isArray(prev) ? prev : []);
      } catch (e) {
        console.error("Failed to load season standings", e);
        setSeason([]);
        setPrevSeason([]);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [LEAGUE_ID, capMaxWeek, compareWeek]);

  // Build previous ranks map
  const prevRankMap = useMemo(() => {
    const map = new Map();
    (prevSeason || []).forEach((t, idx) => map.set(String(t.roster_id), idx + 1));
    return map;
  }, [prevSeason]);

  // Combine with delta arrows
  const seasonWithDelta = useMemo(() => {
    return (season || []).map((t, idx) => {
      const currRank = idx + 1;
      const prevRank = prevRankMap.get(String(t.roster_id));
      const delta = prevRank ? prevRank - currRank : 0; // + = moved up
      return { ...t, currRank, prevRank: prevRank || null, delta };
    });
  }, [season, prevRankMap]);

  const renderDelta = (delta) => {
    if (!compareWeek) return <span className="muted">—</span>;
    if (delta > 0) return <span className="delta-up">▲ {delta}</span>;
    if (delta < 0) return <span className="delta-down">▼ {Math.abs(delta)}</span>;
    return <span className="muted">▬</span>;
  };

  return (
    <section>
      <div className="panel">
        <div className="panel-row">
          <div className="input-group">
            <label>Compare vs Week</label>
            <select
              value={compareWeek || ""}
              onChange={(e) => setCompareWeek(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">(none)</option>
              {compareOptions.map((w) => (
                <option key={w} value={w}>Week {w}</option>
              ))}
            </select>
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            Showing standings through <strong>Week {capMaxWeek}</strong>
          </div>
        </div>
      </div>

      <div className="table-wrap card">
        <div className="table-title">Season Standings (Weeks 1–{capMaxWeek})</div>
        {loading ? (
          <p className="muted">Loading standings…</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Δ</th>
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
              {seasonWithDelta.length === 0 && (
                <tr>
                  <td colSpan={10} className="empty-cell">Season totals not available yet.</td>
                </tr>
              )}
              {seasonWithDelta.map((s) => (
                <tr key={s.roster_id}>
                  <td>{s.currRank}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{renderDelta(s.delta)}</td>
                  <td>
                    <div className="cell-team">
                      {s.avatar && (
                        <img
                          className="avatar"
                          src={s.avatar}
                          alt={s.custom_team_name || s.sleeper_display_name}
                        />
                      )}
                      <div className="team-name">
                        {s.custom_team_name || s.sleeper_display_name || `Roster ${s.roster_id}`}
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
        )}
      </div>
    </section>
  );
}