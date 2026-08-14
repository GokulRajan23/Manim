# Tafel — Lesson Studio

**Rule-compliant slide & video generation for German Gymnasium teachers · Klasse 7–10 · Mathematik / Physik / Chemie**

Hackathon build — Titanium GmbH. Scoped as a **single implementation sprint**: one continuous feature-dev run producing a working, demonstrable pipeline. Everything beyond that scope is in §6, not deleted.

---

## 1. Project Overview

### What it is

Tafel is a teaching platform for German Gymnasium teachers. This document plans the **hero feature: Lesson Studio** — a teacher uploads their own material (a worksheet PDF, a textbook page, a photo of a blackboard), and an agentic pipeline produces a **narrated explainer video** rendered with [Manim](https://www.manim.community/), timed to a synthesised voice-over.

The platform will hold three features. This plan builds one, plus an app shell with navigation placeholders for the other two.

### What makes it different

Not "AI makes a video." The differentiator is that **every video is validated against an explicit, versioned pedagogical rulebook before anything renders.**

`guidelines/rules-{mathematics,physics,chemistry}.md` are authored, owned, and editable by the teaching side. They specify seven mandatory beats, per-beat duration bands, narration rate, mandatory silence, banned phrasing, misconception registers, palette semantics, and a **fail-closed pre-render gate**. A storyboard violating a machine-checkable rule does not render — it returns to the teacher with the failing assertion named.

The competition generates plausible videos. This generates videos that provably follow a didactic method, and can show the audit trail.

### Why it matters

A Gymnasium teacher explaining the intersection of two linear functions has three bad options: redraw it on the board every year, hunt YouTube for something matching their notation, or lose an evening to PowerPoint. Tafel takes the material they already use and produces a step-by-step animated explanation that engages the specific misconception their students actually hold — because the rulebook requires it to.

### The user journey

1. Upload a worksheet PDF or photograph a textbook page.
2. Pick subject and Klasse (7–10).
3. The agent reads the document, extracts the concept, **counts Idea Units**, and reports whether this is one video or a chain.
4. It drafts a **seven-beat storyboard** — anchor, pre-train, elicit, confront, resolve, vary, consolidate — with narration split into speech and mandated silence, and a named misconception from the subject register.
5. **The gate runs.** Failures are shown, not hidden.
6. **The teacher reviews and edits.** Editing here is free; editing after rendering is not.
7. Render: narration synthesised per segment, silence spliced to exact lengths, Manim scene code generated per beat, each rendered in a container, assembled into one MP4 with subtitles.

### Success criteria for the demo

| # | Criterion |
|---|---|
| 1 | A real worksheet goes in; a narrated MP4 comes out, unattended. |
| 2 | Audio and video are **frame-locked** — verifiable by scrubbing to the final second. |
| 3 | **The gate visibly blocks a non-compliant storyboard** and names the rule. The demo's centrepiece. |
| 4 | Output is provably rule-compliant: seven beats in band, ≤300 words, ≥20 % silence, 120–135 wpm, a §7 misconception named and refuted, palette-clean. |
| 5 | **The pipeline cannot hard-fail.** A beat that will not render is replaced by a guaranteed fallback, never a crash. |

### Not in this sprint

Deferred to §6, listed here so nobody builds them by accident:

- **German narration.** English now, German-ready by design (§3.6). The rules already declare `narration_language: en`, `learner_l1: de`.
- `sek2` / Klasse 11–13. Every generation is `sek1`.
- **Klasse 5–6.** The rules define `sek1` as Klasse 7–10 and give no bands, rate, or misconception register below that. Blocked until those sections exist.
- **Multi-link chain generation.** Chains are detected, counted, and surfaced; link 1 is generated.
- The full Manim component library, judgement checks, gate Pass C, PDF/PPTX export, physics and chemistry depth components.
- Authentication, accounts, multi-tenancy, cloud deployment.

---

## 2. Scope Decisions (locked)

| Area | Decision | Rationale |
|---|---|---|
| Repo | Fresh Next.js 16 app at `~/Projects/tafel` | Space-free path — spaces break Docker volume mounts and subprocess args. |
| Stage | **`sek1` only** (Klasse 7–10) | Matches the rules files exactly. One code path, no invented bands. |
| Renderer | Docker, image extends `manimcommunity/manim:stable` | Ships Python 3.12 + ffmpeg + LaTeX. Host has Python 3.14 (unsupported by Manim CE) and **no ffmpeg**. |
| Input | PDF / image upload → concept extraction | Teacher's own material is the differentiator. |
| Rule source | **Prose → prompts · YAML appendix → code** | Each rules file states "Prose above is authoritative; fix this block if they disagree." |
| Gate | **Passes A and B, machine checks, fail closed** | A and B are the compliance claim. Judgement checks and Pass C are §6. |
| Sync | **Audio-first** — video duration derived from measured audio, silence included | Drift becomes structurally impossible. §4.2. |
| Beats | **Exactly 7**, fixed order, per-beat bands | Rules §2, identical across all three subjects. |
| Duration | 130–170 s target, **180 s absolute cap** | Rules §1. Over budget means another video, never faster narration. |
| Narration | 120–135 wpm · ≤300 words · ≥20 % silence | Rules §1, §4. |
| Models | Opus 5 = extraction + storyboard · Sonnet 5 = codegen + repair | Judgment where it matters; speed where beats fan out and retry. |
| Video look | Dark ground `#050315`, **subject rule palettes** | Measured: dark is the better ground for these palettes. §3.2. |
| Carbon | Amended to `#D9D9D9` in `guidelines/rules-chemistry.md` v1.1 | `#2B2B2B` measures 1.44:1 on the dark ground — invisible. |
| Render quality | **`-ql` in the sprint**, `-qm` a one-line switch after | 854×480@15 renders ~3–4× faster than 720p30. Tolerance is frame-derived, so this is safe. §4.11. |
| Manim support code | **Minimal helper module**, not the full library | `palette.py` + `step()` + `cue()` + `RestingFrame` + `fallback.py`. §5.2. |
| Subject exercised | **Mathematics** | Parser handles all three; only maths is driven end to end. §2.1. |
| Exports | **MP4 + VTT** | PDF and PPTX are §6. |
| Storage | SQLite metadata + filesystem artifacts | Real job library, artifacts inspectable while debugging. |
| Progress | 1 s polling against an events table | Stateless: survives refresh, second tab, dev-server restart. |
| Beat failure | Deterministic fallback scene | The video always completes. |

### 2.1 Why mathematics

Manim was built for it — `Axes`, `NumberLine`, `MathTex`, `Transform` are first-class, so maths beats need the least support code to render something correct. Physics needs force diagrams with agent-on-object labelling *and* dual slope/height graph cueing *and* bridging chains. Chemistry needs a compliant particle engine (≥20 particles, thermal motion, solvent, unsuccessful collisions, visible atom conservation) that is a project in itself. Maths gives the most rule compliance per unit of work, and Klasse 7–10 maths is the largest teacher population.

Physics is the runner-up. Chemistry should be last regardless. One-line flip via `DEEP_LIBRARY_SUBJECT`.

---

## 3. Design System

### 3.1 Two palettes, two jurisdictions

**The app UI** uses the brand palette — [realtimecolors.com](https://www.realtimecolors.com/?colors=050315-fbfbfe-2f27ce-dedcff-433bff&fonts=Inter-Inter):

| Token | Hex | Role | Contrast |
|---|---|---|---|
| `SURFACE` | `#FBFBFE` | app background | — |
| `TEXT` | `#050315` | app body text | 19.7:1 on `SURFACE` |
| `PRIMARY` | `#2F27CE` | buttons, links | 8.8:1 on `SURFACE` |
| `SUBTLE` | `#DEDCFF` | secondary surfaces, chips | — |
| `ACCENT` | `#433BFF` | focus rings, active states | — |

**Video frames** use the subject rule palettes, which override brand and stylistic judgement — the rules files say so explicitly. The frame ground is `#050315`, reusing the brand's darkest value so app and output share one visual family without the palettes fighting.

| Mathematics | Hex | Physics | Hex | Chemistry | Hex |
|---|---|---|---|---|---|
| Known quantity | `#4C6EF5` | Force | `#E03131` | Bond forming | `#2F9E44` |
| Unknown quantity | `#F59F00` | Velocity | `#4C6EF5` | Bond breaking | `#E03131` |
| Construction | `#868E96` | Acceleration | `#F59F00` | Energy flow | `#F59F00` |
| Result | `#2F9E44` | Energy | `#2F9E44` | — | |
| Counterexample | `#E03131` | Field | `#7048E8` | — | |
| **Focus accent** | `#F76707` | **Focus accent** | `#F76707` | **Focus accent** | `#F76707` |

Chemistry additionally fixes eight element colours library-wide (rules §5, as amended).

### 3.2 The measured basis for the dark ground

Every rule colour against `#050315`, WCAG 2.1 relative luminance:

| Colour | Ratio | |
|---|---|---|
| `#FFFFFF` hydrogen | 21.0:1 | ✅ |
| `#D9D9D9` carbon *(amended)* | 14.4:1 | ✅ |
| `#F59F00` acceleration / energy flow / unknown | 9.6:1 | ✅ |
| `#F76707` focus accent | 6.7:1 | ✅ |
| `#868E96` construction | 6.1:1 | ✅ |
| `#2F9E44` energy / result / bond forming | 5.9:1 | ✅ |
| `#AB63FA` sodium | 5.7:1 | ✅ |
| `#4C6EF5` velocity / known | 4.7:1 | ✅ |
| `#E03131` force / counterexample / bond breaking | 4.5:1 | ✅ |
| `#7048E8` field | 3.7:1 | ⚠️ graphics only |
| `#3050F8` nitrogen | 3.5:1 | ⚠️ graphics only |
| ~~`#2B2B2B`~~ carbon, unamended | 1.44:1 | ❌ amended |

Only carbon failed. **On a light ground the failures would be worse and more common** — hydrogen `#FFFFFF` at 1.03:1, sulfur `#F5C700` at ~1.8:1, `#F59F00` at 2.07:1 (a role used in all three subjects). Dark is the correct ground for these palettes; CPK carbon was the one thing needing adjustment.

`#7048E8` and `#3050F8` clear WCAG's 3:1 non-text threshold but not the 4.5:1 text threshold: **shapes and strokes only, never labels or equations.** Enforced in the codegen contract.

### 3.3 Palette compliance is structural, not checked

`palette.py` exports **only role-named colours** — `KNOWN`, `UNKNOWN`, `CONSTRUCTION`, `RESULT`, `COUNTEREXAMPLE`, `FOCUS`. The AST guard rejects any raw hex literal in generated code. A palette violation therefore cannot be written, which is stronger than catching it afterwards.

The focus accent `#F76707` is reserved, reachable only through `cue()`, which asserts at most one active cue — satisfying "one cue at a time" and "using it decoratively destroys it" by construction.

### 3.4 Typography

**Inter** for prose. `Text(font="Inter")` silently falls back to DejaVu Sans in the stock image, so `docker/Dockerfile` copies the Inter TTFs and runs `fc-cache`.

Mathematics keeps LaTeX's Computer Modern via `MathTex`. Deliberate: prose in the brand font, mathematics in a mathematical font is correct typography and matches every textbook the learner owns.

On-screen labels are capped at **5 words** (`sek1`), gate-enforced.

### 3.5 Single source of truth

`src/lib/theme/tokens.ts` holds the brand palette. Subject palettes come from the rules YAML, never hardcoded. `npm run gen:theme` emits `docker/python/tafel/palette.py` and `src/app/theme.generated.css`. Editing a palette in a rules file changes the video and nothing else.

### 3.6 German-readiness

1. No user-facing English string hardcoded in a component — all copy in `src/lib/i18n/en.ts`.
2. `lang` is a column on `lessons`, passed to the storyboard prompt and the TTS call. The rules already declare `narration_language: en`, `learner_l1: de`, decimal point on screen, thin-space thousands separator, and the false-friend list (*eventually, actually, sensible, control*) — all parsed from YAML, all German-aware already.
3. `eleven_multilingual_v2` speaks German. Switching is a voice-ID change.

---

## 4. Technical Design

### 4.1 Architecture

```
Next.js 16 (App Router) — one local process
│
├── UI
│   /                        dashboard — 3 feature cards (2 placeholder)
│   /studio                  upload + lesson setup
│   /studio/[id]             storyboard editor · gate report · progress · result
│
├── Route handlers
│   POST   /api/lessons                        upload → job → extraction
│   POST   /api/lessons/:id/storyboard         (re)generate
│   PATCH  /api/lessons/:id/storyboard         persist edits → re-run gate
│   POST   /api/lessons/:id/render             start render (409 if gate not passed)
│   POST   /api/lessons/:id/beats/:idx/retry   re-render one beat
│   GET    /api/lessons/:id/progress           ?since=<eventId>
│   GET    /api/lessons/:id/artifact/:kind     mp4 | vtt
│
└── src/lib/
    ├── rules/       yaml parser · SubjectConfig schema · loader
    ├── gate/        checks/shared.ts · checks/math.ts · runner.ts
    ├── ai/          Anthropic client, model routing, tool-use schemas
    ├── pipeline/    ingest · extract · storyboard · narrate · scene · assemble
    │                orchestrator.ts — in-process job runner
    ├── render/      docker · ffmpeg · ffprobe · reconcile · guard
    ├── tts/         elevenlabs · silence · segments
    ├── db/          schema.sql · client · repo
    ├── theme/       tokens.ts
    └── i18n/        en.ts

docker/python/tafel/     palette.py · helpers.py · fallback.py  (§5.2)
guidelines/              rules-{mathematics,physics,chemistry}.md — the contract
```

**Everything shell-based runs in the container.** The host has no ffmpeg and no ffprobe, so `render/ffmpeg.ts` and `render/ffprobe.ts` shell into the same image rather than calling a host binary. Hard constraint of the target machine.

### 4.2 The sync invariant

> **For every beat *i*: `duration(video_i) == duration(audio_i)`, within one frame, where `audio_i` is the assembled beat track — speech segments *and* mandated silence.**

Folding silence into the audio track is what lets the rules' silence requirements coexist with audio-first sync. A beat's audio is not one MP3 of continuous speech; it is a timeline:

```
Beat 3 "Elicit", band 18–24 s
  speech   "Two lines cross here. Where will they cross if we double the slope?"   9.4 s
  silence  prediction_prompt                                                       3.5 s   ← rules: ≥3.0
  speech   "Commit to an answer before you continue."                              3.1 s
  silence  static_hold                                                             2.0 s
                                                                        audio_ms = 18.0 s
```

`audio_ms` is measured *after* splicing, so it already contains the silence. The video budget is that number. The invariant is untouched.

```
storyboard beat timeline
   │
   ├─► per speech segment ─► ElevenLabs ─► ffprobe
   ├─► per silence gap ────► generated silence of exact length
   │                                    │
   └─► concat ─► beat_NN.mp3 ─► ffprobe ─► audio_ms   ◄── the authority
                                              │
                          band check: audio_ms ∈ [bandMin, bandMax]
                                              │
                              Sonnet 5 codegen (DURATION = audio_ms/1000)
                                              │
                        beat_NN.py ─► Manim ─► beat_NN.silent.mp4 ─► ffprobe
                                              │
                                    reconcile(video_ms, audio_ms)
                                              │
                                  mux ─► beat_NN.mp4   (durations equal)
```

### 4.3 The silence planner

The rules give minimum silences and a global 20 % reserve. Reconciling them:

1. **Mandated silences** placed first: `prediction_prompt ≥ 3.0 s`, `resting_frame ≥ 1.5 s`, `after_transformation ≥ 1.0 s`, `before_reveal ≥ 1.5 s`.
2. **Total silence must reach ≥ 20 % of duration.** For a 150 s video that is 30 s; mandated silences typically total ~12 s.
3. The remainder distributes as `static_hold` gaps after each visual step, **minimum 1.5 s each** — exactly the rules' "hold every new static state ≥ 1.5 s". The reserve and the hold requirement are the same requirement counted two ways.

Word budget follows the rules' formula with silence already subtracted:

```
words_i = ((duration_i − silence_i) / 60) × wpm
```

At 150 s, 30 s silence, 127.5 wpm → **255 words**, matching the rules' own worked figure ("a 2:30 `sek1` video ≈ 250 words").

### 4.4 The narration-rate problem

**The sharpest unverified risk in the plan.** The rules require a *measured* rate of 120–135 wpm. ElevenLabs voices typically speak at 150–160 wpm by default. At 155 wpm the formula yields 310 words, breaking the 300-word cap — the constraint is not satisfiable by budgeting alone. The voice must actually be slowed.

Three levers, in order of preference:

1. `voice_settings.speed` (~0.85) if the model accepts it for `eleven_multilingual_v2`.
2. A naturally slower voice, chosen by measurement rather than preference.
3. Documented deviation, with measured wpm surfaced in the gate report.

`npm run doctor` synthesises a **known 100-word sample and measures actual wpm**, setting `ELEVENLABS_SPEED`. Every downstream duration depends on this number, so it is calibrated in Step 1.

### 4.5 Rules as a machine contract

Each rules file ends with a fenced `yaml` block. `rules/parser.ts` extracts it, Zod-validates it into `SubjectConfig`, and that object drives beat bands, word budgets, silence minimums, palettes, banned-phrase lists, and every machine check.

```ts
SubjectConfig = {
  subject, hard_cap_seconds, idea_units_per_video,
  stages: { sek1: { target_seconds: [130,170], beat_budget_seconds: {...},
                    narration_wpm: [120,135], silence_reserve: 0.20,
                    max_script_words: 300, max_sentence_words: 18,
                    reset_gap_max_seconds: 90, min_reset_beats: 2,
                    max_simultaneous_objects: 5, min_static_hold_seconds: 1.5,
                    max_words_per_label: 5 } },
  spine_beats: [...], reset_beat_types: {...}, silence_minimums_seconds: {...},
  animation_limits: {...}, chains: {...}, method: {...}, palette: {...},
  banned_narration_phrases: {...}, localisation: {...}, gate: {...},
  johnstone?, submicro_rules?, energetics?, element_colours?, curriculum_tags?
}
```

**Prose goes to the model; YAML goes to code.** Anything the YAML can enforce is never left to a prompt. `parser.ts` fails loudly on a rules file whose YAML has drifted from its prose — a drift the files themselves anticipate.

### 4.6 The pre-render gate

**Pass A — post-storyboard, pre-TTS.** Cheapest, catches most, spends no TTS budget.

| | Check |
|---|---|
| A1 | `idea_units == 1` |
| A2 | `duration ≤ 180` and within `[130, 170]` |
| A3 | All seven beats present, correct order, each within its band, beats sum to duration |
| A4 | Estimated words within ±10 % of budget and ≤ 300 |
| A5 | ≥ 2 reset beats, max gap ≤ 90 s, Beat 3 among them |
| A6 | Every sentence ≤ 18 words |
| A7 | Every on-screen label ≤ 5 words; ≤ 5 simultaneous objects |
| A8 | **No on-screen text string appears verbatim in the narration** |
| A9 | Zero banned phrases (subject list — gatekeeping, teleology, evasion, filler) |
| A10 | Misconception declared, and its id exists in the subject's §7 register |
| A11 | `chain.ends_unresolved == false`, `chain.of ≤ 5`, links ≥ 90 s, bridge ≤ 15 words |
| A12 | Chain position present on the resting frame when `chain.of > 1` |
| A13 | Subject declarations present — Grundvorstellung + K/L tags · ≥ 3 representations · Basiskonzept + Johnstone levels |

**Pass B — post-narration, pre-render.** Uses measured audio.

| | Check |
|---|---|
| B1 | Every beat's `audio_ms` inside its band |
| B2 | Beats sum within the target band and under the 180 s cap |
| B3 | Measured narration rate ∈ `[120, 135]` wpm |
| B4 | Total silence / duration ≥ 0.20 |
| B5 | Every prediction beat carries ≥ 3.0 s of contiguous silence |
| B6 | Actual words within ±10 % of budget and ≤ 300 |

**Machine checks cannot be overridden.** A measured 190-second video never renders. Judgement checks (Opus 5 asserting the pedagogy one sentence at a time) and Pass C (frame-differenced static verification, sampled palette compliance) are specified in §6 — Passes A and B are the compliance claim, and they are entirely deterministic.

Colourblind verification (deuteranopia, protanopia) runs as a **unit test over the palettes**, not per render — the palettes are fixed, so checking once per commit is cheaper and stricter.

### 4.7 Pipeline stages

**1 · Ingest.** Store at `workspace/lessons/<id>/source.<ext>`. PDF, PNG, JPEG, HEIC. Cap 25 MB.

**2 · Extract** (Opus 5). The Anthropic API takes PDFs directly as `document` blocks and images as `image` blocks — no PDF library, no OCR service.

```ts
ConceptSpec = {
  subject, klasse: 7..10, topic, summary,
  ideaUnits: { count: number, items: string[] },   // per rules §1 counting rules
  chainProposal: { of: number, links: { title, ideaUnit }[] },
  prerequisites: string[],
  keyTerms: { term, definition }[],
  candidateMisconceptions: { registerId, statement }[],  // MUST come from §7
  workedExample?: { problem, steps: string[] },
  sourceQuotes: string[],
}
```

Two things do real work here. `ideaUnits` applies the rules' counting definition — a new term or symbol to retain, a new relationship between known quantities, an unchunked procedural step, a required representation switch — and **if the count exceeds 1, this is a chain, not a video.** `candidateMisconceptions` must reference the register by id; the agent may not invent one, and A10 enforces it.

**3 · Storyboard** (Opus 5 + full rules prose). Seven beats with speech/silence timelines. Schema in §4.9.

**4 · Gate Pass A.** Fail closed.

**5 · Review gate.** Teacher edits narration, visual specs, on-screen text; adjusts beat durations inside bands. `PATCH` persists and **re-runs Pass A**. Narration segments are hashed, so TTS caching survives edits to unrelated beats.

**6 · Narrate.** Per speech segment: `POST /v1/text-to-speech/{voice_id}`, `model_id: eleven_multilingual_v2`, `output_format: mp3_44100_128`, `voice_settings.speed` from calibration. Silence gaps generated at exact lengths (`anullsrc`). Concatenated to `beat_NN.mp3`, then `ffprobe`d. → **Gate Pass B.**

**7 · Scene codegen + render.** Per beat, parallel, capped at `min(3, floor(cores/2))`:

1. Sonnet 5 writes `beats/beat_NN.py` against the §4.8 contract.
2. **AST guard** — banned imports, raw hex literals, direct multi-animation `self.play`.
3. Docker render.
4. `ffprobe` + reconcile against `audio_ms`.
5. On failure: repair loop ≤ 3 attempts, then fallback scene.

**8 · Assemble.**

```bash
ffmpeg -i beat_NN.silent.mp4 -i beat_NN.mp3 -c:v copy -c:a aac -b:a 128k beat_NN.mp4
ffmpeg -f concat -safe 0 -i concat.txt -c:v libx264 -preset veryfast -crf 20 -c:a aac lesson.mp4
```

Concat re-encodes rather than stream-copying — cheap at this resolution, and it eliminates a class of "streams not identical" failures that are miserable to debug under time pressure.

Also produced: `lesson.vtt`, free given the invariant.

### 4.8 Manim codegen contract

The generated file must satisfy, and the prompt states, all of:

- `from tafel import *` — role-named colours and the helper set (§5.2)
- Exactly one class `Beat`, subclassing `Scene` (or `ThreeDScene` for `scene3d`)
- `DURATION` injected as a module constant; total elapsed time equals it, ending in an explicit final wait
- Allowed imports: `manim`, `numpy`, `tafel`. Nothing else.
- Forbidden: file I/O, network, `os`, `sys`, `subprocess`, `open`, `eval`, `exec`, `__import__`, `SVGMobject`, `ImageMobject`
- **No raw colour literals.** Role names only.
- **One animated change at a time** — use `step()`, never a bare multi-animation `self.play`
- **At most one active cue** — use `cue()`
- `#7048E8` and `#3050F8` for shapes and strokes only, never text (§3.2)
- Maths via `MathTex`; prose via `Text(..., font=FONT)`, ≤ 5 words
- ≤ 5 simultaneous on-screen objects
- Everything inside x ∈ [−7, 7], y ∈ [−4, 4]
- Cumulative build over replacement; on an unavoidable clear, restate what carried over
- End on a resting frame: static, ≥ 1.5 s, chain position when `chain.of > 1`

**The model's arithmetic is never trusted.** It is asked to hit `DURATION`; the output is measured and corrected regardless.

### 4.9 Data model

```sql
CREATE TABLE lessons (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  subject        TEXT NOT NULL,             -- mathematics | physics | chemistry
  klasse         INTEGER NOT NULL,          -- 7..10
  stage          TEXT NOT NULL DEFAULT 'sek1',
  lang           TEXT NOT NULL DEFAULT 'en',
  target_seconds INTEGER NOT NULL,          -- 130..170
  idea_unit      TEXT NOT NULL,             -- the ONE idea
  chain_index    INTEGER NOT NULL DEFAULT 1,
  chain_of       INTEGER NOT NULL DEFAULT 1,
  chain_bridge_in TEXT,                     -- ≤ 15 words
  misconception_id TEXT NOT NULL,           -- must exist in subject §7 register
  subject_meta   TEXT,                      -- Grundvorstellung, K/L, Johnstone, Basiskonzept
  status         TEXT NOT NULL,             -- draft|extracting|storyboarding|gating
                                            -- |awaiting_review|narrating|rendering
                                            -- |assembling|ready|failed|gate_blocked
  source_path    TEXT, source_kind TEXT,
  concept_json   TEXT,
  measured_wpm   REAL,
  error          TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE beats (
  id             TEXT PRIMARY KEY,
  lesson_id      TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  idx            INTEGER NOT NULL,          -- 0..6
  beat_type      TEXT NOT NULL,             -- anchor|pretrain|elicit|confront
                                            -- |resolve|vary|consolidate
  title          TEXT NOT NULL,
  band_min_ms    INTEGER NOT NULL,
  band_max_ms    INTEGER NOT NULL,
  timeline_json  TEXT NOT NULL,             -- speech/silence segments
  visual_spec    TEXT NOT NULL,
  on_screen_text TEXT,                      -- JSON array, ≤ 5 words each
  math_tex       TEXT,                      -- JSON array
  is_reset_beat  INTEGER NOT NULL DEFAULT 0,
  reset_type     TEXT,
  speech_ms      INTEGER, silence_ms INTEGER, audio_ms INTEGER,
  audio_path     TEXT, code_path TEXT, video_path TEXT, video_ms INTEGER,
  status         TEXT NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  fallback_used  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (lesson_id, idx)
);

CREATE TABLE gate_results (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id  TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  pass       TEXT NOT NULL,                 -- A | B
  check_id   TEXT NOT NULL,                 -- A1, B3 …
  holds      INTEGER NOT NULL,
  detail     TEXT,
  ts         INTEGER NOT NULL
);

CREATE TABLE events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id TEXT NOT NULL, ts INTEGER NOT NULL,
  stage     TEXT NOT NULL, level TEXT NOT NULL,   -- info | warn | error
  beat_idx  INTEGER, message TEXT NOT NULL
);
CREATE INDEX idx_events_lesson ON events (lesson_id, id);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, path TEXT NOT NULL, bytes INTEGER,
  created_at INTEGER NOT NULL
);
```

`events` is what makes polling stateless. `gate_results` is what makes compliance auditable — and it is the table the demo screen reads from.

### 4.10 Filesystem layout

```
workspace/lessons/<lessonId>/
├── source.pdf
├── concept.json · storyboard.json · gate.json
├── tafel/                    # helper module, copied per job
├── fallback.py
├── beats/
│   ├── beat_00.py
│   ├── beat_00.seg00.mp3 · beat_00.sil01.mp3 · …
│   ├── beat_00.mp3           # spliced speech + silence
│   ├── beat_00.silent.mp4 · beat_00.mp4
│   └── beat_00.err.txt
├── concat.txt
└── lesson.mp4 · lesson.vtt
```

### 4.11 Duration reconciliation

Tolerance is **one frame, derived from the render frame rate** — 66.7 ms at `-ql` (15 fps), 33.3 ms at `-qm` (30 fps). This is why dropping to `-ql` for speed is safe: the invariant is expressed in frames, not milliseconds.

```
tolerance = ceil(1000 / fps)
target    = audio_ms                      # speech + silence
actual    = ffprobe(beat_NN.silent.mp4)
delta     = target - actual

|delta| ≤ tolerance      → accept
delta > tolerance        → freeze last frame:
                           ffmpeg -vf tpad=stop_mode=clone:stop_duration=<delta>
delta < -tolerance:
   |delta| ≤ 0.25·target → trim tail: ffmpeg -t <target>
   |delta| >  0.25·target → REJECT → repair loop
```

The 25 % guard is the important line. Trimming 40 s off a 15 s beat would silently cut teaching content and produce a video that *looks* fine and *is* wrong. Overshoot beyond a quarter of the budget is a codegen failure, not a rounding error.

Freeze-frame padding is safe in the other direction — a held frame while narration finishes is what a human presenter does, and the rules require exactly that at the resting frame.

### 4.12 Container execution & sandboxing

Generated Python is arbitrary model output. The container is the security boundary.

```bash
docker run --rm --network none --memory 2g --cpus 2 --pids-limit 256 \
  -v <jobdir>:/work -w /work $MANIM_IMAGE \
  manim $MANIM_QUALITY --disable_caching --format mp4 --media_dir /work/media \
        -o beat_00.silent.mp4 beats/beat_00.py Beat
```

`--network none` means a hallucinated `requests.get` fails loudly instead of quietly reaching the internet. Only that job's directory is mounted. `MANIM_QUALITY` is `-ql` (854×480@15) for the sprint, `-qm` (1280×720@30) after. Per-render timeout 180 s; a kill counts as a failed attempt.

### 4.13 Repair loop and fallback

Attempts 1–3. Each failure sends Sonnet 5 the beat spec, the code it wrote, the **last 40 lines of stderr**, and a restatement of the violated rule. Manim tracebacks are long and repetitive with the useful line at the end; sending all of it buries the signal.

`fallback.py` is **hand-written, committed, tested once — never generated.** It reads `fallback.json` (`{ title, mathTex[], bullets[], duration, chainPosition }`) and renders a guaranteed layout timed exactly to `duration`, ending on a compliant resting frame. When a beat exhausts retries, the fallback renders in its place with the original audio untouched. The lesson completes; the beat is flagged.

**This is the load-bearing component of a single-sprint build.** Codegen quality is the one thing a sprint cannot iterate on, so the realistic expectation is that a meaningful share of beats fall back on the first end-to-end run. That is not a failure mode — it is the design absorbing the constraint, and it is why an artifact always exists at the end.

### 4.14 Configuration

```
ANTHROPIC_API_KEY=            ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=          ELEVENLABS_SPEED=0.85      # set by calibration
MANIM_IMAGE=tafel-manim:local MANIM_QUALITY=-ql
RENDER_CONCURRENCY=3          RENDER_TIMEOUT_MS=180000
WORKSPACE_DIR=./workspace     RULES_DIR=./guidelines
DEEP_LIBRARY_SUBJECT=mathematics
MODEL_PLANNER=claude-opus-5   MODEL_CODEGEN=claude-sonnet-5
```

### 4.15 Dependencies

`next@16` · `react@19` · `@anthropic-ai/sdk` · `zod` · `better-sqlite3` · `nanoid` · `yaml` · `tailwindcss@4` · `vitest`

No ffmpeg, Manim, or Python packages on the host. All of that lives in the image.

---

## 5. Development Process

### 5.1 How to execute this plan

**Step 0 comes before everything: start the Docker image pull and build in the background.** `manimcommunity/manim:stable` is roughly a gigabyte and the Inter layer builds on top of it. Steps 1–4 need no container, so the pull should overlap them completely. Kicking it off late is the single most expensive scheduling mistake available in a single-sprint build.

Then work the steps in order. Read the relevant Next 16 docs before writing Next.js code — Next 16's route handler signatures, async request APIs, upload handling, and caching semantics differ from what any model has memorised, and guessing costs more than reading.

Write the test first where behaviour is subtle and cheap to verify: the reconciliation table, the silence planner against the rules' own worked figure, the AST guard, the YAML parser. Build and look where it is UI. Commit at each step boundary so a bad step is one `git reset` rather than a forensic exercise.

### 5.2 Manim support code

`docker/python/tafel/` — hand-written, committed. Deliberately small: the sprint's job is to make the rules *structural* where that is cheap, not to build a component library.

| Piece | Enforces |
|---|---|
| `palette.py` | Role names only — `KNOWN`, `UNKNOWN`, `CONSTRUCTION`, `RESULT`, `COUNTEREXAMPLE`, `FOCUS`. Generated from the rules YAML. Raw hex is an AST-guard error |
| `step(anim, hold=1.5)` | One animated change at a time; asserts a single animation; applies the minimum static hold |
| `cue(target)` | At most one active cue; the only route to the focus accent |
| `label(text, near)` | Labels adjacent to what they label; ≤ 5 words; no legends |
| `RestingFrame(seconds, chain=None)` | Static ≥ 1.5 s, chain position when `of > 1` |
| `fallback.py` | The guaranteed-render scene (§4.13) |

Four helpers and a palette, each individually testable. `ExampleSetStrip`, `CRABridge`, `FadedWorkedExample`, `ForceDiagram`, `GraphWithSlope`, `ParticleField` — the components that would make the rules structural rather than checked — are §6.

### 5.3 Steps

---

#### Step 0 — Background the image pull

Kick off `docker build` for `tafel-manim:local` (base `manimcommunity/manim:stable` + Inter + `fc-cache`). Do not wait on it. Proceed to Step 1.

---

#### Step 1 — Foundation & rules parser

**Goal:** an app that boots, with the rulebook already machine-readable.

**Deliverables:** `create-next-app` scaffold · `src/lib/rules/{parser,schema,loader}.ts` · `src/lib/theme/tokens.ts` + `scripts/gen-theme.ts` · `src/lib/db/{schema.sql,client.ts,repo.ts}` · app shell with nav (Lesson Studio + two placeholder cards) · `scripts/doctor.ts`

**Acceptance:** all three rules files parse into a validated `SubjectConfig` · a rules file with drifted YAML fails loudly · a lesson row round-trips · palette colourblind unit test passes · `npm run dev` renders the dashboard

---

#### Step 2 — Doctor & calibration

**Goal:** the toolchain is verified and the voice is calibrated before anything depends on either.

`npm run doctor` checks: Docker present · image built · `manim --version` · **`ffmpeg` and `ffprobe` inside the image** · LaTeX inside it (render one `MathTex`) · Inter registered (`fc-list`) · Anthropic key · **ElevenLabs: synthesise a known 100-word sample and report measured wpm** · workspace writable.

The ffprobe check matters most — every duration depends on it and the host has neither binary. If absent, `render/ffprobe.ts` falls back to parsing `ffmpeg -i` stderr. The wpm measurement sets `ELEVENLABS_SPEED` (§4.4).

**Acceptance:** all green, measured wpm reported and written to `.env.local`

---

#### Step 3 — Ingest, extraction & Idea Units

**Deliverables:** `/studio` upload form (subject, Klasse 7–10) · `POST /api/lessons` · `pipeline/{ingest,extract}.ts` · `ai/client.ts` with Zod-via-tool-use · `ConceptSpec`

**Acceptance:** a PDF and a photo both yield a valid `ConceptSpec` · `sourceQuotes` genuinely quote the upload · `candidateMisconceptions` reference real §7 register ids · a 3-IU document is reported as a 3-link chain, not crammed into one video · corrupt upload fails with a message, not a stack trace

---

#### Step 4 — Storyboard & silence planner

**Deliverables:** `pipeline/storyboard.ts` · `Storyboard` schema (§4.9) · `tts/silence.ts` — the silence planner (§4.3) · `/studio/[id]` editor: seven fixed beat cards, per-segment narration with live word count and estimated seconds, silence gaps shown with their reason, on-screen text fields, duration bounded to the band · `PATCH /api/lessons/:id/storyboard`

**Acceptance:** exactly seven beats in spine order, each within its band · beats sum inside 130–170 s · estimated words ≤ 300 and within ±10 % of budget · total silence ≥ 20 % · Beat 3 carries ≥ 3.0 s prediction silence · ≥ 2 reset beats with gap ≤ 90 s · edits persist and recompute live

---

#### Step 5 — The gate ← the differentiator

**Deliverables:** `gate/checks/shared.ts` (A1–A13, B1–B6) · `gate/checks/math.ts` · `gate/runner.ts` · gate report UI on `/studio/[id]` showing every check with its measured value and rule reference · `POST /api/lessons/:id/render` returns 409 unless A and B hold

**Acceptance:** a storyboard violating each check fails on exactly that check and no other · a 185 s storyboard is blocked · a storyboard whose on-screen text is read aloud is blocked (A8) · a "clearly, as you can see" narration is blocked (A9) · an invented misconception is blocked (A10) · no check is overridable

The tests here are the plan's real specification. Write them first.

---

#### Step 6 — Narration, silence splicing & Pass B

**Deliverables:** `tts/elevenlabs.ts` with calibrated speed · `tts/segments.ts` — per-segment synthesis, hash-keyed cache · silence generation (`anullsrc`) · `render/ffprobe.ts` · `pipeline/narrate.ts` · Pass B wiring

**Acceptance:** every beat has an `audio_ms` inside its band · measured wpm ∈ [120, 135], or the deviation is surfaced in the gate report · total silence ≥ 20 % · Beat 3 has ≥ 3.0 s contiguous silence verified in the audio, not just the plan · editing one segment re-synthesises exactly that segment

---

#### Step 7 — Support code & fallback

**Deliverables:** `docker/python/tafel/` — `palette.py` (generated), `helpers.py` (`step`, `cue`, `label`, `RestingFrame`), `fallback.py`

**Acceptance:** each helper renders standalone in the container · `step()` raises on multiple simultaneous animations · `cue()` raises on a second active cue · `label()` raises above 5 words · **`fallback.py` renders a full seven-beat lesson end to end at correct durations** — this is the artifact guarantee, so prove it before Step 8

---

#### Step 8 — Codegen, render & repair

**Deliverables:** `render/guard.ts` (AST: banned imports, **raw hex literals**, bare multi-animation `self.play`) · `render/docker.ts` · `render/reconcile.ts` · `pipeline/scene.ts` (codegen + repair) · concurrency limiter

**Acceptance:** seven beats render with any mix of generated and fallback scenes · every output within one frame of its `audio_ms` · a deliberately broken beat recovers via repair · a beat forced to fail three times yields the fallback at the correct duration · the guard rejects `import os` and `#FF0000` without starting a container · a 40 %-overshoot beat routes to repair rather than being trimmed

Note the acceptance criterion does **not** set a generated-vs-fallback ratio. Raising that ratio is a quality loop measured in render cycles, and it is the first thing to continue with after the sprint.

---

#### Step 9 — Assembly & export

**Deliverables:** `render/ffmpeg.ts` (mux, concat, frame extraction, tpad, trim) · `pipeline/assemble.ts` · VTT builder · `GET .../artifact/:kind`

**Acceptance:** `lesson.mp4` duration equals the sum of `audio_ms` within 100 ms · **scrub to the final second: narration and visuals still aligned** · captions track the audio

---

#### Step 10 — Progress, player & audit view

**Deliverables:** `GET .../progress?since=` · `/studio/[id]` gains a live event log, per-beat status with fallback flags, the player with VTT, downloads, per-beat retry, **and the compliance report: every gate check with its measured value**

**Acceptance:** progress updates within ~1 s · **refresh mid-render and progress is intact** · a fallback beat is visibly flagged · per-beat retry re-renders one beat and re-assembles · the compliance report reads from `gate_results`, not a hardcoded list

The compliance report is the screen that makes the pitch. Give it the polish.

---

### 5.4 Testing strategy

**Unit (vitest), test-first:**

- `rules/parser` — all three files parse; drifted YAML fails; a missing required key fails
- `gate/checks/shared` — one passing and one failing fixture per check. The largest and most valuable suite in the project
- `tts/silence` — mandated minimums placed; reserve reaches 20 %; holds ≥ 1.5 s; word budget matches the rules' own worked figure (150 s → ~255 words)
- `render/reconcile` — exact, short by one frame, long by one frame, long by 40 % (must reject), zero-length; correct tolerance at 15 fps and 30 fps
- `render/guard` — accepts clean; rejects `import os`, `open(...)`, a raw hex, a bare multi-animation `self.play`
- narration hashing — whitespace-only change keeps the hash; a real edit changes it
- VTT builder — cumulative offsets correct across seven beats
- **palette colourblind** — deuteranopia and protanopia simulation over all three palettes, asserting pairwise distinguishability

**Integration (manual, marked slow):** a fixture beat plus a fixed-length audio track through the real Docker renderer, asserting duration within one frame. This proves the invariant end to end.

**Always runnable:** `npm run doctor`.

### 5.5 Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Generated Manim scenes are poor or fail** | **High** | Medium | The fallback scene guarantees an artifact regardless (§4.13). Raising the generated-scene ratio is explicitly post-sprint, not a sprint acceptance criterion |
| **Voice cannot hit 120–135 wpm** | **High** | High | Step 2 measures it before anything depends on it; `voice_settings.speed` first, slower voice second, surfaced deviation third (§4.4) |
| **Image pull not finished when Step 7 needs it** | Medium | High | Step 0 backgrounds it; Steps 1–6 need no container |
| Gate too strict — nothing passes | **High** | High | Machine checks are tuned against a real generated storyboard in Step 5, not invented fixtures |
| Seven beats will not fit 130–170 s | Medium | High | Band minima sum to 128 s and maxima to 185 s, so the window is real but narrow — the gate checks per-beat bands **and** the total, and the storyboard prompt is given the arithmetic |
| Image lacks ffprobe | Medium | High | Step 2; documented `ffmpeg -i` stderr fallback |
| Objects overflow the frame | **High** | Medium | Frame bounds in the prompt; ≤ 5 objects enforced |
| Extraction misreads the worksheet | Medium | Medium | `sourceQuotes` grounding; teacher fixes it at the gate before any render cost |

### 5.6 If the sprint runs long

Cut in this order. Every item here degrades the demo without breaking it:

1. Per-beat retry UI (the pipeline still supports it)
2. The live event log (keep the final compliance report)
3. The `label()` and `cue()` helpers (keep `step()` and `RestingFrame` — they carry the animation-limit rules)
4. Gate Pass B checks B4 and B6 (keep B1–B3 and B5 — bands, rate, and prediction silence)
5. Codegen entirely — **run the whole pipeline on fallback scenes only.** Still a complete, frame-locked, rule-compliant, gate-audited video. Plain, but real

**Never cut:** the fallback scene · duration reconciliation · gate Pass A · the storyboard review gate. Those four are what make the demo survivable, correct, compliant, and credible — and the gate is the entire differentiator.

Item 5 deserves emphasis, because it inverts the usual panic response: if codegen is going badly, **stop working on codegen.** A pipeline that reliably produces plain compliant videos demos far better than one that intermittently produces pretty broken ones.

---

## 6. Post-sprint backlog

Specified, deliberately excluded, ordered by value:

1. **Raise the generated-scene ratio.** A quality loop over the codegen prompt, measured in render cycles. The highest-value continuation by a wide margin.
2. **Switch to `-qm`.** One environment variable; tolerance recalculates automatically (§4.11).
3. **The mathematics component library.** `ExampleSetStrip` (four items, non-example mandatory) · `CRABridge` (same instance at two levels side by side) · `FadedWorkedExample` (end-backwards fading, every step carrying a reason) · `DiscreteSet`, `NumberLineModel`, `AreaModel`, `BarModel` · `GrundvorstellungCard`. Each one converts a gate check into a structural guarantee.
4. **Judgement checks.** Opus 5 asserting the §9 judgement list one sentence at a time — elicit–confront–resolve is the real structure · the confrontation *shows* failure · Grundvorstellung named before the first symbol · CRA traversed downward at least once · translation between representations shown live · the two Johnstone levels genuinely connected · the octet rule used as pattern not cause. Overridable with a recorded reason, unlike machine checks.
5. **Gate Pass C.** Frame-differenced verification that resting frames and static holds are genuinely static; sampled key-frame palette compliance.
6. **PDF and PPTX export.** Beat key frames via `ffmpeg -sseof`, `pdf-lib` for one 16:9 page per beat, `pptxgenjs` with narration as speaker notes.
7. **Physics depth components.** `ForceDiagram` (agent-on-object labelling, axes before signs) · `GraphWithSlope` (Δy/Δx drawn even through the origin, slope and height cued separately) · bridging-chain support.
8. **Chemistry depth components.** `ParticleField` — ≥20 particles, thermal motion, phase-correct spacing, solvent, unsuccessful collisions, visible atom conservation, no electron orbits · `LevelBadge`. The bar set by `rules-chemistry.md` §6.3 is unreachable without this, and it is a project rather than a task.
9. **Multi-link chain generation.** Generate all links with forward bridges ≤15 words and chain position on every resting frame.
10. **German narration.** Voice-ID swap plus `lang` threading, already scaffolded (§3.6).
11. **`sek2` (Klasse 11–13).** The config parser is stage-generic already; the gate needs a second code path.
12. **`/library`, accounts, deployment.**

---

## 7. Appendix — prompt skeletons

**Extraction (Opus 5).** System: role as a German Gymnasium subject didactician for the given Klasse; the rules' IU counting definition verbatim; the subject's §7 misconception register as the only permitted source of `candidateMisconceptions`; the requirement to ground every claim in `sourceQuotes`. User: the `document`/`image` block plus subject and Klasse. Output forced through the `ConceptSpec` tool schema.

**Storyboard (Opus 5).** System: the **full prose** of `rules-<subject>.md` — authoritative and short enough to inject whole · the seven beat types with their `sek1` bands · the word budget with silence already subtracted · the silence minimums and their reasons · the reset-beat requirement · the banned-phrase lists · the instruction that on-screen text must never appear verbatim in narration. User: the `ConceptSpec`, the chosen misconception id, chain position, and any teacher focus note. Output forced through the `Storyboard` tool schema.

**Codegen (Sonnet 5).** System: the §4.8 contract · the helper-module reference · the subject's §5 visual grammar · role-named colours with the §3.2 text prohibition · frame bounds. User: the beat — type, title, timeline, visual spec, on-screen text, `mathTex` — and `DURATION`. Output: a single Python file, no prose.

**Repair (Sonnet 5).** The same system prompt, plus the previously generated file, the last 40 lines of stderr, and a restatement of the specific violated rule.
