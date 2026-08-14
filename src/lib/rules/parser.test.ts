/**
 * The rulebook is the contract, so these tests check two different things:
 * that the three real files parse, and that a file which has drifted fails
 * loudly rather than parsing into something subtly wrong.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveMisconceptionId,
  findMisconception,
  misconceptionRegister,
  parseSubjectConfig,
  RulesFileError,
} from "./parser";
import { BEAT_IDS, STAGES, SUBJECTS } from "./schema";
import { beatBands, bannedPhrases, loadAllRules, loadRules, rulesDir } from "./loader";

const rawFile = (subject: string) =>
  readFileSync(join(rulesDir(), `rules-${subject}.yaml`), "utf8");

/** Parse a mutated copy of a real file and return the thrown error message. */
function expectRejection(subject: string, mutate: (yaml: string) => string): string {
  const yaml = mutate(rawFile(subject));
  try {
    parseSubjectConfig(yaml, `mutated-${subject}.yaml`);
  } catch (error) {
    expect(error).toBeInstanceOf(RulesFileError);
    return (error as Error).message;
  }
  throw new Error("expected the mutated rules file to be rejected, but it parsed");
}

describe("the real rules files", () => {
  it.each(SUBJECTS)("parses %s into a validated config", (subject) => {
    const { config } = loadRules(subject);
    expect(config.subject).toBe(subject);
    expect(config.gate.fail_closed).toBe(true);
    expect(config.misconceptions.do_not_invent).toBe(true);
    expect(config.beats.sequence.map((b) => b.id)).toEqual([...BEAT_IDS]);
  });

  it("declares English narration for a German-speaking learner", () => {
    // plan.md §3.6: German-ready by design, English in this sprint.
    for (const { config } of Object.values(loadAllRules())) {
      expect(config.narration_language).toBe("en");
      expect(config.learner_l1).toBe("de");
    }
  });
});

describe("cross-subject invariants", () => {
  // plan.md §2 treats these as identical across all three subjects and builds one
  // code path on that. If a rules file ever diverges, this is where it surfaces.
  const all = Object.values(loadAllRules()).map((r) => r.config);
  const [reference] = all;

  it.each(STAGES)("gives every subject the same seven beat bands at %s", (stage) => {
    const expected = beatBands(reference, stage);
    for (const config of all) expect(beatBands(config, stage)).toEqual(expected);
  });

  it("gives every subject the same silence minimums", () => {
    for (const config of all) {
      expect(config.narration.silence_minimums_seconds).toEqual(
        reference.narration.silence_minimums_seconds,
      );
    }
  });

  it("gives every subject the same duration cap and idea-unit budget", () => {
    for (const config of all) {
      expect(config.limits.hard_cap_seconds).toBe(180);
      expect(config.limits.idea_units_per_video).toBe(1);
    }
  });

  it("reserves the same focus accent in every palette", () => {
    // plan.md §3.3: reachable only through cue(), so it must not vary by subject.
    for (const config of all) expect(config.visuals.palette.accent_focus).toBe("#F76707");
  });
});

