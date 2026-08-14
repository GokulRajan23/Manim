/**
 * Palette compliance for the three rule palettes — plan.md §3.2 and §3.3.
 *
 * Run once per commit rather than per render, because the palettes are fixed: the
 * rules files own them, so checking them here is both cheaper and stricter than
 * sampling rendered frames.
 *
 * ## Why this file asserts baselines instead of purity
 *
 * plan.md §5.4 asks for a colourblind test "asserting pairwise distinguishability".
 * Measured, that is not satisfiable with this rulebook: 3 pairs collide in
 * mathematics, 4 in physics and 16 in chemistry under deuteranopia. Those are not
 * defects to be fixed by nudging hex values — several are load-bearing conventions
 * (red/green for counterexample/result, CPK green for chlorine) that a teacher
 * would recognise and that changing would make the videos *less* conventional.
 *
 * What makes that tolerable is a rule the files state themselves:
 * `colour_encodes_meaning_alone: false`. Colour is never the only channel carrying
 * a meaning, so two colours colliding under simulation is a requirement for
 * redundant encoding — not a licence to ship an ambiguous frame.
 *
 * So the assertions here are:
 *   1. Contrast against the frame ground — a hard pass, no exemptions.
 *   2. Identical colours within a palette — declared exactly.
 *   3. Simulated collisions — declared exactly, in both directions. A palette edit
 *      that introduces a new collision fails, and one that removes a known collision
 *      also fails, so the exemption list can never quietly drift out of date.
 */
import { describe, expect, it } from "vitest";
import { loadAllRules, framePalette } from "@/lib/rules/loader";
import { COLOUR_VISION_DEFICIENCIES, SUBJECTS, type Subject } from "@/lib/rules/schema";
import { contrastRatio, deltaEUnder, type ColourVisionDeficiency } from "./color";
import { CONTRAST, FRAME_GROUND } from "./tokens";

/**
 * CIE76 ΔE below which two colours are treated as confusable across a classroom.
 * The just-noticeable difference is ~2.3; 25 is the coarser "a learner glancing at
 * the board will not mistake these" bar, and is the threshold the baselines below
 * were measured at.
 */
const DISTINGUISHABLE = 25;

/**
 * Colours measured below 4.5:1 on the frame ground. Legal for shapes and strokes,
 * never for labels or equations — enforced downstream in the codegen contract
 * (plan.md §4.8), declared here so the set cannot grow unnoticed.
 */
const GRAPHICS_ONLY: Record<Subject, string[]> = {
  mathematics: [],
  physics: ["field"], // #7048E8 at 3.67:1
  chemistry: ["N"], // #3050F8 at 3.52:1
};

/**
 * Roles sharing a byte-identical colour. Both are chemistry's, and both are the
 * collision between a semantic role and a CPK element colour: a chlorine atom is
 * drawn the same green as "bond forming", an oxygen atom the same red as "bond
 * breaking". Standard convention on each side, in direct conflict when combined.
 */
const IDENTICAL: Record<Subject, [string, string][]> = {
  mathematics: [],
  physics: [],
  chemistry: [
    ["bond_forming", "Cl"], // both #2F9E44
    ["bond_breaking", "O"], // both #E03131
  ],
};

/** Pairs measured below the threshold once the deficiency is simulated. */
const SIMULATED_COLLISIONS: Record<
  Subject,
  Record<ColourVisionDeficiency, [string, string][]>
> = {
  mathematics: {
    deuteranopia: [
      ["unknown_quantity", "accent_focus"], // ΔE 11.7
      ["result", "counterexample"], // ΔE 15.1 — the classic red/green pair
      ["counterexample", "accent_focus"], // ΔE 22.8
    ],
    protanopia: [
      ["unknown_quantity", "accent_focus"], // ΔE 19.1
      ["result", "accent_focus"], // ΔE 13.8
    ],
  },
  physics: {
    deuteranopia: [
      ["force", "energy"], // ΔE 15.1
      ["force", "accent_focus"], // ΔE 22.8
      ["velocity", "field"], // ΔE 6.1 — blue and purple collapse together
      ["acceleration", "accent_focus"], // ΔE 11.7
    ],
    protanopia: [
      ["velocity", "field"], // ΔE 11.9
      ["acceleration", "accent_focus"], // ΔE 19.1
      ["energy", "accent_focus"], // ΔE 13.8
    ],
  },
  chemistry: {
    deuteranopia: [
      ["bond_forming", "bond_breaking"], // ΔE 15.1
      ["bond_forming", "O"], // ΔE 15.1
      ["bond_forming", "Cl"], // ΔE 0.0 — identical
      ["bond_breaking", "accent_focus"], // ΔE 22.8
      ["bond_breaking", "O"], // ΔE 0.0 — identical
      ["bond_breaking", "Cl"], // ΔE 15.1
      ["bond_breaking", "Fe"], // ΔE 17.4
      ["energy_flow", "accent_focus"], // ΔE 11.7
      ["energy_flow", "S"], // ΔE 9.7
      ["energy_flow", "Fe"], // ΔE 17.0
      ["accent_focus", "O"], // ΔE 22.8
      ["accent_focus", "S"], // ΔE 21.3
      ["accent_focus", "Fe"], // ΔE 5.5
      ["H", "C"], // ΔE 13.3 — white against light grey, unaffected by deficiency
      ["O", "Cl"], // ΔE 15.1
      ["O", "Fe"], // ΔE 17.4
    ],
    protanopia: [
      ["bond_forming", "accent_focus"], // ΔE 13.8
      ["bond_forming", "Cl"], // ΔE 0.0 — identical
      ["bond_forming", "Fe"], // ΔE 13.9
      ["bond_breaking", "O"], // ΔE 0.0 — identical
      ["energy_flow", "accent_focus"], // ΔE 19.1
      ["energy_flow", "S"], // ΔE 14.9
      ["energy_flow", "Fe"], // ΔE 18.6
      ["accent_focus", "Cl"], // ΔE 13.8
      ["accent_focus", "Fe"], // ΔE 0.5 — indistinguishable
      ["H", "C"], // ΔE 13.3
      ["N", "Na"], // ΔE 17.6
      ["Cl", "Fe"], // ΔE 13.9
    ],
  },
};

