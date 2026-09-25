// components/RivalriesView.js
//
// "What-if" head-to-head records from /api/rivalries.
// Two views: one manager against everyone, and the whole league as a grid.
// The selected manager, view and seasons live in the URL so a rivalry can be
// shared as a link (e.g. /rivalries?manager=123&seasons=2025).

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";

function winPct(r) {
  if (!r || !r.games) return null;
  return (r.w + r.t * 0.5) / r.games;
}

function fmtPct(p) {
  return p == null ? "—" : `${Math.round(p * 100)}%`;
}

function recordText(r) {
  if (!r) return "—";
  return r.t ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`;
}

function whenText(g) {
  return g ? `${g.season} Wk ${g.week}` : "";
}

/** Sum one manager's records against everyone. */
function totalFor(row = {}) {
  return Object.values(row).reduce(
    (acc, r) => ({ w: acc.w + r.w, l: acc.l + r.l, t: acc.t + r.t, games: acc.games + r.games }),
    { w: 0, l: 0, t: 0, games: 0 }
  );
}

function heat(p) {
  if (p == null) return undefined;
  const strength = Math.min(1, Math.abs(p - 0.5) * 2.4);
  const rgb = p >= 0.5 ? "22, 163, 74" : "220, 38, 38";
  return { background: `rgba(${rgb}, ${0.08 + strength * 0.5})` };
}

function Avatar({ m, size = 28 }) {
  if (m?.avatar) {
    return <img className="avatar" src={m.avatar} alt="" style={{ width: size, height: size }} loading="lazy" decoding="async" />;
  }
  const initials = String(m?.custom_team_name || "?").slice(0, 2).toUpperCase();
  return (
    <span className="avatar avatar-fallback" style={{ width: size, height: size }} aria-hidden="true">
      {initials}
    </span>
  );
}

export default function RivalriesView() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const view = router.query.view === "grid" ? "grid" : "manager";
  const scope = typeof router.query.seasons === "string" ? router.query.seasons : "all";
  const queryManager = typeof router.query.manager === "string" ? router.query.manager : null;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch("/api/rivalries");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        if (!cancelled) setData(json);
      } catch (e) {
        console.error("Failed to load rivalries", e);
        if (!cancelled) setError("Rivalry records couldn't be loaded from Sleeper. Refresh the page to try again.");
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const setQuery = (patch) => {
    const next = { ...router.query, ...patch };
    Object.keys(next).forEach((k) => {
      if (next[k] == null || next[k] === "") delete next[k];
    });
    router.replace({ pathname: router.pathname, query: next }, undefined, { shallow: true, scroll: false });
  };

  const managers = useMemo(() => data?.managers || [], [data]);
  const byId = useMemo(() => new Map(managers.map((m) => [m.owner_id, m])), [managers]);
  const records = useMemo(() => data?.records?.[scope] || {}, [data, scope]);

  const managerId = queryManager && byId.has(queryManager) ? queryManager : managers[0]?.owner_id;
  const manager = byId.get(managerId);

  // Everyone ordered by overall what-if win % for the selected seasons.
  const leagueOrder = useMemo(() => {
    return managers
      .map((m) => ({ m, total: totalFor(records[m.owner_id]) }))
      .sort((a, b) => (winPct(b.total) ?? 0) - (winPct(a.total) ?? 0));
  }, [managers, records]);

  const opponents = useMemo(() => {
    const row = records[managerId] || {};
    return Object.entries(row)
      .map(([oid, r]) => ({ opp: byId.get(oid), r, p: winPct(r) }))
      .filter((x) => x.opp && x.r.games > 0)
      .sort((a, b) => b.p - a.p || b.r.games - a.r.games);
  }, [records, managerId, byId]);

  if (error) return <div className="notice-banner">{error}</div>;
  if (!data) return <p className="muted">Loading rivalry records…</p>;

  const seasonOptions = data.seasons.filter((s) => s.weeks > 0);
  const weeksCounted =
    scope === "all"
      ? seasonOptions.reduce((s, x) => s + x.weeks, 0)
      : seasonOptions.find((s) => s.season === scope)?.weeks || 0;

  const total = totalFor(records[managerId]);
  const best = opponents[0];
  const worst = opponents[opponents.length - 1];

  return (
    <section>
      <div className="tabs">
        <button
          onClick={() => setQuery({ view: null })}
          className={`tab-btn ${view === "manager" ? "active" : ""}`}
        >
          By manager
        </button>
        <button
          onClick={() => setQuery({ view: "grid" })}
          className={`tab-btn ${view === "grid" ? "active" : ""}`}
        >
          League grid
        </button>
      </div>

      <div className="panel">
        <div className="panel-row" style={{ justifyContent: "flex-start", gap: 16 }}>
          {view === "manager" && (
            <div className="input-group">
              <label htmlFor="rival-manager">Manager</label>
              <select id="rival-manager" value={managerId || ""} onChange={(e) => setQuery({ manager: e.target.value })}>
                {managers.map((m) => (
                  <option key={m.owner_id} value={m.owner_id}>
                    {m.custom_team_name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="input-group">
            <label htmlFor="rival-seasons">Seasons</label>
            <select
              id="rival-seasons"
              value={scope}
              onChange={(e) => setQuery({ seasons: e.target.value === "all" ? null : e.target.value })}
            >
              <option value="all">All seasons</option>
              {seasonOptions.map((s) => (
                <option key={s.season} value={s.season}>
                  {s.season}
                </option>
              ))}
            </select>
          </div>
          <small className="muted" style={{ marginLeft: "auto" }}>
            {weeksCounted} completed regular-season week{weeksCounted === 1 ? "" : "s"}
          </small>
        </div>
      </div>

      {view === "manager" ? (
        <>
          {manager && total.games > 0 && (
            <div className="rival-summary">
              <div className="rival-summary-main">
                <Avatar m={manager} size={44} />
                <div>
                  <div className="team-name" style={{ fontSize: 18 }}>{manager.custom_team_name}</div>
                  <div className="muted small">
                    {recordText(total)} against the league • {fmtPct(winPct(total))}
                  </div>
                </div>
              </div>
              {best && (
                <div className="rival-callout good">
                  <div className="muted small">Best matchup</div>
                  <div className="team-name">{best.opp.custom_team_name}</div>
                  <div className="small">{recordText(best.r)}</div>
                </div>
              )}
              {worst && worst !== best && (
                <div className="rival-callout bad">
                  <div className="muted small">Toughest matchup</div>
                  <div className="team-name">{worst.opp.custom_team_name}</div>
                  <div className="small">{recordText(worst.r)}</div>
                </div>
              )}
            </div>
          )}

          <div className="table-wrap card">
            <table className="table">
              <thead>
                <tr>
                  <th>Opponent</th>
                  <th>Record</th>
                  <th>Win %</th>
                  <th title="Average weekly scoring difference against this opponent">Avg margin</th>
                  <th>Biggest win</th>
                  <th>Worst loss</th>
                </tr>
              </thead>
              <tbody>
                {opponents.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty-cell">
                      No completed weeks for these seasons yet.
                    </td>
                  </tr>
                )}
                {opponents.map(({ opp, r, p }) => (
                  <tr key={opp.owner_id}>
                    <td>
                      <div className="cell-team">
                        <Avatar m={opp} />
                        <div>
                          <div className="team-name">{opp.custom_team_name}</div>
                          <div className="muted small">{opp.manager_name || opp.sleeper_display_name}</div>
                        </div>
                      </div>
                    </td>
                    <td>{recordText(r)}</td>
                    <td>
                      <div className="split-bar" style={{ "--p": `${p * 100}%` }} title={fmtPct(p)}>
                        <span>{fmtPct(p)}</span>
                      </div>
                    </td>
                    <td>
                      {(() => {
                        const m = (r.pf - r.pa) / r.games;
                        return (
                          <span className={m > 0 ? "delta-up" : m < 0 ? "delta-down" : "muted"}>
                            {m > 0 ? "+" : m < 0 ? "−" : ""}
                            {Math.abs(m).toFixed(1)}
                          </span>
                        );
                      })()}
                    </td>
                    <td>
                      {r.bestWin ? (
                        <>
                          <span className="delta-up">+{r.bestWin.margin.toFixed(1)}</span>{" "}
                          <span className="muted small">{whenText(r.bestWin)}</span>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {r.worstLoss ? (
                        <>
                          <span className="delta-down">−{r.worstLoss.margin.toFixed(1)}</span>{" "}
                          <span className="muted small">{whenText(r.worstLoss)}</span>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="table-wrap card">
          <table className="rival-grid">
            <thead>
              <tr>
                <th className="corner">
                  <span className="muted small">Row beat column</span>
                </th>
                {leagueOrder.map(({ m }) => (
                  <th key={m.owner_id} className="col-head" title={m.custom_team_name}>
                    <span>{m.custom_team_name}</span>
                  </th>
                ))}
                <th className="col-head total">
                  <span>Overall</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {leagueOrder.map(({ m: rowM, total: rowTotal }) => (
                <tr key={rowM.owner_id}>
                  <th className="row-head">
                    <button
                      className="row-link"
                      onClick={() => setQuery({ view: null, manager: rowM.owner_id })}
                      title={`See ${rowM.custom_team_name}'s rivalries`}
                    >
                      <Avatar m={rowM} size={22} />
                      <span>{rowM.custom_team_name}</span>
                    </button>
                  </th>
                  {leagueOrder.map(({ m: colM }) => {
                    if (colM.owner_id === rowM.owner_id) {
                      return <td key={colM.owner_id} className="self" aria-label="Same manager" />;
                    }
                    const r = records[rowM.owner_id]?.[colM.owner_id];
                    const p = winPct(r);
                    return (
                      <td
                        key={colM.owner_id}
                        style={heat(p)}
                        title={`${rowM.custom_team_name} vs ${colM.custom_team_name}: ${recordText(r)}`}
                      >
                        {p == null ? "" : Math.round(p * 100)}
                      </td>
                    );
                  })}
                  <td className="total" style={heat(winPct(rowTotal))} title={recordText(rowTotal)}>
                    {fmtPct(winPct(rowTotal))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="explainer">
        <summary>What is a &quot;what-if&quot; record?</summary>
        <p>
          Every week, each manager&apos;s score is compared with every other manager&apos;s score — the same
          comparison behind the all-play standings. Your record against a rival is how many weeks you outscored
          them, whether or not Sleeper actually scheduled you to play that week.
        </p>
        <p>
          Records follow the manager&apos;s Sleeper account, so they carry across seasons. Only finished
          regular-season weeks count, so a week in progress never changes the numbers.
        </p>
      </details>
    </section>
  );
}
