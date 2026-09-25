// lib/recap/index.js
//
// The weekly recap email end to end: pick the week, gather the data, have
// Claude write it up, render it, and send it through Resend.
//
// Environment variables (set in Vercel → Project → Settings → Environment Variables):
//   RESEND_API_KEY          Resend API key (required to send).
//   RECAP_FROM              Sender, e.g. "BSFFL Recap <recap@yourdomain.com>".
//                           Defaults to Resend's test sender, which can only
//                           deliver to the email on your Resend account.
//   RECAP_TEST_RECIPIENTS   Comma-separated list for test sends (e.g. just you).
//   RECAP_RECIPIENTS        Comma-separated league list.
//   RECAP_LIVE              "true" sends the Tuesday email to RECAP_RECIPIENTS;
//                           anything else sends it to RECAP_TEST_RECIPIENTS.
//   ANTHROPIC_API_KEY       Claude API key for the write-up.
//   SITE_URL                Link in the email (default https://bsffl.vercel.app).
//   CRON_SECRET             Protects the cron and preview routes.

import { getCurrentSeasonConfig } from "../leagues";
import { getSeasonWeek } from "../weeks";
import { buildRecapData } from "./data";
import { renderRecapHtml, renderRecapText } from "./email";
import { factualNarrative, writeNarrative } from "./narrative";

const DEFAULT_SITE_URL = "https://bsffl.vercel.app";
const DEFAULT_FROM = "BSFFL Recap <onboarding@resend.dev>";
const ET_ZONE = "America/New_York";

export function siteUrl() {
  return (process.env.SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, "");
}

/** Weekday ("Tue") and hour (0–23) on the Eastern-time clock. */
export function easternClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_ZONE,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  return {
    weekday: parts.find((p) => p.type === "weekday")?.value,
    hour: Number(parts.find((p) => p.type === "hour")?.value),
  };
}

/**
 * The most recent week whose games are all over.
 *
 * League weeks turn over Thursday 8 PM ET, so on Tuesday and Wednesday the
 * current league week is the one that just finished with Monday Night Football.
 * From Thursday night through Monday its games are still being played, so the
 * last finished week is the one before it.
 */
export function lastFinishedWeek(config, now = new Date()) {
  const current = getSeasonWeek(config);
  const { weekday } = easternClock(now);
  return weekday === "Tue" || weekday === "Wed" ? current : current - 1;
}

export function parseEmails(value) {
  return String(value || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
}

/**
 * Build the recap for a week.
 * @param {object} [opts]
 * @param {number} [opts.week]     defaults to the last finished week
 * @param {boolean} [opts.useAI]   false skips Claude and uses the plain write-up
 */
export async function buildRecap({ week, useAI = true } = {}) {
  const config = getCurrentSeasonConfig();
  const targetWeek = week ?? lastFinishedWeek(config);
  const regular = config.regularSeasonWeeks || 14;

  if (!targetWeek || targetWeek < 1) {
    return { skipped: `No finished week to recap yet (week ${targetWeek}).` };
  }
  if (targetWeek > regular) {
    return { skipped: `Week ${targetWeek} is after the regular season (weeks 1–${regular}).` };
  }

  const data = await buildRecapData(config, targetWeek);
  const { narrative, source, error } = useAI
    ? await writeNarrative(data)
    : { narrative: factualNarrative(data), source: "fallback" };

  const url = siteUrl();
  return {
    week: targetWeek,
    season: config.season,
    subject: narrative.subject,
    html: renderRecapHtml({ data, narrative, siteUrl: url }),
    text: renderRecapText({ data, narrative, siteUrl: url }),
    narrativeSource: source,
    narrativeError: error || null,
    data,
  };
}

/**
 * Send one copy per recipient (so addresses aren't exposed to each other).
 * Scheduled sends pass an idempotency key, so if the cron fires twice for the
 * same week Resend delivers it only once (keys are remembered for 24 hours).
 * Manual test sends omit it so they can be repeated.
 */
export async function sendRecap(recap, recipients, { audience, idempotencyKey = null }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");
  if (!recipients.length) throw new Error(`No ${audience} recipients configured`);

  const from = process.env.RECAP_FROM || DEFAULT_FROM;
  const results = [];

  // Resend's batch endpoint takes up to 100 emails per call.
  for (let i = 0; i < recipients.length; i += 100) {
    const chunk = recipients.slice(i, i + 100);
    const r = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": `${idempotencyKey}-${i}` } : {}),
      },
      body: JSON.stringify(
        chunk.map((to) => ({
          from,
          to: [to],
          subject: recap.subject,
          html: recap.html,
          text: recap.text,
        }))
      ),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(`Resend error ${r.status}: ${body?.message || JSON.stringify(body)}`);
    }
    results.push(...(body?.data || []));
  }
  return { sent: recipients.length, ids: results.map((x) => x.id) };
}

export function recipientsFor(audience) {
  return audience === "league"
    ? parseEmails(process.env.RECAP_RECIPIENTS)
    : parseEmails(process.env.RECAP_TEST_RECIPIENTS);
}
