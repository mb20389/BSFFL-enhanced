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

## 🏈 BSFFL Standings Behavior

This project implements **All-Play Standings** for the Bus Stop Fantasy Football League (BSFFL), powered by Sleeper’s API.

---

### 📅 Week Definition
- **BSFFL weeks** run **Thursday 8 PM ET → Thursday 8 PM ET**.  
- Example: Week 1 starts at NFL Kickoff (Thursday 9/4/2025, 8 PM ET) and ends the following Thursday at 8 PM ET.  
- This ensures Thursday Night Football is always included in the correct scoring week.

---

### 📊 Weekly View
- Polls every **60 seconds** by default (`POLL_MS` env var).  
- Pulls:
  - **Live scores** from `/api/scores?week={wk}`.
  - **Projections** from `/api/projections?week={wk}` (half-PPR format).
- **Projections**:
  - Show non-zero values only while games are in progress.
  - Reset to `0` once a week has fully ended.
- Includes lineup expand/collapse with player points.

---

### 📈 Season View
- Aggregates **all-play standings** across completed weeks.  
- Shows:
  - Total Wins / Losses.
  - Total Points.
  - High Weeks / Low Weeks → **only count weeks that have completed** (no live awards).
  - Games Back (GB) relative to first place.
  - Rank changes (`Δ`) compared to a prior week.

- Data source: `/api/scores?week=season&maxWeek={N}`  
  - `N` is capped at the current BSFFL week.

---

### ⚙️ Developer Notes
- **`getBsfflWeek()`** in `scores.js` determines the current BSFFL week using the kickoff anchor:
  ```js
  const weekOneDate = "2025-09-04T20:00:00Z";