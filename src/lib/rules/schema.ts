/**
 * The machine contract for `guidelines/rules-<subject>.yaml` — plan.md §4.5.
 *
 * The rules files are authored and owned by the teaching side. This schema is how
 * code reads them, and its job is to fail loudly the moment a file drifts from
 * what the pipeline depends on, rather than silently producing a video that
 * breaks a rule nobody noticed had moved.
 *
 * The strictness is deliberately uneven, and the rule is: **strict on what code
 * consumes, loose on what only the prompt reads.** The gate arithmetic, beat
 * bands, palettes, silence minimums and misconception register are all typed
 * exactly, because a missing or renamed key there is a defect. The `method`
 * blocks differ per subject and are read almost entirely by the model rather than
 * by code, so they pass through untyped — the prompt receives the raw YAML text
 * regardless (plan.md §7), so nothing is lost by not modelling them here.
 *
 * A handful of fields are pinned with `z.literal(true)`. Those are not
 * decoration: `gate.fail_closed`, `misconceptions.do_not_invent` and
 * `beats.order_mandatory` are premises this pipeline is built on. If a rules file
 * ever turns one off, the correct behaviour is to refuse to run, not to quietly
 * comply.
 */
import { z } from "zod";

export const SUBJECTS = ["mathematics", "physics", "chemistry"] as const;
export type Subject = (typeof SUBJECTS)[number];

export const STAGES = ["sek1", "sek2"] as const;
export type Stage = (typeof STAGES)[number];

/**
 * The seven-beat spine, in mandatory order. Verified identical across all three
 * rules files; see `schema.test.ts`.
 */
export const BEAT_IDS = [
  "anchor",
  "pretrain",
  "elicit",
  "confront",
  "resolve",
  "vary",
  "consolidate",
] as const;
export type BeatId = (typeof BEAT_IDS)[number];

export const COLOUR_VISION_DEFICIENCIES = ["deuteranopia", "protanopia"] as const;

const hex = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, "expected a #RRGGBB colour");

/** An inclusive `[min, max]` band. */
const band = z
  .tuple([z.number(), z.number()])
  .refine(([lo, hi]) => lo <= hi, { message: "band minimum must not exceed its maximum" });

export type Band = [number, number];

const stage = z.object({
  label: z.string().min(1),
  target_seconds: band,
  narration_wpm: band,
  silence_reserve: z.number().min(0).max(1),
  max_script_words: z.number().int().positive(),
  max_sentence_words: z.number().int().positive(),
  reset_gap_max_seconds: z.number().positive(),
  min_reset_beats: z.number().int().nonnegative(),
  min_interactive_reset_beats: z.number().int().nonnegative(),
  max_simultaneous_objects: z.number().int().positive(),
  min_static_hold_seconds: z.number().nonnegative(),
  max_words_per_label: z.number().int().positive(),
});

const beat = z.looseObject({
  id: z.enum(BEAT_IDS),
  /** The didactic instruction for this beat. Goes into the storyboard prompt verbatim. */
  do: z.string().min(1),
  seconds: z.object({ sek1: band, sek2: band }),
  min_silence_seconds: z.number().positive().optional(),
  is_reset_beat_1: z.boolean().optional(),
  interactive: z.boolean().optional(),
  required_every_video: z.boolean().optional(),
  must_name_misconception_from: z.string().optional(),
});

const beats = z
  .looseObject({
    order_mandatory: z.literal(true),
    none_removable: z.literal(true),
    sequence: z.array(beat).length(BEAT_IDS.length),
  })
  .refine(
    ({ sequence }) => sequence.every((b, i) => b.id === BEAT_IDS[i]),
    { message: `beats.sequence must be exactly, in order: ${BEAT_IDS.join(", ")}`, path: ["sequence"] },
  );

const videoType = z.object({ duration_seconds: band, chains_by: z.string() });

const limits = z.looseObject({
  hard_cap_seconds: z.number().positive(),
  idea_units_per_video: z.number().int().positive(),
  over_budget_action: z.string().min(1),
  stages: z.object({ sek1: stage, sek2: stage }),
});

const chains = z.looseObject({
  formula: z.string().min(1),
  max_links: z.number().int().positive(),
  min_link_seconds: z.number().positive(),
  boundary: z.string().min(1),
  bridge_max_words: z.number().int().positive(),
  ends_unresolved_allowed: z.boolean(),
  show_chain_position: z.boolean(),
  rules: z.array(z.string()).min(1),
});

const narration = z.looseObject({
  word_budget_formula: z.string().min(1),
  rules: z.array(z.string()).min(1),
  /** Drives the silence planner — plan.md §4.3. */
  silence_minimums_seconds: z.object({
    after_transformation: z.number().positive(),
    before_reveal: z.number().positive(),
    prediction_prompt: z.number().positive(),
    resting_frame: z.number().positive(),
  }),
  notation: z.looseObject({
    decimal_separator_on_screen: z.string(),
    thousands_separator_on_screen: z.string(),
  }),
  /** Category name → phrases. Categories vary per subject; gate check A9 flattens them. */
  banned_phrases: z.record(z.string(), z.array(z.string()).min(1)),
  /** German false friends. Already German-aware; see plan.md §3.6. */
  banned_false_friends: z.array(z.string()),
  required_substitutions: z
    .array(z.looseObject({ banned: z.string().min(1), use: z.string().nullable() }))
    .optional(),
});

