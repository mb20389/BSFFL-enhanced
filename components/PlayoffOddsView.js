// components/PlayoffOddsView.js
//
// Simulated playoff odds for the current season, from /api/playoff-odds.

import React, { useEffect, useMemo, useState } from "react";
import OddsHistoryChart, { SERIES_COLORS } from "./OddsHistoryChart";

function pct(p) {
  if (p == null) return "—";
  if (p >= 1) return "100%";
  if (p <= 0) return "0%";
  const v = p * 100;
  if (v > 99.9) return ">99.9%";
  if (v < 0.1) return "<0.1%";
  return `${v.toFixed(v >= 10 ? 0 : 1)}%`;
}

/** Biggest rise and fall in playoff odds over the most recent completed week. */
function biggestMovers(history) {
  if (!history || history.weeks.length < 2) return { up: null, down: null };
  const last = history.weeks.length - 1;
  const moves = history.teams.map((t) => ({
    t,
    delta: t.playoffPct[last] - t.playoffPct[last - 1],
  }));
  moves.sort((a, b) => b.delta - a.delta);
  const up = moves[0]?.delta > 0.005 ? moves[0] : null;
  const down = moves[moves.length - 1]?.delta < -0.005 ? moves[moves.length - 1] : null;
  return { up, down, week: history.weeks[last] };
}

function points(delta) {
  const v = Math.round(Math.abs(delta) * 100);
  return `${delta >= 0 ? "+" : "−"}${v} pts`;
}

function projRecord(t) {
  const games = Math.round(t.projWins + t.projLosses);
  const w = Math.round(t.projWins);
  return `${w}-${games - w}`;
}

function SeedStrip({ dist, playoffTeams, teamName }) {
  // Shade relative to this team's most likely seed so the shape reads clearly
  // even early in the season, when every probability is small.
  const peak = Math.max(...dist, 0.0001);
  return (
    <div className="seed-strip" role="img" aria-label={`Chance of each final seed for ${teamName}`}>
      {dist.map((p, i) => (
        <span
          key={i}
          className={`seed-cell ${i < playoffTeams ? "in" : "out"} ${i === playoffTeams ? "cut" : ""}`}
          style={{ "--p": p > 0 ? Math.max(0.08, p / peak) : 0 }}
          title={`Seed ${i + 1}: ${pct(p)}`}
        />
      ))}
    </div>
  );
}

