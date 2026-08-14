/**
 * `ConceptSpec` — what extraction produces (plan.md §4.7, stage 2).
 *
 * Two fields here do real work rather than describe:
 *
 *   `ideaUnits`               applies the rulebook's counting definition. If the
 *                             count exceeds `idea_units_per_video`, this material
 *                             is a *chain of videos*, not one video, and the
 *                             pipeline says so instead of cramming it in.
 *   `candidateMisconceptions` must reference the subject's §7 register by id. The
 *                             agent may not invent one — `do_not_invent: true` in
 *                             every rules file, and gate check A10 enforces it at
 *                             storyboard time. Catching it here means the teacher
 *                             sees a real misconception on the first screen.
 *
 * The Zod schema is the tool contract given to the model (see `llm/structured.ts`),
 * so field descriptions are prompt surface, not just documentation.
 */
import { z } from "zod";
import { misconceptionRegister, findMisconception } from "@/lib/rules/parser";
import type { SubjectConfig } from "@/lib/rules/schema";
import { SUBJECTS } from "@/lib/rules/schema";

export const conceptSpecSchema = z.object({
  subject: z.enum(SUBJECTS),
  klasse: z.number().int().min(7).max(10).describe("The Klasse this material targets, 7 to 10."),
  topic: z.string().min(1).describe("The specific topic, in the learner's terms. Not a chapter title."),
  summary: z.string().min(1).describe("Two or three sentences on what this material teaches."),

  ideaUnits: z
    .object({
      count: z.number().int().min(1),
      items: z
        .array(z.string().min(1))
        .min(1)
        .describe("One entry per idea unit, each stated as the thing the learner must retain."),
    })
    .describe(
      "Count an idea unit for each: a new term or symbol the learner must retain; a new " +
        "relationship between quantities already known; a procedural step that cannot be " +
        "chunked with the previous one; a required switch between representations. Do not " +
        "count restatements, examples of an idea already counted, or motivation.",
    ),

  chainProposal: z
    .object({
      of: z.number().int().min(1).describe("Total videos needed. 1 when the material is a single video."),
      links: z
        .array(
          z.object({
            title: z.string().min(1),
            ideaUnit: z.string().min(1).describe("The single idea unit this link teaches."),
          }),
        )
        .min(1),
    })
    .describe("If there is more than one idea unit, propose one link per idea unit."),

  prerequisites: z.array(z.string()).describe("What the learner must already know. May be empty."),
  keyTerms: z.array(z.object({ term: z.string().min(1), definition: z.string().min(1) })),

  candidateMisconceptions: z
    .array(
      z.object({
        registerId: z
          .string()
          .min(1)
          .describe("Must be copied exactly from the register ids supplied in the prompt."),
        statement: z.string().min(1).describe("How this misconception would show up in this topic."),
      }),
    )
    .min(1)
    .describe("Choose only from the supplied register. Never invent one."),

  workedExample: z
    .object({ problem: z.string().min(1), steps: z.array(z.string().min(1)).min(1) })
    .optional(),

  sourceQuotes: z
    .array(z.string().min(1))
    .min(1)
    .describe("Short verbatim spans copied from the uploaded material. Never paraphrase here."),
});

export type ConceptSpec = z.infer<typeof conceptSpecSchema>;

/** One problem found when checking a spec against the rulebook and the upload. */
export type ConceptProblem = { field: string; detail: string };

/**
 * Check the things the schema cannot: that ids exist, and that quotes quote.
 *
 * Kept separate from the Zod schema deliberately — these depend on the subject's
 * rulebook and on the source text, neither of which belongs in a static schema,
 * and the caller decides whether a problem is fatal or merely reported.
 */
export function checkConcept(
  spec: ConceptSpec,
  config: SubjectConfig,
  sourceText?: string,
): ConceptProblem[] {
  const problems: ConceptProblem[] = [];

  // A10's precondition. An invented id is the single most likely way for a
  // plausible-looking spec to be wrong, so it is named precisely.
  const register = misconceptionRegister(config);
  for (const [index, candidate] of spec.candidateMisconceptions.entries()) {
    if (!findMisconception(config, candidate.registerId)) {
      problems.push({
        field: `candidateMisconceptions[${index}].registerId`,
        detail:
          `"${candidate.registerId}" is not in the ${config.subject} register ` +
          `(${register.length} entries). The register is closed — do_not_invent is set.`,
      });
    }
  }

  // Idea-unit count and the chain proposal have to agree, or the "one idea per
  // video" rule is being satisfied on paper only.
  const perVideo = config.limits.idea_units_per_video;
  if (spec.ideaUnits.count !== spec.ideaUnits.items.length) {
    problems.push({
      field: "ideaUnits.count",
      detail: `count is ${spec.ideaUnits.count} but ${spec.ideaUnits.items.length} items were listed`,
    });
  }
  const expectedLinks = Math.ceil(spec.ideaUnits.count / perVideo);
  if (spec.chainProposal.of !== expectedLinks) {
    problems.push({
      field: "chainProposal.of",
      detail:
        `${spec.ideaUnits.count} idea units at ${perVideo} per video is ${expectedLinks} ` +
        `link(s), but the proposal says ${spec.chainProposal.of}`,
    });
  }
  if (spec.chainProposal.links.length !== spec.chainProposal.of) {
    problems.push({
      field: "chainProposal.links",
      detail: `${spec.chainProposal.links.length} links listed but of=${spec.chainProposal.of}`,
    });
  }

  // "sourceQuotes genuinely quote the upload" is an acceptance criterion, so it
  // is checked rather than trusted. Only possible when the source is text; a
  // photograph has no extractable text on our side, and the check is skipped
  // rather than faked.
  if (sourceText && sourceText.trim().length > 0) {
    const haystack = normalise(sourceText);
    for (const [index, quote] of spec.sourceQuotes.entries()) {
      if (!haystack.includes(normalise(quote))) {
        problems.push({
          field: `sourceQuotes[${index}]`,
          detail: `not found verbatim in the upload: ${JSON.stringify(quote.slice(0, 60))}`,
        });
      }
    }
  }

  return problems;
}

/**
 * Compare on letters and digits alone — whitespace removed, not collapsed.
 *
 * PDF text extraction loses word boundaries: the fixture's "A linear function"
 * comes back as "Alinear function", and "The slope" as "Theslope". Collapsing
 * runs of punctuation to a single space would therefore reject honest quotes,
 * which is the worse failure here — a false alarm on every quote teaches the
 * teacher to ignore the warning. Dropping separators entirely survives that,
 * and a quote of any real length is still far too specific to match by accident.
 */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}