const visuals = z.looseObject({
  rules: z.array(z.string()).min(1),
  cue_preference: z.array(z.string()).min(1),
  max_simultaneous_animated_changes: z.number().int().positive(),
  max_simultaneous_cues: z.number().int().positive(),
  /**
   * Every rules file declares this `false` — colour never carries meaning on its
   * own. That is what makes the simulated-collision exemptions in
   * `palette.test.ts` defensible rather than a shrug.
   */
  colour_encodes_meaning_alone: z.boolean(),
  /**
   * Role name → colour. `palette.py` is generated from exactly this, and the AST
   * guard rejects raw hex in generated scenes, so a palette violation cannot be
   * written (plan.md §3.3).
   */
  palette: z
    .record(z.string(), hex)
    .refine((p) => "accent_focus" in p, {
      message: "palette must define accent_focus — it is the only route to the focus cue",
    }),
  /** Chemistry only: eight element colours, fixed library-wide. */
  element_colours: z.record(z.string(), hex).optional(),
  colourblind_check: z.array(z.enum(COLOUR_VISION_DEFICIENCIES)).min(1),
});

const misconception = z.looseObject({
  claim: z.string().min(1),
  /** Present on only one register entry today; the rest are derived. See `parser.ts`. */
  id: z.string().min(1).optional(),
  domain: z.array(z.string()).min(1),
  priority: z.string().optional(),
});

const misconceptions = z.looseObject({
  min_addressed_per_video: z.number().int().positive(),
  /** Gate check A10 exists because of this. The agent may not invent a misconception. */
  do_not_invent: z.literal(true),
  register: z.array(misconception).min(1),
});

const gate = z.looseObject({
  /** The whole premise. A rules file that turns this off is not one we can honour. */
  fail_closed: z.literal(true),
  word_budget_tolerance: z.number().positive().max(1),
  machine_checks: z.array(z.string()).min(1),
  judgement_checks: z.array(z.string()).min(1),
});

/**
 * The validated shape of one rules file. Extra keys survive parsing but are not
 * typed — see the strictness note at the top of this file.
 */
export const subjectConfigSchema = z
  .looseObject({
    subject: z.enum(SUBJECTS),
    version: z.number().positive(),
    narration_language: z.enum(["en", "de"]),
    learner_l1: z.enum(["en", "de"]),
    limits,
    video_types: z.looseObject({
      concept: videoType,
      worked: videoType,
      drill: videoType,
      no_type_gets_a_cap_exception: z.literal(true),
    }),
    idea_units: z.looseObject({
      count_one_for_each: z.array(z.string()).min(1),
      do_not_count: z.array(z.string()).min(1),
    }),
    beats,
    reset_beats: z.looseObject({
      interactive_types: z.array(z.string()).min(1),
      passive_types: z.array(z.string()),
    }),
    chains,
    narration,
    visuals,
    /** Subject-specific and read by the prompt, not by code. Intentionally untyped. */
    method: z.looseObject({}),
    misconceptions,
    banned: z.array(z.string()).min(1),
    gate,
    video_spec_required_fields: z.array(z.string()).min(1),
  })
  /**
   * The seven per-beat bands must actually be able to add up to a duration inside
   * the stage target. If they cannot, the rulebook is internally unsatisfiable and
   * no storyboard could ever pass the gate — a drift worth catching at parse time
   * rather than discovering as a mysteriously unpassable gate. plan.md §5.5 flags
   * this window as real but narrow: for `sek1` the minima sum to 128 s and the
   * maxima to 185 s against a 130–170 s target.
   */
  .superRefine((config, ctx) => {
    for (const stageName of STAGES) {
      const [targetLo, targetHi] = config.limits.stages[stageName].target_seconds;
      let bandLo = 0;
      let bandHi = 0;
      for (const b of config.beats.sequence) {
        bandLo += b.seconds[stageName][0];
        bandHi += b.seconds[stageName][1];
      }
      if (Math.max(bandLo, targetLo) > Math.min(bandHi, targetHi)) {
        ctx.addIssue({
          code: "custom",
          path: ["beats", "sequence"],
          message:
            `${stageName}: the seven beat bands sum to ${bandLo}–${bandHi} s, which cannot ` +
            `produce a duration inside the ${targetLo}–${targetHi} s target. No storyboard ` +
            `could satisfy both, so the rulebook is internally inconsistent.`,
        });
      }
    }
  });

export type SubjectConfig = z.infer<typeof subjectConfigSchema>;
export type StageLimits = z.infer<typeof stage>;
export type BeatSpec = z.infer<typeof beat>;
