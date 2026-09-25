// lib/recap/narrative.js
//
// Turns the recap numbers (lib/recap/data.js) into the written parts of the
// email with Claude. The model only writes prose — every table in the email is
// rendered straight from the data — and it is told to use nothing but the
// numbers it is given.
//
// If ANTHROPIC_API_KEY is missing or the call fails, factualNarrative() writes
// short plain sentences from the same data so the email still goes out.

import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-opus-5";

const SECTIONS = ["subject", "intro", "topScore", "bottomScore", "playoffOdds", "trends"];

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    subject: {
      type: "string",
      description: "Email subject line, under 80 characters. Starts with 'BSFFL Week N:'.",
    },
    intro: { type: "string", description: "1–2 sentence opener summarizing the week." },
    topScore: {
      type: "string",
      description: "The week's top score: who, how many points, and which players drove it.",
    },
    bottomScore: {
      type: "string",
      description:
        "The week's bottom score: which players let the team down, and whether an owner decision (bench choices, empty slots, starting a zero) caused or worsened it.",
    },
    playoffOdds: {
      type: "string",
      description: "Whose playoff odds moved most this week and why.",
    },
    trends: {
      type: "string",
      description: "Teams on hot or cold runs over recent weeks and what it means for the season.",
    },
  },
  required: SECTIONS,
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You write the weekly recap email for BSFFL, a 16-team fantasy football league among friends.

How the league works:
- Standings are "all-play": every week each team is scored against every other team, so a week's record runs from 0-15 to 15-0 and the season record is the sum.
- Ties in all-play wins are broken by total points. The top 8 make the playoffs.
- Playoff odds come from a simulation of the remaining regular-season weeks.

Voice: a sharp, funny league columnist writing for people who know each other. Good-natured trash talk is welcome; be specific rather than generic. Refer to teams by team name and, where it reads naturally, the manager's name.

Rules:
- Use only facts present in the data. Never invent injuries, trades, real-world NFL game events, or quotes. A player's injury_status is his status today, not necessarily during the game; mention it only as "now listed as …".
- Round points to one decimal and odds to whole percentages (e.g. 0.634 → 63%).
- For the bottom score, decide whether the owner's decisions mattered: compare pointsLeftOnBench, swaps, emptySlots, zeroPointStarters and startersWithNoGame (starters with no projection, usually a bye or a player ruled out before kickoff) with optimalWouldHave. If the best possible lineup still would have finished last, say the roster simply didn't show up, and don't blame the owner.
- Each section is 2–4 sentences of plain text. No markdown, no bullet points, no headings.`;

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

function isValidNarrative(obj) {
  return obj && SECTIONS.every((k) => typeof obj[k] === "string" && obj[k].trim());
}

/**
 * @returns {Promise<{ narrative: object, source: "claude" | "fallback", error?: string }>}
 */
export async function writeNarrative(data) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { narrative: factualNarrative(data), source: "fallback", error: "ANTHROPIC_API_KEY not set" };
  }

  try {
    const response = await getClient().beta.messages.create({
      model: process.env.RECAP_MODEL || DEFAULT_MODEL,
      max_tokens: 16000,
      // If the model declines, re-run the request on Anthropic's recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: {
        effort: process.env.RECAP_EFFORT || "medium",
        format: { type: "json_schema", schema: OUTPUT_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Write the recap for week ${data.week} of the ${data.season} season. Here is the data:\n\n${JSON.stringify(data)}`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      throw new Error(`Model declined (${response.stop_details?.category ?? "no category"})`);
    }
    if (response.stop_reason === "max_tokens") {
      throw new Error("Response hit max_tokens");
    }

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = JSON.parse(text);
    if (!isValidNarrative(parsed)) throw new Error("Response missing sections");

    return { narrative: parsed, source: "claude" };
  } catch (err) {
    console.error("recap narrative error:", err);
    return { narrative: factualNarrative(data), source: "fallback", error: String(err?.message || err) };
  }
}

/* ---------------- plain fallback ---------------- */

const pct = (p) => `${Math.round(p * 100)}%`;
const pts = (x) => Number(x).toFixed(1);
const playerList = (players) =>
  players.map((p) => `${p.name} (${pts(p.points)})`).join(", ");

/** Short factual sentences, used when Claude isn't available. */
export function factualNarrative(data) {
  const { week, topScore: top, bottomScore: bottom, oddsMovers, seasonStandings } = data;
  const leader = seasonStandings[0];

  const topDrivers = top.lineup?.topContributors || [];
  const bottomLineup = bottom.lineup;

  let bottomText = `${bottom.team} had the week's low score at ${pts(bottom.points)}.`;
  if (bottomLineup) {
    const busts = bottomLineup.biggestDisappointments?.length
      ? bottomLineup.biggestDisappointments
      : [...bottomLineup.starters].filter((s) => !s.empty).sort((a, b) => a.points - b.points).slice(0, 2);
    if (busts.length) bottomText += ` The weak spots: ${playerList(busts)}.`;
    if (bottomLineup.pointsLeftOnBench > 0) {
      bottomText += ` The best possible lineup would have scored ${pts(bottomLineup.optimalPoints)}, leaving ${pts(bottomLineup.pointsLeftOnBench)} on the bench`;
      bottomText += bottom.optimalWouldHave?.stillLowest
        ? " — still last, so this one wasn't on the lineup."
        : ` — enough for a ${bottom.optimalWouldHave.allPlayWins}-${bottom.optimalWouldHave.allPlayLosses} all-play week.`;
    } else {
      bottomText += " The lineup was already optimal; the roster just didn't produce.";
    }
    if (bottomLineup.emptySlots.length) {
      bottomText += ` Empty lineup slot(s): ${bottomLineup.emptySlots.join(", ")}.`;
    }
    if (bottomLineup.startersWithNoGame?.length) {
      bottomText += ` Started with no game: ${bottomLineup.startersWithNoGame.map((p) => p.name).join(", ")}.`;
    }
  }

  const risers = oddsMovers.filter((m) => m.change > 0.005).slice(0, 2);
  const fallers = oddsMovers.filter((m) => m.change < -0.005).slice(0, 2);
  const move = (m) => `${m.team} (${pct(m.from)} → ${pct(m.to)})`;
  let oddsText = "Playoff odds barely moved this week.";
  if (risers.length || fallers.length) {
    oddsText = [
      risers.length ? `Biggest risers: ${risers.map(move).join(", ")}.` : "",
      fallers.length ? `Biggest fallers: ${fallers.map(move).join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  const hot = [...seasonStandings].sort((a, b) => b.recent.wins - a.recent.wins)[0];
  const cold = [...seasonStandings].sort((a, b) => a.recent.wins - b.recent.wins)[0];
  const trendsText =
    `${leader.team} leads the league at ${leader.wins}-${leader.losses}. ` +
    `Over the last ${hot.recent.weeks} week(s), ${hot.team} has been hottest (${hot.recent.wins}-${hot.recent.losses}) ` +
    `and ${cold.team} coldest (${cold.recent.wins}-${cold.recent.losses}).`;

  return {
    subject: `BSFFL Week ${week}: ${top.team} tops the week with ${pts(top.points)}`,
    intro: `Week ${week} is in the books. ${data.weeksRemaining} regular-season week(s) remain.`,
    topScore:
      `${top.team} put up the week's high score of ${pts(top.points)}` +
      (topDrivers.length ? `, led by ${playerList(topDrivers)}.` : "."),
    bottomScore: bottomText,
    playoffOdds: oddsText,
    trends: trendsText,
  };
}
