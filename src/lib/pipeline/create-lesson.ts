/**
 * Ingest → extract, as one operation (plan.md §4.7 stages 1–2).
 *
 * Sits between the route handler and the two stages so the HTTP layer stays thin
 * and the sequence is testable without a request. Every step appends an event,
 * because the events table is what makes progress polling stateless (§4.9) and
 * the log is the first thing worth having when an extraction goes wrong.
 */
import { appendEvent, createLesson, updateLesson, type Lesson } from "@/lib/db/repo";
import { extract } from "./extract";
import { ingest, IngestError } from "./ingest";
import type { ConceptProblem, ConceptSpec } from "./concept";
import { loadRules } from "@/lib/rules/loader";
import { stageLimits } from "@/lib/rules/loader";
import type { Subject } from "@/lib/rules/schema";
import { findTopic, TOPICS } from "./topics";

export type CreateLessonInput = {
  subject: Subject;
  klasse: number;
  data: Uint8Array;
  filename?: string;
};

export type CreateLessonResult = {
  lesson: Lesson;
  concept: ConceptSpec;
  problems: ConceptProblem[];
};

/** Shown until extraction names the real one. Never reaches a teacher. */
const PENDING = "(extracting)";

export async function createLessonFromUpload(
  input: CreateLessonInput,
): Promise<CreateLessonResult> {
  const { config } = loadRules(input.subject);
  const [targetLo, targetHi] = stageLimits(config, "sek1").target_seconds;

  // The row is created before the file is stored because the lesson id names the
  // directory the file goes in (§4.10). `idea_unit` and `misconception_id` are
  // NOT NULL and are not known until extraction, so they are written as
  // placeholders and replaced in the same request — which is precisely what the
  // `extracting` status exists to describe.
  const lesson = createLesson({
    title: input.filename?.replace(/\.[^.]+$/, "") ?? "Untitled",
    subject: input.subject,
    klasse: input.klasse,
    targetSeconds: Math.round((targetLo + targetHi) / 2),
    ideaUnit: PENDING,
    misconceptionId: PENDING,
    status: "extracting",
  });

  try {
    const stored = ingest(lesson.id, input.data, input.filename);
    appendEvent(lesson.id, "ingest", `Stored ${stored.kind}, ${stored.bytes} bytes`);
    updateLesson(lesson.id, { sourcePath: stored.path, sourceKind: stored.kind });

    const { spec, problems } = await extract(config, input.klasse, stored.kind, stored.path);

    for (const problem of problems) {
      appendEvent(lesson.id, "extract", `${problem.field}: ${problem.detail}`, { level: "warn" });
    }
    appendEvent(
      lesson.id,
      "extract",
      `${spec.ideaUnits.count} idea unit(s); proposed chain of ${spec.chainProposal.of}`,
    );

    // Link 1 of the chain is what this lesson becomes. The rest are surfaced to
    // the teacher as a proposal (§1: chains are detected and counted, link 1 is
    // generated) rather than silently created or silently dropped.
    const first = spec.chainProposal.links[0];
    const updated = updateLesson(lesson.id, {
      title: spec.topic,
      ideaUnit: first?.ideaUnit ?? spec.ideaUnits.items[0] ?? spec.topic,
      misconceptionId: spec.candidateMisconceptions[0]!.registerId,
      chainIndex: 1,
      chainOf: spec.chainProposal.of,
      concept: spec,
      status: "draft",
    });

    return { lesson: updated!, concept: spec, problems };
  } catch (error) {
    // The row is kept, not deleted: a failed extraction with its event log is
    // more useful to a teacher than a lesson that silently never appeared.
    const message = error instanceof IngestError ? error.userMessage : (error as Error).message;
    appendEvent(lesson.id, "extract", message, { level: "error" });
    updateLesson(lesson.id, { status: "failed", error: message });
    throw error;
  }
}

/**
 * Start a lesson from a built-in topic instead of an upload.
 *
 * Synchronous, because there is nothing to read and no model to ask: the concept
 * is already written. Everything downstream — storyboard, gate, narration,
 * render — is identical to the upload path, which is the point.
 */
export function createLessonFromTopic(topicId: string): { lesson: Lesson; concept: ConceptSpec } {
  const topic = findTopic(topicId);
  if (!topic) {
    throw new Error(`unknown topic "${topicId}". Known: ${TOPICS.map((t) => t.id).join(", ")}`);
  }

  const { config } = loadRules(topic.concept.subject);
  const [lo, hi] = stageLimits(config, "sek1").target_seconds;

  const lesson = createLesson({
    title: topic.concept.topic,
    subject: topic.concept.subject,
    klasse: topic.klasse,
    targetSeconds: Math.round((lo + hi) / 2),
    ideaUnit: topic.concept.ideaUnits.items[0]!,
    misconceptionId: topic.concept.candidateMisconceptions[0]!.registerId,
    concept: topic.concept,
    status: "draft",
    sourceKind: "topic",
  } as Parameters<typeof createLesson>[0]);

  updateLesson(lesson.id, { concept: topic.concept });
  appendEvent(lesson.id, "ingest", `Built-in topic: ${topic.label} (Klasse ${topic.klasse})`);

  return { lesson: { ...lesson, concept: topic.concept }, concept: topic.concept };
}
