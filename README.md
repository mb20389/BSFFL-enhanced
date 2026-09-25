This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/pages/api-reference/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `pages/index.js`. The page auto-updates as you edit the file.

[API routes](https://nextjs.org/docs/pages/building-your-application/routing/api-routes) can be accessed on [http://localhost:3000/api/hello](http://localhost:3000/api/hello). This endpoint can be edited in `pages/api/hello.js`.

The `pages/api` directory is mapped to `/api/*`. Files in this directory are treated as [API routes](https://nextjs.org/docs/pages/building-your-application/routing/api-routes) instead of React pages.

This project uses [`next/font`](https://nextjs.org/docs/pages/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn-pages-router) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/pages/building-your-application/deploying) for more details.

## 🏈 All-Play Standings Behavior

This project implements **All-Play Standings** for the league, powered by Sleeper’s API.

| Season | League | Sleeper league ID | Page |
| --- | --- | --- | --- |
| 2026 (current) | BSFFL | `1389341431096684544` | `/` |
| 2025 (archived) | BSFFL | `1260076858616053760` | `/2025` |

---

### 🗂️ Seasons & the league registry

`lib/leagues.js` is the **source of truth** for which Sleeper league the site reads.
It holds one entry per season (league ID, league name, Week 1 kickoff anchor, week
counts, `archived` flag) plus `CURRENT_SEASON`.

- Every page and every API route resolves its league through that registry.
- API routes accept `?season=2025` (preferred) or `?leagueId=…` (explicit override).
  With neither, they serve `CURRENT_SEASON`.
- `SLEEPER_LEAGUE_ID` / `NEXT_PUBLIC_SLEEPER_LEAGUE_ID` are now only a last-resort
  fallback if the registry has no ID for a season. A stale deployment env var can
  no longer pin the site to a finished season.

**Rolling over to a new season:**

1. Add the new season to `SEASONS` in `lib/leagues.js` (league ID, name, the
   8 PM ET Week 1 kickoff in UTC, `archived: false`). If the season opens on a
   day other than Thursday, also set `weekTwoDate` — see Week Definition below.
2. Point `CURRENT_SEASON` at it — `/` follows automatically.
3. Mark the outgoing season `archived: true`.
4. Copy `pages/2025.js` to `pages/<year>.js` for the outgoing season. That page is
   pinned to its own league ID forever, so it keeps rendering that season's final
   standings after every future rollover.

Archived seasons are read-only: no polling, no projections column, standings frozen
at the final regular-season week, and API responses cached for 12 hours since the
data can never change.

---

### 📅 Week Definition

**A week always turns over before its own first kickoff**, so the site is already
showing week N when week N's first game starts.

| Week | Turns over at | Ahead of |
| --- | --- | --- |
| Normal week | **Thursday 8:00 PM ET** | the 8:15 PM TNF kickoff |
| Thanksgiving week | **Thursday 11:00 AM ET** | the 12:30 PM early game |
| 2026 Week 1 | **Wed 9/9 8:00 PM ET** | that night's opener |

- Turnovers are resolved against the **America/New_York wall clock**, not fixed
  7-day arithmetic, so they stay at the same local time when DST ends in November
  instead of sliding an hour earlier.
- **Thanksgiving is detected automatically** (the fourth Thursday in November) and
  turns over in the morning, so the noon games are scored in the right week rather
  than the site sitting on the previous week until 8 PM. `earlyTurnoverDates` in a
  season's config forces the same early turnover on any other `YYYY-MM-DD` whose
  week opens with a daytime game.
- **When the season doesn’t open on a Thursday, Week 1 runs long** rather than
  shifting every later week off Thursday. 2026 opens with a **Wednesday night game
  on 9/9**, so:
  - Week 1: Wed 9/9 8 PM ET → Thu 9/17 8 PM ET (8 days)
  - Week 2 onward: Thursday 8 PM ET → Thursday 8 PM ET as usual
  - This is configured per season with `weekOneDate` (when Week 1 begins) and the
    optional `weekTwoDate` (where the Thursday cadence resumes, which also sets the
    weekday and time of every later turnover). Omit `weekTwoDate` for a normal
    Thursday opener, as in 2025.
- Before Week 1 kicks off the week is `0`, and the UI says the season hasn’t started
  rather than showing empty standings.

---

### 📊 Weekly View
- Polls every **60 seconds** by default (`NEXT_PUBLIC_POLL_MS` env var) — live seasons only.
- Pulls:
  - **Live scores** from `/api/scores?season={yr}&week={wk}`.
  - **Projections** from `/api/projections?season={yr}&week={wk}` (half-PPR format).
- **Projections**:
  - Show non-zero values only while games are in progress.
  - Reset to `0` once a week has fully ended.
  - Hidden entirely on archive pages.
- Includes lineup expand/collapse with player points.

---

### 📈 Season View
- Aggregates **all-play standings** across completed weeks.
- Shows:
  - Total Wins / Losses.
  - Total Points.
  - High Weeks / Low Weeks → **only count weeks that have completed** (no live awards).
    On an archive every week is complete, so all of them count.
  - Games Back (GB) relative to first place.
  - Rank changes (`Δ`) compared to a prior week.

- Data source: `/api/scores?season={yr}&week=season&maxWeek={N}`
  - `N` defaults to the current league week, capped at `regularSeasonWeeks` (14,
    i.e. the week before `playoff_week_start`).

---

### 🔌 API routes

All routes take an optional `season` (or `leagueId`) parameter:

| Route | Purpose |
| --- | --- |
| `/api/league` | League metadata (name, status, size, playoff week start) |
| `/api/nfl-week` | Current NFL + league week, standings caps, `seasonStarted` |
| `/api/scores` | `week={n}` for one week, `week=season&maxWeek={n}` for standings |
| `/api/projections` | Half-PPR starter projections for a week |
| `/api/lineup` | One roster's starters and points for a week |
| `/api/users`, `/api/rosters`, `/api/season` | Raw league data helpers |

---

### ⚙️ Developer Notes
- **`getSeasonWeek(config)`** in `lib/weeks.js` determines the current league week
  from that season's kickoff anchor, and reports the final week for archived seasons
  so completed-week logic counts every week:
  ```js
  // lib/leagues.js
  "2026": {
    leagueId: "1389341431096684544",
    weekOneDate: "2026-09-10T00:00:00Z", // Wed 9/9, 8 PM ET
    weekTwoDate: "2026-09-18T00:00:00Z", // Thu 9/17, 8 PM ET
    ...
  }
  ```
  (September is EDT, so 8 PM ET is `00:00Z` the next day.)
- **`components/LeagueDashboard.js`** renders both the live and archived views; the
  page files are thin wrappers that hand it a season config.

---

## 🤝 Rivalries (`/rivalries`)

"What-if" head-to-head records between every pair of managers. Every week, each
manager's score is compared with every other manager's score (the same comparison
behind all-play); a manager's record against a rival is how many weeks they
outscored that rival.

- Keyed by Sleeper **user ID**, so rivalries follow the manager across seasons.
- Counts only **completed regular-season weeks** (live weeks never move the numbers).
- Covers every season in `lib/leagues.js` automatically — add a season there and it
  shows up in the Seasons filter.
- Two views: **By manager** (record, win %, avg margin, biggest win / worst loss vs.
  each opponent) and **League grid** (16×16 win % heatmap, sorted by overall record).
- The selected manager, view and seasons are in the URL, so a rivalry can be shared
  as a link: `/rivalries?manager=<sleeper user id>&seasons=2025`.
- Data: `/api/rivalries`.

## 🎲 Playoff odds (`/playoffs`)

Monte Carlo playoff odds using BSFFL rules: **top 8 in all-play** make it, **total
points** break ties, seeded straight down that order (1 v 8, 2 v 7…).

- Completed weeks are real results; the remaining regular-season weeks are simulated
  10,000 times (`?sims=` accepts 1,000–50,000).
- Each team's weekly scoring average is shrunk toward the league average early in
  the season (`PRIOR_WEEKS` in `lib/playoffOdds.js`), and each simulation also varies
  how good each team "really" is, so early-season odds stay appropriately humble.
- Seeded random numbers: the odds only change when a week becomes final.
- **Clinched / Eliminated** badges appear only when mathematically certain.
- Shows playoff %, top-4 %, #1-seed %, projected record, and a seed-by-seed chance strip.
- Back-tested on 2025: better than "current top 8 are locks" at every checkpoint.
- Data: `/api/playoff-odds?season=2026`. Page follows `CURRENT_SEASON`;
  `/playoffs?season=2025` shows an earlier season.

### 📉 Odds history chart

Above the odds table, a line chart shows how every team's odds moved week by week
(point *k* = the odds as they stood once week *k* was final; "Pre" = everyone even).

- Switch between **Make playoffs**, **Top 4** and **#1 seed**.
- All teams draw as faint lines; hover to preview, click a line, chip, or table row to
  pin up to 6 teams in color. It opens on the latest week's biggest riser and faller.
- The x-axis spans the full regular season, so an in-progress season shows the weeks
  still to play.
- Plain SVG — no chart library.
- Data: `/api/playoff-odds-history?season=2026`. The table and chart share
  `lib/seasonOdds.js`, so the chart's latest point always matches the table. Each
  finished week's odds are cached (they can never change); a full 14-week season takes
  ~2 s to compute from cold.

Shared Sleeper fetching/caching for both lives in `lib/sleeper.js`.

## 📧 Weekly recap email (Tuesdays, 6 AM ET)

An automated recap of the week that just ended, built on all-play results:
week and season all-play standings, the top and bottom scores (the players who
drove them, and for the bottom score the lineup decisions behind it: points
left on the bench, who should have started, empty or bye-week starters), whose
playoff odds moved, recent hot and cold runs, and a link to the site.

- **Numbers** come from the same code as the site (`lib/recap/data.js` reuses
  `lib/seasonOdds.js`), so the odds in the email match `/playoffs` exactly.
- **Write-up** is by Claude (`lib/recap/narrative.js`) as broadcast-booth banter
  between Cotton McKnight (play-by-play) and Pepper Brooks (color) from
  *Dodgeball*, told to use only the data it's given. If the API key is missing
  or the call fails, the email still goes out with Cotton reading the plain
  facts and a stock Pepper line.
- **Sending** is from a Gmail account via SMTP (nodemailer), one copy per
  recipient. A personal Gmail account can send to about 500 recipients a day.
- **Schedule:** `vercel.json` runs `/api/cron/weekly-recap` at 10:00 and 11:00
  UTC on Tuesdays; the route only proceeds when it's 6 AM Eastern, so the send
  time survives the DST change. Only regular-season weeks (1–14) are recapped.

### Environment variables (Vercel → Settings → Environment Variables)

| Variable | Purpose |
| --- | --- |
| `CRON_SECRET` | Required. Vercel sends it to the cron route; also unlocks manual runs and previews. |
| `GMAIL_USER` | The Gmail address the recap is sent from. |
| `GMAIL_APP_PASSWORD` | A [Google App Password](https://myaccount.google.com/apppasswords) for that account (requires 2-Step Verification). Not your normal password. |
| `RECAP_FROM_NAME` | Display name on the email (default `BSFFL Recap`). |
| `RECAP_TEST_RECIPIENTS` | Comma-separated test list (e.g. just you). |
| `RECAP_RECIPIENTS` | Comma-separated league list. |
| `RECAP_LIVE` | `true` sends Tuesday's email to the league; anything else sends it to the test list. |
| `ANTHROPIC_API_KEY` | Claude API key for the write-up. |
| `SITE_URL` | Link in the email (default `https://bsffl.vercel.app`). |
| `RECAP_MODEL` / `RECAP_EFFORT` | Optional overrides (default `claude-opus-5`, `medium`). |

### Previewing and testing

- `/api/recap-preview?key=<CRON_SECRET>` — the email in your browser (last
  finished week). Add `&week=2`, `&ai=0` (skip Claude; free and instant),
  `&format=text` or `&format=json`.
- `/api/cron/weekly-recap?key=<CRON_SECRET>&force=1` — send now to the test list.
  Add `&week=2`, `&dryRun=1` (build but don't send), or `&to=league`.
