/**
 * Running the gate and recording what it found (plan.md §4.6).
 *
 * Results go to `gate_results` rather than being returned and forgotten: the
 * compliance report reads from that table, so the screen that makes the pitch is
 * showing what actually ran, not a hardcoded list.
 */
import { recordGateResults } from "@/lib/db/repo";
import { holds, passA, passB, type CheckResult, type MeasuredInput, type StoryboardInput } from "./checks";
import type { SubjectConfig } from "@/lib/rules/schema";

export type GateOutcome = { results: CheckResult[]; holds: boolean };

export class GateBlocked extends Error {
  constructor(readonly failures: CheckResult[]) {
    super(
      `Gate blocked: ${failures.map((f) => `${f.id} (${f.rule}) — ${f.detail}`).join("; ")}`,
    );
    this.name = "GateBlocked";
  }
}

function record(lessonId: string, results: CheckResult[]): void {
  recordGateResults(
    lessonId,
    results[0]?.pass ?? "A",
    results.map((r) => ({ checkId: r.id, holds: r.holds, detail: `${r.rule} — ${r.detail}` })),
  );
}

export function runPassA(
  lessonId: string,
  config: SubjectConfig,
  board: StoryboardInput,
  targetSeconds: number,
): GateOutcome {
  const results = passA(config, board, targetSeconds);
  record(lessonId, results);
  return { results, holds: holds(results) };
}

export function runPassB(
  lessonId: string,
  config: SubjectConfig,
  measured: MeasuredInput,
  targetSeconds: number,
): GateOutcome {
  const results = passB(config, measured, targetSeconds);
  record(lessonId, results);
  return { results, holds: holds(results) };
}

/** Fail closed. Machine checks are never overridable (§4.6). */
export function enforce(outcome: GateOutcome): void {
  if (!outcome.holds) throw new GateBlocked(outcome.results.filter((r) => !r.holds));
}

/** One line per check, measured value included. The compliance report in text form. */
export function format(results: CheckResult[]): string {
  const width = Math.max(...results.map((r) => r.rule.length));
  return results
    .map((r) => `  ${r.holds ? "pass" : "FAIL"}  ${r.id.padEnd(3)} ${r.rule.padEnd(width)}  ${r.detail}`)
    .join("\n");
}
