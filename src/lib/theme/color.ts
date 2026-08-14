/**
 * Colour measurement for the palette compliance tests.
 *
 * plan.md §3.2 makes two independent claims about every rule palette, and this
 * module is what measures them rather than asserting them:
 *
 *   1. Every colour is legible against the frame ground — WCAG 2.1 contrast.
 *   2. Colours carrying different meanings stay tellable apart for a learner
 *      with deuteranopia or protanopia — simulate the deficiency, then measure
 *      perceptual distance in CIE Lab.
 *
 * The rules files ask for both (`visuals.colourblind_check`) and, crucially,
 * also declare `colour_encodes_meaning_alone: false` — so a small simulated
 * distance is a requirement for redundant encoding, not automatically a defect.
 * These functions report numbers; the tests decide what the numbers mean.
 */

/** sRGB, each channel 0–255. */
export type Rgb = { r: number; g: number; b: number };

/** CIE L*a*b* under a D65 white point. */
export type Lab = { L: number; a: number; b: number };

export type ColourVisionDeficiency = "deuteranopia" | "protanopia";

const HEX = /^#([0-9a-fA-F]{6})$/;

/** Parse `#RRGGBB`. Throws rather than guessing — a malformed palette entry is a rules-file defect. */
export function parseHex(hex: string): Rgb {
  const match = HEX.exec(hex.trim());
  if (!match) throw new Error(`Not a #RRGGBB colour: ${JSON.stringify(hex)}`);
  const n = parseInt(match[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

export function toHex({ r, g, b }: Rgb): string {
  const clamp = (c: number) => Math.max(0, Math.min(255, Math.round(c)));
  return `#${[r, g, b].map((c) => clamp(c).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** sRGB 0–255 → linear-light 0–1. The inverse companding from IEC 61966-2-1. */
function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear-light 0–1 → sRGB 0–255. */
function fromLinear(channel: number): number {
  const c = Math.max(0, Math.min(1, channel));
  return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * WCAG 2.1 contrast ratio, 1:1 to 21:1. Thresholds that matter here:
 * 4.5:1 for text and equations, 3:1 for shapes and strokes.
 */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Machado, Oliveira & Fernandes (2009) severity-1.0 transforms, applied in
 * linear-light RGB. Chosen over the older Viénot–Brettel–Mollon matrices because
 * they are the ones derived for and validated against display colour.
 */
const CVD_MATRIX: Record<ColourVisionDeficiency, readonly number[]> = {
  protanopia: [
    0.152286, 1.052583, -0.204868,
    0.114503, 0.786281, 0.099216,
    -0.003882, -0.048116, 1.051998,
  ],
  deuteranopia: [
    0.367322, 0.860646, -0.227968,
    0.280085, 0.672501, 0.047413,
    -0.011820, 0.042940, 0.968881,
  ],
};

/** Simulate how a colour appears to a dichromat. */
export function simulate(hex: string, deficiency: ColourVisionDeficiency): string {
  const { r, g, b } = parseHex(hex);
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const m = CVD_MATRIX[deficiency];
  return toHex({
    r: fromLinear(m[0] * lr + m[1] * lg + m[2] * lb),
    g: fromLinear(m[3] * lr + m[4] * lg + m[5] * lb),
    b: fromLinear(m[6] * lr + m[7] * lg + m[8] * lb),
  });
}

/** sRGB → CIE L*a*b*, D65 white point. */
export function toLab(hex: string): Lab {
  const { r, g, b } = parseHex(hex);
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];

  // Linear sRGB → XYZ (D65), then normalise by the white point.
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb;
  const z = (0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb) / 1.08883;

  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = [f(x), f(y), f(z)];

  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/**
 * CIE76 ΔE*ab between two colours. Coarser than CIEDE2000 but monotonic and
 * easy to reason about: ~2.3 is the just-noticeable difference, and the double
 * digits are what "distinguishable across a classroom" needs.
 */
export function deltaE(a: string, b: string): number {
  const [x, y] = [toLab(a), toLab(b)];
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
}

/** ΔE between two colours as a dichromat sees them. */
export function deltaEUnder(a: string, b: string, deficiency: ColourVisionDeficiency): number {
  return deltaE(simulate(a, deficiency), simulate(b, deficiency));
}
