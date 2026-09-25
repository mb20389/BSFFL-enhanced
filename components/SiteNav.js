// components/SiteNav.js
//
// Site-level navigation shared by every page, plus a simple page header for the
// pages that aren't built on LeagueDashboard (rivalries, playoff odds).

import Link from "next/link";
import { useRouter } from "next/router";
import { SEASONS } from "../lib/leagues";

const LINKS = [
  { href: "/", label: "Standings", match: (p) => p === "/" || /^\/\d{4}$/.test(p) },
  { href: "/rivalries", label: "Rivalries", match: (p) => p.startsWith("/rivalries") },
  { href: "/playoffs", label: "Playoff odds", match: (p) => p.startsWith("/playoffs") },
];

export default function SiteNav() {
  const { pathname } = useRouter();
  return (
    <nav className="site-nav" aria-label="Site">
      <span className="site-nav-brand">BSFFL</span>
      {LINKS.map((l) => {
        const active = l.match(pathname);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`site-nav-link ${active ? "active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function PageHeader({ title, chip, subtitle, leagueId }) {
  const id = leagueId || Object.values(SEASONS).find((s) => !s.archived)?.leagueId;
  return (
    <header
      className="header"
      style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
    >
      <div>
        <h1 className="title">
          {title}
          {chip ? <span className="season-chip">{chip}</span> : null}
        </h1>
        {subtitle ? <p className="subtitle">{subtitle}</p> : null}
      </div>
      {id ? (
        <a
          href={`https://sleeper.com/leagues/${id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-light"
          title="Open league on Sleeper"
          style={{ display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zM5 5h6v2H7v10h10v-4h2v6H5V5z" fill="currentColor" />
          </svg>
          <span>View on Sleeper</span>
        </a>
      ) : null}
    </header>
  );
}
