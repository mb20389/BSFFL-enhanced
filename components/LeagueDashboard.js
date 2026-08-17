// components/LeagueDashboard.js
//
// The Weekly + Season all-play views, parameterized by a season config from
// lib/leagues.js. `/` renders the current season; `/2025` (and any future
// archive page) renders a finished season read-only from the same code.

import React, { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { CURRENT_SEASON, listSeasons } from "../lib/leagues";
import { buildAllPlayRecord } from "../lib/allPlay";
import LiveStandingsView from "./LiveStandingsView";

const POLL_MS = Number(process.env.NEXT_PUBLIC_POLL_MS || 60000);
const LINEUP_COOLDOWN_MS = 120000;

/** Every API route resolves its league from `season`, so tack it onto each URL. */
function apiUrl(path, season, params = {}) {
  const qs = new URLSearchParams({ season: String(season), ...params });
  return `${path}?${qs.toString()}`;
}

export function seasonHref(season) {
  return String(season) === CURRENT_SEASON ? "/" : `/${season}`;
}

function SeasonNav({ activeSeason }) {
  const seasons = listSeasons();
  if (seasons.length < 2) return null;

  return (
    <nav className="season-nav" aria-label="Seasons">
      {seasons.map((s) => {
        const isActive = String(s.season) === String(activeSeason);
        return (
          <Link
            key={s.season}
            href={seasonHref(s.season)}
            className={`season-link ${isActive ? "active" : ""}`}
            aria-current={isActive ? "page" : undefined}
          >
            {s.season}
            {s.archived ? "" : " • live"}
          </Link>
        );
      })}
    </nav>
  );
}

export default function LeagueDashboard({ config }) {
  const isArchive = Boolean(config.archived);
  const [activeTab, setActiveTab] = useState(isArchive ? "season" : "weekly");
  const [league, setLeague] = useState(null);
  const [weekState, setWeekState] = useState(null);

  const sleeperLeagueUrl = config.leagueId
    ? `https://sleeper.com/leagues/${config.leagueId}`
    : "#";

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [leagueRes, weekRes] = await Promise.all([
          fetch(apiUrl("/api/league", config.season)),
          fetch(apiUrl("/api/nfl-week", config.season)),
        ]);
        const [leagueJson, weekJson] = await Promise.all([
          leagueRes.ok ? leagueRes.json() : Promise.resolve(null),
          weekRes.ok ? weekRes.json() : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setLeague(leagueJson);
        setWeekState(weekJson);
      } catch (e) {
        console.error("Failed to load league info", e);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [config.season]);

  const leagueName = league?.name || config.name || "League";
  const seasonStarted = weekState ? weekState.seasonStarted !== false : !isArchive;

  // An archive opens on its final regular-season week; a live season opens on
  // whatever week is currently being played.
  const defaultWeek = isArchive
    ? config.regularSeasonWeeks || 14
    : Number(weekState?.bsfflWeek) || 1;
  const defaultWeeksList = useMemo(
    () => Array.from({ length: config.totalWeeks || 18 }, (_, i) => i + 1),
    [config.totalWeeks]
  );

  return (
    <div className="container">
      <header
        className="header"
        style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
      >
        <div>
          <h1 className="title">
            {leagueName} All-Play Standings
            <span className="season-chip">{config.season}</span>
          </h1>
          <p className="subtitle">
            {isArchive
              ? `Final ${config.season} results • archived, no longer updating`
              : "Live data from Sleeper • Weekly & season totals"}
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <SeasonNav activeSeason={config.season} />
          {config.leagueId ? (
            <a
              href={sleeperLeagueUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-light"
              title="Open league on Sleeper"
              style={{ display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zM5 5h6v2H7v10h10v-4h2v6H5V5z" fill="currentColor" />
              </svg>
              <span>View on Sleeper</span>
            </a>
          ) : null}
        </div>
      </header>

      {isArchive ? (
        <div className="archive-banner">
          <strong>{config.season} archive.</strong> These standings are final and frozen —
          weeks 1–{config.regularSeasonWeeks} of the {leagueName} regular season.{" "}
          <Link href={seasonHref(CURRENT_SEASON)}>Go to the {CURRENT_SEASON} season →</Link>
        </div>
      ) : !seasonStarted ? (
        <div className="notice-banner">
          The {config.season} season hasn’t kicked off yet. Scores appear once Week 1
          starts.
        </div>
      ) : null}

      <div className="tabs">
        <button onClick={() => setActiveTab("weekly")} className={`tab-btn ${activeTab === "weekly" ? "active" : ""}`}>
          Weekly
        </button>
        <button onClick={() => setActiveTab("live")} className={`tab-btn ${activeTab === "live" ? "active" : ""}`}>
          Live vs Projected
        </button>
        <button onClick={() => setActiveTab("season")} className={`tab-btn ${activeTab === "season" ? "active" : ""}`}>
          Season
        </button>
      </div>

      {activeTab === "weekly" ? (
        <WeeklyView config={config} seasonStarted={seasonStarted} />
      ) : activeTab === "live" ? (
        <LiveStandingsView
          config={config}
          seasonStarted={seasonStarted}
          defaultWeek={defaultWeek}
          weeksList={weekState?.weeksArrayAll || defaultWeeksList}
        />
      ) : (
        <SeasonView config={config} seasonStarted={seasonStarted} />
      )}
    </div>
  );
}

/* -------------------- WEEKLY -------------------- */
function WeeklyView({ config, seasonStarted }) {
  const isArchive = Boolean(config.archived);
  const SEASON = config.season;
  const LEAGUE_ID = config.leagueId;

  const [week, setWeek] = useState(1);
  const [scores, setScores] = useState([]);
  const [projections, setProjections] = useState({});
  const [loading, setLoading] = useState(false);
  const [openRoster, setOpenRoster] = useState(null);
  const [lineups, setLineups] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);
  const [weeksList, setWeeksList] = useState(
    Array.from({ length: config.totalWeeks || 18 }, (_, i) => i + 1)
  );

  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("desc");

  const lineupFetchedAtRef = useRef({});
  const prevProjectionsRef = useRef({});
  const [projDeltas, setProjDeltas] = useState({});

  const controllerRef = useRef(null);
  const intervalRef = useRef(null);

  // Default to the current BSFFL week (the final regular season week on an archive)
  useEffect(() => {
    const loadWeek = async () => {
      try {
        const r = await fetch(apiUrl("/api/nfl-week", SEASON));
        const wk = await r.json();
        if (isArchive) {
          setWeek(Number(wk?.regularSeasonWeeks) || config.regularSeasonWeeks || 14);
        } else {
          setWeek(Number(wk?.bsfflWeek) || 1);
        }
        if (Array.isArray(wk?.weeksArrayAll)) {
          setWeeksList(wk.weeksArrayAll);
        }
      } catch {
        setWeek(isArchive ? config.regularSeasonWeeks || 14 : 1);
      }
    };
    loadWeek();
  }, [SEASON, isArchive, config.regularSeasonWeeks]);

  const fetchWeekly = async (currentWeek) => {
    const wkNum = Number(currentWeek);
    if (!LEAGUE_ID || !wkNum) return;

    if (controllerRef.current) controllerRef.current.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    try {
      // Projections only matter while a week is still being played.
      const requests = [
        fetch(apiUrl("/api/scores", SEASON, { week: wkNum }), { signal: controller.signal }),
      ];
      if (!isArchive) {
        requests.push(
          fetch(apiUrl("/api/projections", SEASON, { week: wkNum }), { signal: controller.signal })
        );
      }

      const [scoresRes, projRes] = await Promise.all(requests);

      const [scoresJson, projJson] = await Promise.all([
        scoresRes.json(),
        projRes && projRes.ok ? projRes.json() : Promise.resolve([]),
      ]);

      if (Array.isArray(scoresJson)) {
        setScores(scoresJson);
      } else if (Array.isArray(scoresJson?.rows)) {
        setScores(scoresJson.rows);
      } else {
        setScores([]);
      }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, LEAGUE_ID]);

  // Archived seasons never change, so there is nothing to poll for.
  useEffect(() => {
    if (isArchive) return undefined;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, isArchive]);

  const rowsBase = useMemo(() => {
    if (!scores.length) return [];
    const { higherCountByPoints, lowerCountByPoints, max, min } = buildAllPlayRecord(scores);

    return scores.map((t) => {
      const pts = Number(t.points || 0);
      const wins = lowerCountByPoints.get(pts) || 0;
      const losses = higherCountByPoints.get(pts) || 0;
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

  const toggleRoster = async (roster_id) => {
    const willOpen = openRoster !== roster_id;
    setOpenRoster(willOpen ? roster_id : null);
    if (!willOpen) return;

    const lastTs = lineupFetchedAtRef.current[roster_id] || 0;
    const now = Date.now();
    const shouldThrottle = now - lastTs < LINEUP_COOLDOWN_MS;

    // A finished week's lineup is immutable, so never refetch it.
    if (lineups[roster_id] && (isArchive || shouldThrottle)) return;

    try {
      const res = await fetch(apiUrl("/api/lineup", SEASON, { week, rosterId: roster_id }));
      const data = await res.json();
      setLineups((m) => ({ ...m, [roster_id]: data }));
      lineupFetchedAtRef.current[roster_id] = now;
    } catch (e) {
      console.error("Failed to load lineup", e);
    }
  };

  const colCount = isArchive ? 5 : 6;

  return (
    <section>
      <div className="panel">
        <div className="panel-row">
          <div className="input-group">
            <label htmlFor={`week-${SEASON}`}>Week</label>
            <select id={`week-${SEASON}`} value={week} onChange={(e) => setWeek(Number(e.target.value))}>
              {weeksList.map((w) => (
                <option key={w} value={w}>Week {w}</option>
              ))}
            </select>
          </div>
          <small className="muted">
            {isArchive
              ? `${SEASON} season • final scores`
              : lastUpdated
              ? `Last updated: ${lastUpdated.toLocaleTimeString()}`
              : ""}
          </small>
        </div>
      </div>

      {loading ? (
        <p className="muted">Loading scores…</p>
      ) : (
        <div className="table-wrap card">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                {!isArchive && <th>Proj</th>}
                <th>Points</th>
                <th>All-Play</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="empty-cell">
                    {seasonStarted ? "No scores found." : `Week ${week} hasn’t been played yet.`}
                  </td>
                </tr>
              )}
              {rows.map((t, idx) => {
                const isOpen = openRoster === t.roster_id;
                const lineup = lineups[t.roster_id]?.starters || [];
                return (
                  <React.Fragment key={t.roster_id}>
                    <tr>
                      <td>{idx + 1}</td>
                      <td>
                        <div className="cell-team">
                          {t.avatar && (
                            <img className="avatar" src={t.avatar} alt={t.custom_team_name || t.sleeper_display_name} loading="lazy" decoding="async" />
                          )}
                          <div>
                            <div className="team-name">{t.custom_team_name || t.sleeper_display_name || `Roster ${t.roster_id}`}</div>
                            <div className="muted small">{t.manager_name || "—"}</div>
                          </div>
                        </div>
                      </td>
                      {!isArchive && <td>{t.projected?.toFixed(1) ?? "—"}</td>}
                      <td>{t.points.toFixed(1)}</td>
                      <td>{t.wins}-{t.losses}</td>
                      <td>
                        <button onClick={() => toggleRoster(t.roster_id)} className={`btn ${isOpen ? "btn-dark" : "btn-light"}`}>
                          {isOpen ? "Hide lineup" : "View lineup"}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={colCount} className="expand-cell">
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
                                          {p.headshot && <img className="headshot" src={p.headshot} alt={p.name} loading="lazy" decoding="async" />}
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

function SeasonView({ config, seasonStarted }) {
  const isArchive = Boolean(config.archived);
  const SEASON = config.season;
  const LEAGUE_ID = config.leagueId;

  const [season, setSeason] = useState([]);
  const [prevSeason, setPrevSeason] = useState([]);
  const [loading, setLoading] = useState(false);
  const [booted, setBooted] = useState(false);

  const [capMaxWeek, setCapMaxWeek] = useState(0);
  const [compareWeek, setCompareWeek] = useState(null);
  const [compareOptions, setCompareOptions] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      const fallbackMax = isArchive ? config.regularSeasonWeeks || 14 : 0;
      try {
        const r = await fetch(apiUrl("/api/nfl-week", SEASON));
        const w = await r.json();

        const rawMax = Number(w?.bsfflCappedMaxWeekForStandings);
        const maxW = Number.isFinite(rawMax) ? rawMax : fallbackMax;
        // An archive compares nothing by default — the season is over.
        const priorW = isArchive ? null : w?.bsfflPrior ?? null;

        if (cancelled) return;
        setCapMaxWeek(maxW);
        setCompareWeek(priorW && priorW <= maxW ? priorW : null);
        setCompareOptions(Array.from({ length: Math.max(maxW - 1, 0) }, (_, i) => i + 1));
      } catch {
        if (cancelled) return;
        setCapMaxWeek(fallbackMax);
        setCompareWeek(null);
        setCompareOptions(Array.from({ length: Math.max(fallbackMax - 1, 0) }, (_, i) => i + 1));
      } finally {
        if (!cancelled) setBooted(true);
      }
    };
    boot();
    return () => {
      cancelled = true;
    };
  }, [SEASON, isArchive, config.regularSeasonWeeks]);

  useEffect(() => {
    if (!LEAGUE_ID || !booted) return;
    if (!capMaxWeek) {
      setSeason([]);
      setPrevSeason([]);
      return;
    }

    const load = async () => {
      setLoading(true);
      try {
        const currRes = await fetch(apiUrl("/api/scores", SEASON, { week: "season", maxWeek: capMaxWeek }));
        const curr = await currRes.json();

        let prev = [];
        if (compareWeek && compareWeek >= 1) {
          const prevRes = await fetch(apiUrl("/api/scores", SEASON, { week: "season", maxWeek: compareWeek }));
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
  }, [LEAGUE_ID, SEASON, capMaxWeek, compareWeek, booted]);

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

  const title = capMaxWeek
    ? `${isArchive ? "Final " : ""}Season Standings (Weeks 1–${capMaxWeek})`
    : `${SEASON} Season Standings`;

  return (
    <section>
      <div className="panel">
        <div className="panel-row" style={{ gap: 16 }}>
          <div className="input-group">
            <label>Compare vs Week</label>
            <select
              value={compareWeek || ""}
              onChange={(e) => setCompareWeek(e.target.value ? Number(e.target.value) : null)}
              disabled={compareOptions.length === 0}
            >
              <option value="">(none)</option>
              {compareOptions.map((w) => (
                <option key={w} value={w}>Week {w}</option>
              ))}
            </select>
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            {capMaxWeek ? (
              <>
                Showing standings through <strong>Week {capMaxWeek}</strong>
                {isArchive ? " (final)" : ""}
              </>
            ) : (
              <>No completed weeks yet</>
            )}
          </div>
        </div>
      </div>

      <div className="table-wrap card">
        <div className="table-title">{title}</div>
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
                  <td colSpan={10} className="empty-cell">
                    {seasonStarted
                      ? "Season totals not available yet."
                      : `The ${SEASON} season hasn’t started — standings appear after Week 1.`}
                  </td>
                </tr>
              )}
              {seasonWithDelta.map((s) => (
                <tr key={s.roster_id}>
                  <td>{s.currRank}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{renderDelta(s.delta)}</td>
                  <td>
                    <div className="cell-team">
                      {s.avatar && (
                        <img className="avatar" src={s.avatar} alt={s.custom_team_name || s.sleeper_display_name} loading="lazy" decoding="async" />
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
