// pages/playoffs.js
// Simulated playoff odds for the current season. Follows CURRENT_SEASON in
// lib/leagues.js, so it rolls over with the rest of the site.
import Head from "next/head";
import SiteNav, { PageHeader } from "../components/SiteNav";
import PlayoffOddsView from "../components/PlayoffOddsView";
import { getCurrentSeasonConfig } from "../lib/leagues";

export default function Playoffs({ config }) {
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
        <PageHeader
          title={`${config.name} Playoff Odds`}
          chip={config.season}
          subtitle={`Top 8 in all-play make the playoffs • odds from simulating the rest of the season`}
          leagueId={config.leagueId}
        />
        <PlayoffOddsView config={config} />
      </div>
    </>
  );
}

export function getStaticProps() {
  return { props: { config: getCurrentSeasonConfig() } };
}
