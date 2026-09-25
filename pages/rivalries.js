// pages/rivalries.js
// "What-if" head-to-head records between every pair of managers, across seasons.
import Head from "next/head";
import SiteNav, { PageHeader } from "../components/SiteNav";
import RivalriesView from "../components/RivalriesView";
import { getCurrentSeasonConfig } from "../lib/leagues";

export default function Rivalries({ config }) {
  return (
    <>
      <Head>
        <title>{`${config.name} Rivalries`}</title>
        <meta
          name="description"
          content={`Week-by-week head-to-head records between every ${config.name} manager, across seasons.`}
        />
      </Head>
      <div className="container">
        <SiteNav />
        <PageHeader
          title={`${config.name} Rivalries`}
          subtitle="How often each manager has outscored every other manager, week by week"
          leagueId={config.leagueId}
        />
        <RivalriesView />
      </div>
    </>
  );
}

export function getStaticProps() {
  return { props: { config: getCurrentSeasonConfig() } };
}
