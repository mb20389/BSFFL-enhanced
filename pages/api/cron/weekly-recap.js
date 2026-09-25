// pages/api/cron/weekly-recap.js
//
// Sends the weekly recap email. Vercel Cron calls this on Tuesday mornings
// (see vercel.json) with `Authorization: Bearer $CRON_SECRET`.
//
// Vercel Cron schedules are in UTC, so vercel.json triggers it at both 10:00
// and 11:00 UTC and this route only proceeds when it is 6 AM on the Eastern
// clock — 10:00 UTC during daylight time, 11:00 UTC after DST ends. That
// check is also what stops the second trigger from sending a duplicate.
//
// Scheduled runs go to the league (RECAP_RECIPIENTS) when RECAP_LIVE=true,
// and to RECAP_TEST_RECIPIENTS otherwise.
//
// Manual runs (same secret, as a header or ?key=):
//   ?force=1        skip the Tuesday-6-AM check
//   ?week=3         recap a specific week (default: last finished week)
//   ?to=test        send to RECAP_TEST_RECIPIENTS (default for manual runs)
//   ?to=league      send to RECAP_RECIPIENTS
//   ?dryRun=1       build everything but don't send; returns a summary
//   ?ai=0           skip Claude and use the plain write-up

import { buildRecap, easternClock, recipientsFor, sendRecap } from "../../../lib/recap";

export const config = { maxDuration: 300 };

const SEND_WEEKDAY = "Tue";
const SEND_HOUR_ET = 6;

export function isAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed: never run unauthenticated
  return req.headers.authorization === `Bearer ${secret}` || req.query.key === secret;
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  const manual = req.query.force === "1" || req.query.week != null || req.query.to != null || req.query.dryRun === "1";

  if (!manual) {
    const { weekday, hour } = easternClock();
    if (weekday !== SEND_WEEKDAY || hour !== SEND_HOUR_ET) {
      return res.status(200).json({ skipped: `Not ${SEND_WEEKDAY} ${SEND_HOUR_ET} AM ET (now ${weekday} ${hour}:00 ET)` });
    }
  }

  const audience = manual
    ? req.query.to === "league" ? "league" : "test"
    : process.env.RECAP_LIVE === "true" ? "league" : "test";

  try {
    const week = req.query.week != null ? Number(req.query.week) : undefined;
    if (week != null && !Number.isInteger(week)) {
      return res.status(400).json({ error: "Invalid week" });
    }

    const recap = await buildRecap({ week, useAI: req.query.ai !== "0" });
    if (recap.skipped) return res.status(200).json({ skipped: recap.skipped });

    const recipients = recipientsFor(audience);
    const summary = {
      season: recap.season,
      week: recap.week,
      subject: recap.subject,
      audience,
      recipients: recipients.length,
      narrativeSource: recap.narrativeSource,
      narrativeError: recap.narrativeError,
    };

    if (req.query.dryRun === "1") return res.status(200).json({ dryRun: true, ...summary });

    const result = await sendRecap(recap, recipients, { audience });
    console.log("weekly recap sent:", { ...summary, ...result });
    return res.status(200).json({ ...summary, ...result });
  } catch (err) {
    console.error("weekly recap error:", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
