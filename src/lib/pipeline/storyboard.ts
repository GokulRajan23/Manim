/**
 * Stage 3 — Storyboard (plan.md §4.7), scoped to the 60-second demo profile.
 *
 * Seven beats in spine order, each with the narration that will be spoken and the
 * keywords that will appear on screen. Durations are *not* asked of the model:
 * they are derived from the measured audio in the next stage, because the sync
 * invariant (§4.2) makes audio the authority and anything the model guessed here
 * would be overwritten anyway.
 *
 * The word budget is the one number that matters. It uses the *measured* rate,
 * not the rulebook's midpoint — narration measured at ~145 wpm while the budget
 * formula assumed 127.5, and writing to the wrong figure makes every script run
 * long against real audio.
 */
import { z } from "zod";
import { structured } from "@/lib/llm/structured";
import type { ConceptSpec } from "./concept";
import { BEAT_IDS, type BeatId } from "@/lib/rules/schema";

/**
 * The rate that actually applies to *short segments*, which is not the rate
 * `npm run calibrate` reports.
 *
 * Calibration measures one continuous 100-word sample and gets 145 wpm. Seven
 * separate segments come back slower — measured 107 words in 66 s of audio, so
 * ~97 wpm — because ElevenLabs puts its own lead-in and tail on every request,
 * and seven segments pay that seven times. Budgeting at 145 overshot a 60-second
 * target by 28 %.
 */
const SEGMENT_WPM = 97;

export const storyboardSchema = z.object({
  beats: z
    .array(
      z.object({
        beat: z.enum(BEAT_IDS),
        narration: z
          .string()
          .describe("What the voice says. Plain prose, no markup, no stage directions."),
        onScreen: z
          .array(z.string())
          .describe("At most 3 keywords or short symbolic phrases. Never the narration itself."),
        role: z
          .enum(["known", "unknown", "construction", "result", "focus"])
          .describe("Which palette role this beat is about."),
      }),
    )
    .length(7),
});

export type Storyboard = z.infer<typeof storyboardSchema>;
export type StoryboardBeat = Storyboard["beats"][number];

const SPINE: Record<BeatId, string> = {
  anchor: "Hook it to something the learner already knows.",
  pretrain: "Name the parts and symbols before using them.",
  elicit: "Ask the learner to predict. Leave the question hanging.",
  confront: "Show the misconception failing, concretely.",
  resolve: "Give the correct account, worked through.",
  vary: "One quick variation, so it does not stay a single case.",
  consolidate: "State what was learned in one sentence.",
};

export async function storyboard(
  concept: ConceptSpec,
  totalSeconds: number,
  misconception: string,
  /** Seconds of deliberate stillness the narration must leave room for. */
  holdSeconds = 0,
  /** Per-beat duration bands, already scaled to this target. Drives the split. */
  bands?: Record<BeatId, readonly [number, number]>,
): Promise<Storyboard> {
  // The rulebook's own formula, (seconds / 60) * wpm, applied to the time
  // actually available for speech once the holds are taken out.
  const speaking = Math.max(totalSeconds - holdSeconds, totalSeconds * 0.4);
  const words = Math.round((speaking / 60) * SEGMENT_WPM);

  // Words per beat, in proportion to that beat's duration band. An even split
  // fails gate check B1: the resolve beat is budgeted three times the anchor, so
  // giving them equal narration puts both outside their bands at once.
  const shares = BEAT_IDS.map((id) => {
    const [lo, hi] = bands?.[id] ?? [1, 1];
    return (lo + hi) / 2;
  });
  const totalShare = shares.reduce((a, b) => a + b, 0);
  const perBeat = shares.map((share) => Math.round((words * share) / totalShare));

  const prompt = [
    `Write a ${totalSeconds}-second explainer for Klasse ${concept.klasse} on: ${concept.topic}.`,
    `The single idea: ${concept.ideaUnits.items[0] ?? concept.topic}`,
    `The misconception to confront: ${misconception}`,
    "",
    `TOTAL narration budget: ${words} words. Aim for this total, do not undershoot it —`,
    "a script well under budget makes the beats too short for their duration bands.",
    "",
    "Words per beat. These are not suggestions. Each beat has its own duration",
    "band and the word count is the only thing putting it inside that band. At",
    "this length a single extra sentence pushes a beat out of its band and the",
    "whole lesson is rejected. Treat the maximum as hard.",
    ...BEAT_IDS.map(
      (i_, i) => `  ${i + 1}. ${BEAT_IDS[i]} — aim ${perBeat[i]}, MAX ${Math.round((perBeat[i] ?? 0) * 1.1)} words — ${SPINE[BEAT_IDS[i]!]}`,
    ),
    "",
    "Rules that are checked:",
    "  - Never read the on-screen text aloud. On-screen text is keywords and symbols only.",
    "  - No 'clearly', 'as you can see', 'simply', 'obviously'.",
    "  - Short sentences, at most 18 words.",
    "  - The elicit beat must ask a real question and not answer it.",
    "",
    // The audience is 12-16 and hearing this in their second language: the
    // rulebook records narration_language: en with learner_l1: de. Abstract
    // phrasing is the failure mode, and it is not something the machine checks
    // can catch — only the prompt can.
    "How to say it. This learner is 12-16 years old and English is their second",
    "language, so plainness is not a style choice here:",
    "  - One idea per sentence. Prefer 8-12 words.",
    "  - Everyday words over technical ones. Say 'goes up' before 'increases'.",
    "  - Name a concrete thing before you name the rule about it. A ramp, a road,",
    "    a staircase — then the word 'slope'.",
    "  - Use numbers the learner can hold: 2, 3, 10, 50. Never a decimal you did",
    "    not have to introduce.",
    "  - Address the learner as 'you'. Say what to look at, not what is 'observed'.",
    "  - Never use a term before the pretrain beat has named it.",
  ].join("\n");

  return structured(
    storyboardSchema,
    "record_storyboard",
    "Record the seven-beat storyboard.",
    [{ kind: "text", text: prompt }],
    {
      system:
        "You write narration for German Gymnasium explainer videos in English. " +
        "You are terse: every word costs screen time. You never pad.",
      temperature: 0.4,
    },
  );
}
