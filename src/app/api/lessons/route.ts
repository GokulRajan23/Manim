/**
 * `POST /api/lessons` — a teacher's upload becomes a lesson (plan.md §4.7).
 *
 * Next 16 Route Handler: Web `Request`/`Response`, not cached for POST.
 *
 * Every rejection here returns a sentence a teacher can act on. "Corrupt upload
 * fails with a message, not a stack trace" is an acceptance criterion for this
 * step, so the handler distinguishes what the caller can fix (`IngestError`, a
 * bad field) from what they cannot (an extraction that would not converge), and
 * never lets an internal message escape as-is.
 */
import { createLessonFromUpload } from "@/lib/pipeline/create-lesson";
import { IngestError, MAX_UPLOAD_BYTES } from "@/lib/pipeline/ingest";
import { StructuredError } from "@/lib/llm/structured";
import { SUBJECTS, type Subject } from "@/lib/rules/schema";
import { en } from "@/lib/i18n/en";

/** Klasse 7–10 is the whole of `sek1`, and the whole of this sprint (§2). */
const KLASSE = { min: 7, max: 10 } as const;

function bad(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad(en.studio.errors.notMultipart);
  }

  const subject = form.get("subject");
  if (typeof subject !== "string" || !SUBJECTS.includes(subject as Subject)) {
    return bad(en.studio.errors.subject);
  }

  const klasse = Number(form.get("klasse"));
  if (!Number.isInteger(klasse) || klasse < KLASSE.min || klasse > KLASSE.max) {
    return bad(en.studio.errors.klasse);
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return bad(en.studio.errors.noFile);
  }
  // Checked before reading the body into memory, so an oversized upload costs a
  // header rather than 25 MB of heap.
  if (file.size > MAX_UPLOAD_BYTES) {
    return bad(en.studio.errors.tooLarge, 413);
  }

  try {
    const { lesson, concept, problems } = await createLessonFromUpload({
      subject: subject as Subject,
      klasse,
      data: new Uint8Array(await file.arrayBuffer()),
      filename: file.name,
    });

    return Response.json({ lesson, concept, problems }, { status: 201 });
  } catch (error) {
    if (error instanceof IngestError) return bad(error.userMessage, 415);

    // The model could not produce a valid ConceptSpec. That is not the teacher's
    // fault and not something they can fix by editing a field, so it reads as a
    // failure of ours and the detail stays in the event log.
    if (error instanceof StructuredError) return bad(en.studio.errors.extraction, 502);

    console.error("POST /api/lessons", error);
    return bad(en.studio.errors.unknown, 500);
  }
}
