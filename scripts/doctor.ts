/**
 * `npm run doctor` — verify the toolchain before anything depends on it.
 *
 * plan.md §5.1 and Step 2. The host cannot run this pipeline on its own: it has
 * Python 3.14 (unsupported by Manim CE) and neither ffmpeg nor ffprobe, so every
 * shell-based stage runs in the container. That makes "is the container actually
 * usable" a question worth answering once, loudly, rather than discovering it
 * halfway through a render.
 *
 * Checks are independent and all of them run, so one failure does not hide the
 * next. The exit code is non-zero if any *required* check fails; optional checks
 * report and do not fail the run.
 *
 * Container-internal checks (LaTeX, Inter registration) and the ElevenLabs wpm
 * calibration are added in Step 2, once there is a built image and a key to
 * measure against.
 */
import { execFile } from "node:child_process";
import { accessSync, constants, mkdirSync } from "node:fs";
import { promisify } from "node:util";
import { closeDb, db, workspaceDir } from "../src/lib/db/client";
import { loadAllRules, framePalette, rulesDir, stageLimits } from "../src/lib/rules/loader";
import { SUBJECTS } from "../src/lib/rules/schema";
import { ping, providerName } from "../src/lib/llm/client";
import { contrastRatio } from "../src/lib/theme/color";
import { CONTRAST, FRAME_GROUND } from "../src/lib/theme/tokens";

const run = promisify(execFile);

type Outcome = { ok: boolean; detail: string };
type Check = {
  name: string;
  /** Optional checks report but never fail the run. */
  optional?: boolean;
  probe: () => Promise<Outcome> | Outcome;
};

const ok = (detail: string): Outcome => ({ ok: true, detail });
const bad = (detail: string): Outcome => ({ ok: false, detail });

