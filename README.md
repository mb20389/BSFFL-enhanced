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
| 2026 (current) | SDFFL | `1389754614080880640` | `/` |
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
   Thursday 8 PM ET Week 1 kickoff in UTC, `archived: false`).
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
- **League weeks** run **Thursday 8 PM ET → Thursday 8 PM ET**.
- Week 1 starts at NFL Kickoff (Thursday 9/10/2026, 8 PM ET for the 2026 season)
  and ends the following Thursday at 8 PM ET.
- This ensures Thursday Night Football is always included in the correct scoring week.
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
  "2026": { leagueId: "1389754614080880640", weekOneDate: "2026-09-11T00:00:00Z", ... }
  ```
  (September is EDT, so Thursday 8 PM ET is `00:00Z` the next day.)
- **`components/LeagueDashboard.js`** renders both the live and archived views; the
  page files are thin wrappers that hand it a season config.
