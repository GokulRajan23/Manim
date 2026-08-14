/**
 * Stage 1 — Ingest (plan.md §4.7).
 *
 * Store the teacher's upload at `workspace/lessons/<id>/source.<ext>` and decide
 * what it actually is. "Decide what it is" is the whole job: the extension and
 * the browser-supplied MIME type are both hints, and a corrupt or mislabelled
 * file has to fail here with a sentence a teacher can act on — never a stack
 * trace three stages later (an acceptance criterion for Step 3).
 *
 * Detection is by magic bytes, because that is the only claim about a file that
 * the file itself makes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { workspaceDir } from "@/lib/db/client";

/** Rules §4.7: PDF, PNG, JPEG, HEIC. */
export const ACCEPTED_KINDS = ["pdf", "png", "jpeg", "heic"] as const;
export type SourceKind = (typeof ACCEPTED_KINDS)[number];

/** §4.7 caps the upload at 25 MB. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export class IngestError extends Error {
  constructor(
    message: string,
    /** Safe to show a teacher: no paths, no internals. */
    readonly userMessage: string,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

const EXTENSION: Record<SourceKind, string> = {
  pdf: "pdf",
  png: "png",
  jpeg: "jpg",
  heic: "heic",
};

/** Media types as the model gateway expects them. */
export const MEDIA_TYPE: Record<SourceKind, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpeg: "image/jpeg",
  heic: "image/heic",
};

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * Identify the upload from its leading bytes.
 *
 * Returns undefined for anything not on the accepted list, including files whose
 * name says one thing and whose contents say another — which is exactly the
 * "corrupt upload" case, and the reason this does not trust `file.type`.
 */
export function detectKind(bytes: Uint8Array): SourceKind | undefined {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf"; // %PDF
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  // HEIC is ISO-BMFF: a `ftyp` box at offset 4, brand at 8.
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(brand)) return "heic";
  }
  return undefined;
}

export type IngestResult = {
  kind: SourceKind;
  /** Absolute path to the stored file. */
  path: string;
  bytes: number;
};

/** Where this lesson's artifacts live (plan.md §4.10). */
export function lessonDir(lessonId: string): string {
  return join(workspaceDir(), "lessons", lessonId);
}

/**
 * Validate and store an upload. Throws `IngestError` with a teacher-readable
 * message for every rejection reason.
 */
export function ingest(lessonId: string, data: Uint8Array, originalName?: string): IngestResult {
  if (data.byteLength === 0) {
    throw new IngestError("empty upload", "That file is empty. Please upload the file again.");
  }
  if (data.byteLength > MAX_UPLOAD_BYTES) {
    const mb = (data.byteLength / 1024 / 1024).toFixed(1);
    throw new IngestError(
      `upload too large: ${data.byteLength}`,
      `That file is ${mb} MB. The limit is 25 MB — try exporting the page on its own.`,
    );
  }

  const kind = detectKind(data);
  if (!kind) {
    // Name the file so the teacher can tell which one, but say nothing about why
    // in implementation terms — "not a PDF despite the extension" is the useful part.
    const named = originalName ? ` (${originalName})` : "";
    throw new IngestError(
      `unrecognised file type${named}`,
      `That file${named} is not a PDF, PNG, JPEG or HEIC — or it is damaged. ` +
        `If it came from a scanner or a phone, try exporting it again.`,
    );
  }

  const dir = lessonDir(lessonId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `source.${EXTENSION[kind]}`);
  writeFileSync(path, data);

  return { kind, path, bytes: data.byteLength };
}
