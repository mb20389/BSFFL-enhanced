// lib/recap/email.js
//
// Renders the weekly recap as an email: HTML with inline styles (email clients
// ignore <style> blocks and external CSS) plus a plain-text version.

const COLORS = {
  bg: "#f3f4f6",
  card: "#ffffff",
  text: "#111827",
  muted: "#6b7280",
  border: "#e5e7eb",
  accent: "#1d4ed8",
  up: "#15803d",
  down: "#b91c1c",
  stripe: "#f9fafb",
};

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const pts = (x) => Number(x).toFixed(1);
const pct = (p) => `${Math.round(p * 100)}%`;

function signedPct(change) {
  const v = Math.round(change * 100);
  if (v === 0) return "—";
  return `${v > 0 ? "+" : "−"}${Math.abs(v)}`;
}

function rankDelta(t) {
  if (t.previousRank == null) return "";
  const d = t.previousRank - t.rank;
  if (d === 0) return `<span style="color:${COLORS.muted}">–</span>`;
  const color = d > 0 ? COLORS.up : COLORS.down;
  return `<span style="color:${color}">${d > 0 ? "▲" : "▼"}${Math.abs(d)}</span>`;
}

function paragraphs(text) {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 12px;line-height:1.55;font-size:15px">${esc(p)}</p>`)
    .join("");
}

const th = (label, align = "left") =>
  `<th style="text-align:${align};padding:6px 8px;font-size:12px;font-weight:600;color:${COLORS.muted};border-bottom:1px solid ${COLORS.border};text-transform:uppercase;letter-spacing:.03em">${label}</th>`;

// Right-aligned cells hold numbers ("19-11", "68%"); keep them on one line on phones.
const td = (content, align = "left", extra = "") =>
  `<td style="text-align:${align};padding:6px 8px;font-size:14px;border-bottom:1px solid ${COLORS.border};${align === "right" ? "white-space:nowrap;" : ""}${extra}">${content}</td>`;

function teamCell(t) {
  const manager = t.manager && t.manager !== t.team ? `<br><span style="color:${COLORS.muted};font-size:12px">${esc(t.manager)}</span>` : "";
  return `<strong>${esc(t.team)}</strong>${manager}`;
}

function table(headers, rows) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 8px">
<thead><tr>${headers.join("")}</tr></thead>
<tbody>${rows.join("")}</tbody></table>`;
}

function section(title, body) {
  return `<tr><td style="padding:24px 24px 8px">
<h2 style="margin:0 0 12px;font-size:18px;color:${COLORS.text}">${esc(title)}</h2>
${body}
</td></tr>`;
}

function playerLine(p) {
  const proj = p.projected != null ? ` <span style="color:${COLORS.muted}">(proj ${pts(p.projected)})</span>` : "";
  return `${esc(p.name)} <span style="color:${COLORS.muted}">${esc(p.pos)}${p.nflTeam ? ` · ${esc(p.nflTeam)}` : ""}</span> — <strong>${pts(p.points)}</strong>${proj}`;
}

function callout(lines) {
  return `<div style="background:${COLORS.stripe};border:1px solid ${COLORS.border};border-radius:8px;padding:12px 14px;margin:4px 0 8px;font-size:14px;line-height:1.6">${lines.join("<br>")}</div>`;
}

export function renderRecapHtml({ data, narrative, siteUrl }) {
  const { week, season, weekStandings, seasonStandings, oddsMovers, topScore, bottomScore } = data;
  const zebra = (i) => (i % 2 ? `background:${COLORS.stripe};` : "");

  const weekTable = table(
    [th("#"), th("Team"), th("Score", "right"), th("All-play", "right")],
    weekStandings.map((t, i) =>
      `<tr>${td(t.rank, "left", zebra(i))}${td(teamCell(t), "left", zebra(i))}${td(pts(t.points), "right", zebra(i))}${td(`${t.wins}-${t.losses}`, "right", zebra(i))}</tr>`
    )
  );

  const seasonTable = table(
    [th("#"), th("Team"), th("W-L", "right"), th("PF", "right"), th("GB", "right"), th("Playoffs", "right")],
    seasonStandings.map((t, i) => {
      const cutoff = i === data.playoffTeams - 1 ? `border-bottom:2px solid ${COLORS.accent};` : "";
      const z = zebra(i) + cutoff;
      const status = t.odds.status === "clinched" ? " ✓" : t.odds.status === "eliminated" ? " ✗" : "";
      return `<tr>${td(`${t.rank} ${rankDelta(t)}`, "left", `white-space:nowrap;${z}`)}${td(teamCell(t), "left", z)}${td(`${t.wins}-${t.losses}`, "right", z)}${td(pts(t.pointsFor), "right", z)}${td(t.gamesBack === 0 ? "—" : t.gamesBack, "right", z)}${td(pct(t.odds.playoffPct) + status, "right", z)}</tr>`;
    })
  );

  const topLines = (topScore.lineup?.topContributors || []).map(
    (p) => `${playerLine(p)} <span style="color:${COLORS.muted}">(${pct(p.shareOfTotal)} of total)</span>`
  );

  const bl = bottomScore.lineup;
  const bottomLines = [];
  if (bl) {
    (bl.biggestDisappointments?.length ? bl.biggestDisappointments : []).forEach((p) =>
      bottomLines.push(playerLine(p))
    );
    if (bl.pointsLeftOnBench > 0) {
      bottomLines.push(
        `Best possible lineup: <strong>${pts(bl.optimalPoints)}</strong> (${pts(bl.pointsLeftOnBench)} left on the bench)`
      );
      bl.swaps.slice(0, 3).forEach((s) =>
        bottomLines.push(
          `Should have started ${esc(s.start.name)} (${pts(s.start.points)})${s.insteadOf ? ` over ${esc(s.insteadOf.name)} (${pts(s.insteadOf.points)})` : ""}`
        )
      );
    } else {
      bottomLines.push("Lineup was already optimal — no points left on the bench.");
    }
    if (bl.emptySlots.length) bottomLines.push(`Empty lineup slot(s): ${esc(bl.emptySlots.join(", "))}`);
    if (bl.startersWithNoGame?.length) {
      bottomLines.push(`Started with no game (bye or ruled out): ${bl.startersWithNoGame.map((p) => esc(p.name)).join(", ")}`);
    }
  }

  const movers = oddsMovers.filter((m) => Math.abs(m.change) >= 0.005).slice(0, 6);
  const moversTable = movers.length
    ? table(
        [th("Team"), th("Before", "right"), th("Now", "right"), th("Change (pts)", "right")],
        movers.map((m, i) => {
          const color = m.change > 0 ? COLORS.up : COLORS.down;
          return `<tr>${td(teamCell(m), "left", zebra(i))}${td(pct(m.from), "right", zebra(i))}${td(pct(m.to), "right", zebra(i))}${td(`<strong style="color:${color}">${signedPct(m.change)}</strong>`, "right", zebra(i))}</tr>`;
        })
      )
    : "";

  const button = (href, label) =>
    `<a href="${esc(href)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px;margin:0 8px 8px 0">${esc(label)}</a>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(narrative.subject)}</title></head>
