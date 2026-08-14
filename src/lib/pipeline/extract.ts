/**
 * Stage 2 — Extract (plan.md §4.7).
 *
 * Read the teacher's upload and produce a `ConceptSpec`. The gateway handles both
 * input shapes natively: a PDF is parsed server-side, an image goes to a vision
 * model. No PDF library and no OCR service on our side.
 *
 * The register is supplied *in the prompt* as a closed list. Asking a model not to
 * invent a misconception works far better when the alternative is spelled out than
 * when it is only forbidden, and `checkConcept` verifies the answer regardless —
 * the prompt is a nudge, the check is the contract.
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { promisify } from "node:util";
import { checkConcept, conceptSpecSchema, type ConceptProblem, type ConceptSpec } from "./concept";
import { MEDIA_TYPE, type SourceKind } from "./ingest";
import { structured, type Part } from "@/lib/llm/structured";
import { misconceptionRegister } from "@/lib/rules/parser";
import type { SubjectConfig } from "@/lib/rules/schema";

const run = promisify(execFile);

const SYSTEM = [
  "You extract teaching material into a strict schema for a German Gymnasium lesson pipeline.",
  "You read the uploaded material and report what is actually in it.",
  "You never invent a misconception: you choose only from the register you are given.",
  "sourceQuotes must be copied verbatim from the material, never paraphrased.",
  "If the material contains several distinct ideas, say so honestly in ideaUnits and",
  "propose a chain. Never compress several ideas into one video to make it fit.",
].join(" ");

export type ExtractResult = {
  spec: ConceptSpec;
  /** Non-fatal findings, surfaced to the teacher rather than swallowed. */
  problems: ConceptProblem[];
};

/** How the upload is presented to the model. */
function sourcePart(kind: SourceKind, path: string): Part {
  const base64 = readFileSync(path).toString("base64");
  if (kind === "pdf") return { kind: "pdf", filename: "source.pdf", base64 };
  return { kind: "image", mediaType: MEDIA_TYPE[kind], base64 };
}

function prompt(config: SubjectConfig, klasse: number): string {
  const register = misconceptionRegister(config);
  const lines = register.map((entry) => `  ${entry.id} — ${entry.claim}`).join("\n");

  return [
    `Subject: ${config.subject}. Klasse: ${klasse} (stage sek1).`,
    "",
    "Extract this material into the record_concept tool.",
    "",
    `Idea units: count at most ${config.limits.idea_units_per_video} per video. ` +
      "If this material holds more, report the true count and propose one chain link per idea unit.",
    "",
    "The misconception register is closed. Copy a registerId exactly from this list:",
    lines,
    "",
    "Choose the misconceptions a learner at this Klasse would plausibly hold for this topic.",
  ].join("\n");
}

/**
 * Extract a `ConceptSpec` from a stored upload.
 *
 * Returns problems alongside the spec instead of throwing on them: an invented
 * register id or a paraphrased quote is worth showing the teacher next to the
 * draft, and the gate blocks the ones that matter before anything renders.
 * A spec that cannot be produced at all does throw — `StructuredError`.
 */
export async function extract(
  config: SubjectConfig,
  klasse: number,
  kind: SourceKind,
  path: string,
): Promise<ExtractResult> {
  const spec = await structured(
    conceptSpecSchema,
    "record_concept",
    "Record the concept extracted from the uploaded teaching material.",
    [{ kind: "text", text: prompt(config, klasse) }, sourcePart(kind, path)],
    { system: SYSTEM },
  );

  // Quote verification needs the source as text. Only a PDF gives us that without
  // an OCR pass, so for a photograph the check is skipped rather than faked —
  // `checkConcept` treats an absent source as "not checkable", not "passed".
  const sourceText = kind === "pdf" ? await pdfText(path) : undefined;

  return { spec, problems: checkConcept(spec, config, sourceText) };
}

/**
 * Recover a PDF's text, for quote verification only.
 *
 * Ghostscript rather than a Node PDF library: it is already in the render image,
 * and pdflatex output uses compressed content streams that a regex over the raw
 * bytes cannot read at all (measured: zero matches on the fixture). The host has
 * no Ghostscript, so this runs in the container like every other shell stage.
 *
 * Extraction is imperfect — word boundaries are frequently lost — which is why
 * `checkConcept` compares on letters and digits alone. A scanned page has no text
 * layer and yields nothing; that returns empty and quote checking is skipped,
 * which is the honest outcome rather than a fabricated pass.
 */
async function pdfText(path: string): Promise<string> {
  const dir = dirname(path);
  try {
    const { stdout } = await run(
      "docker",
      [
        "run", "--rm", "--network", "none", "-v", `${dir}:/work`, "-w", "/work",
        "--entrypoint", "gs", process.env.MANIM_IMAGE ?? "tafel-manim:local",
        "-dNOPAUSE", "-dBATCH", "-dQUIET", "-sDEVICE=txtwrite", "-sOutputFile=-",
        `/work/${basename(path)}`,
      ],
      { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
    );
    return stdout;
  } catch {
    // A PDF we cannot read is not a reason to fail extraction — it only means
    // the quotes go unverified, which `checkConcept` handles by not checking.
    return "";
  }
}
