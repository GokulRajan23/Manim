/**
 * Every user-facing string in the app.
 *
 * plan.md §3.6 makes this a hard rule: no user-facing English is hardcoded in a
 * component. German narration is deferred to the backlog, but German *interface*
 * copy is then a matter of adding `de.ts` rather than hunting through JSX.
 *
 * Copy conventions, applied throughout: active voice, sentence case, and an action
 * keeps its name across the whole flow — the button that says "Render" produces an
 * event that says "Rendering". Nothing here sells; it describes what happens.
 */
import type { BeatId } from "@/lib/rules/schema";

export const en = {
  brand: {
    name: "Tafel",
    /** Used in <title> and the document description. */
    title: "Tafel — Lesson Studio",
    description:
      "Rule-compliant slide and video generation for German Gymnasium teachers, Klasse 7 to 10.",
  },

  nav: {
    label: "Sections",
    studio: "Lesson Studio",
    library: "Library",
    rulebook: "Rulebook",
  },

  dashboard: {
    eyebrow: "Klasse 7–10 · Mathematik, Physik, Chemie",
    headline: "Your worksheet, explained in seven beats.",
    lede:
      "Upload the material you already teach from. Tafel drafts a storyboard, checks it " +
      "against your subject's rulebook, and refuses to render anything that breaks it.",
    start: "Open Lesson Studio",

    spine: {
      heading: "The spine",
      caption: "Every lesson runs these seven beats, in this order, within these seconds.",
      /** Makes plan.md §3.5 visible: the rulebook is the source, not the code. */
      provenance: "Read from {file}. Change the rulebook and every video changes with it.",
      /** Legend for the two-tone bars. */
      required: "Required",
      slack: "Slack",
      secondsAbbrev: "s",
    },

    /** Each is a measured fact from the rulebook, not a marketing number. */
    facts: {
      target: "Target length",
      cap: "Hard cap",
      silence: "Silence reserve",
      words: "Word ceiling",
      ideaUnits: "Ideas per video",
      oneIdea: "One",
    },

    features: {
      heading: "Three features",
      studio: {
        name: "Lesson Studio",
        blurb: "Turn a worksheet or a photo of the board into a narrated explainer video.",
        action: "Open",
      },
      library: {
        name: "Library",
        blurb: "Every lesson you have made, each with the compliance record it passed on.",
      },
      rulebook: {
        name: "Rulebook",
        blurb:
          "The pedagogical contract your videos are checked against, versioned and owned by " +
          "your teaching team.",
      },
    },

    status: {
      ready: "Ready",
      planned: "Planned",
    },
  },

  /** Teacher-facing names for the seven beats. The rulebook's own ids stay internal. */
  beats: {
    anchor: "Anchor",
    pretrain: "Pre-train",
    elicit: "Elicit",
    confront: "Confront",
    resolve: "Resolve",
    vary: "Vary",
    consolidate: "Consolidate",
  } satisfies Record<BeatId, string>,

  errors: {
    rulebookUnreadable: "The rulebook could not be read, so nothing can be generated yet.",
  },

  studio: {
    eyebrow: "Lesson Studio",
    headline: "Start from your own material.",
    lede:
      "Upload a worksheet, a textbook page, or a photo of the board. Tafel reads it, " +
      "counts the ideas in it, and tells you whether that is one video or a chain.",

    form: {
      file: "Material",
      fileHint: "PDF, PNG, JPEG or HEIC, up to 25 MB.",
      choose: "Choose a file",
      subject: "Subject",
      klasse: "Klasse",
      submit: "Read this material",
      working: "Reading…",
    },

    subjects: {
      mathematics: "Mathematik",
      physics: "Physik",
      chemistry: "Chemie",
    },

    result: {
      heading: "What Tafel found",
      topic: "Topic",
      ideaUnits: "Idea units",
      /** The rule that decides one video or several, stated where it applies. */
      chainOne: "One idea unit, so this is one video.",
      chainMany:
        "{count} idea units. The rulebook allows one per video, so this is a chain of " +
        "{of} — Tafel generates the first link.",
      misconception: "Misconception to confront",
      quotes: "Quoted from your material",
      problems: "Worth checking",
      continue: "Open the storyboard",
    },

    /** Every one of these is something the teacher can act on, or an honest apology. */
    errors: {
      notMultipart: "That upload did not arrive as a file. Please try again.",
      subject: "Choose a subject: Mathematik, Physik or Chemie.",
      klasse: "Choose a Klasse between 7 and 10.",
      noFile: "Choose a file to upload.",
      tooLarge: "That file is larger than 25 MB. Try exporting the single page you need.",
      extraction:
        "Tafel could not read that material into a lesson. The event log for this " +
        "lesson has the details.",
      unknown: "Something went wrong on our side. The event log has the details.",
    },
  },
} as const;

/** Fill `{name}` placeholders. Keeps the sentence in en.ts rather than in a component. */
export function t(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}
