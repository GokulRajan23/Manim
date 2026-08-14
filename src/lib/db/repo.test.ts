/**
 * Round-trip tests for the metadata store, against an in-memory database.
 *
 * These cover the two things that bite later: the camelCase/snake_case boundary
 * (a mistyped column name here surfaces as a silently null field three steps down
 * the pipeline) and the schema's CHECK constraints, which are the last line of
 * defence for invariants the rulebook cares about.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "./client";
import {
  appendEvent,
  createLesson,
  deleteLesson,
  getArtifact,
  getLesson,
  listBeats,
  listEvents,
  listGateResults,
  listLessons,
  recordArtifact,
  recordGateResults,
  replaceBeats,
  updateBeat,
  updateLesson,
  type NewBeat,
  type NewLesson,
} from "./repo";
import { BEAT_IDS } from "@/lib/rules/schema";

process.env.DATABASE_PATH = ":memory:";

const aLesson: NewLesson = {
  title: "Where two lines cross",
  subject: "mathematics",
  klasse: 8,
  targetSeconds: 150,
  ideaUnit: "The intersection of two linear functions is the pair satisfying both",
  misconceptionId: "a_graph_s_height_is_confused_with_its_slope",
};

/** Seven beats in spine order, with the real sek1 bands. */
const sevenBeats = (): NewBeat[] => {
  const bands: [number, number][] = [
    [12, 18],
    [12, 18],
    [18, 24],
    [22, 32],
    [40, 55],
    [12, 20],
    [12, 18],
  ];
  return BEAT_IDS.map((beatType, idx) => ({
    idx,
    beatType,
    title: `Beat ${idx}`,
    bandMinMs: bands[idx][0] * 1000,
    bandMaxMs: bands[idx][1] * 1000,
    timeline: [{ kind: "speech", text: "..." }],
    visualSpec: "axes with two lines",
    isResetBeat: beatType === "elicit",
    resetType: beatType === "elicit" ? "prediction" : null,
  }));
};

beforeEach(() => {
  closeDb(); // a fresh :memory: database per test
});

describe("lessons", () => {
  it("round-trips every field", () => {
    const created = createLesson({
      ...aLesson,
      chainIndex: 2,
      chainOf: 3,
      chainBridgeIn: "You found where the lines meet.",
      subjectMeta: { grundvorstellung: "covariation", kompetenzen: ["K4"] },
      sourcePath: "workspace/lessons/abc/source.pdf",
      sourceKind: "pdf",
    });

    const read = getLesson(created.id);
    expect(read).toEqual(created);
    expect(read!.title).toBe(aLesson.title);
    expect(read!.klasse).toBe(8);
    expect(read!.chainOf).toBe(3);
    expect(read!.chainBridgeIn).toBe("You found where the lines meet.");
    expect(read!.subjectMeta).toEqual({ grundvorstellung: "covariation", kompetenzen: ["K4"] });
    expect(read!.sourceKind).toBe("pdf");
  });

  it("defaults to a sek1 English draft in a chain of one", () => {
    const lesson = createLesson(aLesson);
    expect(lesson.stage).toBe("sek1");
    expect(lesson.lang).toBe("en");
    expect(lesson.status).toBe("draft");
    expect(lesson.chainIndex).toBe(1);
    expect(lesson.chainOf).toBe(1);
    expect(lesson.measuredWpm).toBeNull();
  });

  it("patches only the named columns and always moves updated_at", () => {
    const lesson = createLesson(aLesson);
    const patched = updateLesson(lesson.id, { status: "awaiting_review", measuredWpm: 127.4 })!;

    expect(patched.status).toBe("awaiting_review");
    expect(patched.measuredWpm).toBeCloseTo(127.4);
    expect(patched.title).toBe(lesson.title); // untouched
    expect(patched.updatedAt).toBeGreaterThanOrEqual(lesson.updatedAt);
    expect(patched.createdAt).toBe(lesson.createdAt);
  });

  it("stores the extracted concept as JSON", () => {
    const lesson = createLesson(aLesson);
    const concept = { topic: "Linear functions", ideaUnits: { count: 1, items: ["intersection"] } };
    expect(updateLesson(lesson.id, { concept })!.concept).toEqual(concept);
  });

  it("lists newest first", () => {
    const first = createLesson(aLesson);
    const second = createLesson({ ...aLesson, title: "Second" });
    expect(listLessons().map((l) => l.id).slice(0, 2)).toEqual([second.id, first.id]);
  });

  it("returns undefined for an unknown id rather than throwing", () => {
    expect(getLesson("nope")).toBeUndefined();
  });

  it("refuses a Klasse outside 7-13", () => {
    // Klasse 5-6 is blocked because the rules define no bands below sek1 (plan.md §1).
    expect(() => createLesson({ ...aLesson, klasse: 6 })).toThrow(/CHECK constraint/);
  });

  it("refuses a status outside the pipeline's state machine", () => {
    expect(() =>
      createLesson({ ...aLesson, status: "almost_done" as never }),
    ).toThrow(/CHECK constraint/);
  });

  it("refuses a chain position outside its own chain", () => {
    expect(() => createLesson({ ...aLesson, chainIndex: 4, chainOf: 3 })).toThrow(
      /CHECK constraint/,
    );
  });
});

