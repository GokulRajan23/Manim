import Link from "next/link";
import { getArtifact, listGateResults, listLessons } from "@/lib/db/repo";
import { en } from "@/lib/i18n/en";
import { TOPICS } from "@/lib/pipeline/topics";

/**
 * One built-in topic per Klasse, and a link to the lesson if it has been made.
 *
 * The upload path is the differentiator, but it needs a teacher's own material
 * to show anything. These give every Klasse a starting point with no file at
 * hand — and because a preset is just a `ConceptSpec`, everything downstream is
 * the same pipeline, gate included.
 */
export function TopicPicker() {
  // Newest ready lesson per topic, so the card links to something playable.
  const ready = listLessons(100).filter((l) => l.sourceKind === "topic" && l.status === "ready");

  return (
    <section>
      <h2 className="text-sm font-medium">{en.studio.topics.heading}</h2>
      <p className="mt-1.5 max-w-prose text-sm text-ink/55">{en.studio.topics.lede}</p>

      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {TOPICS.map((topic) => {
          const lesson = ready.find((l) => l.klasse === topic.klasse);
          const checks = lesson ? listGateResults(lesson.id) : [];
          const playable = lesson && getArtifact(lesson.id, "mp4");

          const card = (
            <>
              <p className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{topic.label}</span>
                <span className="shrink-0 text-xs text-ink/45">
                  {en.studio.form.klasse} {topic.klasse}
                </span>
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink/60">{topic.blurb}</p>
              <p className="mt-3 text-xs">
                {playable ? (
                  <span className="text-primary">
                    {checks.filter((c) => c.holds).length}/{checks.length}{" "}
                    {en.studio.topics.checksHold}
                  </span>
                ) : (
                  <span className="text-ink/40 font-mono">
                    npm run make -- topic:{topic.id}
                  </span>
                )}
              </p>
            </>
          );

          return (
            <li
              key={topic.id}
              className="rounded border border-ink/12 p-4 transition-colors hover:border-ink/25"
            >
              {playable ? <Link href={`/studio/${lesson.id}`}>{card}</Link> : card}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
