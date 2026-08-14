import Link from "next/link";
import { UploadForm } from "./_components/upload-form";
import { en } from "@/lib/i18n/en";
import { SUBJECTS } from "@/lib/rules/schema";

/**
 * `/studio` — where a lesson starts.
 *
 * The page is a server component and the form is the only client island, so the
 * subject list comes from the rulebook's own `SUBJECTS` rather than being typed
 * into JSX twice.
 */
export const metadata = { title: `${en.studio.eyebrow} — ${en.brand.name}` };

/** Klasse 7–10 is the whole of `sek1`, and the whole of this sprint (plan.md §2). */
const KLASSEN = [7, 8, 9, 10];

export default function Studio() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm text-ink/50 hover:text-primary">
        {en.brand.name}
      </Link>

      <p className="mt-8 text-xs uppercase tracking-widest text-ink/45">{en.studio.eyebrow}</p>
      <h1 className="mt-3 text-3xl font-medium tracking-tight">{en.studio.headline}</h1>
      <p className="mt-4 max-w-prose leading-relaxed text-ink/65">{en.studio.lede}</p>

      <div className="mt-10">
        <UploadForm
          subjects={SUBJECTS.map((id) => ({ id, label: en.studio.subjects[id] }))}
          klassen={KLASSEN}
        />
      </div>
    </div>
  );
}
