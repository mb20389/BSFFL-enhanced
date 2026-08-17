// components/LiveStandingsChart.js
//
// A dumbbell chart: for each team, where its all-play record stands right now
// and where it projects to finish. Before → after per item is what a dumbbell is
// for, so it takes one hue in two shades — the light dot is now, the dark dot is
// the projection, and the gap between them is the ground about to move.
//
// The palette is the blue ordinal ramp at steps 300 and 450, validated against
// this app's white card surface (monotone lightness, visible step gap, light end
// clears the surface). The app renders light-only, so the chart commits to the
// same single look rather than following the OS theme onto a white page.

import { useState } from "react";

const SERIES = {
  live: { color: "#6da7ec", label: "Now" },
  projected: { color: "#2a78d6", label: "Projected final" },
};

const INK = {
  primary: "#0b0b0b",
  secondary: "#52514e",
  muted: "#898781",
  gridline: "#e1e0d9",
  axis: "#c3c2b7",
  surface: "#ffffff",
};

const ROW_HEIGHT = 26;
const DOT_RADIUS = 5;
const LEFT_GUTTER = 168;
const RIGHT_PAD = 28;
const TOP_PAD = 34;
const BOTTOM_PAD = 8;
const PLOT_WIDTH = 460;

function niceTicks(maxWins) {
  const step = maxWins > 12 ? 3 : maxWins > 6 ? 2 : 1;
  const ticks = [];
  for (let v = 0; v <= maxWins; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] !== maxWins) ticks.push(maxWins);
  return ticks;
}

export default function LiveStandingsChart({ teams = [], week, summary }) {
  const [hovered, setHovered] = useState(null);

  if (!teams.length) return null;

  // All-play wins run 0 … (teams − 1): everyone plays everyone else.
  const maxWins = Math.max(teams.length - 1, 1);
  const chartHeight = TOP_PAD + teams.length * ROW_HEIGHT + BOTTOM_PAD;
  const totalWidth = LEFT_GUTTER + PLOT_WIDTH + RIGHT_PAD;

  const x = (wins) => LEFT_GUTTER + (Math.max(0, Math.min(wins, maxWins)) / maxWins) * PLOT_WIDTH;
  const y = (index) => TOP_PAD + index * ROW_HEIGHT + ROW_HEIGHT / 2;

  const ticks = niceTicks(maxWins);
  const hoveredTeam = hovered != null ? teams[hovered] : null;

  return (
    <div className="chart-block">
      <div className="chart-head">
        <div>
          <div className="chart-title">All-play standings — now vs projected final</div>
          <div className="chart-sub">
            Week {week}
            {summary?.phase === "final"
              ? " • all games final"
              : summary?.phase === "in_progress"
              ? ` • ${summary.toPlay + summary.live} of ${summary.total} starters still to finish`
              : " • no games played yet"}
          </div>
        </div>
        <div className="chart-legend">
          {Object.values(SERIES).map((s) => (
            <span key={s.label} className="legend-item">
              <span className="legend-dot" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      <div className="chart-scroll">
        <svg
          viewBox={`0 0 ${totalWidth} ${chartHeight}`}
          width="100%"
          height={chartHeight}
          role="img"
          aria-label={`Dumbbell chart comparing each team's current all-play wins with its projected final all-play wins for week ${week}`}
          style={{ display: "block", minWidth: 620 }}
        >
          {/* gridlines + axis ticks */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={x(t)}
                x2={x(t)}
                y1={TOP_PAD - 8}
                y2={chartHeight - BOTTOM_PAD}
                stroke={INK.gridline}
                strokeWidth="1"
              />
              <text
                x={x(t)}
                y={TOP_PAD - 14}
                textAnchor="middle"
                fontSize="11"
                fill={INK.muted}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {t}
              </text>
            </g>
          ))}
          {/* caption sits in the gutter, clear of the tick row */}
          <text
            x={LEFT_GUTTER - 12}
            y={TOP_PAD - 14}
            fontSize="11"
            fill={INK.muted}
            textAnchor="end"
          >
            all-play wins
          </text>

          {teams.map((t, i) => {
            const isHovered = hovered === i;
            const liveX = x(t.liveWins);
            const projX = x(t.projWins);
            const rowY = y(i);
            const name = t.custom_team_name || t.sleeper_display_name || `Roster ${t.roster_id}`;

            return (
              // The svg as a whole is one labelled image; the table underneath is
              // the accessible reading of these numbers, so the rows carry no
              // ARIA of their own (roles inside role="img" are ignored anyway).
              <g
                key={t.roster_id}
                data-team-row={t.roster_id}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              >
                {/* full-row hit target, bigger than the marks */}
                <rect
                  x={0}
                  y={rowY - ROW_HEIGHT / 2}
                  width={totalWidth}
                  height={ROW_HEIGHT}
                  fill={isHovered ? "rgba(37, 99, 235, 0.06)" : "transparent"}
                />

                <text
                  x={LEFT_GUTTER - 12}
                  y={rowY + 4}
                  textAnchor="end"
                  fontSize="12"
                  fill={isHovered ? INK.primary : INK.secondary}
                  fontWeight={isHovered ? 600 : 400}
                >
                  {name.length > 22 ? `${name.slice(0, 21)}…` : name}
                </text>

                {/* connector: neutral, so it separates the dots without adding data ink */}
                <line
                  x1={Math.min(liveX, projX)}
                  x2={Math.max(liveX, projX)}
                  y1={rowY}
                  y2={rowY}
                  stroke={INK.axis}
                  strokeWidth="2"
                  strokeLinecap="round"
                />

                {/* surface ring keeps the dots readable where they overlap */}
                <circle cx={liveX} cy={rowY} r={DOT_RADIUS} fill={SERIES.live.color} stroke={INK.surface} strokeWidth="2" />
                <circle cx={projX} cy={rowY} r={DOT_RADIUS} fill={SERIES.projected.color} stroke={INK.surface} strokeWidth="2" />
              </g>
            );
          })}
        </svg>
      </div>

      {hoveredTeam ? (
        <div className="chart-tooltip" role="status">
          <strong>{hoveredTeam.custom_team_name || hoveredTeam.sleeper_display_name}</strong>
          <span>
            Now {hoveredTeam.liveWins}-{hoveredTeam.liveLosses} ({hoveredTeam.points.toFixed(1)} pts)
          </span>
          <span>
            Projected {hoveredTeam.projWins}-{hoveredTeam.projLosses} ({hoveredTeam.projected.toFixed(1)} pts)
          </span>
          <span className="muted">
            {hoveredTeam.startersToPlay + hoveredTeam.startersLive} of {hoveredTeam.startersTotal} starters left
          </span>
        </div>
      ) : (
        <div className="chart-tooltip chart-tooltip-empty">
          Hover a team for its points and remaining starters.
        </div>
      )}
    </div>
  );
}
