/**
 * Narrate → render → assemble (plan.md §4.7 stages 6–8), demo profile.
 *
 * The sync invariant in one place: each beat's narration is synthesised first and
 * *measured* with ffprobe, and that measurement becomes the scene's `DURATION`.
 * Video is therefore never fitted to video — it is cut to the length the audio
 * actually is, which is why scrubbing to the final second still lines up (§4.2).
 *
 * Every shell stage runs in the container: the host has no ffmpeg, no ffprobe and
 * a Python that Manim CE does not support (§4.12).
 */
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { StoryboardBeat } from "@/lib/pipeline/storyboard";

const run = promisify(execFile);
const image = () => process.env.MANIM_IMAGE ?? "tafel-manim:local";

/** Run a command inside the image with the job directory mounted at /work. */
async function inImage(dir: string, args: string[], timeoutMs = 300_000): Promise<string> {
  const { stdout } = await run(
    "docker",
    ["run", "--rm", "--network", "none", "-v", `${dir}:/work`, "-w", "/work", ...args],
    { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
  );
  return stdout.trim();
}

const ffmpeg = (dir: string, args: string[]) =>
  inImage(dir, ["--entrypoint", "ffmpeg", image(), "-v", "error", "-y", ...args]);

/** Duration in seconds, measured — never estimated. */
export async function probeSeconds(dir: string, file: string): Promise<number> {
  const out = await inImage(dir, [
    "--entrypoint", "ffprobe", image(),
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `/work/${file}`,
  ], 60_000);
  const seconds = Number(out);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`bad duration for ${file}: ${out}`);
  return seconds;
}

/**
 * Total silence in an audio file, in seconds — measured, not assumed.
 *
 * The gate's silence checks are only honest if silence means "the learner hears
 * nothing", which includes the pauses inside the synthesised speech, not just the
 * padding we added. Assuming only our own padding counted understated silence by
 * more than half and pushed the measured narration rate below the rulebook floor
 * — a failure that was an artefact of the measurement, not of the lesson.
 *
 * -35 dB over 0.3 s: quiet enough to ignore breath noise, long enough that a gap
 * between words does not register as thinking time.
 */
export async function silenceSeconds(dir: string, file: string): Promise<number> {
  const { stderr } = await run(
    "docker",
    [
      "run", "--rm", "--network", "none", "-v", `${dir}:/work`, "-w", "/work",
      "--entrypoint", "ffmpeg", image(),
      "-i", `/work/${file}`, "-af", "silencedetect=noise=-35dB:d=0.3", "-f", "null", "-",
    ],
    { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
  ).catch((error: { stderr?: string }) => ({ stderr: error.stderr ?? "" }));

  let total = 0;
  for (const match of (stderr ?? "").matchAll(/silence_duration:\s*([\d.]+)/g)) {
    total += Number(match[1]);
  }
  return total;
}

/** Synthesise one narration segment to `dir/<name>.mp3`. */
export async function speak(dir: string, name: string, text: string): Promise<string> {
  const key = process.env.ELEVENLABS_API_KEY;
  const voice = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voice) throw new Error("ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID are required");

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          speed: Number(process.env.ELEVENLABS_SPEED ?? 0.7),
        },
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok) throw new Error(`ElevenLabs ${response.status}: ${(await response.text()).slice(0, 200)}`);

  const file = `${name}.mp3`;
  writeFileSync(join(dir, file), Buffer.from(await response.arrayBuffer()));
  return file;
}

/**
 * Pad a narration segment with trailing silence.
 *
 * The rules require stillness the narration does not fill — a beat that is pure
 * speech from first frame to last gives the learner nowhere to think. Padding
 * after the speech is also what gives the prediction beat its silence.
 */
export async function padSilence(dir: string, file: string, seconds: number): Promise<string> {
  const out = file.replace(/\.mp3$/, ".padded.mp3");
  await ffmpeg(dir, ["-i", `/work/${file}`, "-af", `apad=pad_dur=${seconds.toFixed(2)}`, `/work/${out}`]);
  return out;
}

/** Write and render one beat's scene at exactly `seconds`. */
export async function renderBeat(
  dir: string,
  index: number,
  beat: StoryboardBeat,
  seconds: number,
): Promise<string> {
  const name = `beat_${String(index).padStart(2, "0")}`;
  // `Beat` must be *defined* here: Manim ignores an imported Scene subclass and
  // reports "there are no scenes inside that module".
  const py = [
    "from tafel.beat import BeatBase",
    "",
    "",
    "class Beat(BeatBase):",
    `    TITLE = ${JSON.stringify(title(beat))}`,
    `    LINES = ${JSON.stringify(beat.onScreen.slice(0, 3))}`,
    `    ROLE = ${JSON.stringify(beat.role)}`,
    `    DURATION = ${seconds.toFixed(3)}`,
    "",
  ].join("\n");
  writeFileSync(join(dir, `${name}.py`), py);

  await inImage(dir, [
    "-e", "PYTHONPATH=/work",
    image(),
    "manim", process.env.MANIM_QUALITY ?? "-ql", "--disable_caching", "--format", "mp4",
    "--media_dir", "/work/media", "-o", `${name}.silent.mp4`, `${name}.py`, "Beat",
  ]);

  return `media/videos/${name}/480p15/${name}.silent.mp4`;
}

/** Beat titles are the teacher-facing spine names, capped at a readable length. */
function title(beat: StoryboardBeat): string {
  const words = beat.beat.charAt(0).toUpperCase() + beat.beat.slice(1);
  return words;
}

/** Mux one beat's video with its audio. */
export async function mux(dir: string, video: string, audio: string, out: string): Promise<string> {
  await ffmpeg(dir, [
    "-i", `/work/${video}`, "-i", `/work/${audio}`,
    "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", `/work/${out}`,
  ]);
  return out;
}

/**
 * Concatenate the beats into the finished lesson.
 *
 * Re-encodes rather than stream-copying: cheap at this resolution, and it removes
 * a class of "streams not identical" failures that are miserable to debug (§4.7).
 */
export async function concat(dir: string, parts: string[], out: string): Promise<string> {
  writeFileSync(join(dir, "concat.txt"), parts.map((p) => `file '/work/${p}'`).join("\n"));
  await ffmpeg(dir, [
    "-f", "concat", "-safe", "0", "-i", "/work/concat.txt",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", `/work/${out}`,
  ]);
  return out;
}

/** WebVTT, free given the invariant: cumulative offsets are already known. */
export function vtt(segments: { text: string; seconds: number }[]): string {
  const stamp = (t: number) => {
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = (t % 60).toFixed(3).padStart(6, "0");
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s}`;
  };
  let at = 0;
  const cues = segments.map((segment, index) => {
    const start = at;
    at += segment.seconds;
    return `${index + 1}\n${stamp(start)} --> ${stamp(at)}\n${segment.text}\n`;
  });
  return `WEBVTT\n\n${cues.join("\n")}`;
}

export function jobDir(lessonId: string, workspace: string): string {
  const dir = join(workspace, "lessons", lessonId);
  mkdirSync(dir, { recursive: true });
  return dir;
}
