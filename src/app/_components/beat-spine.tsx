import { en } from "@/lib/i18n/en";
import type { BeatId } from "@/lib/rules/schema";

export type SpineBeat = {
  id: BeatId;
  /** Seconds this beat must last at minimum, and may last at most. */
  min: number;
  max: number;
  /** The rulebook's own instruction for the beat, shown on hover. */
  instruction: string;
};

/**
 * The seven-beat spine, drawn to scale.
 *
 * Each beat's width is proportional to its maximum band, so `resolve` visibly
 * dominates and the eye lands on where the time actually goes. Within a beat, the
 * solid portion is the minimum the rulebook requires and the pale portion is the
 * slack a storyboard may spend — which is the single most useful thing a teacher
 * can know before editing a beat's duration.
 *
 * An ordered list, because the order is the content: `beats.order_mandatory` is
 * `true` in all three rules files and no beat is removable. The numbers are not
 * decoration.
 */
export function BeatSpine({ beats }: { beats: SpineBeat[] }) {
  const total = beats.reduce((sum, beat) => sum + beat.max, 0);

  return (
    <figure className="mt-8">
      <ol className="hidden items-end gap-1.5 sm:flex" aria-label={en.dashboard.spine.caption}>
        {beats.map((beat, index) => (
          <li
            key={beat.id}
            style={{ flexGrow: beat.max, flexBasis: 0 }}
            className="min-w-0"
            title={beat.instruction}
          >
            <p className="mb-1.5 flex items-baseline gap-1.5">
              <span className="font-book text-ink/45 text-[13px] leading-none">{index + 1}</span>
              <span className="truncate text-[13px] leading-none font-medium">
                {en.beats[beat.id]}
              </span>
            </p>
            <Bar beat={beat} />
            <p className="font-book mt-1.5 text-[13px] leading-none text-ink/55">
              {beat.min}–{beat.max}
              {en.dashboard.spine.secondsAbbrev}
            </p>
          </li>
        ))}
      </ol>

      {/* Below sm the row cannot hold seven labels, so the same data stacks. */}
      <ol className="flex flex-col gap-3 sm:hidden" aria-label={en.dashboard.spine.caption}>
        {beats.map((beat, index) => (
          <li key={beat.id} className="grid grid-cols-[1.25rem_1fr_auto] items-center gap-3">
            <span className="font-book text-ink/45 text-sm">{index + 1}</span>
            <span className="text-sm font-medium">{en.beats[beat.id]}</span>
            <span className="font-book text-sm text-ink/55">
              {beat.min}–{beat.max}
              {en.dashboard.spine.secondsAbbrev}
            </span>
            <div className="col-start-2 col-span-2" style={{ width: `${(beat.max / total) * 100}%` }}>
              <Bar beat={beat} />
            </div>
          </li>
        ))}
      </ol>

      <figcaption className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-ink/55">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-primary" aria-hidden />
          {en.dashboard.spine.required}
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-subtle" aria-hidden />
          {en.dashboard.spine.slack}
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * The band itself: solid to the minimum the rulebook requires, pale across the
 * slack a storyboard may spend.
 */
function Bar({ beat }: { beat: SpineBeat }) {
  return (
    <div className="flex h-9 overflow-hidden rounded-[3px] bg-subtle" aria-hidden>
      <div className="bg-primary" style={{ width: `${(beat.min / beat.max) * 100}%` }} />
    </div>
  );
}
