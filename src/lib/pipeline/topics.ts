/**
 * Built-in topics — one per Klasse, mathematics.
 *
 * A lesson normally starts from a teacher's own upload, and that is the
 * differentiator. But extraction is the one non-deterministic stage in the
 * pipeline and the slowest, which makes it the wrong thing to depend on when
 * demonstrating everything downstream of it. These presets are hand-authored
 * `ConceptSpec`s: the same shape extraction produces, so the pipeline cannot
 * tell the difference, with none of the variance.
 *
 * Every `registerId` here is a real id from the mathematics §7 register, and
 * gate check A10 verifies that on every run — a preset naming an invented
 * misconception would be blocked exactly like a model-generated one. The ids
 * are asserted in `topics.test.ts` so a rulebook edit that renames a claim
 * fails a test rather than a demo.
 *
 * Each carries exactly one idea unit, so each is a single video rather than a
 * chain (rules §1).
 */
import type { ConceptSpec } from "./concept";

export type Topic = {
  id: string;
  klasse: 7 | 8 | 9 | 10;
  /** Shown in the picker. German, as a teacher would name it. */
  label: string;
  blurb: string;
  /** Which diagram in `docker/python/tafel/visuals.py` this lesson draws. */
  visual: "slope" | "pythagoras" | "parabola" | "percent";
  concept: ConceptSpec;
};

function spec(
  klasse: 7 | 8 | 9 | 10,
  topic: string,
  summary: string,
  ideaUnit: string,
  registerId: string,
  statement: string,
  keyTerms: { term: string; definition: string }[],
): ConceptSpec {
  return {
    subject: "mathematics",
    klasse,
    topic,
    summary,
    ideaUnits: { count: 1, items: [ideaUnit] },
    chainProposal: { of: 1, links: [{ title: topic, ideaUnit }] },
    prerequisites: [],
    keyTerms,
    candidateMisconceptions: [{ registerId, statement }],
    // No upload, so nothing to quote. The summary stands in as the source of
    // record; `checkConcept` only verifies quotes when there is a text source.
    sourceQuotes: [summary],
  };
}

export const TOPICS: Topic[] = [
  {
    id: "klasse7-prozent",
    visual: "percent",
    klasse: 7,
    label: "Prozentrechnung",
    blurb: "A percentage is a fraction of a whole, not a fixed amount.",
    concept: spec(
      7,
      "Percentages as a fraction of the whole",
      "A percentage always refers to some whole. The same percentage of two different wholes gives two different amounts.",
      "A percentage is a proportion of a whole, so its value depends on the whole it refers to.",
      "multiplication_always_makes_bigger_and_division_always_makes_smaller",
      "Learners expect taking a percentage to make a number smaller and adding one to make it bigger, regardless of the whole.",
      [
        { term: "Prozent", definition: "parts per hundred of a whole" },
        { term: "Grundwert", definition: "the whole the percentage refers to" },
      ],
    ),
  },
  {
    id: "klasse8-steigung",
    visual: "slope",
    klasse: 8,
    label: "Lineare Funktionen",
    blurb: "Slope is rise over run — steepness, not height.",
    concept: spec(
      8,
      "Slope of a straight line",
      "In y = mx + b the number m is the slope: how much y changes for each step in x. It measures steepness, not how high the line sits.",
      "The slope m is the ratio of rise to run, and is constant everywhere along a straight line.",
      "a_graph_s_height_is_confused_with_its_slope",
      "Learners read a line that sits higher on the axes as having a larger slope, confusing position with steepness.",
      [
        { term: "Steigung", definition: "rise divided by run, the constant m" },
        { term: "y-Achsenabschnitt", definition: "the value of y where the line crosses x = 0" },
      ],
    ),
  },
  {
    id: "klasse9-pythagoras",
    visual: "pythagoras",
    klasse: 9,
    label: "Satz des Pythagoras",
    blurb: "Areas of squares add — lengths do not.",
    concept: spec(
      9,
      "The Pythagorean theorem as areas",
      "In a right triangle the squares on the two shorter sides have areas that add to the area of the square on the hypotenuse.",
      "a² + b² = c² is a statement about areas of squares, not about adding the side lengths themselves.",
      "illusion_of_linearity",
      "Learners add the two shorter sides directly to get the hypotenuse, treating a relation between areas as one between lengths.",
      [
        { term: "Hypotenuse", definition: "the side opposite the right angle, always the longest" },
        { term: "Kathete", definition: "either of the two sides forming the right angle" },
      ],
    ),
  },
  {
    id: "klasse10-parabel",
    visual: "parabola",
    klasse: 10,
    label: "Quadratische Funktionen",
    blurb: "The parameter a stretches the parabola; it does not move it.",
    concept: spec(
      10,
      "The parameter a in y = ax²",
      "In y = ax² the number a controls how narrow or wide the parabola is, and which way it opens. It does not shift the curve up or down.",
      "The parameter a scales a parabola vertically; its sign decides the opening direction.",
      "a_variable_is_one_specific_unknown_number_not_a_varying_quantity",
      "Learners treat a as a fixed unknown to solve for, rather than a parameter whose variation changes the whole family of curves.",
      [
        { term: "Parabel", definition: "the graph of a quadratic function" },
        { term: "Scheitelpunkt", definition: "the turning point of the parabola" },
      ],
    ),
  },
];

export const findTopic = (id: string): Topic | undefined => TOPICS.find((t) => t.id === id);