describe("a drifted rules file fails loudly", () => {
  it("rejects a missing required key", () => {
    const message = expectRejection("mathematics", (yaml) =>
      // Drop the whole line, indentation included — a partial cut would break the
      // YAML instead of exercising the schema.
      yaml.replace(/^ *max_script_words: 300\n/m, ""),
    );
    expect(message).toContain("max_script_words");
  });

  it("rejects a beat spine in the wrong order", () => {
    // Swap `pretrain` and `anchor` by renaming their ids.
    const message = expectRejection("mathematics", (yaml) =>
      yaml.replace("    - id: anchor", "    - id: pretrain").replace(
        "    - id: pretrain\n      do: Name the symbols",
        "    - id: anchor\n      do: Name the symbols",
      ),
    );
    expect(message).toContain("beats.sequence must be exactly, in order");
  });

  it("rejects a gate that no longer fails closed", () => {
    const message = expectRejection("physics", (yaml) =>
      yaml.replace("  fail_closed: true", "  fail_closed: false"),
    );
    expect(message).toContain("fail_closed");
  });

  it("rejects a register that permits invented misconceptions", () => {
    const message = expectRejection("physics", (yaml) =>
      yaml.replace("  do_not_invent: true", "  do_not_invent: false"),
    );
    expect(message).toContain("do_not_invent");
  });

  it("rejects a palette colour that is not a hex triplet", () => {
    const message = expectRejection("mathematics", (yaml) =>
      yaml.replace('known_quantity: "#4C6EF5"', 'known_quantity: "cornflower"'),
    );
    expect(message).toContain("#RRGGBB");
  });

  it("rejects a palette with no reserved focus accent", () => {
    const message = expectRejection("chemistry", (yaml) =>
      yaml.replace('    accent_focus: "#F76707"', '    attention: "#F76707"'),
    );
    expect(message).toContain("accent_focus");
  });

  it("rejects beat bands that cannot sum into the stage target", () => {
    // Widen the resolve beat's sek1 band from 40-55 s to 90-95 s. Every band is
    // still individually valid, but the seven minima now sum to 178 s and cannot
    // come in under the 170 s ceiling.
    //
    // Note the asymmetry: the bands cannot be made infeasible from below. Even
    // shrinking resolve to nothing leaves the other six maxima summing to exactly
    // 130 s, which still just reaches the target floor.
    const message = expectRejection("mathematics", (yaml) =>
      yaml.replace(
        "seconds: { sek1: [40, 55], sek2: [55, 75] }",
        "seconds: { sek1: [90, 95], sek2: [55, 75] }",
      ),
    );
    expect(message).toContain("internally inconsistent");
  });

  it("rejects YAML that is not a mapping", () => {
    expect(() => parseSubjectConfig("- just\n- a list\n", "bad.yaml")).toThrow(
      /expected a YAML mapping/,
    );
  });

  it("names the file in the error", () => {
    const message = expectRejection("chemistry", (yaml) => yaml.replace("subject: chemistry", ""));
    expect(message).toContain("mutated-chemistry.yaml");
  });
});

describe("the misconception register", () => {
  it("derives an id for every entry and keeps them unique", () => {
    for (const { config, subject } of Object.values(loadAllRules())) {
      const register = misconceptionRegister(config);
      expect(register.length).toBe(config.misconceptions.register.length);
      const ids = register.map((m) => m.id);
      expect(new Set(ids).size, `${subject} has colliding ids`).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it("honours an explicit id over the derived one", () => {
    const { config } = loadRules("mathematics");
    const entry = findMisconception(config, "illusion_of_linearity");
    expect(entry).toBeDefined();
    expect(entry!.derived).toBe(false);
    expect(entry!.claim).toContain("Doubling a side doubles the area");
  });

  it("derives ids from claim text where none is given", () => {
    const { config } = loadRules("physics");
    const entry = findMisconception(config, "motion_requires_a_continuing_force");
    expect(entry).toBeDefined();
    expect(entry!.derived).toBe(true);
  });

  it("returns undefined for an invented id, which is what gate check A10 reports", () => {
    const { config } = loadRules("mathematics");
    expect(findMisconception(config, "students_dislike_fractions")).toBeUndefined();
  });

  it("rejects a register whose entries collide on a derived id", () => {
    const message = expectRejection("physics", (yaml) =>
      yaml.replace(
        "    - claim: Heavier objects fall faster",
        "    - claim: Motion requires a continuing force!",
      ),
    );
    expect(message).toContain("resolve to the same id");
  });

  it("slugifies punctuation and case out of a claim", () => {
    expect(deriveMisconceptionId("A graph's height is confused with its slope")).toBe(
      "a_graph_s_height_is_confused_with_its_slope",
    );
  });
});

describe("banned phrases", () => {
  it("flattens every category and keeps the category for reporting", () => {
    const { config } = loadRules("mathematics");
    const flat = bannedPhrases(config);
    expect(flat).toContainEqual({ phrase: "as you can see", category: "gatekeeping" });
    expect(flat).toContainEqual({ phrase: "wants to", category: "teleology" });
    expect(flat.length).toBeGreaterThan(15);
  });

  it("carries each subject's own additional category", () => {
    const byCategory = (subject: "physics" | "chemistry") =>
      new Set(bannedPhrases(loadRules(subject).config).map((p) => p.category));
    expect(byCategory("physics")).toContain("physics");
    expect(byCategory("chemistry")).toContain("chemistry");
  });
});