const rules = loadAllRules();
const paletteOf = (subject: Subject) => framePalette(rules[subject].config);

/** Order-insensitive, so a declared pair need not match the palette's key order. */
const asKey = (pair: [string, string]) => [...pair].sort().join(" / ");
const asKeys = (pairs: [string, string][]) => new Set(pairs.map(asKey)).size === pairs.length
  ? pairs.map(asKey).sort()
  : (() => { throw new Error(`duplicate pair declared: ${pairs.map(asKey).join(", ")}`); })();

function pairsBelow(subject: Subject, deficiency: ColourVisionDeficiency): [string, string][] {
  const entries = Object.entries(paletteOf(subject));
  const found: [string, string][] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (deltaEUnder(entries[i][1], entries[j][1], deficiency) < DISTINGUISHABLE) {
        found.push([entries[i][0], entries[j][0]]);
      }
    }
  }
  return found;
}

describe("contrast against the frame ground", () => {
  it.each(SUBJECTS)("%s: every colour is at least usable for graphics", (subject) => {
    for (const [role, hex] of Object.entries(paletteOf(subject))) {
      const ratio = contrastRatio(hex, FRAME_GROUND);
      expect(ratio, `${subject}.${role} (${hex}) on ${FRAME_GROUND}`).toBeGreaterThanOrEqual(
        CONTRAST.GRAPHIC,
      );
    }
  });

  it.each(SUBJECTS)("%s: exactly the declared colours are graphics-only", (subject) => {
    const measured = Object.entries(paletteOf(subject))
      .filter(([, hex]) => contrastRatio(hex, FRAME_GROUND) < CONTRAST.TEXT)
      .map(([role]) => role);
    expect(measured.sort()).toEqual([...GRAPHICS_ONLY[subject]].sort());
  });

  it("carbon clears text contrast after the v1.1 amendment", () => {
    // Unamended CPK carbon #2B2B2B measures 1.44:1 here — invisible. See the
    // amendment commit on guidelines/rules-chemistry.yaml.
    const carbon = paletteOf("chemistry").C;
    expect(carbon).toBe("#D9D9D9");
    expect(contrastRatio(carbon, FRAME_GROUND)).toBeGreaterThan(14);
  });

  it("the frame ground is the brand's darkest value", () => {
    expect(FRAME_GROUND).toBe("#050315");
  });
});

describe("colour reuse within a palette", () => {
  it.each(SUBJECTS)("%s: exactly the declared roles share a colour", (subject) => {
    const entries = Object.entries(paletteOf(subject));
    const found: [string, string][] = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (entries[i][1].toUpperCase() === entries[j][1].toUpperCase()) {
          found.push([entries[i][0], entries[j][0]]);
        }
      }
    }
    expect(asKeys(found)).toEqual(asKeys(IDENTICAL[subject]));
  });
});

describe("colourblind simulation", () => {
  it.each(SUBJECTS)("%s: checks the deficiencies its rules file asks for", (subject) => {
    expect(rules[subject].config.visuals.colourblind_check.sort()).toEqual(
      [...COLOUR_VISION_DEFICIENCIES].sort(),
    );
  });

  for (const subject of SUBJECTS) {
    for (const deficiency of COLOUR_VISION_DEFICIENCIES) {
      it(`${subject}: ${deficiency} collisions match the declared baseline exactly`, () => {
        expect(asKeys(pairsBelow(subject, deficiency))).toEqual(
          asKeys(SIMULATED_COLLISIONS[subject][deficiency]),
        );
      });
    }
  }

  it("every subject relies on more than colour to carry meaning", () => {
    // This is the rule that makes the baselines above acceptable rather than a shrug.
    for (const subject of SUBJECTS) {
      expect(rules[subject].config.visuals.colour_encodes_meaning_alone).toBe(false);
    }
  });

  it("the focus accent is confusable in every subject, so cue() cannot use colour alone", () => {
    // plan.md §3.3 makes the focus accent the single most semantically loaded colour
    // in the system — the only route to "look here now", reserved so that using it
    // decoratively destroys it. Measured, it collides with a role colour in all three
    // palettes under at least one deficiency, worst of all against chemistry's iron
    // at ΔE 0.5. A cue that signalled by colour alone would therefore be invisible to
    // a dichromat learner, which is why cue() must add a non-colour channel. The
    // rules files already permit one: `visuals.cue_preference` is [colour, highlight,
    // arrow].
    for (const subject of SUBJECTS) {
      const collidesWithFocus = COLOUR_VISION_DEFICIENCIES.some((deficiency) =>
        SIMULATED_COLLISIONS[subject][deficiency].some((pair) => pair.includes("accent_focus")),
      );
      expect(collidesWithFocus, `${subject} focus accent`).toBe(true);
      expect(rules[subject].config.visuals.cue_preference).toContain("highlight");
    }
  });
});
