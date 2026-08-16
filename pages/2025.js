// pages/2025.js
// Permanent archive of the 2025 BSFFL season (Sleeper league 1260076858616053760).
// This page is pinned to that league forever — it never follows CURRENT_SEASON,
// so it keeps rendering the final 2025 all-play standings after every rollover.
import Head from "next/head";
import LeagueDashboard from "../components/LeagueDashboard";
import { SEASONS } from "../lib/leagues";

const SEASON_2025 = SEASONS["2025"];

export default function Season2025({ config }) {
  return (
    <>
      <Head>
        <title>{`${config.name} 2025 Final Standings (Archive)`}</title>
        <meta
          name="description"
          content={`Archived final all-play standings for the 2025 ${config.name} season.`}
        />
      </Head>
      <LeagueDashboard config={config} />
    </>
  );
}

export function getStaticProps() {
  return { props: { config: SEASON_2025 } };
}
