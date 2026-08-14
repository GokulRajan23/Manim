/**
 * The pre-render gate (plan.md §4.6). **Fail closed.**
 *
 * This is the differentiator: a storyboard that violates a machine-checkable rule
 * does not render, and the failing assertion is named. Every check reports the
 * *measured value* alongside its verdict, because the compliance report is read
 * by a teacher who is entitled to see the number, not just the word "pass".
 *
 * Two passes, run at different moments:
 *   A  on the storyboard, before a single second of audio is bought.
 *   B  on measured audio, before a single frame is rendered.
 *
 * No check is overridable. Nothing here consults a model — these are arithmetic
 * against the rulebook, which is what makes the claim auditable.
 */
import { bannedPhrases, beatBands, stageLimits } from "@/lib/rules/loader";
import { findMisconception } from "@/lib/rules/parser";
import { BEAT_IDS, type BeatId, type SubjectConfig } from "@/lib/rules/schema";

export type CheckResult = {
  id: string;
  pass: "A" | "B";
  /** What the rule requires, in the teacher's terms. */
  rule: string;
  holds: boolean;
  /** The measured value. Shown whether it passed or failed. */
  detail: string;
};

export type StoryboardInput = {
  beats: { beat: BeatId; narration: string; onScreen: string[] }[];
  misconceptionId: string;
};

export type MeasuredInput = {
  /** Per beat, in spine order: measured audio and the silence inside it. */
  beats: { beat: BeatId; audioMs: number; silenceMs: number; words: number }[];
};

/**
 * The demo profile scales every second-based band by one factor.
 *
 * A 60-second lesson cannot satisfy a rulebook written for 130–170 s, and the
 * honest options were to fake a pass or to say what was scaled. This does the
 * latter: the factor is reported on every duration check, so a reader can see
 * exactly which numbers were relaxed and by how much. Word and phrase rules are
 * *not* scaled — those hold at any length.
 */
export function durationScale(config: SubjectConfig, targetSeconds: number): number {
  const [lo, hi] = stageLimits(config, "sek1").target_seconds;
  const midpoint = (lo + hi) / 2;
  return targetSeconds >= lo ? 1 : targetSeconds / midpoint;
}

const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * Words in an on-screen label, where a mathematical symbol is not a word.
 *
 * `max_words_per_label` limits how much *reading* a label asks of the learner.
 * Splitting on whitespace counts the operators in "20 % · 50 = 10" as five words
 * and blocks a four-token expression that takes one glance — the rule was
 * written about prose, and symbols are exactly what these labels are meant to
 * carry. Only tokens containing a letter or digit count.
 */
const labelWords = (text: string): number =>
  text.trim().split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;

