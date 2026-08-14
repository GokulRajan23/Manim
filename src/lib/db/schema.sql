-- Tafel metadata store — plan.md §4.9.
--
-- SQLite holds metadata; the filesystem holds artifacts (plan.md §2). Two tables
-- here are load-bearing beyond mere record-keeping:
--
--   `events`      is what makes progress polling stateless. The client asks for
--                 everything after an id it already has, so a refresh, a second
--                 tab, or a dev-server restart all resume correctly.
--   `gate_results` is what makes compliance auditable, and is the table the
--                 compliance report reads from. Nothing about that screen is
--                 hardcoded.
--
-- Idempotent: safe to run on every boot.

CREATE TABLE IF NOT EXISTS lessons (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  subject          TEXT NOT NULL,                    -- mathematics | physics | chemistry
  klasse           INTEGER NOT NULL,                 -- 7..10 this sprint; sek2 is deferred
  stage            TEXT NOT NULL DEFAULT 'sek1',
  lang             TEXT NOT NULL DEFAULT 'en',       -- German-readiness; see plan.md §3.6
  target_seconds   INTEGER NOT NULL,                 -- 130..170
  idea_unit        TEXT NOT NULL,                    -- the ONE idea this video teaches
  chain_index      INTEGER NOT NULL DEFAULT 1,
  chain_of         INTEGER NOT NULL DEFAULT 1,
  chain_bridge_in  TEXT,                             -- <= 15 words
  misconception_id TEXT NOT NULL,                    -- must resolve in the subject register
  subject_meta     TEXT,                             -- JSON: Grundvorstellung, K/L, Johnstone, Basiskonzept
  status           TEXT NOT NULL,
  source_path      TEXT,
  source_kind      TEXT,
  concept_json     TEXT,
  measured_wpm     REAL,
  error            TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,

  CHECK (klasse BETWEEN 7 AND 13),
  CHECK (chain_index >= 1 AND chain_index <= chain_of),
  CHECK (subject IN ('mathematics', 'physics', 'chemistry')),
  CHECK (stage IN ('sek1', 'sek2')),
  CHECK (status IN (
    'draft', 'extracting', 'storyboarding', 'gating', 'awaiting_review',
    'narrating', 'rendering', 'assembling', 'ready', 'failed', 'gate_blocked'
  ))
);

CREATE TABLE IF NOT EXISTS beats (
  id             TEXT PRIMARY KEY,
  lesson_id      TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  idx            INTEGER NOT NULL,                   -- 0..6, spine order
  beat_type      TEXT NOT NULL,
  title          TEXT NOT NULL,
  band_min_ms    INTEGER NOT NULL,
  band_max_ms    INTEGER NOT NULL,
  timeline_json  TEXT NOT NULL,                      -- JSON: speech and silence segments
  visual_spec    TEXT NOT NULL,
  on_screen_text TEXT,                               -- JSON array, <= 5 words each
  math_tex       TEXT,                               -- JSON array
  is_reset_beat  INTEGER NOT NULL DEFAULT 0,
  reset_type     TEXT,
  speech_ms      INTEGER,
  silence_ms     INTEGER,
  audio_ms       INTEGER,                            -- measured, and the authority for video length
  audio_path     TEXT,
  code_path      TEXT,
  video_path     TEXT,
  video_ms       INTEGER,
  status         TEXT NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  fallback_used  INTEGER NOT NULL DEFAULT 0,

  UNIQUE (lesson_id, idx),
  CHECK (idx BETWEEN 0 AND 6),
  CHECK (beat_type IN (
    'anchor', 'pretrain', 'elicit', 'confront', 'resolve', 'vary', 'consolidate'
  )),
  CHECK (band_min_ms <= band_max_ms)
);

CREATE TABLE IF NOT EXISTS gate_results (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  pass      TEXT NOT NULL,                           -- A | B
  check_id  TEXT NOT NULL,                           -- A1, B3, ...
  holds     INTEGER NOT NULL,
  detail    TEXT,                                    -- the measured value, for the report
  ts        INTEGER NOT NULL,

  CHECK (pass IN ('A', 'B')),
  CHECK (holds IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_gate_results_lesson ON gate_results (lesson_id, id);

CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  ts        INTEGER NOT NULL,
  stage     TEXT NOT NULL,
  level     TEXT NOT NULL,                           -- info | warn | error
  beat_idx  INTEGER,
  message   TEXT NOT NULL,

  CHECK (level IN ('info', 'warn', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_events_lesson ON events (lesson_id, id);

CREATE TABLE IF NOT EXISTS artifacts (
  id         TEXT PRIMARY KEY,
  lesson_id  TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,                          -- mp4 | vtt | ...
  path       TEXT NOT NULL,
  bytes      INTEGER,
  created_at INTEGER NOT NULL,

  UNIQUE (lesson_id, kind)
);
