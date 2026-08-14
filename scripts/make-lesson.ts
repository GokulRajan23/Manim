/**
 * `npm run make -- <file>` — upload to finished MP4, unattended.
 *
 * The whole pipeline end to end: ingest, extract, storyboard, narrate, render,
 * assemble. Scenes are the deterministic beat scene rather than generated code
 * (plan.md §4.13's artifact guarantee), which is what makes this incapable of
 * hard-failing on a bad generation.
 */
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { workspaceDir } from "@/lib/db/client";
import { appendEvent, getLesson, recordArtifact, updateLesson } from "@/lib/db/repo";
import type { ConceptSpec } from "@/lib/pipeline/concept";
import { createLessonFromUpload } from "@/lib/pipeline/create-lesson";
import { createLessonFromTopic } from "@/lib/pipeline/create-lesson";
import { enforce, format, runPassA, runPassB } from "@/lib/gate/runner";
import { beatBands, loadRules } from "@/lib/rules/loader";
import { durationScale } from "@/lib/gate/checks";
import { storyboard } from "@/lib/pipeline/storyboard";
import { findTopic } from "@/lib/pipeline/topics";
import { generateScene } from "@/lib/pipeline/scene";
import {
  concat, jobDir, mux, padSilence, probeSeconds, renderBeat, silenceSeconds, speak, vtt,
} from "@/lib/render/pipeline";
import type { BeatId, Subject } from "@/lib/rules/schema";

/**
 * The demo profile. Short enough to iterate on, long enough to be a lesson.
 *
 * There is a floor here worth knowing about: the rulebook's seven beats have
 * per-beat minima that sum to about 128s at full scale, and each narration
 * segment carries roughly a second of fixed lead-in and tail from the voice.
 * Seven segments pay that seven times, so below about 35s the fixed overhead
 * dominates and the beats stop fitting their own scaled bands.
 */
const TOTAL_SECONDS = Number(process.env.DEMO_SECONDS ?? 35);

/** Minimum trailing stillness per beat. The rules never allow zero. */
const HOLD_SECONDS = 0.5;

/** Step 8 on/off. Off falls back to the deterministic scene for every beat. */
const CODEGEN = process.env.CODEGEN !== "0";

function log(message: string): void {
  console.log(`  ${new Date().toISOString().slice(11, 19)}  ${message}`);
}

