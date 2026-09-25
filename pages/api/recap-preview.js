// pages/api/recap-preview.js
//
// Shows the weekly recap email in the browser without sending it:
//   /api/recap-preview?key=<CRON_SECRET>             last finished week
//   /api/recap-preview?key=<CRON_SECRET>&week=2      a specific week
//   &ai=0         skip Claude (free, instant) and use the plain write-up
//   &format=text  the plain-text version
//   &format=json  the underlying data and write-up
//
// Protected by CRON_SECRET because each preview with Claude costs an API call.

import { buildRecap } from "../../lib/recap";
import { isAuthorized } from "./cron/weekly-recap";

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  try {
    const week = req.query.week != null ? Number(req.query.week) : undefined;
    if (week != null && !Number.isInteger(week)) {
      return res.status(400).json({ error: "Invalid week" });
    }

    const recap = await buildRecap({ week, useAI: req.query.ai !== "0" });
    if (recap.skipped) return res.status(200).json({ skipped: recap.skipped });

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Recap-Narrative", recap.narrativeSource);

    if (req.query.format === "json") {
      return res.status(200).json({
        subject: recap.subject,
        narrativeSource: recap.narrativeSource,
        narrativeError: recap.narrativeError,
        data: recap.data,
      });
    }
    if (req.query.format === "text") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.status(200).send(`Subject: ${recap.subject}\n\n${recap.text}`);
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(recap.html);
  } catch (err) {
    console.error("recap preview error:", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