describe("beats", () => {
  it("round-trips a full seven-beat spine in order", () => {
    const lesson = createLesson(aLesson);
    const written = replaceBeats(lesson.id, sevenBeats());

    expect(written.map((b) => b.beatType)).toEqual([...BEAT_IDS]);
    expect(written.map((b) => b.idx)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(written[4].bandMinMs).toBe(40_000);
    expect(written[2].isResetBeat).toBe(true);
    expect(written[2].resetType).toBe("prediction");
    expect(written[0].isResetBeat).toBe(false);
    expect(written[0].timeline).toEqual([{ kind: "speech", text: "..." }]);
    expect(written[0].onScreenText).toEqual([]);
  });

  it("refuses a spine that is not exactly seven beats", () => {
    const lesson = createLesson(aLesson);
    expect(() => replaceBeats(lesson.id, sevenBeats().slice(0, 6))).toThrow(
      /exactly 7 beats/,
    );
  });

  it("replaces wholesale rather than accumulating", () => {
    const lesson = createLesson(aLesson);
    replaceBeats(lesson.id, sevenBeats());
    replaceBeats(lesson.id, sevenBeats().map((b) => ({ ...b, title: `Redone ${b.idx}` })));

    const beats = listBeats(lesson.id);
    expect(beats).toHaveLength(7);
    expect(beats[3].title).toBe("Redone 3");
  });

  it("records measured audio and render results per beat", () => {
    const lesson = createLesson(aLesson);
    replaceBeats(lesson.id, sevenBeats());

    const updated = updateBeat(lesson.id, 2, {
      speechMs: 12_500,
      silenceMs: 5_500,
      audioMs: 18_000,
      audioPath: "beats/beat_02.mp3",
      status: "narrated",
    })!;

    expect(updated.audioMs).toBe(18_000);
    expect(updated.speechMs! + updated.silenceMs!).toBe(updated.audioMs);
    expect(updated.status).toBe("narrated");
    expect(updated.fallbackUsed).toBe(false);
  });

  it("flags a beat that fell back", () => {
    const lesson = createLesson(aLesson);
    replaceBeats(lesson.id, sevenBeats());
    const beat = updateBeat(lesson.id, 5, {
      status: "fallback",
      fallbackUsed: true,
      attempts: 3,
      lastError: "Manim exited 1: NameError",
    })!;
    expect(beat.fallbackUsed).toBe(true);
    expect(beat.attempts).toBe(3);
    expect(beat.lastError).toContain("NameError");
  });

  it("refuses a beat type outside the spine", () => {
    const lesson = createLesson(aLesson);
    const beats = sevenBeats();
    beats[0] = { ...beats[0], beatType: "intro" as never };
    expect(() => replaceBeats(lesson.id, beats)).toThrow(/CHECK constraint/);
  });

  it("goes away when its lesson does", () => {
    const lesson = createLesson(aLesson);
    replaceBeats(lesson.id, sevenBeats());
    deleteLesson(lesson.id);
    expect(listBeats(lesson.id)).toEqual([]);
  });
});

describe("events", () => {
  it("returns only what the caller has not seen, which is what makes polling stateless", () => {
    const lesson = createLesson(aLesson);
    appendEvent(lesson.id, "extract", "Read 2 pages");
    const second = appendEvent(lesson.id, "storyboard", "Drafted seven beats");
    appendEvent(lesson.id, "render", "Beat 3 failed", { level: "error", beatIdx: 3 });

    expect(listEvents(lesson.id)).toHaveLength(3);

    const fresh = listEvents(lesson.id, second);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].message).toBe("Beat 3 failed");
    expect(fresh[0].level).toBe("error");
    expect(fresh[0].beatIdx).toBe(3);
  });

  it("orders oldest first so a log reads top to bottom", () => {
    const lesson = createLesson(aLesson);
    appendEvent(lesson.id, "ingest", "first");
    appendEvent(lesson.id, "ingest", "second");
    expect(listEvents(lesson.id).map((e) => e.message)).toEqual(["first", "second"]);
  });

  it("keeps one lesson's log out of another's", () => {
    const a = createLesson(aLesson);
    const b = createLesson({ ...aLesson, title: "Other" });
    appendEvent(a.id, "ingest", "for a");
    expect(listEvents(b.id)).toEqual([]);
  });

  it("defaults to info", () => {
    const lesson = createLesson(aLesson);
    appendEvent(lesson.id, "ingest", "plain");
    expect(listEvents(lesson.id)[0].level).toBe("info");
  });
});

