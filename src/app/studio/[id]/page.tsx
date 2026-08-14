import Link from "next/link";
import { notFound } from "next/navigation";
import { getArtifact, getLesson, listEvents, listGateResults } from "@/lib/db/repo";
import { en } from "@/lib/i18n/en";

/**
 * `/studio/[id]` — the lesson, and the compliance report.
 *
 * plan.md calls this "the screen that makes the pitch", and the thing that makes
 * it worth anything is that **every row is read from `gate_results`**. Nothing
 * here is a hardcoded list of reassuring checkmarks: if a check did not run, it
 * does not appear, and if it failed it says so with the value it measured.
 */
export const dynamic = "force-dynamic";

export default async function LessonPage({ params }: PageProps<"/studio/[id]">) {
  const { id } = await params;
  const lesson = getLesson(id);
  if (!lesson) notFound();

  const gate = listGateResults(id);
  const events = listEvents(id);
  const video = getArtifact(id, "mp4");
  const failing = gate.filter((r) => !r.holds);

  const passA = gate.filter((r) => r.pass === "A");
  const passB = gate.filter((r) => r.pass === "B");

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <Link href="/studio" className="text-sm text-ink/50 hover:text-primary">
        ← {en.studio.eyebrow}
      </Link>

      <h1 className="mt-6 text-2xl font-medium tracking-tight">{lesson.title}</h1>
      <p className="mt-2 text-sm text-ink/55">
        {lesson.subject} · Klasse {lesson.klasse} · {lesson.status}
        {lesson.chainOf > 1 && ` · link ${lesson.chainIndex} of ${lesson.chainOf}`}
      </p>

      {video && (
        <video
          controls
          className="mt-8 w-full rounded border border-ink/10 bg-frame"
          src={`/api/lessons/${id}/artifact/mp4`}
        >
          <track
            kind="captions"
            srcLang="en"
            label="English"
            default
            src={`/api/lessons/${id}/artifact/vtt`}
          />
        </video>
      )}

      {gate.length > 0 && (
        <section className="mt-12">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-medium">Compliance report</h2>
            <span
              className={`rounded-full px-3 py-1 text-xs ${
                failing.length === 0 ? "bg-subtle text-primary" : "bg-ink/10 text-ink/80"
              }`}
            >
              {failing.length === 0
                ? `${gate.length} checks hold`
                : `${failing.length} of ${gate.length} failing`}
            </span>
          </div>
          <p className="mt-2 max-w-prose text-sm text-ink/60">
            Read from the rulebook and recorded per run. Machine checks are not overridable —
            a lesson that fails one does not render.
          </p>

          <GateTable title="Pass A — before any audio is bought" rows={passA} />
          <GateTable title="Pass B — before any frame is rendered" rows={passB} />
        </section>
      )}

      {events.length > 0 && (
        <section className="mt-12">
          <h2 className="text-lg font-medium">Event log</h2>
          <ul className="mt-4 space-y-1.5 font-mono text-xs">
            {events.map((event) => (
              <li key={event.id} className="flex gap-3">
                <span className="shrink-0 text-ink/35">{event.stage}</span>
                <span className={event.level === "error" ? "text-ink" : "text-ink/70"}>
                  {event.message}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function GateTable({
  title,
  rows,
}: {
  title: string;
  rows: { id: number; checkId: string; holds: boolean; detail: string | null }[];
}) {
  if (rows.length === 0) return null;

  return (
    <div className="mt-7">
      <h3 className="text-xs uppercase tracking-widest text-ink/45">{title}</h3>
      <table className="mt-3 w-full border-collapse text-sm">
        <tbody>
          {rows.map((row) => {
            // `detail` is stored as "<rule> — <measured value>", so the rule and
            // the number it was measured against stay together in the record.
            const [rule, measured] = (row.detail ?? "").split(" — ");
            return (
              <tr key={row.id} className="border-t border-ink/10 align-baseline">
                <td className="w-12 py-2.5 font-mono text-xs text-ink/45">{row.checkId}</td>
                <td className="w-16 py-2.5">
                  <span className={row.holds ? "text-primary" : "text-ink"}>
                    {row.holds ? "pass" : "FAIL"}
                  </span>
                </td>
                <td className="py-2.5 pr-4">{rule}</td>
                <td className="py-2.5 text-right font-mono text-xs text-ink/60">{measured}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
