/**
 * The two provider-compatibility behaviours that were found by measurement, not
 * by reading a spec — so they are pinned here. Both were real 422s from a live
 * gateway, and both would fail silently as "the model is bad at schemas".
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { jsonFromProse, toolParameters } from "./structured";

describe("toolParameters", () => {
  const schema = z.object({
    klasse: z.number().int().min(7).max(10),
    items: z.array(z.string().min(1)).min(1),
    topic: z.string().describe("the topic"),
  });

  it("drops keywords providers reject", () => {
    // Measured: `422 "record_concept.parameters uses $schema"`, then
    // `422 "properties.klasse uses minimum"`.
    const json = JSON.stringify(toolParameters(schema));
    for (const keyword of ["$schema", "minimum", "maximum", "minItems", "minLength"]) {
      expect(json).not.toContain(keyword);
    }
  });

  it("keeps the shape and the descriptions the model needs", () => {
    const params = toolParameters(schema) as Record<string, never>;
    expect(params.type).toBe("object");
    expect(Object.keys(params.properties)).toEqual(["klasse", "items", "topic"]);
    expect(params.required).toEqual(["klasse", "items", "topic"]);
    expect(params.properties["topic"]!["description"]).toBe("the topic");
    expect(params.properties["items"]!["items"]!["type"]).toBe("string");
  });

  it("never mistakes a field named like a keyword for a keyword", () => {
    const params = toolParameters(
      z.object({ pattern: z.string(), format: z.string(), minimum: z.number() }),
    ) as Record<string, never>;
    expect(Object.keys(params.properties)).toEqual(["pattern", "format", "minimum"]);
  });
});

describe("jsonFromProse", () => {
  it("reads a fenced block", () => {
    const content = 'Here you go:\n```json\n{"topic":"slope"}\n```\nHope that helps.';
    expect(JSON.parse(jsonFromProse(content)!)).toEqual({ topic: "slope" });
  });

  it("reads a bare object with commentary around it", () => {
    expect(JSON.parse(jsonFromProse('Sure. {"a":1} Let me know.')!)).toEqual({ a: 1 });
  });

  it("stops at the matching brace, not the first one", () => {
    const content = '{"outer":{"inner":2}} trailing prose with a } in it';
    expect(JSON.parse(jsonFromProse(content)!)).toEqual({ outer: { inner: 2 } });
  });

  it("ignores braces inside strings", () => {
    const content = '{"note":"a } inside a string","ok":true}';
    expect(JSON.parse(jsonFromProse(content)!)).toEqual({ note: "a } inside a string", ok: true });
  });

  it("handles an escaped quote before a brace", () => {
    const content = '{"note":"he said \\"} \\" loudly","ok":true}';
    expect(JSON.parse(jsonFromProse(content)!)).toEqual({ note: 'he said "} " loudly', ok: true });
  });

  it("returns undefined when there is nothing to parse", () => {
    expect(jsonFromProse(undefined)).toBeUndefined();
    expect(jsonFromProse("I could not read the document.")).toBeUndefined();
    expect(jsonFromProse("{ unbalanced")).toBeUndefined();
  });
});
