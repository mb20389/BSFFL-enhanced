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

**The NFL schedule decides when**, rather than a hand-maintained calendar rule.
Each week turns over on the date of its own first game (`lib/scheduleWeeks.js`):

| That week's first game | Turns over at | Example |
| --- | --- | --- |
| A standalone night game | **8:00 PM ET that day** | every normal Thursday, ahead of the 8:15 TNF kickoff |
| A full daytime slate | **11:00 AM ET that day** | 2026 week 18, which opens on a Sunday |

- The schedule feed carries dates but no kickoff times, so **the size of the first
  slate stands in for the time**: one game that day is a prime-time kickoff, several
  means a daytime slate starting around lunchtime.
- This is what catches the weeks a calendar rule misses. **2026 week 12 opens with a
  Wednesday night game on 11/25**, the day before Thanksgiving — a Thursday-anchored
  rule scored it under week 11. Turning over Wednesday evening also puts
  Thanksgiving's noon games in the right week.
- Turnovers resolve against the **America/New_York wall clock**, so they hold at the
  same local time when DST ends in November instead of sliding an hour earlier.
- The evening anchor's weekday and time of day come from `weekTwoDate`, so a league
  that plays by different hours edits one field.
- **If the schedule can't be fetched, the calendar rule in `lib/weeks.js` takes over**
  (Thursday 8 PM ET, with automatic Thanksgiving detection and `earlyTurnoverDates`),
  so the site still knows the week when Sleeper is down. `/api/nfl-week` reports which
  was used as `weekSource`, and `?debug=1` dumps every derived turnover.
- Before Week 1 kicks off the week is `0`, and the UI says the season hasn’t started
  rather than showing empty standings.

---

### 📊 Weekly View
- Polls every **60 seconds** by default (`NEXT_PUBLIC_POLL_MS` env var) — live seasons only.
- Pulls:
  - **Live scores** from `/api/scores?season={yr}&week={wk}`.
  - **Projections** from `/api/projections?season={yr}&week={wk}` (half-PPR format).
- Projections are live projected finals (see below); the column is hidden on archives.
- Includes lineup expand/collapse with player points.

---

### 🔴 Live vs Projected View

A dumbbell chart plus table showing, for every team, its all-play record **right
now** against its **projected final** — so you can see the ground about to move
while games are being played. It refreshes on the same 60s poll and stops polling
once every game is final.

**Live projections are not a sum of Sleeper's projections.** Sleeper's weekly
numbers are full-game figures that do not decay as a game is played, so summing
them mid-Sunday double-counts everyone who has already finished. Each player's
projected final is resolved from their own game's status instead
(`lib/liveScoring.js`), joining `projections.game_id → schedule.game_id`:

| Player's game | Contributes |
| --- | --- |
| Hasn't kicked off | their projection |
| Final | their actual points |
| In progress | `max(actual, projection)` |
| No game at all (bye, inactive) | their actual points — nothing more is coming |

The in-progress rule is deliberate. Sleeper's schedule feed carries a status but
**no game clock**, so there is no honest way to decay a projection partway through
a game. Treating the projection as a floor keeps the number monotonic — it never
sags as a player accumulates points — and it converges on the truth as each game
finalises. Taking the floor also covers players missing from the projections feed,
who keep their actual points instead of silently counting as zero. If a clock
source is added later, `projectPlayerFinal()` is the only thing that changes.

> ⚠️ **Not yet observed against live games.** This shipped in the offseason, when
> every game in the feed reads `pre_game` or `complete`. The final-week and
> not-started paths are verified against real data; the in-progress path is covered
> by unit assertions only. Worth a look during Week 1.

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
| `/api/nfl-week` | Current NFL + league week, standings caps, `seasonStarted`, `weekSource` (`?debug=1` dumps every turnover) |
| `/api/scores` | `week={n}` for one week, `week=season&maxWeek={n}` for standings |
| `/api/live-standings` | Both all-play standings for a week — live and projected — with per-team rank delta and starters remaining |
| `/api/projections` | Live projected final score per roster |
| `/api/lineup` | One roster's starters and points for a week |
| `/api/users`, `/api/rosters`, `/api/season` | Raw league data helpers |

> **Projections come from the un-versioned Sleeper path**
> (`https://api.sleeper.app/projections/nfl/{season}/{week}?season_type=regular&order_by=ppr`).
> The `/v1/projections/...` variant still answers `200` but returns
> `{ player_id: {} }` for every player — no stats at all — which silently produces
> zero projections everywhere. Don't "fix" it back to `/v1/`.

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