/** Run a command, returning stdout, or throw with stderr's tail attached. */
async function sh(command: string, args: string[], timeoutMs = 30_000): Promise<string> {
  const { stdout } = await run(command, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

const manimImage = () => process.env.MANIM_IMAGE ?? "tafel-manim:local";

/** Run a command inside the Manim image, with the same isolation the renderer uses. */
const inImage = (args: string[]) =>
  sh("docker", ["run", "--rm", "--network", "none", manimImage(), ...args], 120_000);

const checks: Check[] = [
  {
    name: "node >= 20.9",
    probe: () => {
      const [major, minor] = process.versions.node.split(".").map(Number);
      const supported = major > 20 || (major === 20 && minor >= 9);
      return supported
        ? ok(`v${process.versions.node}`)
        : bad(`v${process.versions.node}; Next 16 requires 20.9 or newer`);
    },
  },
  {
    name: "workspace writable",
    probe: () => {
      const dir = workspaceDir();
      try {
        mkdirSync(dir, { recursive: true });
        accessSync(dir, constants.W_OK);
        return ok(dir);
      } catch (error) {
        return bad(`${dir}: ${(error as Error).message}`);
      }
    },
  },
  {
    name: "rulebook parses",
    probe: () => {
      try {
        const all = loadAllRules();
        const versions = SUBJECTS.map((s) => `${s} v${all[s].config.version}`).join(", ");
        return ok(`${versions} — from ${rulesDir()}`);
      } catch (error) {
        return bad((error as Error).message.split("\n").slice(0, 6).join("\n    "));
      }
    },
  },
  {
    name: "palette contrast",
    probe: () => {
      const failures: string[] = [];
      const graphicsOnly: string[] = [];
      for (const subject of SUBJECTS) {
        for (const [role, hex] of Object.entries(framePalette(loadAllRules()[subject].config))) {
          const ratio = contrastRatio(hex, FRAME_GROUND);
          if (ratio < CONTRAST.GRAPHIC) failures.push(`${subject}.${role} ${ratio.toFixed(2)}:1`);
          else if (ratio < CONTRAST.TEXT) graphicsOnly.push(`${subject}.${role}`);
        }
      }
      if (failures.length > 0) return bad(`below ${CONTRAST.GRAPHIC}:1 — ${failures.join(", ")}`);
      return ok(`all clear on ${FRAME_GROUND}; graphics-only: ${graphicsOnly.join(", ")}`);
    },
  },
  {
    name: "metadata store",
    probe: () => {
      try {
        const tables = db()
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
          .all() as { name: string }[];
        closeDb();
        return ok(tables.map((t) => t.name).filter((n) => !n.startsWith("sqlite_")).join(", "));
      } catch (error) {
        return bad((error as Error).message);
      }
    },
  },
  {
    name: "model gateway reachable",
    probe: async () => {
      // A live round trip, not a presence check: a revoked key is indistinguishable
      // from a good one until something actually calls the gateway. `ping` reports
      // an unset key as a thrown error, which the runner below turns into a FAIL.
      const { ok: reachable, detail } = await ping();
      return reachable ? ok(`${providerName()} — ${detail}`) : bad(`${providerName()} — ${detail}`);
    },
  },
  {
    name: "ElevenLabs reachable",
    probe: async () => {
      const key = process.env.ELEVENLABS_API_KEY;
      if (!key) return bad("ELEVENLABS_API_KEY unset — no narration");
      try {
        const response = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
          headers: { "xi-api-key": key },
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          return bad(`HTTP ${response.status} — ${(await response.text()).slice(0, 160)}`);
        }
        // The character budget is the operative number: narration for a full
        // lesson is a few thousand characters, and the cap is per billing period.
        const plan = (await response.json()) as {
          tier?: string;
          status?: string;
          character_count?: number;
          character_limit?: number;
        };
        const used = plan.character_count ?? 0;
        const limit = plan.character_limit ?? 0;
        return ok(
          `${plan.tier ?? "unknown"} tier, ${plan.status ?? "unknown"} — ` +
            `${(limit - used).toLocaleString()} of ${limit.toLocaleString()} characters left`,
        );
      } catch (error) {
        return bad(firstLine(error));
      }
    },
  },
  {
    name: "narration calibrated",
    probe: () => {
      // Doctor does not re-measure — that spends quota on every run. It checks
      // that a measurement happened and that the speed is one the API accepts,
      // since an out-of-range value fails at synthesis time, deep in a job.
      const voice = process.env.ELEVENLABS_VOICE_ID;
      const speed = Number(process.env.ELEVENLABS_SPEED);
      if (!voice) return bad("ELEVENLABS_VOICE_ID unset — run `npm run calibrate`");
      if (!Number.isFinite(speed)) return bad("ELEVENLABS_SPEED unset or not a number");
      if (speed < 0.7 || speed > 1.2) {
        return bad(`ELEVENLABS_SPEED=${speed} outside the 0.7-1.2 the API accepts`);
      }
      const [lo, hi] = stageLimits(loadAllRules().mathematics.config, "sek1").narration_wpm;
      return ok(`voice ${voice} at speed ${speed}; rulebook band ${lo}-${hi} wpm`);
    },
  },
  {
    name: "docker daemon",
    probe: async () => {
      try {
        return ok(`server ${await sh("docker", ["info", "--format", "{{.ServerVersion}}"])}`);
      } catch {
        return bad("not reachable — start Docker Desktop; nothing renders without it");
      }
    },
  },
  {
    name: `image ${manimImage()}`,
    probe: async () => {
      try {
        // Generous for a metadata read, because every check runs concurrently
        // and the container-based ones can have several images starting at once.
        // Observed: this timing out at 30 s and reporting a built image as
        // missing, while the checks that actually *ran* in it all passed.
        const id = await sh(
          "docker",
          ["image", "inspect", manimImage(), "--format", "{{.Id}}"],
          90_000,
        );
        return ok(id.replace("sha256:", "").slice(0, 12));
      } catch {
        return bad("not built — see docker/Dockerfile");
      }
    },
  },
  {
    name: "manim in image",
    probe: async () => {
      try {
        return ok(await inImage(["manim", "--version"]));
      } catch (error) {
        return bad(firstLine(error));
      }
    },
  },
  {
    name: "ffmpeg + ffprobe in image",
    probe: async () => {
      // The most important check here: every duration in the pipeline is an ffprobe
      // measurement, and the host has neither binary.
      try {
        const ffmpeg = firstLine(await inImage(["ffmpeg", "-version"]));
        const ffprobe = firstLine(await inImage(["ffprobe", "-version"]));
        return ok(`${ffmpeg.split(" version ")[1]?.split(" ")[0] ?? ffmpeg} / ${
          ffprobe.split(" version ")[1]?.split(" ")[0] ?? ffprobe
        }`);
      } catch (error) {
        return bad(firstLine(error));
      }
    },
  },
  {
    name: "Inter in image",
    probe: async () => {
      try {
        // `Text(font="Inter")` falls back to DejaVu Sans when the font is missing
        // rather than raising, so this failure would otherwise reach the screen
        // looking like a successful render (§3.4). fc-match is the honest test:
        // it reports what fontconfig would actually hand back for that name.
        const matched = firstLine(await inImage(["fc-match", "Inter"]));
        return /inter/i.test(matched)
          ? ok(matched)
          : bad(`"Inter" resolves to ${matched} — Text(font="Inter") would silently fall back`);
      } catch (error) {
        return bad(firstLine(error));
      }
    },
  },
  {
    name: "LaTeX in image",
    probe: async () => {
      // Rendering a real MathTex, not just checking pdflatex is on PATH: the
      // path that matters is latex -> dvi -> dvisvgm -> SVG, and a TeX Live
      // missing a style file fails only at that last step.
      const scene = [
        "from manim import *",
        "class Probe(Scene):",
        "    def construct(self):",
        "        self.add(MathTex(r'm = \\frac{\\Delta y}{\\Delta x}'))",
      ].join("\n");
      // Base64 rather than quoting the source into `sh -c`: the scene contains
      // backslashes, quotes and newlines, all of which a shell would mangle.
      const encoded = Buffer.from(scene, "utf8").toString("base64");
      try {
        await sh(
          "docker",
          [
            "run", "--rm", "--network", "none", "--entrypoint", "sh", manimImage(),
            "-c",
            `mkdir -p /tmp/p && cd /tmp/p && echo ${encoded} | base64 -d > p.py && ` +
              `manim -ql --disable_caching --format png -s --media_dir /tmp/p/media p.py Probe`,
          ],
          180_000,
        );
        return ok("MathTex renders (latex → dvisvgm)");
      } catch (error) {
        // Manim reports a missing style file or a TeX error on stderr many lines
        // in, so the first line alone is rarely the useful one.
        const text = error instanceof Error ? error.message : String(error);
        const tex = text
          .split("\n")
          .find((line) => /latex|tex |\.sty|dvisvgm/i.test(line));
        return bad(tex?.trim() ?? firstLine(error));
      }
    },
  },
];

function firstLine(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text.split("\n")[0]!.trim();
}

async function main(): Promise<void> {
  // All of them, concurrently: one failure must not hide the next.
  const results = await Promise.all(
    checks.map(async (check) => {
      try {
        return { check, outcome: await check.probe() };
      } catch (error) {
        return { check, outcome: bad(firstLine(error)) };
      }
    }),
  );

  const width = Math.max(...checks.map((c) => c.name.length));
  let required = 0;

  for (const { check, outcome } of results) {
    const mark = outcome.ok ? "ok  " : check.optional ? "note" : "FAIL";
    console.log(`  ${mark}  ${check.name.padEnd(width)}  ${outcome.detail}`);
    if (!outcome.ok && !check.optional) required += 1;
  }

  console.log(
    required === 0
      ? "\n  All required checks passed."
      : `\n  ${required} required check${required === 1 ? "" : "s"} failed.`,
  );

  process.exit(required === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
