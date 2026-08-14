/**
 * The presets are demo material, which is exactly why they are tested: a broken
 * one fails in front of an audience. Every check here is one the gate would
 * apply anyway — running them at build time means a rulebook edit that renames
 * a misconception breaks a test rather than a demo.
 */
import { describe, expect, it } from "vitest";
import { checkConcept } from "./concept";
import { TOPICS, findTopic } from "./topics";
import { loadRules } from "@/lib/rules/loader";

const config = loadRules("mathematics").config;

describe("built-in topics", () => {
  it("covers Klasse 7 to 10, one each", () => {
    // Numeric sort: the default is lexicographic, which orders these [10,7,8,9].
    expect(TOPICS.map((t) => t.klasse).sort((a, b) => a - b)).toEqual([7, 8, 9, 10]);
  });

  it("has unique ids and can look them up", () => {
    expect(new Set(TOPICS.map((t) => t.id)).size).toBe(TOPICS.length);
    for (const topic of TOPICS) expect(findTopic(topic.id)).toBe(topic);
    expect(findTopic("nope")).toBeUndefined();
  });

  it.each(TOPICS.map((t) => [t.id, t] as const))(
    "%s passes the same concept checks as an extracted lesson",
    (_id, topic) => {
      // Names a real §7 misconception (gate A10) and its chain is consistent.
      expect(checkConcept(topic.concept, config)).toEqual([]);
    },
  );

  it.each(TOPICS.map((t) => [t.id, t] as const))(
    "%s is a single video, not a chain",
    (_id, topic) => {
      expect(topic.concept.ideaUnits.count).toBe(config.limits.idea_units_per_video);
      expect(topic.concept.chainProposal.of).toBe(1);
    },
  );

  it.each(TOPICS.map((t) => [t.id, t] as const))("%s declares its own Klasse", (_id, topic) => {
    expect(topic.concept.klasse).toBe(topic.klasse);
  });
});
