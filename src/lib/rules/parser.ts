/**
 * YAML text → a validated `SubjectConfig`, plus the one normalisation the raw
 * files need: stable ids for the misconception register.
 */
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { subjectConfigSchema, type SubjectConfig } from "./schema";

/**
 * Thrown when a rules file cannot be honoured. Carries the source label and the
 * prettified validation report, because "the rulebook drifted" is a message for a
 * human to act on, not a stack trace to swallow.
 */
export class RulesFileError extends Error {
  constructor(
    readonly source: string,
    detail: string,
  ) {
    super(`Rules file ${source} is not usable:\n${detail}`);
    this.name = "RulesFileError";
  }
}

/** Longest derived id. Long enough to stay unambiguous, short enough for a model to copy. */
const MAX_DERIVED_ID_LENGTH = 72;

/**
 * Derive a register id from a misconception's claim text.
 *
 * Gate check A10 requires a storyboard to name a misconception by id and requires
 * that id to exist in the subject's register — but only one register entry across
 * the three rules files carries an explicit `id` today. Rather than edit the
 * teaching-owned files, ids are derived from the claim, and an explicit `id` always
 * wins where one is present.
 *
 * The trade-off, stated plainly: **rewording a claim changes its id.** A lesson
 * that referenced the old id then fails A10 by name instead of silently pointing at
 * a misconception that no longer exists, which is the failure direction we want.
 */
export function deriveMisconceptionId(claim: string): string {
  const slug = claim
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_DERIVED_ID_LENGTH)
    .replace(/_+$/, "");
  if (!slug) throw new Error(`Claim yields no usable id: ${JSON.stringify(claim)}`);
  return slug;
}

/** One register entry with its id resolved. */
export type RegisteredMisconception = {
  id: string;
  claim: string;
  domain: string[];
  priority?: string;
  /** True when the id came from the claim text rather than an explicit `id:` field. */
  derived: boolean;
};

/**
 * The subject's misconception register with every id resolved, in file order.
 * This is the only permitted source of `candidateMisconceptions` during extraction
 * and the set A10 checks against.
 */
export function misconceptionRegister(config: SubjectConfig): RegisteredMisconception[] {
  return config.misconceptions.register.map((entry) => ({
    id: entry.id ?? deriveMisconceptionId(entry.claim),
    claim: entry.claim,
    domain: entry.domain,
    ...(entry.priority === undefined ? {} : { priority: entry.priority }),
    derived: entry.id === undefined,
  }));
}

/** Look up a register entry by id. Returns undefined for an invented id — which is what A10 reports. */
export function findMisconception(
  config: SubjectConfig,
  id: string,
): RegisteredMisconception | undefined {
  return misconceptionRegister(config).find((m) => m.id === id);
}

/**
 * Parse and validate one rules file.
 *
 * `source` is only used in error messages — pass the path so a failure names the
 * file a human has to open.
 */
export function parseSubjectConfig(yamlText: string, source: string): SubjectConfig {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (cause) {
    throw new RulesFileError(source, `YAML did not parse: ${(cause as Error).message}`);
  }

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new RulesFileError(source, "expected a YAML mapping at the top level");
  }

  const result = subjectConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new RulesFileError(source, z.prettifyError(result.error));
  }
  const config = result.data;

  // Ids must be unique, or A10 cannot tell which misconception was named. Truncation
  // in `deriveMisconceptionId` makes this a real possibility rather than a formality.
  const seen = new Map<string, string>();
  for (const entry of misconceptionRegister(config)) {
    const previous = seen.get(entry.id);
    if (previous !== undefined) {
      throw new RulesFileError(
        source,
        `two misconceptions resolve to the same id ${JSON.stringify(entry.id)}:\n` +
          `  - ${previous}\n  - ${entry.claim}\n` +
          "Give one of them an explicit, distinct `id:` in the rules file.",
      );
    }
    seen.set(entry.id, entry.claim);
  }

  return config;
}
