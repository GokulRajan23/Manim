/**
 * The language-model client. One per process, constructed lazily.
 *
 * Every gateway this project talks to speaks the OpenAI wire protocol, so the
 * provider is a base URL, a key and a set of model IDs — not a different SDK.
 * That is the whole reason this file has a provider table instead of branching
 * logic: switching gateways is configuration, not code (plan.md §4.14).
 */
import OpenAI from "openai";

export type ProviderName = "openrouter" | "deutschlandgpt";

type Provider = {
  baseUrl: string;
  /** Which environment variable holds this provider's key. */
  keyVar: string;
  /** Sent on every request. OpenRouter uses these for attribution. */
  headers?: Record<string, string>;
  defaults: { planner: string; codegen: string };
};

const PROVIDERS: Record<ProviderName, Provider> = {
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    keyVar: "OPENROUTER_API_KEY",
    headers: {
      "HTTP-Referer": "https://github.com/tafel-lesson-studio",
      "X-Title": "Tafel Lesson Studio",
    },
    defaults: { planner: "openrouter/free", codegen: "openrouter/free" },
  },
  // GDPR-compliant German gateway brokering the same Claude models the plan was
  // written against. Kept configured because the EU-residency argument for it
  // still holds; it is not the default only because its key is not live.
  deutschlandgpt: {
    baseUrl: "https://api.deutschlandgpt.de/v1",
    keyVar: "DEUTSCHLANDGPT_API_KEY",
    defaults: { planner: "claude-opus-5", codegen: "claude-sonnet-5" },
  },
};

export function providerName(): ProviderName {
  const configured = process.env.LLM_PROVIDER ?? "openrouter";
  if (!(configured in PROVIDERS)) {
    throw new Error(
      `LLM_PROVIDER="${configured}" is not a known provider. ` +
        `Expected one of: ${Object.keys(PROVIDERS).join(", ")}.`,
    );
  }
  return configured as ProviderName;
}

export function provider(): Provider {
  return PROVIDERS[providerName()];
}

/** The base URL actually in use, after any explicit override. */
export function llmBaseUrl(): string {
  return process.env.LLM_BASE_URL ?? provider().baseUrl;
}

/**
 * Which model does which job.
 *
 * The plan splits these deliberately: one careful pass for judgement work
 * (extraction, storyboarding), a cheaper model for the work that fans out and
 * retries (scene codegen, repair). A provider whose defaults are the same slug
 * for both collapses that distinction — see the note in .env.example.
 */
export const MODEL = {
  get planner(): string {
    return process.env.MODEL_PLANNER ?? provider().defaults.planner;
  },
  get codegen(): string {
    return process.env.MODEL_CODEGEN ?? provider().defaults.codegen;
  },
} as const;

let client: OpenAI | undefined;

/** The live client, initialised on first call. */
export function llm(): OpenAI {
  if (client) return client;

  const active = provider();
  const apiKey = process.env[active.keyVar];
  if (!apiKey) {
    throw new Error(
      `${active.keyVar} is unset, and LLM_PROVIDER is "${providerName()}". ` +
        `Copy .env.example to .env.local and fill it in; ` +
        `\`npm run doctor\` reports which credentials are missing.`,
    );
  }

  client = new OpenAI({
    apiKey,
    baseURL: llmBaseUrl(),
    defaultHeaders: active.headers,
    // Codegen runs a repair loop already; a transport-level retry on top of it
    // only muddies which failure the loop is reacting to.
    maxRetries: 2,
    timeout: Number(process.env.LLM_TIMEOUT_MS ?? 120_000),
  });

  return client;
}

/** Drop the client. For tests, which swap the environment between cases. */
export function resetLlm(): void {
  client = undefined;
}

export type PingResult = {
  ok: boolean;
  /** Human-readable detail: the model's reply, or why the call failed. */
  detail: string;
};

/**
 * Smallest possible round trip against a real model, for `npm run doctor`.
 *
 * Checking that a key is *present* is nearly worthless here — a revoked or
 * mistyped key looks identical to a good one until the first real call, which
 * would otherwise be several expensive pipeline stages in.
 */
export async function ping(model: string = MODEL.codegen): Promise<PingResult> {
  try {
    const response = await llm().chat.completions.create({
      model,
      messages: [{ role: "user", content: "Reply with exactly: PONG" }],
      // Generous for a one-word answer, deliberately: a reasoning model spends
      // this budget on thinking *before* emitting any content, so a tight cap
      // truncates mid-thought and the check fails on a healthy gateway. The
      // free router can hand this request to such a model at any time.
      max_tokens: 512,
    });

    const choice = response.choices[0];
    const reply = choice?.message?.content?.trim();
    if (!reply) {
      const why =
        choice?.finish_reason === "length"
          ? "hit the token cap before emitting content"
          : `finish_reason=${choice?.finish_reason ?? "none"}`;
      return { ok: false, detail: `${model} returned no content — ${why}` };
    }

    // A router resolves to a different underlying model per call, and the
    // response says which one. Worth printing: it is the only visibility into
    // what actually served the request.
    const served = response.model && response.model !== model ? ` (served by ${response.model})` : "";

    // Check the *content*, not just that bytes came back. The free router's pool
    // includes non-chat models — a content-safety classifier answered this exact
    // prompt with "User Safety: safe" — and those cannot generate scene code.
    // Anything that fails to echo one obvious word will not survive codegen.
    if (!/PONG/i.test(reply)) {
      return {
        ok: false,
        detail: `${model}${served} ignored a trivial instruction (replied ${JSON.stringify(
          reply.slice(0, 60),
        )}) — likely not a general chat model`,
      };
    }

    return { ok: true, detail: `${model}${served} → ${reply}` };
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      const body = typeof error.error === "object" ? JSON.stringify(error.error) : error.message;
      return { ok: false, detail: `HTTP ${error.status} from ${llmBaseUrl()} — ${body}` };
    }
    return { ok: false, detail: (error as Error).message };
  }
}
