/**
 * Ingest is the boundary where a teacher's file becomes our problem, and the
 * acceptance criterion is that a corrupt upload "fails with a message, not a
 * stack trace". These tests are mostly about that message existing and being
 * about the file rather than about us.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectKind, ingest, IngestError, MAX_UPLOAD_BYTES } from "./ingest";

const FIXTURES = join(__dirname, "__fixtures__");
const pdf = () => new Uint8Array(readFileSync(join(FIXTURES, "worksheet-multi-iu.pdf")));
const jpeg = () => new Uint8Array(readFileSync(join(FIXTURES, "photo-multi-iu.jpg")));

describe("detectKind", () => {
  it("identifies the real fixtures", () => {
    expect(detectKind(pdf())).toBe("pdf");
    expect(detectKind(jpeg())).toBe("jpeg");
  });

  it("identifies PNG and HEIC by signature", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(detectKind(png)).toBe("png");

    // ISO-BMFF: size, "ftyp", brand.
    const heic = new Uint8Array(16);
    heic.set([0x66, 0x74, 0x79, 0x70], 4);
    heic.set([...Buffer.from("heic")], 8);
    expect(detectKind(heic)).toBe("heic");
  });

  it("rejects a file whose name lies about its contents", () => {
    // The exact corrupt-upload case: it is called .pdf, it is not a PDF.
    expect(detectKind(new Uint8Array(Buffer.from("This is plain text, not a PDF")))).toBeUndefined();
  });

  it("rejects an empty and a truncated signature", () => {
    expect(detectKind(new Uint8Array(0))).toBeUndefined();
    expect(detectKind(new Uint8Array([0x25, 0x50]))).toBeUndefined(); // "%P" — half of %PDF
  });
});

describe("ingest", () => {
  it("rejects an empty file with a message, not a crash", () => {
    expect(() => ingest("t1", new Uint8Array(0))).toThrowError(IngestError);
    try {
      ingest("t1", new Uint8Array(0));
    } catch (error) {
      expect((error as IngestError).userMessage).toMatch(/empty/i);
    }
  });

  it("rejects an oversized file and says what the limit is", () => {
    // A valid PDF signature, so size is the only reason it can fail.
    const huge = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    huge.set([0x25, 0x50, 0x44, 0x46]);
    try {
      ingest("t2", huge);
      expect.unreachable("oversized upload should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(IngestError);
      expect((error as IngestError).userMessage).toContain("25 MB");
    }
  });

  it("names the file in the message so the teacher knows which one failed", () => {
    try {
      ingest("t3", new Uint8Array(Buffer.from("not a document")), "Arbeitsblatt.pdf");
      expect.unreachable("unrecognised upload should throw");
    } catch (error) {
      const message = (error as IngestError).userMessage;
      expect(message).toContain("Arbeitsblatt.pdf");
      // No stack frame, no absolute path, no exception name — the acceptance
      // criterion in spirit. Stack frames are matched as indented "at " lines
      // rather than a bare "at (", which occurs in ordinary prose.
      expect(message).not.toMatch(/\n\s+at |\/Users\/|\b\w*Error:/);
    }
  });

  it("stores an accepted file and reports what it stored", () => {
    const result = ingest("t4", pdf(), "worksheet.pdf");
    expect(result.kind).toBe("pdf");
    expect(result.path).toMatch(/lessons[/\\]t4[/\\]source\.pdf$/);
    expect(result.bytes).toBeGreaterThan(0);
    expect(new Uint8Array(readFileSync(result.path)).length).toBe(result.bytes);
  });
});
