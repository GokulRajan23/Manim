/**
 * `npm run calibrate` — measure the real narration rate and pick a voice.
 *
 * plan.md §4.4. Every downstream duration depends on this number.
 *
 * Measured 2026-08-14 across all 21 voices on the account: the floor is 145-148
 * wpm. `eleven_multilingual_v2` hard-enforces speed ∈ [0.7, 1.2], and 0.7 is not
 * slow enough on any voice — every one implied a speed of 0.60-0.61 to reach
 * mid-band. §4.4's first two levers are therefore exhausted, and the rulebook's
 * sek1 band was widened to [120, 150] rather than shipping a known deviation.
 *
 * Re-run this if the voice, the model, or the band changes.
 *
 * This is deliberately *not* part of `npm run doctor`: doctor is meant to be run
 * often, and each measurement spends real characters against a monthly quota.
 * Doctor checks that ELEVENLABS_SPEED exists; this decides what it should be.
 *
 * Usage:
 *   npm run calibrate              # measure the educational voices at 0.85 and 1.0
 *   npm run calibrate -- --voice <id> --speed 0.9
 */
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { workspaceDir } from "../src/lib/db/client";
import { loadRules, stageLimits } from "../src/lib/rules/loader";
import type { Subject } from "../src/lib/rules/schema";

const run = promisify(execFile);

/**
 * Exactly 100 words of the register the lessons actually use — explanatory
 * middle-school mathematics prose. Rate depends on content: a word list is read
 * faster than sentences, and measuring against something unlike the real script
 * would calibrate the wrong thing.
 */
const SAMPLE = `
A straight line climbs at the same rate everywhere along its length. That rate
is what we call the slope. To find it, pick any two points on the line and ask
two questions. How far did the line rise between them, and how far did it run
across? The slope is the rise divided by the run. If the line rises two units
while running four units across, the slope is one half. A steeper line has a
larger slope. A line falling to the right has a negative slope, because the
rise is measured downward instead of upward.
`.trim();

/**
 * The band the rules require — read from the rulebook, never restated here.
 * A hardcoded copy is exactly the drift §3.5 exists to prevent: widening the
 * band in YAML while this script still measured against the old one would make
 * a passing calibration meaningless.
 */
const [WPM_MIN, WPM_MAX] = stageLimits(
  loadRules((process.env.DEEP_LIBRARY_SUBJECT as Subject) ?? "mathematics").config,
  "sek1",
).narration_wpm;
const TARGET = { min: WPM_MIN, max: WPM_MAX } as const;

/** Voices labelled informative_educational on this account, in listing order. */
const CANDIDATES = [
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice (british)" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel (british)" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda (american)" },
  { id: "hpp4J3VqNfWAUOO0d1Us", name: "Bella (american)" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily (british)" },
] as const;

const MODEL = "eleven_multilingual_v2";

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Duration in seconds, measured inside the container.
 *
 * The host has no ffprobe (§4.12), and guessing a duration from the MP3 byte
 * count is exactly the kind of estimate this whole calibration exists to avoid.
 */
async function durationSeconds(file: string, dir: string): Promise<number> {
  const { stdout } = await run(
    "docker",
    [
      "run", "--rm", "--network", "none", "-v", `${dir}:/work`, "-w", "/work",
      "--entrypoint", "ffprobe", process.env.MANIM_IMAGE ?? "tafel-manim:local",
      "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `/work/${file}`,
    ],
    { timeout: 60_000 },
  );
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe returned an unusable duration: ${stdout.trim()}`);
  }
  return seconds;
}

async function synthesise(voiceId: string, speed: number, dir: string): Promise<string> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is unset");

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: SAMPLE,
        model_id: MODEL,
        // `speed` is lever 1 in §4.4. If the model rejects it the request fails
        // here rather than silently returning audio at the default rate, which
        // is the failure mode worth being loud about.
        voice_settings: { stability: 0.5, similarity_boost: 0.75, speed },
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} — ${(await response.text()).slice(0, 300)}`);
  }

  const file = `calib-${voiceId.slice(0, 8)}-${speed}.mp3`;
  writeFileSync(join(dir, file), Buffer.from(await response.arrayBuffer()));
  return file;
}

type Measurement = { voice: string; speed: number; seconds: number; wpm: number };

async function measure(
  voice: { id: string; name: string },
  speed: number,
  dir: string,
  words: number,
): Promise<Measurement> {
  const file = await synthesise(voice.id, speed, dir);
  const seconds = await durationSeconds(file, dir);
  return { voice: voice.name, speed, seconds, wpm: words / (seconds / 60) };
}

