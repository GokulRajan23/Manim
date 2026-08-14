/**
 * Typed access to the metadata store.
 *
 * This is the only place that knows the database's snake_case column names. Every
 * function here returns camelCase domain objects, so the rest of the app reads and
 * writes one shape and a column rename stays a one-file change.
 */
import { nanoid } from "nanoid";
import { db } from "./client";
import { BEAT_IDS, type BeatId, type Stage, type Subject } from "@/lib/rules/schema";

export const LESSON_STATUSES = [
  "draft",
  "extracting",
  "storyboarding",
  "gating",
  "awaiting_review",
  "narrating",
  "rendering",
  "assembling",
  "ready",
  "failed",
  "gate_blocked",
] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

export const BEAT_STATUSES = [
  "planned",
  "narrated",
  "coding",
  "rendering",
  "rendered",
  "failed",
  "fallback",
] as const;
export type BeatStatus = (typeof BEAT_STATUSES)[number];

export type EventLevel = "info" | "warn" | "error";
export type GatePass = "A" | "B";

export type Lesson = {
  id: string;
  title: string;
  subject: Subject;
  klasse: number;
  stage: Stage;
  lang: string;
  targetSeconds: number;
  ideaUnit: string;
  chainIndex: number;
  chainOf: number;
  chainBridgeIn: string | null;
  misconceptionId: string;
  subjectMeta: unknown | null;
  status: LessonStatus;
  sourcePath: string | null;
  sourceKind: string | null;
  concept: unknown | null;
  measuredWpm: number | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
};

export type NewLesson = {
  title: string;
  subject: Subject;
  klasse: number;
  targetSeconds: number;
  ideaUnit: string;
  misconceptionId: string;
  stage?: Stage;
  lang?: string;
  chainIndex?: number;
  chainOf?: number;
  chainBridgeIn?: string | null;
  subjectMeta?: unknown;
  status?: LessonStatus;
  sourcePath?: string | null;
  sourceKind?: string | null;
};

export type Beat = {
  id: string;
  lessonId: string;
  idx: number;
  beatType: BeatId;
  title: string;
  bandMinMs: number;
  bandMaxMs: number;
  timeline: unknown;
  visualSpec: string;
  onScreenText: string[];
  mathTex: string[];
  isResetBeat: boolean;
  resetType: string | null;
  speechMs: number | null;
  silenceMs: number | null;
  audioMs: number | null;
  audioPath: string | null;
  codePath: string | null;
  videoPath: string | null;
  videoMs: number | null;
  status: BeatStatus;
  attempts: number;
  lastError: string | null;
  fallbackUsed: boolean;
};

export type LessonEvent = {
  id: number;
  lessonId: string;
  ts: number;
  stage: string;
  level: EventLevel;
  beatIdx: number | null;
  message: string;
};

export type GateResult = {
  id: number;
  lessonId: string;
  pass: GatePass;
  checkId: string;
  holds: boolean;
  detail: string | null;
  ts: number;
};

export type Artifact = {
  id: string;
  lessonId: string;
  kind: string;
  path: string;
  bytes: number | null;
  createdAt: number;
};

const now = () => Date.now();
const bool = (value: number) => value === 1;
const json = <T>(value: string | null): T | null =>
  value === null ? null : (JSON.parse(value) as T);

// --- Lessons -----------------------------------------------------------------

type LessonRow = {
  id: string;
  title: string;
  subject: Subject;
  klasse: number;
  stage: Stage;
  lang: string;
  target_seconds: number;
  idea_unit: string;
  chain_index: number;
  chain_of: number;
  chain_bridge_in: string | null;
  misconception_id: string;
  subject_meta: string | null;
  status: LessonStatus;
  source_path: string | null;
  source_kind: string | null;
  concept_json: string | null;
  measured_wpm: number | null;
  error: string | null;
  created_at: number;
  updated_at: number;
};