<body style="margin:0;padding:0;background:${COLORS.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${COLORS.text}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg}"><tr><td align="center" style="padding:24px 8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:${COLORS.card};border-radius:12px;overflow:hidden">
<tr><td style="background:${COLORS.accent};padding:20px 24px;color:#ffffff">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">${esc(data.leagueName)} · ${esc(season)} season</div>
<div style="font-size:24px;font-weight:700;margin-top:4px">Week ${week} Recap</div>
</td></tr>
<tr><td style="padding:20px 24px 0">${paragraphs(narrative.intro)}</td></tr>
${section(`Week ${week} all-play results`, weekTable)}
${section("Season all-play standings", seasonTable + `<p style="margin:4px 0 0;font-size:12px;color:${COLORS.muted}">Blue line = playoff cut (top ${data.playoffTeams}). ▲▼ = change from last week. ✓ clinched, ✗ eliminated.</p>`)}
${section(`🔥 Top score: ${topScore.team} — ${pts(topScore.points)}`, paragraphs(narrative.topScore) + (topLines.length ? callout(topLines) : ""))}
${section(`🧊 Bottom score: ${bottomScore.team} — ${pts(bottomScore.points)}`, paragraphs(narrative.bottomScore) + (bottomLines.length ? callout(bottomLines) : ""))}
${section("📈 Playoff odds movers", paragraphs(narrative.playoffOdds) + moversTable)}
${section("📊 Trends", paragraphs(narrative.trends))}
<tr><td style="padding:16px 24px 24px">
${button(siteUrl, "Open the BSFFL site")}${button(`${siteUrl.replace(/\/$/, "")}/playoffs`, "Full playoff odds")}
</td></tr>
</table>
<p style="font-size:12px;color:${COLORS.muted};margin:12px 0 0">All-play: every team plays every other team each week. <a href="${esc(siteUrl)}" style="color:${COLORS.muted}">${esc(siteUrl)}</a></p>
</td></tr></table>
</body></html>`;
}

export function renderRecapText({ data, narrative, siteUrl }) {
  const { week, weekStandings, seasonStandings, topScore, bottomScore } = data;
  const lines = [];
  lines.push(`${data.leagueName} WEEK ${week} RECAP`, "", narrative.intro, "");
  lines.push(`WEEK ${week} ALL-PLAY`);
  weekStandings.forEach((t) => lines.push(`${String(t.rank).padStart(2)}. ${t.team} — ${pts(t.points)} (${t.wins}-${t.losses})`));
  lines.push("", "SEASON ALL-PLAY STANDINGS");
  seasonStandings.forEach((t) =>
    lines.push(`${String(t.rank).padStart(2)}. ${t.team} — ${t.wins}-${t.losses}, ${pts(t.pointsFor)} PF, playoffs ${pct(t.odds.playoffPct)}`)
  );
  lines.push("", `TOP SCORE: ${topScore.team} — ${pts(topScore.points)}`, narrative.topScore, "");
  lines.push(`BOTTOM SCORE: ${bottomScore.team} — ${pts(bottomScore.points)}`, narrative.bottomScore);
  lines.push("", "PLAYOFF ODDS", narrative.playoffOdds, "", "TRENDS", narrative.trends, "", siteUrl);
  return lines.join("\n");
}
