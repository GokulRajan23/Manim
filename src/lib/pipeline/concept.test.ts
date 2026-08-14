/**
 * `checkConcept` is where two of Step 3's acceptance criteria actually live:
 * misconception ids must resolve against the §7 register, and sourceQuotes must
 * genuinely quote the upload. Both are checked against the real mathematics
 * rulebook rather than a stub, because the register's contents are the point.
 */
import { describe, expect, it } from "vitest";
import { checkConcept, type ConceptSpec } from "./concept";
import { loadRules } from "@/lib/rules/loader";
import { misconceptionRegister } from "@/lib/rules/parser";

const config = loadRules("mathematics").config;
const realId = misconceptionRegister(config)[0]!.id;

/** A spec that passes everything, so each test can break exactly one thing. */
function spec(overrides: Partial<ConceptSpec> = {}): ConceptSpec {
  return {
    subject: "mathematics",
    klasse: 8,
    topic: "Slope of a line",
    summary: "How steep a line is, and how to compute it.",
    ideaUnits: { count: 1, items: ["The slope is rise over run."] },
    chainProposal: { of: 1, links: [{ title: "Slope", ideaUnit: "Slope is rise over run." }] },
    prerequisites: [],
    keyTerms: [{ term: "slope", definition: "rise divided by run" }],
    candidateMisconceptions: [{ registerId: realId, statement: "Confuses steepness with height." }],
    sourceQuotes: ["The slope is the rise divided by the run."],
    ...overrides,
  };
}

describe("misconception ids", () => {
  it("accepts an id that is in the register", () => {
    expect(checkConcept(spec(), config)).toEqual([]);
  });

  it("rejects an invented id and names the field", () => {
    const problems = checkConcept(
      spec({
        candidateMisconceptions: [
          { registerId: "students_dislike_fractions", statement: "Invented." },
        ],
      }),
      config,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]!.field).toBe("candidateMisconceptions[0].registerId");
    expect(problems[0]!.detail).toContain("do_not_invent");
  });
});

describe("idea units and the chain", () => {
  it("rejects a count that disagrees with the listed items", () => {
    const problems = checkConcept(spec({ ideaUnits: { count: 3, items: ["only one"] } }), config);
    expect(problems.map((p) => p.field)).toContain("ideaUnits.count");
  });

  it("requires a multi-idea document to become a chain, not one video", () => {
    // The acceptance criterion: three idea units is a three-link chain. Claiming
    // one video for three ideas is the failure this catches.
    const problems = checkConcept(
      spec({
        ideaUnits: { count: 3, items: ["a", "b", "c"] },
        chainProposal: { of: 1, links: [{ title: "All of it", ideaUnit: "a" }] },
      }),
      config,
    );
    const fields = problems.map((p) => p.field);
    expect(fields).toContain("chainProposal.of");
    expect(problems.find((p) => p.field === "chainProposal.of")!.detail).toContain("3 link(s)");
  });

  it("accepts a correctly proposed three-link chain", () => {
    const problems = checkConcept(
      spec({
        ideaUnits: { count: 3, items: ["a", "b", "c"] },
        chainProposal: {
          of: 3,
          links: [
            { title: "A", ideaUnit: "a" },
            { title: "B", ideaUnit: "b" },
            { title: "C", ideaUnit: "c" },
          ],
        },
      }),
      config,
    );
    expect(problems).toEqual([]);
  });
});

describe("source quotes", () => {
  const source = "The slope is the rise divided by the run. A steeper line has a larger slope.";

  it("accepts a verbatim quote", () => {
    expect(checkConcept(spec(), config, source)).toEqual([]);
  });

  it("accepts a quote whose spacing the PDF text layer mangled", () => {
    // Real behaviour: ghostscript returns "Theslope" and "Alinear" for the
    // fixture. Comparing on letters alone is what keeps honest quotes passing.
    const mangled = "Theslope is therise divided by therun.";
    expect(checkConcept(spec(), config, mangled)).toEqual([]);
  });

  it("rejects a paraphrase presented as a quote", () => {
    const problems = checkConcept(
      spec({ sourceQuotes: ["Slope measures how steeply a line ascends."] }),
      config,
      source,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]!.field).toBe("sourceQuotes[0]");
  });

  it("skips the check when there is no extractable text, rather than failing every quote", () => {
    // A photograph has no text layer on our side. Silence is correct here;
    // reporting every quote as unverified would train the teacher to ignore it.
    expect(checkConcept(spec(), config, undefined)).toEqual([]);
    expect(checkConcept(spec(), config, "   ")).toEqual([]);
  });
});
