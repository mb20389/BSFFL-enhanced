// lib/leagues.js
//
// Central registry of every season the site knows about.
//
// This registry is the source of truth for league IDs — not the environment.
// Rolling the site over to a new season means adding an entry here and pointing
// CURRENT_SEASON at it; the previous season keeps its entry forever so its
// archive page (`/2025`, `/2026`, …) keeps rendering exactly as it did on the
// last day of that season.
//
// weekOneDate is the 8:00 PM ET kickoff of Week 1, expressed in UTC (September
// is EDT, so 8:00 PM ET == 00:00 UTC the next day). BSFFL weeks run
// Thursday 8 PM ET → Thursday 8 PM ET.
//
// weekTwoDate is optional and only needed when the season opens on something
// other than a Thursday: it pins where the normal Thursday cadence picks up, so
// Week 1 simply runs long instead of every later week drifting off Thursday.
// Omit it and weeks are a uniform 7 days from weekOneDate.

export const SEASONS = {
  "2026": {
    season: "2026",
    leagueId: "1389341431096684544",
    name: "BSFFL",
    // 2026 opens on a Wednesday night: Week 1 starts Wed 9/9/2026, 8 PM ET …
    weekOneDate: "2026-09-10T00:00:00Z",
    // … and the Thursday→Thursday cadence resumes at Week 2, Thu 9/17, 8 PM ET.
    weekTwoDate: "2026-09-18T00:00:00Z",
    totalWeeks: 18,
    // Standings cover the regular season only (playoff_week_start is 15).
    regularSeasonWeeks: 14,
    archived: false,
  },
  "2025": {
    season: "2025",
    leagueId: "1260076858616053760",
    name: "BSFFL",
    // NFL 2025 opener: Thursday 9/4/2025, 8 PM ET.
    weekOneDate: "2025-09-05T00:00:00Z",
    totalWeeks: 18,
    regularSeasonWeeks: 14,
    archived: true,
  },
};

export const CURRENT_SEASON = "2026";

const DEFAULT_TOTAL_WEEKS = 18;
const DEFAULT_REGULAR_SEASON_WEEKS = 14;

/** All seasons, newest first. */
export function listSeasons() {
  return Object.values(SEASONS).sort((a, b) => Number(b.season) - Number(a.season));
}

/** Archived seasons (the ones with permanent archive pages), newest first. */
export function listArchivedSeasons() {
  return listSeasons().filter((s) => s.archived);
}

/** The season the site is currently tracking live. */
export function getCurrentSeasonConfig() {
  return SEASONS[CURRENT_SEASON];
}

/**
 * Look up a season config by year. Unknown seasons fall back to the current
 * season so a stray `?season=1999` can never leave a route without a league.
 */
export function getSeasonConfig(season) {
  const key = String(season ?? "").trim();
  return SEASONS[key] || getCurrentSeasonConfig();
}

export function findSeasonByLeagueId(leagueId) {
  const id = String(leagueId ?? "").trim();
  if (!id) return null;
  return listSeasons().find((s) => s.leagueId === id) || null;
}

/**
 * Resolve the league context for an API request or a page.
 *
 * Precedence:
 *   1. `season` — the normal path (`?season=2025`).
 *   2. `leagueId` — an explicit override; if it belongs to a known season we
 *      return that season's config, otherwise we synthesize one so ad-hoc
 *      league IDs still work.
 *   3. The current season from the registry.
 *
 * SLEEPER_LEAGUE_ID / NEXT_PUBLIC_SLEEPER_LEAGUE_ID are only consulted when the
 * registry somehow has no ID for the season, so a stale deployment env var can
 * no longer pin the site to a finished season.
 */
export function resolveLeagueContext({ season, leagueId } = {}) {
  const seasonKey = String(season ?? "").trim();
  if (seasonKey && SEASONS[seasonKey]) return SEASONS[seasonKey];

  const id = String(leagueId ?? "").trim();
  if (id) {
    const known = findSeasonByLeagueId(id);
    if (known) return known;

    const base = seasonKey ? { season: seasonKey } : getCurrentSeasonConfig();
    return {
      season: seasonKey || base.season,
      leagueId: id,
      name: base.name || "League",
      weekOneDate: base.weekOneDate || getCurrentSeasonConfig().weekOneDate,
      weekTwoDate: base.weekTwoDate || null,
      totalWeeks: base.totalWeeks || DEFAULT_TOTAL_WEEKS,
      regularSeasonWeeks: base.regularSeasonWeeks || DEFAULT_REGULAR_SEASON_WEEKS,
      archived: Boolean(base.archived),
    };
  }

  const current = getCurrentSeasonConfig();
  if (current?.leagueId) return current;

  const envLeagueId =
    process.env.SLEEPER_LEAGUE_ID || process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID || "";
  return { ...current, leagueId: envLeagueId };
}

/** Convenience for API handlers: resolve straight from `req.query`. */
export function resolveLeagueContextFromQuery(query = {}) {
  return resolveLeagueContext({ season: query.season, leagueId: query.leagueId });
}
