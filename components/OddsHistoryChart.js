// components/OddsHistoryChart.js
//
// Week-by-week playoff odds as a line chart, drawn with plain SVG (no chart
// library). Every team is a faint line; selected teams are drawn in color with
// labels. Hover a line to preview it, click to pin it. The x-axis always spans
// the whole regular season, so an in-progress season shows the road ahead.

import React, { useEffect, useMemo, useRef, useState } from "react";

export const SERIES_COLORS = ["#2563eb", "#db2777", "#ea580c", "#16a34a", "#7c3aed", "#0891b2"];

const METRICS = [
  { key: "playoffPct", label: "Make playoffs" },
  { key: "top4Pct", label: "Top 4" },
  { key: "firstSeedPct", label: "#1 seed" },
];

const PAD = { top: 14, right: 150, bottom: 30, left: 44 };
const HEIGHT = 320;
const LABEL_GAP = 16;

function fmt(p) {
  if (p == null) return "—";
  const v = p * 100;
  if (v >= 99.95) return "100%";
  if (v > 0 && v < 0.5) return "<1%";
  return `${Math.round(v)}%`;
}

function weekLabel(w) {
  return w === 0 ? "Pre" : `Wk ${w}`;
}

/** Spread end-of-line labels so they never overlap. */
function spreadLabels(items, min, max) {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].y - sorted[i - 1].y < LABEL_GAP) sorted[i].y = sorted[i - 1].y + LABEL_GAP;
  }
  const overflow = sorted.length ? sorted[sorted.length - 1].y - max : 0;
  if (overflow > 0) sorted.forEach((s) => (s.y -= overflow));
  for (let i = sorted.length - 2; i >= 0; i--) {
    if (sorted[i + 1].y - sorted[i].y < LABEL_GAP) sorted[i].y = sorted[i + 1].y - LABEL_GAP;
  }
  sorted.forEach((s) => (s.y = Math.max(s.y, min)));
  return sorted;
}

