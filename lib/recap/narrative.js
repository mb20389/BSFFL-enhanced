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

// Every section except the subject is a short broadcast-booth exchange, one
// line per speaker, e.g. "Cotton: …\nPepper: …". lib/recap/email.js styles
// the speaker names.
const DIALOGUE = "Dialogue, one line per turn, each line starting with 'Cotton: ' or 'Pepper: ' and separated by a newline.";

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    subject: {
      type: "string",
      description: "Email subject line, under 80 characters, starting with 'BSFFL Week N:'. Plain text, not dialogue.",
    },
    intro: { type: "string", description: `Cold open welcoming viewers to the week's coverage, 2–3 lines. ${DIALOGUE}` },
    topScore: {
      type: "string",
      description: `The week's top score: who, how many points, and which players drove it. 3–5 lines. ${DIALOGUE}`,
    },
    bottomScore: {
      type: "string",
      description: `The week's bottom score: which players let the team down, and whether an owner decision (bench choices, empty slots, starting a zero) caused or worsened it. 3–5 lines. ${DIALOGUE}`,
    },
    playoffOdds: {
      type: "string",
      description: `Whose playoff odds moved most this week and why. 3–5 lines. ${DIALOGUE}`,
    },
    trends: {
      type: "string",
      description: `Teams on hot or cold runs over recent weeks and what it means for the season, ending with a sign-off. 3–5 lines. ${DIALOGUE}`,
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

Voice: the recap is called as a broadcast by Cotton McKnight and Pepper Brooks, the ESPN8 "The Ocho" commentary team from the movie Dodgeball.
- Cotton McKnight does play-by-play: polished, booming, over-the-top sports-anchor gravitas applied to fantasy football as if it were a world championship. He delivers the actual facts and numbers.
- Pepper Brooks does color commentary: earnest, deadpan, and slightly off, offering confident analysis that is either blindingly obvious or a baffling non sequitur, and occasionally a bizarre personal aside.
- They play off each other: Cotton sets it up, Pepper reacts. Keep the jokes about the teams and the week's results, not generic.
- Write original banter in their style. An occasional nod to their best-known catchphrases is fine (at most one per email), but don't recite lines from the movie.
- Refer to teams by team name and, where it reads naturally, the manager's name. Good-natured trash talk is welcome.

Rules:
- Use only facts present in the data. Never invent injuries, trades, real-world NFL game events, or quotes from real people. A player's injury_status is his status today, not necessarily during the game; mention it only as "now listed as …".
- Every number a reader needs must be said by one of them: round points to one decimal and odds to whole percentages (e.g. 0.634 → 63%).
- For the bottom score, decide whether the owner's decisions mattered: compare pointsLeftOnBench, swaps, emptySlots, zeroPointStarters and startersWithNoGame (starters with no projection, usually a bye or a player ruled out before kickoff) with optimalWouldHave. If the best possible lineup still would have finished last, say the roster simply didn't show up, and don't blame the owner.
- Every section except the subject is dialogue: one line per turn, each starting with "Cotton: " or "Pepper: ", separated by newlines. Keep each line to one to three sentences. No markdown, no stage directions, no other speakers.`;

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

  // Keep the booth voice even without Claude: Cotton reads the facts, Pepper chimes in.
  const booth = (facts, pepper) => `Cotton: ${facts}\nPepper: ${pepper}`;

  return {
    subject: `BSFFL Week ${week}: ${top.team} tops the week with ${pts(top.points)}`,
    intro: booth(
      `Welcome to ESPN8, The Ocho, where week ${week} of BSFFL action is officially in the books. ${data.weeksRemaining} regular-season week(s) remain.`,
      "That's a lot of weeks, Cotton. Or not many. It depends on how you count them."
    ),
    topScore: booth(
      `${top.team} put up the week's high score of ${pts(top.points)}` +
        (topDrivers.length ? `, led by ${playerList(topDrivers)}.` : "."),
      "When you score the most points, Cotton, you tend to beat the teams that scored fewer."
    ),
    bottomScore: booth(bottomText, "A tough week, Cotton. You hate to see it. Well, some of us don't."),
    playoffOdds: booth(oddsText, "The computer has spoken, Cotton, and frankly I don't trust it."),
    trends: booth(
      trendsText,
      "That's all the time we have. Back to you, Cotton. Wait, I'm Pepper. Back to me."
    ),
  };
}
