// pages/playoffs.js
// Simulated playoff odds. Defaults to CURRENT_SEASON (so it rolls over with the
// rest of the site); `/playoffs?season=2025` shows how an earlier race unfolded.
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import SiteNav, { PageHeader } from "../components/SiteNav";
import PlayoffOddsView from "../components/PlayoffOddsView";
import { CURRENT_SEASON, getCurrentSeasonConfig, listSeasons, SEASONS } from "../lib/leagues";

function playoffsHref(season) {
  return String(season) === CURRENT_SEASON ? "/playoffs" : `/playoffs?season=${season}`;
}

export default function Playoffs({ current }) {
  const router = useRouter();
  const requested = typeof router.query.season === "string" ? router.query.season : null;
  const config = (requested && SEASONS[requested]) || current;
  const archived = Boolean(config.archived);

  return (
    <>
      <Head>
        <title>{`${config.name} Playoff Odds • ${config.season}`}</title>
        <meta
          name="description"
          content={`Simulated playoff odds for the ${config.season} ${config.name} season, based on all-play standings.`}
        />
      </Head>
      <div className="container">
        <SiteNav />
        <div className="page-header-row">
          <PageHeader
            title={`${config.name} Playoff Odds`}
            chip={config.season}
            subtitle={
              archived
                ? `How the ${config.season} playoff race unfolded, week by week`
                : "Top 8 in all-play make the playoffs • odds from simulating the rest of the season"
            }
            leagueId={config.leagueId}
          />
          <nav className="season-nav" aria-label="Seasons">
            {listSeasons().map((s) => {
              const active = String(s.season) === String(config.season);
              return (
                <Link
                  key={s.season}
                  href={playoffsHref(s.season)}
                  className={`season-link ${active ? "active" : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  {s.season}
                  {s.archived ? "" : " • live"}
                </Link>
              );
            })}
          </nav>
        </div>
        <PlayoffOddsView config={config} />
      </div>
    </>
  );
}

export function getStaticProps() {
  return { props: { current: getCurrentSeasonConfig() } };
}