export default function PlayoffOddsView({ config }) {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);
  // Pinned teams on the chart, and the color slot each one holds.
  const [selected, setSelected] = useState([]);
  const [colorSlots, setColorSlots] = useState({});

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setHistory(null);
    setError(null);
    setSelected([]);
    setColorSlots({});

    const q = `season=${encodeURIComponent(config.season)}`;
    const load = async () => {
      try {
        const r = await fetch(`/api/playoff-odds?${q}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        if (!cancelled) setData(json);
      } catch (e) {
        console.error("Failed to load playoff odds", e);
        if (!cancelled) setError("Playoff odds couldn't be loaded from Sleeper. Refresh the page to try again.");
      }
      // The chart is a bonus: if it fails, the table still stands on its own.
      try {
        const r = await fetch(`/api/playoff-odds-history?${q}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        if (!cancelled) setHistory(json);
      } catch (e) {
        console.error("Failed to load playoff odds history", e);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [config.season]);

  const movers = useMemo(() => biggestMovers(history), [history]);

  // Start the chart on this week's biggest riser and faller.
  useEffect(() => {
    if (!history) return;
    const initial = [movers.up?.t.roster_id, movers.down?.t.roster_id].filter((id) => id != null);
    setSelected(initial);
    setColorSlots(Object.fromEntries(initial.map((id, i) => [id, i])));
  }, [history, movers]);

  const toggleTeam = (id) => {
    if (selected.includes(id)) {
      const nextSlots = { ...colorSlots };
      delete nextSlots[id];
      setSelected(selected.filter((x) => x !== id));
      setColorSlots(nextSlots);
      return;
    }
    // At the limit, the earliest pick makes room for the new one.
    const kept = selected.length >= SERIES_COLORS.length ? selected.slice(1) : selected;
    const nextSlots = Object.fromEntries(kept.map((k) => [k, colorSlots[k]]));
    const used = new Set(Object.values(nextSlots));
    const free = SERIES_COLORS.findIndex((_, i) => !used.has(i));
    nextSlots[id] = free === -1 ? 0 : free;
    setSelected([...kept, id]);
    setColorSlots(nextSlots);
  };

  const colorOf = (id) => (colorSlots[id] != null ? SERIES_COLORS[colorSlots[id]] : null);

  const rows = useMemo(() => {
    const teams = data?.teams || [];
    return [...teams].sort(
      (a, b) => b.playoffPct - a.playoffPct || a.avgSeed - b.avgSeed || a.currentRank - b.currentRank
    );
  }, [data]);

  if (error) return <div className="notice-banner">{error}</div>;
  if (!data) return <p className="muted">Running simulations…</p>;

  if (!data.weeksPlayed) {
    return (
      <div className="notice-banner">
        Playoff odds appear once Week 1 is final. Until then, every team is even.
      </div>
    );
  }

  const playoffTeams = data.playoffTeams || 8;
  const done = data.remainingWeeks === 0;

  return (
    <section>
      <div className="panel">
        <div className="panel-row">
          <div style={{ fontSize: 14 }}>
            {done ? (
              <>Final regular-season standings — these results are set.</>
            ) : (
              <>
                Based on <strong>Weeks 1–{data.weeksPlayed}</strong>, with the{" "}
                <strong>{data.remainingWeeks} remaining weeks</strong> played out{" "}
                {data.simulations.toLocaleString()} times.
              </>
            )}
          </div>
          {!done && <small className="muted">Updates when each week is final</small>}
        </div>
      </div>

      {(movers.up || movers.down) && (
        <div className="movers">
          <span className="muted">After Week {movers.week}:</span>
          {movers.up && (
            <button className="mover up" onClick={() => toggleTeam(movers.up.t.roster_id)}>
              <span className="delta-up">▲ {points(movers.up.delta)}</span> {movers.up.t.custom_team_name}
            </button>
          )}
          {movers.down && (
            <button className="mover down" onClick={() => toggleTeam(movers.down.t.roster_id)}>
              <span className="delta-down">▼ {points(movers.down.delta)}</span> {movers.down.t.custom_team_name}
            </button>
          )}
        </div>
      )}

      {history && history.weeks.length > 1 && (
        <OddsHistoryChart
          history={history}
          regularSeasonWeeks={data.regularSeasonWeeks}
          selected={selected}
          colorOf={colorOf}
          onToggle={toggleTeam}
        />
      )}

      <div className="table-wrap card">
        <table className="table odds-table">
          <thead>
            <tr>
              <th>Now</th>
              <th>Team</th>
              <th>Playoffs</th>
              <th>Top 4</th>
              <th>#1 seed</th>
              <th>All-Play</th>
              <th>Pts</th>
              <th title="Average final all-play record across simulations">Proj. record</th>
              <th>
                Seed chances <span className="muted small">1 → 16</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, idx) => (
              <React.Fragment key={t.roster_id}>
                {idx === playoffTeams && (
                  <tr className="playoff-line" aria-hidden="true">
                    <td colSpan={9}>
                      <span>{done ? "Playoff line" : "Projected playoff line"}</span>
                    </td>
                  </tr>
                )}
                <tr>
                  <td>{t.currentRank}</td>
                  <td>
                    <button
                      className="cell-team team-toggle"
                      onClick={() => toggleTeam(t.roster_id)}
                      aria-pressed={selected.includes(t.roster_id)}
                      title={selected.includes(t.roster_id) ? "Remove from chart" : "Show on chart"}
                    >
                      {t.avatar && (
                        <img className="avatar" src={t.avatar} alt="" loading="lazy" decoding="async" />
                      )}
                      <div>
                        <div className="team-name">
                          {selected.includes(t.roster_id) && (
                            <span className="chart-dot" style={{ background: colorOf(t.roster_id) }} />
                          )}
                          {t.custom_team_name}
                        </div>
                        <div className="muted small">
                          {t.manager_name || t.sleeper_display_name}
                          {t.status === "clinched" && <span className="status-badge clinched">Clinched</span>}
                          {t.status === "eliminated" && <span className="status-badge eliminated">Eliminated</span>}
                        </div>
                      </div>
                    </button>
                  </td>
                  <td>
                    <div className="pct-bar" style={{ "--w": `${t.playoffPct * 100}%` }}>
                      <span>{pct(t.playoffPct)}</span>
                    </div>
                  </td>
                  <td>{pct(t.top4Pct)}</td>
                  <td>{pct(t.firstSeedPct)}</td>
                  <td>
                    {t.wins}-{t.losses}
                  </td>
                  <td>{Number(t.points).toFixed(1)}</td>
                  <td className="muted">
                    {done ? `${t.wins}-${t.losses}` : projRecord(t)}
                  </td>
                  <td>
                    <SeedStrip dist={t.seedDist} playoffTeams={playoffTeams} teamName={t.custom_team_name} />
                  </td>
                </tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <details className="explainer">
        <summary>How these odds work</summary>
        <p>
          The top {playoffTeams} teams in all-play standings make the playoffs, with total points breaking
          ties, and they&apos;re seeded straight down that order (1 vs 8, 2 vs 7…). The simulation uses exactly
          those rules.
        </p>
        <p>
          Each team gets a weekly scoring average from its games so far. Early in the season that average is
          pulled toward the league average ({data.leagueMean} points), because a couple of big weeks can be
          luck. Every simulation then plays out the remaining weeks with realistic week-to-week swings (about
          ±{data.weeklySd} points), scores every all-play game, and ranks the final standings. The percentages
          are how often each outcome happened.
        </p>
        <p>
          <strong>Clinched</strong> and <strong>Eliminated</strong> only appear when the result is
          mathematically certain, not just very likely. The odds don&apos;t account for injuries, trades, or
          byes — they only know the scores.
        </p>
      </details>
    </section>
  );
}
