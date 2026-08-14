/**
 * Reads the rulebook off disk and hands the rest of the app two things: the
 * validated config that drives code, and the raw YAML text that goes into prompts.
 *
 * Both matter. plan.md §4.5 splits the rulebook as "prose to the model, YAML to
 * code", assuming each rules file carried authoritative prose above a YAML
 * appendix. The files as delivered are YAML only — but they carry the didactic
 * content inside it (`beats.sequence[].do`, `narration.rules`, `visuals.rules`,
 * `method.*`), so the prompt receives the whole file verbatim instead of a prose
 * section. The split is therefore by *audience*, not by file region: code reads
 * the typed config, the model reads the text.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseSubjectConfig } from "./parser";
import {
  BEAT_IDS,
  SUBJECTS,
  type Band,
  type BeatId,
  type BeatSpec,
  type Stage,
  type StageLimits,
  type Subject,
  type SubjectConfig,
} from "./schema";

/**
 * Where the rulebook lives. Overridable so tests can point at fixtures.
 *
 * The ignore comment stops Turbopack tracing the entire project into the server
 * bundle: it cannot statically know where `RULES_DIR` points, so it conservatively
 * assumes anything. The path is deliberately configurable, and this app runs from
 * its own project root, so the conservative trace buys nothing.
 */
export function rulesDir(): string {
  return resolve(/* turbopackIgnore: true */ process.env.RULES_DIR ?? "guidelines");
}

export type LoadedRules = {
  subject: Subject;
  config: SubjectConfig;
  /** The file verbatim. Injected whole into the extraction and storyboard prompts. */
  yaml: string;
  path: string;
};

const cache = new Map<string, LoadedRules>();

/** Drop the cache. Tests that swap `RULES_DIR` need this; nothing else should. */
export function clearRulesCache(): void {
  cache.clear();
}

/**
 * Load and validate one subject's rules. Throws `RulesFileError` on drift — the
 * pipeline has no meaningful degraded mode without a rulebook it can trust.
 */
export function loadRules(subject: Subject): LoadedRules {
  const path = join(rulesDir(), `rules-${subject}.yaml`);
  const cached = cache.get(path);
  if (cached) return cached;

  const yaml = readFileSync(path, "utf8");
  const config = parseSubjectConfig(yaml, path);

  if (config.subject !== subject) {
    throw new Error(
      `${path} declares subject "${config.subject}" but is named for "${subject}".`,
    );
  }

  const loaded: LoadedRules = { subject, config, yaml, path };
  cache.set(path, loaded);
  return loaded;
}

/** Load all three. Used by `doctor` and by the tests that assert cross-subject invariants. */
export function loadAllRules(): Record<Subject, LoadedRules> {
  return Object.fromEntries(SUBJECTS.map((s) => [s, loadRules(s)])) as Record<
    Subject,
    LoadedRules
  >;
}

// --- Derived reads -----------------------------------------------------------
// Small accessors so the rest of the app never has to know how the YAML nests.

export function stageLimits(config: SubjectConfig, stage: Stage): StageLimits {
  return config.limits.stages[stage];
}

export function beatSpec(config: SubjectConfig, beat: BeatId): BeatSpec {
  const found = config.beats.sequence.find((b) => b.id === beat);
  // Unreachable: the schema pins `sequence` to exactly BEAT_IDS in order.
  if (!found) throw new Error(`No such beat in the spine: ${beat}`);
  return found;
}

/** The `[min, max]` seconds band for one beat at one stage. */
export function beatBand(config: SubjectConfig, beat: BeatId, stage: Stage): Band {
  return beatSpec(config, beat).seconds[stage];
}

/** Every beat's band, in spine order — what the storyboard prompt and gate A3 need. */
export function beatBands(config: SubjectConfig, stage: Stage): Record<BeatId, Band> {
  return Object.fromEntries(
    BEAT_IDS.map((id) => [id, beatBand(config, id, stage)]),
  ) as Record<BeatId, Band>;
}

/**
 * Every banned narration phrase, flattened across the subject's categories.
 * Gate check A9 works on this list; the category names are kept for reporting
 * which kind of violation it was.
 */
export function bannedPhrases(config: SubjectConfig): { phrase: string; category: string }[] {
  return Object.entries(config.narration.banned_phrases).flatMap(([category, phrases]) =>
    phrases.map((phrase) => ({ phrase, category })),
  );
}

/**
 * The subject's frame palette: semantic roles, plus chemistry's fixed element
 * colours. `palette.py` is generated from exactly this.
 */
export function framePalette(config: SubjectConfig): Record<string, string> {
  return { ...config.visuals.palette, ...(config.visuals.element_colours ?? {}) };
}