async function main(): Promise<void> {
  const source = process.argv[2];
  if (!source) throw new Error("usage: npm run make -- <file.pdf|photo.jpg> [subject] [klasse]");
  const subject = (process.argv[3] ?? "mathematics") as Subject;
  const klasse = Number(process.argv[4] ?? 8);
  void klasse;

  // `lesson:<id>` reuses an already-extracted concept. Extraction is the one
  // non-deterministic stage and the most expensive; re-running it to iterate on
  // the gate or the render would pay for a model call that changed nothing.
  let lesson, concept;
  let visual = "";
  if (source.startsWith("lesson:")) {
    const existing = getLesson(source.slice("lesson:".length));
    if (!existing?.concept) throw new Error(`no stored concept for ${source}`);
    lesson = existing;
    concept = existing.concept as ConceptSpec;
    log(`reusing lesson ${lesson.id}`);
  } else if (source.startsWith("topic:")) {
    // A built-in topic skips ingest and extraction entirely — the concept is
    // hand-authored and already in the shape extraction would have produced.
    const picked = findTopic(source.slice("topic:".length));
    ({ lesson, concept } = createLessonFromTopic(source.slice("topic:".length)));
    visual = picked?.visual ?? "";
    log(`topic ${lesson.id} — Klasse ${lesson.klasse} — diagram "${visual}"`);
  } else {
    log(`ingest + extract: ${source}`);
    ({ lesson, concept } = await createLessonFromUpload({
      subject,
      klasse,
      data: new Uint8Array(readFileSync(source)),
      filename: source.split("/").pop(),
    }));
  }
  log(`lesson ${lesson.id} — "${concept.topic}" (${concept.ideaUnits.count} idea units)`);

  log(`storyboard: seven beats, ${TOTAL_SECONDS}s budget`);
  const cfg = loadRules(subject).config;
  const scale = durationScale(cfg, TOTAL_SECONDS);
  const scaled = Object.fromEntries(
    Object.entries(beatBands(cfg, "sek1")).map(([k, [lo, hi]]) => [k, [lo * scale, hi * scale]]),
  ) as unknown as Record<BeatId, readonly [number, number]>;
  const board = await storyboard(concept, TOTAL_SECONDS, lesson.misconceptionId, HOLD_SECONDS * 7, scaled);
  const totalWords = board.beats.reduce((n, b) => n + b.narration.split(/\s+/).length, 0);
  log(`storyboard: ${totalWords} words`);
  const { config } = loadRules(subject);
  updateLesson(lesson.id, { status: "gating" });
  const a = runPassA(lesson.id, config, {
    beats: board.beats,
    misconceptionId: lesson.misconceptionId,
  }, TOTAL_SECONDS);
  console.log(`\n  GATE PASS A\n${format(a.results)}\n`);
  enforce(a);

  updateLesson(lesson.id, { status: "narrating" });

  const dir = jobDir(lesson.id, workspaceDir());
  // The support package travels with the job rather than being baked into the
  // image, so a palette regenerated from the rulebook takes effect immediately.
  cpSync(join(process.cwd(), "docker/python/tafel"), join(dir, "tafel"), { recursive: true });

  const parts: string[] = [];
  const cues: { text: string; seconds: number }[] = [];
  const measured: { beat: typeof board.beats[number]["beat"]; audioMs: number; silenceMs: number; words: number }[] = [];
  const audio: { name: string; padded: string; seconds: number }[] = [];
  let generatedCount = 0;

  for (const [index, beat] of board.beats.entries()) {
    const name = `beat_${String(index).padStart(2, "0")}`;

    // Audio first, and measured — the duration of everything else follows from it.
    const raw = await speak(dir, name, beat.narration);

    // Silence is planned, not left over (§4.3). A beat whose speech falls short
    // of its band is padded up into it rather than being failed by B1 — the
    // stillness is time the learner gets to think, and the band is where the
    // rulebook says that time belongs. A beat that runs *over* its band cannot
    // be fixed here and is left for the gate to block, which is correct.
    const spoken = await probeSeconds(dir, raw);
    const [bandLo] = scaled[beat.beat];
    const pad = Math.max(HOLD_SECONDS, bandLo - spoken + 0.3);

    const padded = await padSilence(dir, raw, pad);
    const seconds = await probeSeconds(dir, padded);

    measured.push({
      beat: beat.beat,
      audioMs: Math.round(seconds * 1000),
      silenceMs: Math.round((await silenceSeconds(dir, padded)) * 1000),
      words: beat.narration.trim().split(/\s+/).filter(Boolean).length,
    });
    audio.push({ name, padded, seconds });
    log(`${beat.beat.padEnd(12)} narrated ${seconds.toFixed(2)}s`);
  }

  // Pass B runs on measured audio, before a single frame is rendered (§4.6).
  const b = runPassB(lesson.id, config, { beats: measured }, TOTAL_SECONDS);
  console.log(`\n  GATE PASS B\n${format(b.results)}\n`);
  enforce(b);

  updateLesson(lesson.id, { status: "rendering" });
  for (const [index, beat] of board.beats.entries()) {
    const { name, padded, seconds } = audio[index]!;
    // Emphasis walks 0 → 1 across the spine so the figure builds with the
    // explanation instead of arriving complete in the first beat.
    const emphasis = index / (board.beats.length - 1);

    // Step 8: try a generated scene, then fall back. Both the guard and the
    // render are allowed to reject it; only a beat that survives both is used.
    let generated: string | undefined;
    if (CODEGEN) {
      const scene = await generateScene(beat, seconds, join(process.cwd(), "docker/python/tafel"));
      if (scene.code) {
        generated = scene.code;
        appendEvent(lesson.id, "codegen", `${beat.beat}: generated — ${scene.intent}`, { beatIdx: index });
      } else {
        appendEvent(lesson.id, "codegen", `${beat.beat}: fallback — ${scene.problems.join("; ")}`,
          { level: "warn", beatIdx: index });
      }
    }

    let silent: string;
    try {
      // When codegen succeeds the generated scene *is* the diagram; drawing the
      // built-in one underneath would stack two figures in one frame.
      silent = await renderBeat(dir, index, beat, seconds, generated ? "" : visual, emphasis, generated);
      if (generated) generatedCount += 1;
    } catch (error) {
      // The guard passed but manim still refused it. The artifact guarantee is
      // exactly this branch: render the deterministic scene at the same duration.
      // Keep manim's own words: "which beat fell back" is far less useful than
      // "why", and this is the signal the repair loop needs to get better.
      const reason = String((error as { stderr?: string }).stderr ?? (error as Error).message)
        .split("\n")
        .filter((line) => /error|exception|Traceback|not defined|takes|argument/i.test(line))
        .slice(-2)
        .join(" | ")
        .slice(0, 220);
      appendEvent(lesson.id, "render", `${beat.beat}: generated scene failed to render — ${reason}`,
        { level: "warn", beatIdx: index });
      silent = await renderBeat(dir, index, beat, seconds, visual, emphasis);
    }
    const merged = await mux(dir, silent, padded, `${name}.mp4`);
    const rendered = await probeSeconds(dir, merged);
    log(`${beat.beat.padEnd(12)} rendered ${rendered.toFixed(2)}s`);
    parts.push(merged);
    cues.push({ text: beat.narration, seconds: rendered });
  }

  updateLesson(lesson.id, { status: "assembling" });
  log("assemble");
  await concat(dir, parts, "lesson.mp4");
  writeFileSync(join(dir, "lesson.vtt"), vtt(cues));

  const total = await probeSeconds(dir, "lesson.mp4");
  const expected = cues.reduce((n, c) => n + c.seconds, 0);

  recordArtifact(lesson.id, "mp4", join(dir, "lesson.mp4"));
  recordArtifact(lesson.id, "vtt", join(dir, "lesson.vtt"));
  updateLesson(lesson.id, { status: "ready" });
  appendEvent(lesson.id, "assemble", `lesson.mp4 ${total.toFixed(2)}s`);

  console.log(`\n  scenes       ${generatedCount} generated, ${board.beats.length - generatedCount} fallback`);
  console.log(`  lesson.mp4   ${total.toFixed(2)}s  (sum of beats ${expected.toFixed(2)}s, drift ${
    Math.abs(total - expected).toFixed(3)
  }s)`);
  console.log(`  ${join(dir, "lesson.mp4")}\n`);
}

main().catch((error: unknown) => {
  console.error(`\n  FAILED: ${(error as Error).message}\n`);
  process.exit(1);
});
