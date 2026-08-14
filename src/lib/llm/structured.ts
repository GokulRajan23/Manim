/**
 * Structured model output, via tool use (plan.md §4.7, Step 3).
 *
 * The pipeline never parses prose. Every stage that needs a typed result declares
 * a Zod schema, that schema becomes the parameter schema of a single tool, and
 * the model is forced to call it. Validation happens against the same Zod object
 * the rest of the code consumes, so a model that drifts from the contract fails
 * here — loudly, with the field named — rather than three stages downstream where
 * the symptom is an undefined property in a Manim scene.
 *
 * `tool_choice: "required"` does the forcing. Every free model measured on this
 * gateway honours it; a model that does not is treated as a failed attempt.
 */
import type OpenAI from "openai";
import { z } from "zod";
import { llm, MODEL, providerName } from "./client";

/** A part of a user message: text, an image, or a document. */
export type Part =
  | { kind: "text"; text: string }
  | { kind: "image"; mediaType: string; base64: string }
  | { kind: "pdf"; filename: string; base64: string };

export type StructuredOptions = {
  /** Defaults to the planner model — this is judgement work. */
  model?: string;
  system?: string;
  /** How many times to re-ask when the model returns something invalid. */
  attempts?: number;
  /** Lower for extraction: this is reading, not writing. */
  temperature?: number;
};

/**
 * A PDF is parsed gateway-side, so no PDF library or OCR service is needed here
 * (§4.7 assumed this of the Anthropic API; it holds on both gateways, by
 * different mechanisms). The `{type:"file"}` content part is identical across
 * them — only the opt-in differs:
 *
 *   openrouter      requires the `file-parser` plugin. `pdf-text` is the free
 *                   text-extraction engine; it does not OCR a scanned page,
 *                   which is why a photograph goes as an image, not as a PDF.
 *   deutschlandgpt  handles `{type:"file"}` directly — their own examples pass
 *                   `file_data` with no plugin field at all.
 *
 * Sending the plugin to a gateway that does not know it is not worth the risk of
 * a rejected request, so it is opt-in per provider rather than always-on.
 */
const PDF_PLUGIN = [{ id: "file-parser", pdf: { engine: "pdf-text" } }];

function toContent(parts: Part[]): unknown[] {
  return parts.map((part) => {
    switch (part.kind) {
      case "text":
        return { type: "text", text: part.text };
      case "image":
        return {
          type: "image_url",
          image_url: { url: `data:${part.mediaType};base64,${part.base64}` },
        };
      case "pdf":
        return {
          type: "file",
          file: {
            filename: part.filename,
            file_data: `data:application/pdf;base64,${part.base64}`,
          },
        };
    }
  });
}

/**
 * JSON Schema keywords that providers behind this gateway reject outright.
 *
 * Measured against `google/gemma-4-26b-a4b-it:free`, which 422s one keyword at a
 * time: first `parameters uses $schema`, then `properties.klasse uses minimum`.
 * The accepted subset is roughly types, properties, required, enum, items and
 * descriptions — the shape of the data, not its constraints.
 */
const UNSUPPORTED_KEYWORDS = new Set([
  "$schema",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
]);

/**
 * Convert a Zod schema into tool parameters a provider will accept.
 *
 * Constraints are stripped, not honoured — which is safe here precisely because
 * the tool schema is a *hint* and Zod is the contract. Every response is parsed
 * against the original schema with its bounds intact, and a violation comes back
 * to the model as a named retry. Sending the bounds would buy a slightly better
 * first guess at the cost of the request failing outright on these providers.
 */
export function toolParameters(schema: z.ZodType): Record<string, unknown> {
  return strip(z.toJSONSchema(schema, { target: "draft-7" })) as Record<string, unknown>;
}

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node === null || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    // `properties` holds field names, which must never be treated as keywords —
    // a field legitimately called "pattern" or "format" would vanish otherwise.
    out[key] = key === "properties" ? mapValues(value, strip) : strip(value);
  }
  return out;
}

function mapValues(node: unknown, fn: (value: unknown) => unknown): unknown {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return node;
  return Object.fromEntries(
    Object.entries(node as Record<string, unknown>).map(([key, value]) => [key, fn(value)]),
  );
}

/**
 * Recover a JSON object from a model's prose reply.
 *
 * Handles the two shapes that actually occur: a ```json fenced block, and a bare
 * object with commentary around it. Brace matching rather than a greedy regex,
 * so trailing prose after the object does not swallow the parse — string
 * literals are tracked because a `}` inside a quoted value must not close it.
 */
export function jsonFromProse(content: string | undefined): string | undefined {
  return jsonCandidates(content)[0];
}

/**
 * Every top-level JSON object in a reply, in order.
 *
 * Not just the first: a model that narrates before answering ("I'll record
 * `{"topic": ...}` — here is the full record: {…}") puts a *fragment* first, and
 * taking it yielded exactly the failure this was written for — every required
 * field reported missing while the real answer sat further down the reply. The
 * caller validates each in turn and keeps the one that fits the schema.
 */
