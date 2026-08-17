// components/LiveStandingsView.js
//
// The Live tab: the dumbbell chart plus the table that backs it. The table is
// not optional decoration — it is the accessible reading of the same numbers,
// and it carries the values the chart deliberately doesn't label.

import { useCallback, useEffect, useRef, useState } from "react";
import LiveStandingsChart from "./LiveStandingsChart";

const POLL_MS = Number(process.env.NEXT_PUBLIC_POLL_MS || 60000);

function apiUrl(path, season, params = {}) {
  const qs = new URLSearchParams({ season: String(season), ...params });
  return `${path}?${qs.toString()}`;
}

function renderRankDelta(delta) {
  if (!delta) return <span className="muted">▬</span>;
  if (delta > 0) return <span className="delta-up">▲ {delta}</span>;
  return <span className="delta-down">▼ {Math.abs(delta)}</span>;
}

export default function LiveStandingsView({ config, defaultWeek, weeksList = [], seasonStarted }) {
  const isArchive = Boolean(config.archived);
  const [week, setWeek] = useState(defaultWeek || 1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);
  const controllerRef = useRef(null);

  const load = useCallback(async () => {
    if (!config.leagueId || !week) return;
    if (controllerRef.current) controllerRef.current.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/live-standings", config.season, { week }), {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      if (e.name !== "AbortError") {
        console.error("Failed to load live standings", e);
        setError("Could not load live standings.");
      }
    } finally {
      setLoading(false);
    }
  }, [config.leagueId, config.season, week]);

  // Follow the season's current week until the reader picks one themselves.
  useEffect(() => {
    if (defaultWeek) setWeek(defaultWeek);
  }, [defaultWeek]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll only while a live week is actually in progress — a finished week and an
  // archive have nothing left to change.
  useEffect(() => {
    if (isArchive) return undefined;
    if (data?.summary?.phase === "final") return undefined;

    const tick = () => {
      if (!document.hidden) load();
    };
    intervalRef.current = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", tick);
      if (controllerRef.current) controllerRef.current.abort();
    };
  }, [isArchive, data?.summary?.phase, load]);

  const teams = data?.teams || [];

  if (!seasonStarted && !isArchive) {
    return (
      <section>
        <div className="table-wrap card">
          <p className="empty-cell">
            The {config.season} season hasn’t started — live scoring appears once Week 1 kicks off.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="panel">
        <div className="panel-row">
          <div className="input-group">
            <label htmlFor={`live-week-${config.season}`}>Week</label>
            <select
              id={`live-week-${config.season}`}
              value={week}
              onChange={(e) => setWeek(Number(e.target.value))}
            >
              {weeksList.map((w) => (
                <option key={w} value={w}>
                  Week {w}
                </option>
              ))}
            </select>
          </div>
          <small className="muted">
            {data?.summary?.phase === "in_progress"
              ? "Updating while games are in progress"
              : data?.summary?.phase === "final"
              ? "All games final — projections match the board"
              : ""}
          </small>
        </div>
      </div>

      {error ? <div className="notice-banner">{error}</div> : null}

      {loading && !teams.length ? (
        <p className="muted">Loading live standings…</p>
      ) : !teams.length ? (
        <div className="table-wrap card">
          <p className="empty-cell">Week {week} hasn’t been played yet.</p>
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <LiveStandingsChart teams={teams} week={data.week} summary={data.summary} />
          </div>

          <div className="table-wrap card">
            <div className="table-title">
              Live vs projected — Week {data.week}
              {data.updatedAt ? (
                <span className="muted small" style={{ fontWeight: 400, marginLeft: 8 }}>
                  updated {new Date(data.updatedAt).toLocaleTimeString()}
                </span>
              ) : null}
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Team</th>
                  <th>Pts</th>
                  <th>All-Play</th>
                  <th>Proj Pts</th>
                  <th>Proj All-Play</th>
                  <th>Δ Rank</th>
                  <th>Left</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((t) => (
                  <tr key={t.roster_id}>
                    <td>{t.liveRank}</td>
                    <td>
                      <div className="cell-team">
                        {t.avatar && (
                          <img
                            className="avatar"
                            src={t.avatar}
                            alt={t.custom_team_name || t.sleeper_display_name}
                            loading="lazy"
                            decoding="async"
                          />
                        )}
                        <div>
                          <div className="team-name">
                            {t.custom_team_name || t.sleeper_display_name || `Roster ${t.roster_id}`}
                          </div>
                          <div className="muted small">{t.manager_name || "—"}</div>
                        </div>
                      </div>
                    </td>
                    <td>{t.points.toFixed(1)}</td>
                    <td>
                      {t.liveWins}-{t.liveLosses}
                    </td>
                    <td>{t.projected.toFixed(1)}</td>
                    <td>
                      {t.projWins}-{t.projLosses}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{renderRankDelta(t.rankDelta)}</td>
                    <td>
                      {t.startersToPlay + t.startersLive}/{t.startersTotal}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
