import Link from "next/link";
import { relative } from "node:path";
import { BeatSpine, type SpineBeat } from "./_components/beat-spine";
import { en, t } from "@/lib/i18n/en";
import { beatSpec, loadRules, stageLimits } from "@/lib/rules/loader";
import { BEAT_IDS, SUBJECTS, type Subject } from "@/lib/rules/schema";

/**
 * The dashboard.
 *
 * The hero is the rulebook rather than a claim about it: the spine is drawn from
 * the YAML on every request, so what a teacher sees here is the contract their
 * videos are actually checked against. If the rulebook stops parsing, this page is
 * the first place that shows it.
 */

/**
 * Read the rulebook per request, not at build time.
 *
 * Without this, Next prerenders this route statically and the spine freezes at
 * whatever the YAML said when the build ran — so amending a rules file would leave
 * the dashboard confidently displaying the previous contract. plan.md §3.5 promises
 * the opposite: edit the rulebook and everything downstream follows.
 */
export const dynamic = "force-dynamic";

/** Which subject's bands to display. They are identical across all three (see parser.test.ts). */
function displaySubject(): Subject {
  const configured = process.env.DEEP_LIBRARY_SUBJECT;
  return SUBJECTS.includes(configured as Subject) ? (configured as Subject) : "mathematics";
}

export default function Dashboard() {
  let rules;
  try {
    rules = loadRules(displaySubject());
  } catch (error) {
    return (
      <Shell>
        <p className="max-w-prose text-ink/70">{en.errors.rulebookUnreadable}</p>
        <pre className="mt-4 max-w-full overflow-x-auto rounded border border-ink/10 bg-subtle/40 p-4 text-xs">
          {(error as Error).message}
        </pre>
      </Shell>
    );
  }

  const { config } = rules;
  const stage = stageLimits(config, "sek1");
  const [targetMin, targetMax] = stage.target_seconds;

  const beats: SpineBeat[] = BEAT_IDS.map((id) => {
    const spec = beatSpec(config, id);
    return { id, min: spec.seconds.sek1[0], max: spec.seconds.sek1[1], instruction: spec.do };
  });

  const facts = [
    { label: en.dashboard.facts.target, value: `${targetMin}–${targetMax} s` },
    { label: en.dashboard.facts.cap, value: `${config.limits.hard_cap_seconds} s` },
    { label: en.dashboard.facts.silence, value: `${Math.round(stage.silence_reserve * 100)} %` },
    { label: en.dashboard.facts.words, value: String(stage.max_script_words) },
    { label: en.dashboard.facts.ideaUnits, value: en.dashboard.facts.oneIdea },
  ];

  return (
    <Shell>
      <p className="font-book text-lg text-ink/60">{en.dashboard.eyebrow}</p>
      <h1 className="mt-3 max-w-2xl text-4xl leading-[1.08] font-semibold tracking-[-0.025em] sm:text-5xl">
        {en.dashboard.headline}
      </h1>
      <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink/70">{en.dashboard.lede}</p>

      <Link
        href="/studio"
        className="mt-8 inline-flex items-center rounded bg-primary px-5 py-3 text-sm font-medium text-surface transition-colors hover:bg-accent"
      >
        {en.dashboard.start}
      </Link>

      <section className="mt-16 border-t border-ink/10 pt-10" aria-labelledby="spine-heading">
        <h2 id="spine-heading" className="font-book text-xl">
          {en.dashboard.spine.heading}
        </h2>
        <p className="mt-1.5 max-w-xl text-sm text-ink/60">{en.dashboard.spine.caption}</p>

        <BeatSpine beats={beats} />

        <dl className="mt-10 grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className="text-[13px] text-ink/55">{fact.label}</dt>
              <dd className="font-book mt-1 text-2xl leading-none">{fact.value}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-8 text-[13px] text-ink/45">
          {t(en.dashboard.spine.provenance, {
            file: relative(process.cwd(), rules.path),
          })}
        </p>
      </section>

      <section className="mt-16 border-t border-ink/10 pt-10" aria-labelledby="features-heading">
        <h2 id="features-heading" className="font-book text-xl">
          {en.dashboard.features.heading}
        </h2>

        <ul className="mt-6 grid gap-4 sm:grid-cols-3">
          <li>
            <Link
              href="/studio"
              className="group flex h-full flex-col rounded border border-ink/15 p-5 transition-colors hover:border-primary"
            >
              <FeatureCard
                name={en.dashboard.features.studio.name}
                blurb={en.dashboard.features.studio.blurb}
                status={en.dashboard.status.ready}
                ready
              />
            </Link>
          </li>
          {[en.dashboard.features.library, en.dashboard.features.rulebook].map((feature) => (
            <li key={feature.name}>
              <div className="flex h-full flex-col rounded border border-dashed border-ink/15 p-5">
                <FeatureCard
                  name={feature.name}
                  blurb={feature.blurb}
                  status={en.dashboard.status.planned}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-5xl px-6 py-16">{children}</div>;
}

function FeatureCard({
  name,
  blurb,
  status,
  ready = false,
}: {
  name: string;
  blurb: string;
  status: string;
  ready?: boolean;
}) {
  return (
    <>
      <p className="flex items-baseline justify-between gap-3">
        <span className={`font-medium ${ready ? "" : "text-ink/55"}`}>{name}</span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
            ready ? "bg-subtle text-primary" : "text-ink/40"
          }`}
        >
          {status}
        </span>
      </p>
      <p className={`mt-2 text-sm leading-relaxed ${ready ? "text-ink/65" : "text-ink/45"}`}>
        {blurb}
      </p>
    </>
  );
}
