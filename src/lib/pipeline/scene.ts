/**
 * Step 8 — scene codegen, guarded, repaired, and guaranteed (plan.md §4.8, §4.13).
 *
 * Why this exists at all: the hand-written diagrams in `tafel/visuals.py` only
 * know four topics. A teacher who uploads anything else gets a title card, which
 * makes the product a demo with four rehearsed answers rather than a tool. Codegen
 * is what generalises it.
 *
 * What makes it safe to run arbitrary model output:
 *
 *   1. the AST guard rejects on the *source*, before a container starts
 *   2. the render is sandboxed — `--network none`, one directory, capped
 *   3. failures are repaired with the real error, up to a limit
 *   4. and when that limit is reached the deterministic scene renders instead,
 *      at exactly the same duration, so the lesson always completes
 *
 * Step (4) is the reason this can be attempted at all. Codegen quality is the one
 * thing a sprint cannot iterate on, so the design absorbs bad generations rather
 * than depending on good ones — a beat that falls back is a worse beat, never a
 * missing one.
 */
import { z } from "zod";
import { structured } from "@/lib/llm/structured";
import { MODEL } from "@/lib/llm/client";
import { describe, guard, type Violation } from "@/lib/render/guard";
import type { StoryboardBeat } from "./storyboard";

const sceneSchema = z.object({
  code: z
    .string()
    .min(1)
    .describe("The complete Python file. No markdown fences, no commentary."),
  intent: z.string().min(1).describe("One sentence: what this scene shows."),
});

export type SceneResult = {
  /** Python source ready to render, or undefined when every attempt failed. */
  code?: string;
  intent?: string;
  attempts: number;
  /** Why it gave up, for the event log. */
  problems: string[];
};

/**
 * The contract the generated file must satisfy. Stated positively and in full,
 * because a model repairs against what it was told, and anything left implicit
 * here becomes a guard rejection later.
 */
function contract(beat: StoryboardBeat, seconds: number): string {
  return [
    "Write one complete Python file for Manim Community v0.21.",
    "",
    "Hard requirements — the file is rejected automatically if any is broken:",
    "  - Define exactly `class Beat(BeatBase)`, importing `from tafel.beat import BeatBase`.",
    "  - Override `body(self)` — NOT `construct`. The base class draws the title,",
    "    the rule and the keywords, then calls your `body()`, then holds the frame",
    "    for exactly the right duration. Overriding `construct` breaks the timing.",
    "  - Do not call `self.wait()`. The base class owns the timing.",
    "  - Animate with `self.play(...)`, ONE animation per call. Two animations in",
    "    one `self.play` is rejected.",
    "  - Your animations must total under 40% of DURATION; the rest is the hold.",
    "  - Allowed imports: `manim`, `numpy`, `tafel` only. Nothing else.",
    "  - No raw colours. Use role names from `tafel.palettes.mathematics`:",
    "    KNOWN, UNKNOWN, CONSTRUCTION, RESULT, FONT. A literal like",
    '    "#FF0000" is rejected.',
    "  - NEVER draw in GROUND. It is the colour of the frame itself, so anything",
    "    drawn in it is invisible. This is rejected automatically.",
    "  - Forbidden: open, eval, exec, __import__, getattr, any dunder attribute,",
    "    SVGMobject, ImageMobject, file or network access.",
    "",
    "Available to you, already imported by `from manim import *`:",
    "  Axes, NumberLine, MathTex, Text, Line, Arrow, Dot, Polygon, Square, Circle,",
    "  Rectangle, VGroup, Create, FadeIn, Transform, Write.",
    "",
    "Guidance:",
    "  - Draw the mathematics. A beat that only shows words is a wasted beat.",
    "  - Keep it to a handful of mobjects: the rules cap what may be on screen.",
    "  - Use MathTex for formulas, Text(font=FONT) for words.",
    "  - Position with next_to / shift / move_to relative to ORIGIN. Do not assume",
    "    a coordinate is on screen; the frame is 14.2 by 8 units.",
    "",
    `This beat is "${beat.beat}", lasting ${seconds.toFixed(1)} seconds.`,
    `Narration (do NOT put this on screen): "${beat.narration}"`,
    `On-screen keywords already drawn for you: ${JSON.stringify(beat.onScreen)}`,
  ].join("\n");
}

const SYSTEM =
  "You write Manim scene code for a German Gymnasium lesson pipeline. " +
  "You draw mathematics — axes, shapes, constructions — never decorative graphics. " +
  "You output a complete Python file and nothing else.";

/**
 * Generate a scene for one beat, guarding and repairing as needed.
 *
 * Returns `code: undefined` rather than throwing when it cannot succeed: the
 * caller falls back to the deterministic scene, and a beat that falls back is a
 * normal outcome here, not an error.
 */
export async function generateScene(
  beat: StoryboardBeat,
  seconds: number,
  tafelDir: string,
  maxAttempts = 3,
): Promise<SceneResult> {
  const problems: string[] = [];
  let feedback = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let generated: z.infer<typeof sceneSchema>;
    try {
      generated = await structured(
        sceneSchema,
        "write_scene",
        "Write the Manim scene for this beat.",
        [{ kind: "text", text: contract(beat, seconds) + feedback }],
        // Codegen is the work that fans out and retries, so it runs on the
        // cheaper model by design (§4.14).
        { system: SYSTEM, model: MODEL.codegen, temperature: 0.3, attempts: 1 },
      );
    } catch (error) {
      problems.push(`attempt ${attempt}: model call failed — ${(error as Error).message}`);
      continue;
    }

    // Models fence code even when told not to; unwrapping is cheaper than a
    // repair round spent on punctuation.
    const code = unfence(generated.code);
    const violations: Violation[] = await guard(code, tafelDir);

    if (violations.length === 0) {
      return { code, intent: generated.intent, attempts: attempt, problems };
    }

    problems.push(`attempt ${attempt}: ${violations.map((v) => v.rule).join(", ")}`);
    feedback =
      `\n\nYour previous attempt was rejected by the guard:\n${describe(violations)}\n` +
      "Fix every one of these and return the complete file again.";
  }

  return { attempts: maxAttempts, problems };
}

/** Strip a ```python fence if the model added one despite being asked not to. */
function unfence(code: string): string {
  const fenced = /```(?:python)?\s*\n([\s\S]*?)```/.exec(code);
  return (fenced?.[1] ?? code).trim();
}
