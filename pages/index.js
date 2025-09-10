// pages/index.js
import React, { useState, useEffect, useMemo, useRef } from "react";

const POLL_MS = Number(process.env.NEXT_PUBLIC_POLL_MS || 60000);
const LINEUP_COOLDOWN_MS = 120000;

export default function Home() {
  const [activeTab, setActiveTab] = useState("weekly");
  const LEAGUE_ID = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID || "";
  const sleeperLeagueUrl = LEAGUE_ID ? `https://sleeper.com/leagues/${LEAGUE_ID}` : "#";

  return (
    <div className="container">
      <header className="header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 className="title">BSFFL All-Play Standings</h1>
          <p className="subtitle">Live data from Sleeper • Weekly & season totals</p>
        </div>

        {LEAGUE_ID ? (
          <a
            href={sleeperLeagueUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-light"
            title="Open league on Sleeper"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zM5 5h6v2H7v10h10v-4h2v6H5V5z" fill="currentColor"/>
            </svg>
            <span>View on Sleeper</span>
          </a>
        ) : null}
      </header>

      <div className="tabs">
        <button onClick={() => setActiveTab("weekly")} className={`tab-btn ${activeTab === "weekly" ? "active" : ""}`}>
          Weekly
        </button>
        <button onClick={() => setActiveTab("season")} className={`tab-btn ${activeTab === "season" ? "active" : ""}`}>
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

  // … the rest of your table/rendering logic stays exactly the same …
}


/* -------------------- SEASON -------------------- */

function SeasonView() {
  const [season, setSeason] = useState([]);
  const [prevSeason, setPrevSeason] = useState([]);
  const [loading, setLoading] = useState(false);

  const [capMaxWeek, setCapMaxWeek] = useState(14);
  const [compareWeek, setCompareWeek] = useState(null);
  const [compareOptions, setCompareOptions] = useState([]);

  const LEAGUE_ID = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID || "";

  useEffect(() => {
    const boot = async () => {
      try {
        const r = await fetch("/api/nfl-week");
        const w = await r.json();

        const maxW = Number(w?.bsfflCappedMaxWeekForStandings || 14);
        const priorW = w?.bsfflPrior ?? null;

        setCapMaxWeek(maxW);
        setCompareWeek(priorW);
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

        // Note: /api/scores returns { bsfflWeek, seasonRows }
        setSeason(Array.isArray(curr?.seasonRows) ? curr.seasonRows : []);
        setPrevSeason(Array.isArray(prev?.seasonRows) ? prev.seasonRows : []);
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

  const prevRankMap = useMemo(() => {
    const map = new Map();
    (prevSeason || []).forEach((t, idx) => map.set(String(t.roster_id), idx + 1));
    return map;
  }, [prevSeason]);

  const seasonWithDelta = useMemo(() => {
    return (season || []).map((t, idx) => {
      const currRank = idx + 1;
      const prevRank = prevRankMap.get(String(t.roster_id));
      const delta = prevRank ? prevRank - currRank : 0;
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
        <div className="panel-row" style={{ gap: 16 }}>
          <div className="input-group">
            <label>Compare vs Week</label>
            <select value={compareWeek || ""} onChange={(e) => setCompareWeek(e.target.value ? Number(e.target.value) : null)}>
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
                        <img className="avatar" src={s.avatar} alt={s.custom_team_name || s.sleeper_display_name} />
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
