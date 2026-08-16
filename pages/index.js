// pages/index.js
// The current season. Rolling over to a new year means updating
// CURRENT_SEASON / SEASONS in lib/leagues.js — this page follows automatically.
import Head from "next/head";
import LeagueDashboard from "../components/LeagueDashboard";
import { getCurrentSeasonConfig } from "../lib/leagues";

export default function Home({ config }) {
  return (
    <>
      <Head>
        <title>{`${config.name} All-Play Standings • ${config.season}`}</title>
        <meta
          name="description"
          content={`All-play standings for the ${config.season} ${config.name} season, powered by Sleeper.`}
        />
      </Head>
      <LeagueDashboard config={config} />
    </>
  );
}

export function getStaticProps() {
  return { props: { config: getCurrentSeasonConfig() } };
}
