/**
 * Running the AST guard before a container is ever started (plan.md §4.8).
 *
 * The guard itself is Python, in `docker/python/tafel/guard.py`, because the only
 * honest way to decide what Python source does is to parse it with Python. This
 * is the thin side that shells out and reads the verdict.
 *
 * The check runs with `--network none` and no volume beyond the file under test.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Violation = { rule: string; detail: string; line: number };

/**
 * Check generated scene source. An empty array means it may be rendered.
 *
 * Every violation is returned, not just the first: the repair loop gets one
 * round to fix everything rather than rediscovering problems one render at a
 * time, and each render is the expensive part.
 */
export async function guard(source: string, tafelDir: string): Promise<Violation[]> {
  const dir = mkdtempSync(join(tmpdir(), "tafel-guard-"));
  writeFileSync(join(dir, "candidate.py"), source);

  const image = process.env.MANIM_IMAGE ?? "tafel-manim:local";
  try {
    const { stdout } = await run(
      "docker",
      [
        "run", "--rm", "--network", "none",
        "-v", `${dir}:/candidate:ro`,
        "-v", `${tafelDir}:/guard/tafel:ro`,
        "-e", "PYTHONPATH=/guard",
        "--entrypoint", "python", image,
        "-m", "tafel.guard", "/candidate/candidate.py",
      ],
      { timeout: 60_000 },
    );
    return JSON.parse(stdout) as Violation[];
  } catch (error) {
    // The guard exits non-zero when it rejects, which `execFile` treats as a
    // failure — the payload is still on stdout and is the actual answer.
    const payload = (error as { stdout?: string }).stdout?.trim();
    if (payload) {
      try {
        return JSON.parse(payload) as Violation[];
      } catch {
        // fall through to the hard failure below
      }
    }
    // The guard could not run at all. Fail closed: unchecked source is not
    // rendered, because "the guard was broken" must never mean "anything goes".
    return [
      {
        rule: "guard-unavailable",
        detail: `the guard could not run: ${(error as Error).message.split("\n")[0]}`,
        line: 0,
      },
    ];
  }
}

/** One line per violation, for a repair prompt or an event log. */
export const describe = (violations: Violation[]): string =>
  violations.map((v) => `line ${v.line}: [${v.rule}] ${v.detail}`).join("\n");
