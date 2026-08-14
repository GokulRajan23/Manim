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
import { appendEvent, recordArtifact, updateLesson } from "@/lib/db/repo";
import { createLessonFromUpload } from "@/lib/pipeline/create-lesson";
import { storyboard } from "@/lib/pipeline/storyboard";
import {
  concat, jobDir, mux, padSilence, probeSeconds, renderBeat, speak, vtt,
} from "@/lib/render/pipeline";
import type { Subject } from "@/lib/rules/schema";

/** The demo profile: short enough to iterate on, long enough to be a lesson. */
const TOTAL_SECONDS = Number(process.env.DEMO_SECONDS ?? 60);

/** Trailing stillness per beat. Small, but the rules never allow zero. */
const HOLD_SECONDS = 1.0;

function log(message: string): void {
  console.log(`  ${new Date().toISOString().slice(11, 19)}  ${message}`);
}

async function main(): Promise<void> {
  const source = process.argv[2];
  if (!source) throw new Error("usage: npm run make -- <file.pdf|photo.jpg> [subject] [klasse]");
  const subject = (process.argv[3] ?? "mathematics") as Subject;
  const klasse = Number(process.argv[4] ?? 8);

  log(`ingest + extract: ${source}`);
  const { lesson, concept } = await createLessonFromUpload({
    subject,
    klasse,
    data: new Uint8Array(readFileSync(source)),
    filename: source.split("/").pop(),
  });
  log(`lesson ${lesson.id} — "${concept.topic}" (${concept.ideaUnits.count} idea units)`);

  log(`storyboard: seven beats, ${TOTAL_SECONDS}s budget`);
  const board = await storyboard(concept, TOTAL_SECONDS, lesson.misconceptionId, HOLD_SECONDS * 7);
  const totalWords = board.beats.reduce((n, b) => n + b.narration.split(/\s+/).length, 0);
  log(`storyboard: ${totalWords} words`);
  updateLesson(lesson.id, { status: "narrating" });

  const dir = jobDir(lesson.id, workspaceDir());
  // The support package travels with the job rather than being baked into the
  // image, so a palette regenerated from the rulebook takes effect immediately.
  cpSync(join(process.cwd(), "docker/python/tafel"), join(dir, "tafel"), { recursive: true });

  const parts: string[] = [];
  const cues: { text: string; seconds: number }[] = [];

  for (const [index, beat] of board.beats.entries()) {
    const name = `beat_${String(index).padStart(2, "0")}`;

    // Audio first, and measured — the duration of everything else follows from it.
    const raw = await speak(dir, name, beat.narration);
    const padded = await padSilence(dir, raw, HOLD_SECONDS);
    const seconds = await probeSeconds(dir, padded);

    const silent = await renderBeat(dir, index, beat, seconds);
    const merged = await mux(dir, silent, padded, `${name}.mp4`);

    const rendered = await probeSeconds(dir, merged);
    log(`${beat.beat.padEnd(12)} audio ${seconds.toFixed(2)}s → video ${rendered.toFixed(2)}s`);

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

  console.log(`\n  lesson.mp4   ${total.toFixed(2)}s  (sum of beats ${expected.toFixed(2)}s, drift ${
    Math.abs(total - expected).toFixed(3)
  }s)`);
  console.log(`  ${join(dir, "lesson.mp4")}\n`);
}

main().catch((error: unknown) => {
  console.error(`\n  FAILED: ${(error as Error).message}\n`);
  process.exit(1);
});
