"use client";

import { useState } from "react";
import { en, t } from "@/lib/i18n/en";
import type { ConceptSpec, ConceptProblem } from "@/lib/pipeline/concept";
import type { Subject } from "@/lib/rules/schema";

/**
 * The upload form, and the extraction result underneath it.
 *
 * Extraction is a model call measured in tens of seconds, so the submitted state
 * is not decoration — without it the page looks broken for the whole wait. The
 * result is rendered here rather than on a redirect because the point of this
 * screen is the *decision* it surfaces: one video, or a chain.
 */
type Result = { concept: ConceptSpec; problems: ConceptProblem[]; lessonId: string };

export function UploadForm({
  subjects,
  klassen,
}: {
  subjects: { id: Subject; label: string }[];
  klassen: number[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<Result | undefined>();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setResult(undefined);

    try {
      const response = await fetch("/api/lessons", {
        method: "POST",
        body: new FormData(event.currentTarget),
      });
      const body = await response.json();
      if (!response.ok) {
        // The API's messages are already teacher-facing; showing them verbatim
        // is the whole reason they are written that way.
        setError(body?.error ?? en.studio.errors.unknown);
      } else {
        setResult({ concept: body.concept, problems: body.problems, lessonId: body.lesson.id });
      }
    } catch {
      setError(en.studio.errors.unknown);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-6">
        <div>
          <label htmlFor="file" className="block text-sm font-medium">
            {en.studio.form.file}
          </label>
          <input
            id="file"
            name="file"
            type="file"
            required
            accept=".pdf,.png,.jpg,.jpeg,.heic,application/pdf,image/png,image/jpeg,image/heic"
            className="mt-2 block w-full rounded border border-ink/15 bg-surface px-3 py-2 text-sm
                       file:mr-3 file:rounded file:border-0 file:bg-subtle file:px-3 file:py-1.5
                       file:text-sm file:text-primary hover:border-ink/25"
          />
          <p className="mt-1.5 text-xs text-ink/50">{en.studio.form.fileHint}</p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <label htmlFor="subject" className="block text-sm font-medium">
              {en.studio.form.subject}
            </label>
            <select
              id="subject"
              name="subject"
              defaultValue="mathematics"
              className="mt-2 block w-full rounded border border-ink/15 bg-surface px-3 py-2 text-sm"
            >
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="klasse" className="block text-sm font-medium">
              {en.studio.form.klasse}
            </label>
            <select
              id="klasse"
              name="klasse"
              defaultValue="8"
              className="mt-2 block w-full rounded border border-ink/15 bg-surface px-3 py-2 text-sm"
            >
              {klassen.map((klasse) => (
                <option key={klasse} value={klasse}>
                  {klasse}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="rounded bg-primary px-4 py-2 text-sm text-surface disabled:opacity-55"
        >
          {busy ? en.studio.form.working : en.studio.form.submit}
        </button>
      </form>

      {error && (
        <p className="mt-6 rounded border border-ink/15 bg-subtle/40 px-4 py-3 text-sm text-ink/80">
          {error}
        </p>
      )}

      {result && <Found {...result} />}
    </>
  );
}

function Found({ concept, problems, lessonId }: Result) {
  const { ideaUnits, chainProposal } = concept;

  return (
    <section className="mt-10 border-t border-ink/10 pt-8">
      <h2 className="text-lg font-medium">{en.studio.result.heading}</h2>

      <dl className="mt-5 space-y-5 text-sm">
        <Row label={en.studio.result.topic}>{concept.topic}</Row>

        <Row label={en.studio.result.ideaUnits}>
          <ol className="list-decimal space-y-1 pl-5">
            {ideaUnits.items.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ol>
          {/* The one-idea-per-video rule, stated at the moment it decides something. */}
          <p className="mt-3 text-ink/65">
            {chainProposal.of === 1
              ? en.studio.result.chainOne
              : t(en.studio.result.chainMany, {
                  count: ideaUnits.count,
                  of: chainProposal.of,
                })}
          </p>
        </Row>

        <Row label={en.studio.result.misconception}>
          <code className="text-xs text-primary">
            {concept.candidateMisconceptions[0]?.registerId}
          </code>
          <p className="mt-1">{concept.candidateMisconceptions[0]?.statement}</p>
        </Row>

        <Row label={en.studio.result.quotes}>
          <ul className="space-y-1.5">
            {concept.sourceQuotes.map((quote, index) => (
              <li key={index} className="border-l-2 border-ink/15 pl-3 text-ink/70">
                {quote}
              </li>
            ))}
          </ul>
        </Row>

        {problems.length > 0 && (
          <Row label={en.studio.result.problems}>
            <ul className="space-y-1 text-ink/70">
              {problems.map((problem, index) => (
                <li key={index}>
                  <code className="text-xs">{problem.field}</code> — {problem.detail}
                </li>
              ))}
            </ul>
          </Row>
        )}
      </dl>

      <a
        href={`/studio/${lessonId}`}
        className="mt-8 inline-block rounded bg-primary px-4 py-2 text-sm text-surface"
      >
        {en.studio.result.continue}
      </a>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[10rem_1fr] sm:gap-6">
      <dt className="text-ink/50">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