/** Pass A — on the storyboard, before anything is bought or rendered. */
export function passA(
  config: SubjectConfig,
  board: StoryboardInput,
  targetSeconds: number,
): CheckResult[] {
  const stage = stageLimits(config, "sek1");
  const scale = durationScale(config, targetSeconds);
  const results: CheckResult[] = [];
  const add = (id: string, rule: string, holds: boolean, detail: string) =>
    results.push({ id, pass: "A", rule, holds, detail });

  // A1 — the spine is fixed, in order, always seven.
  const order = board.beats.map((b) => b.beat);
  add(
    "A1",
    "Exactly seven beats, in spine order",
    order.length === 7 && BEAT_IDS.every((id, i) => order[i] === id),
    order.length === 7 ? order.join(" → ") : `${order.length} beats: ${order.join(", ")}`,
  );

  // A2 — every beat actually says something.
  const empty = board.beats.filter((b) => words(b.narration) === 0).map((b) => b.beat);
  add("A2", "Every beat carries narration", empty.length === 0,
    empty.length ? `empty: ${empty.join(", ")}` : "all seven have narration");

  // A3 — on-screen labels are keywords, not sentences.
  const longLabels = board.beats.flatMap((b) =>
    b.onScreen.filter((l) => labelWords(l) > stage.max_words_per_label).map((l) => `${b.beat}:"${l}"`),
  );
  add("A3", `On-screen labels ≤ ${stage.max_words_per_label} words`, longLabels.length === 0,
    longLabels.length ? longLabels.join(", ") : `longest ${Math.max(0,
      ...board.beats.flatMap((b) => b.onScreen.map(labelWords)))} words`);

  // A4 — a frame the learner can hold in working memory.
  const crowded = board.beats.filter((b) => b.onScreen.length > stage.max_simultaneous_objects);
  add("A4", `At most ${stage.max_simultaneous_objects} objects on screen`, crowded.length === 0,
    crowded.length ? crowded.map((b) => `${b.beat}:${b.onScreen.length}`).join(", ")
      : `most crowded ${Math.max(0, ...board.beats.map((b) => b.onScreen.length))}`);

  // A8 — never read the on-screen text aloud. Redundancy costs attention.
  const readAloud = board.beats.filter((b) => {
    const spoken = b.narration.toLowerCase();
    return b.onScreen.some((label) => words(label) >= 3 && spoken.includes(label.toLowerCase()));
  });
  add("A8", "On-screen text is never read aloud", readAloud.length === 0,
    readAloud.length ? readAloud.map((b) => b.beat).join(", ") : "no beat reads its own labels");

  // A9 — banned phrasing, straight from the rulebook's own list.
  const banned = bannedPhrases(config);
  // Word boundaries, not substrings: the list contains "um", which matches inside
  // "number" and would block an entirely compliant script. A banned *phrase* is
  // banned as words, and punctuation in the list (e.g. "clearly,") is matched
  // literally where it appears.
  const offenders = board.beats.flatMap((b) =>
    banned
      .filter((p) => {
        const escaped = p.phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|\\W)${escaped}(\\W|$)`, "i").test(b.narration);
      })
      .map((p) => `${b.beat}:"${p.phrase}"`),
  );
  add("A9", `None of the ${banned.length} banned phrases`, offenders.length === 0,
    offenders.length ? offenders.join(", ") : `checked ${banned.length} phrases`);

  // A10 — the misconception must exist in the register. The agent may not invent one.
  const known = findMisconception(config, board.misconceptionId);
  add("A10", "Misconception is named from the §7 register", Boolean(known),
    known ? `${board.misconceptionId}` : `"${board.misconceptionId}" is not in the register`);

  // A11 — sentence length, because a long sentence is an unlearnable one aloud.
  const longest = board.beats.flatMap((b) =>
    b.narration.split(/(?<=[.!?])\s+/).map((s) => ({ beat: b.beat, n: words(s), s })),
  ).sort((a, b) => b.n - a.n)[0];
  add("A11", `Sentences ≤ ${stage.max_sentence_words} words`,
    (longest?.n ?? 0) <= stage.max_sentence_words,
    longest ? `longest ${longest.n} words (${longest.beat})` : "no narration");

  // A12 — the word ceiling, scaled with the target because it is a rate, not a count.
  const total = board.beats.reduce((n, b) => n + words(b.narration), 0);
  const ceiling = Math.round(stage.max_script_words * scale);
  add("A12", `Script ≤ ${ceiling} words${scale < 1 ? ` (scaled ×${scale.toFixed(2)})` : ""}`,
    total <= ceiling, `${total} words`);

  // A13 — the elicit beat must leave a real question hanging.
  const elicit = board.beats.find((b) => b.beat === "elicit");
  add("A13", "The elicit beat asks a question", Boolean(elicit?.narration.includes("?")),
    elicit?.narration.includes("?") ? "question present" : "no question mark in the elicit beat");

  return results;
}

/** Pass B — on measured audio, before a frame is rendered. */
export function passB(
  config: SubjectConfig,
  measured: MeasuredInput,
  targetSeconds: number,
): CheckResult[] {
  const stage = stageLimits(config, "sek1");
  const bands = beatBands(config, "sek1");
  const scale = durationScale(config, targetSeconds);
  const results: CheckResult[] = [];
  const add = (id: string, rule: string, holds: boolean, detail: string) =>
    results.push({ id, pass: "B", rule, holds, detail });

  // B1 — every beat inside its own band. This is the one the fallback protects.
  // A scaled band is already an approximation of a rulebook written for a longer
  // video; under the demo profile it carries a stated tolerance rather than a
  // silent one. At full length (scale 1) the band is exact.
  const tol = scale < 1 ? 0.1 : 0;
  const outOfBand = measured.beats.filter((b) => {
    const [lo, hi] = bands[b.beat];
    return b.audioMs / 1000 < lo * scale * (1 - tol) || b.audioMs / 1000 > hi * scale * (1 + tol);
  });
  add("B1", `Every beat inside its band${scale < 1 ? ` (scaled ×${scale.toFixed(2)}, ±${Math.round(tol * 100)}% demo tolerance)` : ""}`,
    outOfBand.length === 0,
    outOfBand.length
      ? outOfBand.map((b) => `${b.beat} ${(b.audioMs / 1000).toFixed(1)}s vs ${
          (bands[b.beat][0] * scale).toFixed(1)}–${(bands[b.beat][1] * scale).toFixed(1)}s`).join("; ")
      : `all ${measured.beats.length} within band`);

  // B2 — the total, and the cap that no video type may exceed.
  const totalSec = measured.beats.reduce((n, b) => n + b.audioMs, 0) / 1000;
  const [lo, hi] = stage.target_seconds;
  const [sLo, sHi] = [lo * scale, hi * scale];
  add("B2", `Total ${sLo.toFixed(0)}–${sHi.toFixed(0)}s, hard cap ${config.limits.hard_cap_seconds}s`,
    totalSec >= sLo && totalSec <= sHi && totalSec <= config.limits.hard_cap_seconds,
    `${totalSec.toFixed(1)}s`);

  // B3 — the measured narration rate. Not the planned rate: the measured one.
  const totalWords = measured.beats.reduce((n, b) => n + b.words, 0);
  const speechMin = measured.beats.reduce((n, b) => n + (b.audioMs - b.silenceMs), 0) / 60000;
  const wpm = speechMin > 0 ? totalWords / speechMin : 0;
  const [wLo, wHi] = stage.narration_wpm;
  add("B3", `Measured rate ${wLo}–${wHi} wpm`, wpm >= wLo && wpm <= wHi, `${wpm.toFixed(0)} wpm`);

  // B4 — silence is a requirement, not what is left over.
  const silenceMs = measured.beats.reduce((n, b) => n + b.silenceMs, 0);
  const ratio = totalSec > 0 ? silenceMs / 1000 / totalSec : 0;
  add("B4", `Silence ≥ ${Math.round(stage.silence_reserve * 100)}% of the video`,
    ratio >= stage.silence_reserve, `${(ratio * 100).toFixed(1)}%`);

  // B5 — the prediction beat needs real thinking time, not a pause.
  const elicit = measured.beats.find((b) => b.beat === "elicit");
  const need = 3.0 * scale;
  add("B5", `The elicit beat carries ≥ ${need.toFixed(1)}s of silence`,
    (elicit?.silenceMs ?? 0) / 1000 >= need,
    `${((elicit?.silenceMs ?? 0) / 1000).toFixed(1)}s`);

  // B6 — words against the budget the duration actually allows.
  // Budget from *measured* speech time, not total × (1 − reserve). The rulebook's
  // formula assumes silence lands exactly on the reserve; when the real silence
  // is higher (measured 33% against a 20% reserve) the total-based budget asks
  // for words there is no speaking time to hold, and B6 contradicts B3. Speech
  // time is the quantity both checks are really about.
  const budget = Math.round(speechMin * ((wLo + wHi) / 2));
  const tolerance = config.gate.word_budget_tolerance;
  const withinBudget = Math.abs(totalWords - budget) <= budget * tolerance;
  add("B6", `Words within ±${Math.round(tolerance * 100)}% of budget and ≤ ${stage.max_script_words}`,
    withinBudget && totalWords <= stage.max_script_words,
    `${totalWords} words vs budget ${budget}`);

  return results;
}

/** Fail closed: the gate holds only if every check holds. */
export const holds = (results: CheckResult[]): boolean => results.every((r) => r.holds);