function toLesson(row: LessonRow): Lesson {
  return {
    id: row.id,
    title: row.title,
    subject: row.subject,
    klasse: row.klasse,
    stage: row.stage,
    lang: row.lang,
    targetSeconds: row.target_seconds,
    ideaUnit: row.idea_unit,
    chainIndex: row.chain_index,
    chainOf: row.chain_of,
    chainBridgeIn: row.chain_bridge_in,
    misconceptionId: row.misconception_id,
    subjectMeta: json(row.subject_meta),
    status: row.status,
    sourcePath: row.source_path,
    sourceKind: row.source_kind,
    concept: json(row.concept_json),
    measuredWpm: row.measured_wpm,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createLesson(input: NewLesson): Lesson {
  const id = nanoid(12);
  const ts = now();
  db()
    .prepare(
      `INSERT INTO lessons (
         id, title, subject, klasse, stage, lang, target_seconds, idea_unit,
         chain_index, chain_of, chain_bridge_in, misconception_id, subject_meta,
         status, source_path, source_kind, created_at, updated_at
       ) VALUES (
         @id, @title, @subject, @klasse, @stage, @lang, @target_seconds, @idea_unit,
         @chain_index, @chain_of, @chain_bridge_in, @misconception_id, @subject_meta,
         @status, @source_path, @source_kind, @created_at, @updated_at
       )`,
    )
    .run({
      id,
      title: input.title,
      subject: input.subject,
      klasse: input.klasse,
      stage: input.stage ?? "sek1",
      lang: input.lang ?? "en",
      target_seconds: input.targetSeconds,
      idea_unit: input.ideaUnit,
      chain_index: input.chainIndex ?? 1,
      chain_of: input.chainOf ?? 1,
      chain_bridge_in: input.chainBridgeIn ?? null,
      misconception_id: input.misconceptionId,
      subject_meta: input.subjectMeta === undefined ? null : JSON.stringify(input.subjectMeta),
      status: input.status ?? "draft",
      source_path: input.sourcePath ?? null,
      source_kind: input.sourceKind ?? null,
      created_at: ts,
      updated_at: ts,
    });
  return getLesson(id)!;
}

export function getLesson(id: string): Lesson | undefined {
  const row = db().prepare("SELECT * FROM lessons WHERE id = ?").get(id) as
    | LessonRow
    | undefined;
  return row && toLesson(row);
}

export function listLessons(limit = 50): Lesson[] {
  // `rowid` breaks the tie: millisecond timestamps are not a total order, and two
  // lessons created in the same millisecond would otherwise list arbitrarily.
  const rows = db()
    .prepare("SELECT * FROM lessons ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .all(limit) as LessonRow[];
  return rows.map(toLesson);
}

/**
 * Patch a lesson. Only the named columns are touched, and `updated_at` always
 * moves — every write goes through here so freshness cannot be forgotten.
 */
export function updateLesson(
  id: string,
  patch: Partial<{
    title: string;
    status: LessonStatus;
    targetSeconds: number;
    ideaUnit: string;
    misconceptionId: string;
    chainIndex: number;
    chainOf: number;
    chainBridgeIn: string | null;
    subjectMeta: unknown;
    sourcePath: string | null;
    sourceKind: string | null;
    concept: unknown;
    measuredWpm: number | null;
    error: string | null;
  }>,
): Lesson | undefined {
  const columns: Record<string, unknown> = {};
  const map: Record<string, string> = {
    title: "title",
    status: "status",
    targetSeconds: "target_seconds",
    ideaUnit: "idea_unit",
    misconceptionId: "misconception_id",
    chainIndex: "chain_index",
    chainOf: "chain_of",
    chainBridgeIn: "chain_bridge_in",
    sourcePath: "source_path",
    sourceKind: "source_kind",
    measuredWpm: "measured_wpm",
    error: "error",
  };
  for (const [key, column] of Object.entries(map)) {
    if (key in patch) columns[column] = patch[key as keyof typeof patch];
  }
  if ("subjectMeta" in patch) columns.subject_meta = JSON.stringify(patch.subjectMeta);
  if ("concept" in patch) columns.concept_json = JSON.stringify(patch.concept);

  if (Object.keys(columns).length > 0) {
    const assignments = Object.keys(columns)
      .map((column) => `${column} = @${column}`)
      .join(", ");
    db()
      .prepare(`UPDATE lessons SET ${assignments}, updated_at = @updated_at WHERE id = @id`)
      .run({ ...columns, id, updated_at: now() });
  }
  return getLesson(id);
}

export function deleteLesson(id: string): void {
  db().prepare("DELETE FROM lessons WHERE id = ?").run(id);
}

// --- Beats -------------------------------------------------------------------

type BeatRow = {
  id: string;
  lesson_id: string;
  idx: number;
  beat_type: BeatId;
  title: string;
  band_min_ms: number;
  band_max_ms: number;
  timeline_json: string;
  visual_spec: string;
  on_screen_text: string | null;
  math_tex: string | null;
  is_reset_beat: number;
  reset_type: string | null;
  speech_ms: number | null;
  silence_ms: number | null;
  audio_ms: number | null;
  audio_path: string | null;
  code_path: string | null;
  video_path: string | null;
  video_ms: number | null;
  status: BeatStatus;
  attempts: number;
  last_error: string | null;
  fallback_used: number;
};

function toBeat(row: BeatRow): Beat {
  return {
    id: row.id,
    lessonId: row.lesson_id,
    idx: row.idx,
    beatType: row.beat_type,
    title: row.title,
    bandMinMs: row.band_min_ms,
    bandMaxMs: row.band_max_ms,
    timeline: JSON.parse(row.timeline_json),
    visualSpec: row.visual_spec,
    onScreenText: json<string[]>(row.on_screen_text) ?? [],
    mathTex: json<string[]>(row.math_tex) ?? [],
    isResetBeat: bool(row.is_reset_beat),
    resetType: row.reset_type,
    speechMs: row.speech_ms,
    silenceMs: row.silence_ms,
    audioMs: row.audio_ms,
    audioPath: row.audio_path,
    codePath: row.code_path,
    videoPath: row.video_path,
    videoMs: row.video_ms,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    fallbackUsed: bool(row.fallback_used),
  };
}

export type NewBeat = {
  idx: number;
  beatType: BeatId;
  title: string;
  bandMinMs: number;
  bandMaxMs: number;
  timeline: unknown;
  visualSpec: string;
  onScreenText?: string[];
  mathTex?: string[];
  isResetBeat?: boolean;
  resetType?: string | null;
  status?: BeatStatus;
};

/**
 * Replace a lesson's beats wholesale, in one transaction.
 *
 * Wholesale rather than incremental because the spine is fixed at seven beats in a
 * mandatory order: a storyboard regeneration replaces all of them, and a partial
 * write would leave a lesson with a spine that cannot pass gate check A3.
 */
export function replaceBeats(lessonId: string, beats: NewBeat[]): Beat[] {
  if (beats.length !== BEAT_IDS.length) {
    throw new Error(
      `A lesson has exactly ${BEAT_IDS.length} beats; got ${beats.length}. ` +
        "The spine is mandatory and no beat is removable.",
    );
  }
  const database = db();
  database.transaction(() => {
    database.prepare("DELETE FROM beats WHERE lesson_id = ?").run(lessonId);
    const insert = database.prepare(
      `INSERT INTO beats (
         id, lesson_id, idx, beat_type, title, band_min_ms, band_max_ms,
         timeline_json, visual_spec, on_screen_text, math_tex, is_reset_beat,
         reset_type, status
       ) VALUES (
         @id, @lesson_id, @idx, @beat_type, @title, @band_min_ms, @band_max_ms,
         @timeline_json, @visual_spec, @on_screen_text, @math_tex, @is_reset_beat,
         @reset_type, @status
       )`,
    );
    for (const beat of beats) {
      insert.run({
        id: nanoid(12),
        lesson_id: lessonId,
        idx: beat.idx,
        beat_type: beat.beatType,
        title: beat.title,
        band_min_ms: beat.bandMinMs,
        band_max_ms: beat.bandMaxMs,
        timeline_json: JSON.stringify(beat.timeline),
        visual_spec: beat.visualSpec,
        on_screen_text: JSON.stringify(beat.onScreenText ?? []),
        math_tex: JSON.stringify(beat.mathTex ?? []),
        is_reset_beat: beat.isResetBeat ? 1 : 0,
        reset_type: beat.resetType ?? null,
        status: beat.status ?? "planned",
      });
    }
  })();
  return listBeats(lessonId);
}

export function listBeats(lessonId: string): Beat[] {
  const rows = db()
    .prepare("SELECT * FROM beats WHERE lesson_id = ? ORDER BY idx")
    .all(lessonId) as BeatRow[];
  return rows.map(toBeat);
}

export function updateBeat(
  lessonId: string,
  idx: number,
  patch: Partial<{
    title: string;
    timeline: unknown;
    visualSpec: string;
    onScreenText: string[];
    mathTex: string[];
    isResetBeat: boolean;
    resetType: string | null;
    speechMs: number | null;
    silenceMs: number | null;
    audioMs: number | null;
    audioPath: string | null;
    codePath: string | null;
    videoPath: string | null;
    videoMs: number | null;
    status: BeatStatus;
    attempts: number;
    lastError: string | null;
    fallbackUsed: boolean;
  }>,
): Beat | undefined {
  const columns: Record<string, unknown> = {};
  const scalars: Record<string, string> = {
    title: "title",
    visualSpec: "visual_spec",
    resetType: "reset_type",
    speechMs: "speech_ms",
    silenceMs: "silence_ms",
    audioMs: "audio_ms",
    audioPath: "audio_path",
    codePath: "code_path",
    videoPath: "video_path",
    videoMs: "video_ms",
    status: "status",
    attempts: "attempts",
    lastError: "last_error",
  };
  for (const [key, column] of Object.entries(scalars)) {
    if (key in patch) columns[column] = patch[key as keyof typeof patch];
  }
  if ("timeline" in patch) columns.timeline_json = JSON.stringify(patch.timeline);
  if ("onScreenText" in patch) columns.on_screen_text = JSON.stringify(patch.onScreenText);
  if ("mathTex" in patch) columns.math_tex = JSON.stringify(patch.mathTex);
  if ("isResetBeat" in patch) columns.is_reset_beat = patch.isResetBeat ? 1 : 0;
  if ("fallbackUsed" in patch) columns.fallback_used = patch.fallbackUsed ? 1 : 0;

  if (Object.keys(columns).length > 0) {
    const assignments = Object.keys(columns)
      .map((column) => `${column} = @${column}`)
      .join(", ");
    db()
      .prepare(
        `UPDATE beats SET ${assignments} WHERE lesson_id = @lesson_id AND idx = @idx`,
      )
      .run({ ...columns, lesson_id: lessonId, idx });
  }
  return listBeats(lessonId).find((b) => b.idx === idx);
}

// --- Events ------------------------------------------------------------------

/**
 * Append a progress event. Fire-and-forget from the pipeline's point of view; the
 * id it returns is what makes `?since=` polling work.
 */
export function appendEvent(
  lessonId: string,
  stage: string,
  message: string,
  options: { level?: EventLevel; beatIdx?: number } = {},
): number {
  const result = db()
    .prepare(
      `INSERT INTO events (lesson_id, ts, stage, level, beat_idx, message)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      lessonId,
      now(),
      stage,
      options.level ?? "info",
      options.beatIdx ?? null,
      message,
    );
  return Number(result.lastInsertRowid);
}

/** Events after `sinceId`, oldest first. `sinceId` of 0 returns the whole log. */
export function listEvents(lessonId: string, sinceId = 0, limit = 500): LessonEvent[] {
  const rows = db()
    .prepare(
      `SELECT * FROM events WHERE lesson_id = ? AND id > ? ORDER BY id LIMIT ?`,
    )
    .all(lessonId, sinceId, limit) as {
    id: number;
    lesson_id: string;
    ts: number;
    stage: string;
    level: EventLevel;
    beat_idx: number | null;
    message: string;
  }[];
  return rows.map((row) => ({
    id: row.id,
    lessonId: row.lesson_id,
    ts: row.ts,
    stage: row.stage,
    level: row.level,
    beatIdx: row.beat_idx,
    message: row.message,
  }));
}

// --- Gate results ------------------------------------------------------------

/** The pass is a parameter of `recordGateResults`, not a property of each result. */
export type NewGateResult = {
  checkId: string;
  holds: boolean;
  /** The measured value, which is what makes the compliance report worth reading. */
  detail?: string | null;
};

/**
 * Record one pass's worth of check results, replacing any previous run of that
 * pass. Replacing matters: the review gate re-runs Pass A after every edit, and the
 * compliance report must show the current verdict, not an accumulated history.
 */
export function recordGateResults(
  lessonId: string,
  pass: GatePass,
  results: NewGateResult[],
): GateResult[] {
  const database = db();
  const ts = now();
  database.transaction(() => {
    database
      .prepare("DELETE FROM gate_results WHERE lesson_id = ? AND pass = ?")
      .run(lessonId, pass);
    const insert = database.prepare(
      `INSERT INTO gate_results (lesson_id, pass, check_id, holds, detail, ts)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const result of results) {
      insert.run(lessonId, pass, result.checkId, result.holds ? 1 : 0, result.detail ?? null, ts);
    }
  })();
  return listGateResults(lessonId);
}

export function listGateResults(lessonId: string, pass?: GatePass): GateResult[] {
  const rows = (
    pass
      ? db()
          .prepare("SELECT * FROM gate_results WHERE lesson_id = ? AND pass = ? ORDER BY id")
          .all(lessonId, pass)
      : db()
          .prepare("SELECT * FROM gate_results WHERE lesson_id = ? ORDER BY id")
          .all(lessonId)
  ) as {
    id: number;
    lesson_id: string;
    pass: GatePass;
    check_id: string;
    holds: number;
    detail: string | null;
    ts: number;
  }[];
  return rows.map((row) => ({
    id: row.id,
    lessonId: row.lesson_id,
    pass: row.pass,
    checkId: row.check_id,
    holds: bool(row.holds),
    detail: row.detail,
    ts: row.ts,
  }));
}

// --- Artifacts ---------------------------------------------------------------

export function recordArtifact(
  lessonId: string,
  kind: string,
  path: string,
  bytes?: number,
): Artifact {
  db()
    .prepare(
      `INSERT INTO artifacts (id, lesson_id, kind, path, bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (lesson_id, kind) DO UPDATE SET
         path = excluded.path, bytes = excluded.bytes, created_at = excluded.created_at`,
    )
    .run(nanoid(12), lessonId, kind, path, bytes ?? null, now());
  return getArtifact(lessonId, kind)!;
}

export function getArtifact(lessonId: string, kind: string): Artifact | undefined {
  const row = db()
    .prepare("SELECT * FROM artifacts WHERE lesson_id = ? AND kind = ?")
    .get(lessonId, kind) as
    | { id: string; lesson_id: string; kind: string; path: string; bytes: number | null; created_at: number }
    | undefined;
  return (
    row && {
      id: row.id,
      lessonId: row.lesson_id,
      kind: row.kind,
      path: row.path,
      bytes: row.bytes,
      createdAt: row.created_at,
    }
  );
}
