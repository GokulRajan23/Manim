/**
 * The brand palette — plan.md §3.1.
 *
 * This is the single source of truth for the *app UI* only. Video frames use the
 * subject palettes from `guidelines/rules-<subject>.yaml`, which override brand
 * and stylistic judgement because the rules files say so explicitly. Nothing in
 * here is ever used to draw a frame, and no subject colour is ever hardcoded
 * here — `npm run gen:theme` reads those from the rulebook.
 *
 * Source: realtimecolors.com/?colors=050315-fbfbfe-2f27ce-dedcff-433bff
 */
export const BRAND = {
  /** App background. */
  SURFACE: "#FBFBFE",
  /** App body text — 19.7:1 on SURFACE. */
  TEXT: "#050315",
  /** Buttons and links — 8.8:1 on SURFACE. */
  PRIMARY: "#2F27CE",
  /** Secondary surfaces and chips. */
  SUBTLE: "#DEDCFF",
  /** Focus rings and active states. */
  ACCENT: "#433BFF",
} as const;

/**
 * The ground every video frame is drawn on. Deliberately the brand's darkest
 * value, so the app and its output share one visual family without the subject
 * palettes fighting the brand. plan.md §3.2 measured every rule colour against
 * this and found dark to be the correct choice — on a light ground the failures
 * are worse and more numerous.
 */
export const FRAME_GROUND = BRAND.TEXT;

/** WCAG 2.1 thresholds, named so call sites read as intent rather than as numbers. */
export const CONTRAST = {
  /** Labels, equations, any glyph. */
  TEXT: 4.5,
  /** Shapes, strokes, arrows. */
  GRAPHIC: 3.0,
} as const;

export type BrandToken = keyof typeof BRAND;