export default function OddsHistoryChart({ history, regularSeasonWeeks, selected, colorOf, onToggle }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(900);
  const [metric, setMetric] = useState("playoffPct");
  const [hoverTeam, setHoverTeam] = useState(null);
  const [hoverWeek, setHoverWeek] = useState(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const update = () => setWidth(Math.max(320, Math.round(el.clientWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const compact = width < 560;
  const pad = compact ? { ...PAD, right: 104, left: 42 } : PAD;
  const plotW = width - pad.left - pad.right;
  const plotH = HEIGHT - pad.top - pad.bottom;
  const lastWeek = history.weeks[history.weeks.length - 1];
  const xMax = Math.max(regularSeasonWeeks, lastWeek, 1);

  const x = (w) => pad.left + (w / xMax) * plotW;
  const y = (p) => pad.top + (1 - p) * plotH;

  const teams = history.teams;
  const byId = useMemo(() => new Map(teams.map((t) => [t.roster_id, t])), [teams]);

  const pathFor = (values) =>
    values.map((p, i) => `${i === 0 ? "M" : "L"}${x(history.weeks[i]).toFixed(1)},${y(p).toFixed(1)}`).join("");

  const emphasized = [...selected];
  if (hoverTeam != null && !emphasized.includes(hoverTeam)) emphasized.push(hoverTeam);

  const labels = spreadLabels(
    emphasized
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((t) => ({
        id: t.roster_id,
        name: t.custom_team_name,
        value: t[metric][t[metric].length - 1],
        y: y(t[metric][t[metric].length - 1]),
      })),
    pad.top + 4,
    pad.top + plotH
  );

  // Fit end labels to the room right of the last point (~6.5px per character).
  const labelChars = Math.max(6, Math.floor((width - x(lastWeek) - 12) / 6.5) - 5);
  const truncate = (name) => {
    const str = String(name);
    return str.length > labelChars ? `${str.slice(0, labelChars - 1)}…` : str;
  };

  const tickStep = compact ? (xMax > 8 ? 3 : 2) : xMax > 16 ? 2 : 1;
  const ticks = Array.from({ length: xMax + 1 }, (_, i) => i).filter((w) => w === xMax || (w % tickStep === 0 && xMax - w >= tickStep));

  const handleMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const w = Math.round(((px - pad.left) / plotW) * xMax);
    setHoverWeek(w >= 0 && w <= lastWeek ? w : null);
  };

  const tooltipTeams = (emphasized.length ? emphasized.map((id) => byId.get(id)) : [])
    .filter(Boolean)
    .sort((a, b) => b[metric][hoverWeek ?? 0] - a[metric][hoverWeek ?? 0]);

  const colorFor = (id) => colorOf(id) || "#0f172a";

  return (
    <div className="card odds-chart">
      <div className="odds-chart-head">
        <div className="table-title">How the odds have moved</div>
        <div className="segmented" role="group" aria-label="Chart metric">
          {METRICS.map((m) => (
            <button
              key={m.key}
              className={metric === m.key ? "active" : ""}
              aria-pressed={metric === m.key}
              onClick={() => setMetric(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="odds-chart-plot" ref={wrapRef}>
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label={`Line chart of each team's ${METRICS.find((m) => m.key === metric).label.toLowerCase()} odds by week`}
          onPointerMove={handleMove}
          onPointerDown={handleMove}
          onPointerLeave={() => {
            setHoverWeek(null);
            setHoverTeam(null);
          }}
        >
          {/* weeks still to play */}
          {lastWeek < xMax && (
            <g>
              <rect
                x={x(lastWeek)}
                y={pad.top}
                width={x(xMax) - x(lastWeek)}
                height={plotH}
                className="future-zone"
              />
              {x(xMax) - x(lastWeek) > 260 && (
              <text
                x={(x(lastWeek) + x(xMax) + 150) / 2}
                y={pad.top + plotH / 2}
                className="future-label"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {xMax - lastWeek} week{xMax - lastWeek === 1 ? "" : "s"} to play
              </text>
              )}
            </g>
          )}

          {/* grid */}
          {[0, 0.25, 0.5, 0.75, 1].map((p) => (
            <g key={p}>
              <line x1={pad.left} x2={pad.left + plotW} y1={y(p)} y2={y(p)} className="grid-line" />
              <text x={pad.left - 8} y={y(p)} className="axis-label" textAnchor="end" dominantBaseline="middle">
                {Math.round(p * 100)}%
              </text>
            </g>
          ))}
          {ticks.map((w) => (
            <text key={w} x={x(w)} y={HEIGHT - 8} className="axis-label" textAnchor="middle">
              {weekLabel(w)}
            </text>
          ))}
          {/* faint lines for everyone not emphasized */}
          {teams
            .filter((t) => !emphasized.includes(t.roster_id))
            .map((t) => (
              <path key={t.roster_id} d={pathFor(t[metric])} className="series-faint" />
            ))}

          {/* emphasized lines */}
          {emphasized.map((id) => {
            const t = byId.get(id);
            if (!t) return null;
            const pinned = selected.includes(id);
            const color = pinned ? colorFor(id) : "#334155";
            return (
              <g key={id}>
                <path
                  d={pathFor(t[metric])}
                  fill="none"
                  stroke={color}
                  strokeWidth={2.75}
                  strokeDasharray={pinned ? undefined : "5 4"}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {t[metric].map((p, i) => (
                  <circle key={i} cx={x(history.weeks[i])} cy={y(p)} r={3} fill={color} />
                ))}
              </g>
            );
          })}

          {/* wide invisible hit areas so thin lines are easy to hover/click */}
          {teams.map((t) => (
            <path
              key={`hit-${t.roster_id}`}
              d={pathFor(t[metric])}
              className="series-hit"
              onMouseEnter={() => setHoverTeam(t.roster_id)}
              onMouseLeave={() => setHoverTeam(null)}
              onClick={() => onToggle(t.roster_id)}
            >
              <title>{`${t.custom_team_name}: ${fmt(t[metric][t[metric].length - 1])}`}</title>
            </path>
          ))}

          {/* end labels */}
          {labels.map((l) => (
            <text
              key={l.id}
              x={x(lastWeek) + 8}
              y={l.y}
              dominantBaseline="middle"
              className="end-label"
              fill={selected.includes(l.id) ? colorFor(l.id) : "#334155"}
            >
              {fmt(l.value)} {truncate(l.name)}
            </text>
          ))}

          {/* hover guide */}
          {hoverWeek != null && (
            <line x1={x(hoverWeek)} x2={x(hoverWeek)} y1={pad.top} y2={pad.top + plotH} className="hover-guide" />
          )}
        </svg>

        {hoverWeek != null && tooltipTeams.length > 0 && (
          <div
            className="chart-tooltip"
            style={
              x(hoverWeek) > width * 0.6
                ? { right: width - x(hoverWeek) + 10 }
                : { left: x(hoverWeek) + 10 }
            }
          >
            <div className="chart-tooltip-title">{hoverWeek === 0 ? "Preseason" : `After Week ${hoverWeek}`}</div>
            {tooltipTeams.map((t) => (
              <div key={t.roster_id} className="chart-tooltip-row">
                <span
                  className="dot"
                  style={{ background: selected.includes(t.roster_id) ? colorFor(t.roster_id) : "#334155" }}
                />
                <span className="name">{t.custom_team_name}</span>
                <strong>{fmt(t[metric][hoverWeek])}</strong>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="chart-chips" aria-label="Teams on the chart">
        {[...teams]
          .sort((a, b) => b[metric][b[metric].length - 1] - a[metric][a[metric].length - 1])
          .map((t) => {
            const on = selected.includes(t.roster_id);
            return (
              <button
                key={t.roster_id}
                className={`chip ${on ? "on" : ""}`}
                aria-pressed={on}
                onClick={() => onToggle(t.roster_id)}
                onMouseEnter={() => setHoverTeam(t.roster_id)}
                onMouseLeave={() => setHoverTeam(null)}
                style={on ? { borderColor: colorFor(t.roster_id) } : undefined}
              >
                <span className="dot" style={{ background: on ? colorFor(t.roster_id) : "#cbd5e1" }} />
                {t.custom_team_name}
              </button>
            );
          })}
      </div>
      <p className="muted small" style={{ margin: "8px 2px 0" }}>
        Pick up to {SERIES_COLORS.length} teams to compare. Each point is the odds as they stood once that week
        was final.
      </p>
    </div>
  );
}
