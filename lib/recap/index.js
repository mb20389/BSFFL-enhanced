// lib/recap/index.js
//
// The weekly recap email end to end: pick the week, gather the data, have
// Claude write it up, render it, and send it from a Gmail account.
//
// Environment variables (set in Vercel → Project → Settings → Environment Variables):
//   GMAIL_USER              The Gmail address that sends the recap.
//   GMAIL_APP_PASSWORD      A Google App Password for that account (not the
//                           normal password; needs 2-Step Verification on).
//   RECAP_FROM_NAME         Display name on the email (default "BSFFL Recap").
//   RECAP_TEST_RECIPIENTS   Comma-separated list for test sends (e.g. just you).
//   RECAP_RECIPIENTS        Comma-separated league list.
//   RECAP_LIVE              "true" sends the Tuesday email to RECAP_RECIPIENTS;
//                           anything else sends it to RECAP_TEST_RECIPIENTS.
//   ANTHROPIC_API_KEY       Claude API key for the write-up.
//   SITE_URL                Link in the email (default https://bsffl.vercel.app).
//   CRON_SECRET             Protects the cron and preview routes.

import nodemailer from "nodemailer";
import { getCurrentSeasonConfig } from "../leagues";
import { getSeasonWeek } from "../weeks";
import { buildRecapData } from "./data";
import { renderRecapHtml, renderRecapText } from "./email";
import { factualNarrative, writeNarrative } from "./narrative";

const DEFAULT_SITE_URL = "https://bsffl.vercel.app";
const DEFAULT_FROM_NAME = "BSFFL Recap";
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
 * Send one copy per recipient through Gmail, so addresses aren't exposed to
 * each other. Gmail allows roughly 500 recipients a day from a personal account.
 */
export async function sendRecap(recap, recipients, { audience }) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD must be set");
  if (!recipients.length) throw new Error(`No ${audience} recipients configured`);

  const transport = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass: pass.replace(/\s+/g, "") }, // app passwords are shown with spaces
    pool: true, // one connection for the whole list
    // nodemailer waits up to 2 minutes by default; fail fast instead.
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
  const from = { name: process.env.RECAP_FROM_NAME || DEFAULT_FROM_NAME, address: user };

  const ids = [];
  const failed = [];
  try {
    // Surface a bad app password or blocked connection once, before the loop.
    await transport.verify();
    for (const to of recipients) {
      try {
        const info = await transport.sendMail({
          from,
          to,
          subject: recap.subject,
          html: recap.html,
          text: recap.text,
        });
        ids.push(info.messageId);
      } catch (err) {
        console.error(`recap send to ${to} failed:`, err);
        failed.push({ to, error: String(err?.message || err) });
      }
    }
  } finally {
    transport.close();
  }

  if (!ids.length) throw new Error(`Every send failed: ${failed[0]?.error}`);
  return { sent: ids.length, failed };
}

export function recipientsFor(audience) {
  return audience === "league"
    ? parseEmails(process.env.RECAP_RECIPIENTS)
    : parseEmails(process.env.RECAP_TEST_RECIPIENTS);
}