describe("gate results", () => {
  it("records a pass with the measured detail the report displays", () => {
    const lesson = createLesson(aLesson);
    recordGateResults(lesson.id, "A", [
      { checkId: "A1", holds: true, detail: "idea_units = 1" },
      { checkId: "A2", holds: false, detail: "duration 185 s exceeds the 180 s cap" },
    ]);

    const results = listGateResults(lesson.id, "A");
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ pass: "A", checkId: "A1", holds: true });
    expect(results[1].holds).toBe(false);
    expect(results[1].detail).toContain("185 s");
  });

  it("replaces a pass on re-run so the report shows the current verdict", () => {
    const lesson = createLesson(aLesson);
    recordGateResults(lesson.id, "A", [{ checkId: "A2", holds: false, detail: "185 s" }]);
    recordGateResults(lesson.id, "A", [{ checkId: "A2", holds: true, detail: "152 s" }]);

    const results = listGateResults(lesson.id, "A");
    expect(results).toHaveLength(1);
    expect(results[0].holds).toBe(true);
    expect(results[0].detail).toBe("152 s");
  });

  it("keeps Pass A and Pass B independent", () => {
    const lesson = createLesson(aLesson);
    recordGateResults(lesson.id, "A", [{ checkId: "A1", holds: true }]);
    recordGateResults(lesson.id, "B", [{ checkId: "B3", holds: true, detail: "127 wpm" }]);

    expect(listGateResults(lesson.id)).toHaveLength(2);
    expect(listGateResults(lesson.id, "A")).toHaveLength(1);
    expect(listGateResults(lesson.id, "B")[0].checkId).toBe("B3");
  });

  it("refuses a pass letter the gate does not have", () => {
    const lesson = createLesson(aLesson);
    expect(() =>
      recordGateResults(lesson.id, "C" as never, [{ checkId: "C1", holds: true }]),
    ).toThrow(/CHECK constraint/);
  });
});

describe("artifacts", () => {
  it("records and replaces by kind", () => {
    const lesson = createLesson(aLesson);
    recordArtifact(lesson.id, "mp4", "workspace/lessons/x/lesson.mp4", 1024);
    recordArtifact(lesson.id, "vtt", "workspace/lessons/x/lesson.vtt", 96);
    recordArtifact(lesson.id, "mp4", "workspace/lessons/x/lesson.mp4", 2048);

    expect(getArtifact(lesson.id, "mp4")!.bytes).toBe(2048);
    expect(getArtifact(lesson.id, "vtt")!.bytes).toBe(96);
    expect(getArtifact(lesson.id, "pdf")).toBeUndefined();
  });
});