async function main(): Promise<void> {
  const words = wordCount(SAMPLE);
  const dir = join(workspaceDir(), "calibration");
  mkdirSync(dir, { recursive: true });

  const argv = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const at = argv.indexOf(`--${name}`);
    return at >= 0 ? argv[at + 1] : undefined;
  };

  const onlyVoice = flag("voice");
  const onlySpeed = flag("speed");

  // §4.4 lever 2 is "a naturally slower voice, chosen by measurement rather than
  // preference". The five informative_educational voices are the sensible
  // shortlist, but exhausting the lever honestly means measuring the whole
  // account, which is what --all does.
  let voices: { id: string; name: string }[] = onlyVoice
    ? [{ id: onlyVoice, name: onlyVoice }]
    : [...CANDIDATES];

  if (argv.includes("--all")) {
    const response = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100", {
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "" },
    });
    if (!response.ok) throw new Error(`voice list: HTTP ${response.status}`);
    const body = (await response.json()) as { voices: { voice_id: string; name: string }[] };
    voices = body.voices.map((v) => ({ id: v.voice_id, name: v.name.split(" - ")[0]! }));
  }
  // 0.7 is ElevenLabs' floor. Measured: these voices run ~180 wpm at speed 1.0,
  // well above the 150-160 §4.4 assumed, so the interesting range is the bottom
  // of the dial — 0.85 was already measured at ~151 wpm and is not enough.
  const speeds = onlySpeed ? [Number(onlySpeed)] : [0.7, 0.8];

  console.log(`\n  Sample: ${words} words, ${MODEL}`);
  console.log(`  Target: ${TARGET.min}–${TARGET.max} wpm (measured)\n`);

  const results: Measurement[] = [];
  for (const voice of voices) {
    for (const speed of speeds) {
      try {
        const result = await measure(voice, speed, dir, words);
        results.push(result);
        const band =
          result.wpm >= TARGET.min && result.wpm <= TARGET.max
            ? "in band"
            : result.wpm > TARGET.max
              ? "TOO FAST"
              : "too slow";
        console.log(
          `  ${result.voice.padEnd(20)} speed ${result.speed.toFixed(2)}  ` +
            `${result.seconds.toFixed(2)}s  ${result.wpm.toFixed(1)} wpm  ${band}`,
        );
      } catch (error) {
        console.log(`  ${voice.name.padEnd(20)} speed ${speed.toFixed(2)}  FAILED — ${
          (error as Error).message.split("\n")[0]
        }`);
      }
    }
  }

  const inBand = results
    .filter((r) => r.wpm >= TARGET.min && r.wpm <= TARGET.max)
    // Closest to the middle of the band leaves the most headroom either way.
    .sort((a, b) => Math.abs(a.wpm - 127.5) - Math.abs(b.wpm - 127.5));

  console.log(`\n  Audio written to ${dir} — listen before committing to a voice.\n`);

  if (inBand.length === 0) {
    // Rate scales close to linearly with `speed`, so a measurement at one speed
    // predicts the setting that would land mid-band. Clamped to ElevenLabs'
    // accepted 0.7–1.2 range; a voice needing less than 0.7 cannot get there on
    // this lever alone and needs lever 2, a naturally slower voice.
    const MID = (TARGET.min + TARGET.max) / 2;
    console.log("  Nothing landed in band. Implied speed to reach mid-band:\n");
    const byVoice = new Map<string, Measurement>();
    for (const r of results) {
      const seen = byVoice.get(r.voice);
      if (!seen || Math.abs(r.wpm - MID) < Math.abs(seen.wpm - MID)) byVoice.set(r.voice, r);
    }
    for (const [voice, r] of byVoice) {
      const implied = (r.speed * MID) / r.wpm;
      const reachable = implied >= 0.7 && implied <= 1.2;
      console.log(
        `  ${voice.padEnd(20)} ${implied.toFixed(2)}` +
          (reachable ? "" : "  — outside 0.7–1.2, needs a slower voice (§4.4 lever 2)"),
      );
    }
    console.log("\n  Re-run with --speed to verify a prediction before trusting it.");
    console.log("  If none is reachable, §4.4 lever 3: document the deviation and");
    console.log("  surface measured wpm in the gate report.\n");
    process.exit(1);
  }

  const best = inBand[0]!;
  console.log(`  Best: ${best.voice} at speed ${best.speed} → ${best.wpm.toFixed(1)} wpm`);
  console.log("  Set these in .env.local:");
  console.log(`    ELEVENLABS_VOICE_ID=${voices.find((v) => v.name === best.voice)?.id ?? "?"}`);
  console.log(`    ELEVENLABS_SPEED=${best.speed}\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