export function jsonCandidates(content: string | undefined): string[] {
  if (!content) return [];

  // Fenced blocks first — when a model fences its answer, that is the answer.
  const fenced = [...content.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]!);
  const found: string[] = [];

  for (const haystack of [...fenced, content]) {
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < haystack.length; i++) {
      const char = haystack[i]!;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\" && inString) escaped = true;
      else if (char === '"') inString = !inString;
      else if (!inString && char === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (!inString && char === "}" && depth > 0 && --depth === 0 && start >= 0) {
        found.push(haystack.slice(start, i + 1));
      }
    }
    if (found.length > 0) break; // A fenced block won; do not also scan the prose.
  }

  // Largest first: the complete record is longer than any fragment quoted above it.
  return found.sort((a, b) => b.length - a.length);
}

/** Does this error mean "I will not let you force a tool call", rather than something real? */
function isToolChoiceUnsupported(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${JSON.stringify(error)}` : String(error);
  return /tool_choice/i.test(text) && /not supported|unsupported/i.test(text);
}

export class StructuredError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly lastRaw?: string,
  ) {
    super(message);
    this.name = "StructuredError";
  }
}

/**
 * Ask the model for one object matching `schema`.
 *
 * Retries are not a formality: a model that returns malformed JSON or misses a
 * required field is told exactly what was wrong and asked again, which recovers
 * far more often than it fails. The error carries the last raw payload so a
 * failure is debuggable without re-running the call.
 */
export async function structured<T extends z.ZodType>(
  schema: T,
  toolName: string,
  toolDescription: string,
  parts: Part[],
  options: StructuredOptions = {},
): Promise<z.infer<T>> {
  const { model = MODEL.planner, system, attempts = 3, temperature = 0.2 } = options;

  // Zod is the single definition. The tool schema is derived from it rather than
  // written alongside it, so the two cannot drift.
  const parameters = toolParameters(schema);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    ...(system ? [{ role: "system" as const, content: system }] : []),
    { role: "user" as const, content: toContent(parts) as never },
  ];

  const needsPdfPlugin = parts.some((p) => p.kind === "pdf") && providerName() === "openrouter";
  let lastRaw: string | undefined;
  let lastProblem = "";

  // Forcing the call is always preferable. One provider refuses it for image
  // requests — `400 "inference-enforced tool_choice is not supported for
  // multimodal requests"` — but the Claude models behind DeutschlandGPT accept
  // it happily, so this is discovered rather than assumed: force until refused,
  // then fall back to offering the tool for the rest of this call.
  let force = true;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response: OpenAI.Chat.ChatCompletion;
    try {
      response = await llm().chat.completions.create({
        model,
        temperature,
        messages,
        tools: [
          {
            type: "function",
            function: { name: toolName, description: toolDescription, parameters },
          },
        ],
        tool_choice: force ? "required" : "auto",
        ...(needsPdfPlugin ? ({ plugins: PDF_PLUGIN } as never) : {}),
      });
    } catch (error) {
      if (force && isToolChoiceUnsupported(error)) {
        force = false;
        attempt--; // The request never reached the model; this does not count.
        continue;
      }
      throw error;
    }

    // `choices` is absent when the gateway answers with an error-shaped body,
    // which it does with a 200 often enough to be worth handling as data.
    const message = response.choices?.[0]?.message;
    const call = message?.tool_calls?.[0];

    // Prefer the tool call, but accept JSON written into the reply. With images
    // the call cannot be forced (see above), and models routinely answer a
    // schema request with a fenced JSON block instead — the data is right there,
    // and rejecting it over delivery mechanism would fail the photo path for no
    // reason. Zod validates both identically, so nothing is trusted either way.
    const candidates =
      call && "function" in call
        ? [call.function.arguments]
        : jsonCandidates(message?.content ?? undefined);

    // Try each candidate against the real schema and keep the first that fits.
    let matched: z.infer<T> | undefined;
    for (const candidate of candidates) {
      try {
        const result = schema.safeParse(JSON.parse(candidate));
        if (result.success) {
          matched = result.data;
          break;
        }
      } catch {
        // Not JSON after all; the next candidate may be.
      }
    }
    if (matched !== undefined) return matched;

    const raw = candidates[0];

    if (!raw) {
      lastProblem = response.choices
        ? `the model replied without calling ${toolName} and without usable JSON` +
          (message?.content ? `: ${String(message.content).slice(0, 200)}` : "")
        : `the gateway returned no choices: ${JSON.stringify(response).slice(0, 200)}`;
    } else {
      lastRaw = raw;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        lastProblem = `the arguments were not valid JSON (${(error as Error).message})`;
        parsed = undefined;
      }

      if (parsed !== undefined) {
        const result = schema.safeParse(parsed);
        if (result.success) return result.data;
        lastProblem = result.error.issues
          .slice(0, 8)
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ");
      }
    }

    // Feed the failure back rather than re-asking the same question blindly.
    if (attempt < attempts) {
      messages.push({
        role: "user",
        content:
          `That did not satisfy the ${toolName} schema — ${lastProblem}. ` +
          `Call ${toolName} again with every required field present and correctly typed.`,
      });
    }
  }

  throw new StructuredError(
    `${toolName} did not produce a valid result in ${attempts} attempts. Last problem: ${lastProblem}`,
    attempts,
    lastRaw,
  );
}
