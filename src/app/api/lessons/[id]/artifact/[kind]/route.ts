/**
 * `GET /api/lessons/:id/artifact/:kind` — serve a finished artifact.
 *
 * Artifacts live on the filesystem, not in the database (plan.md §2), so the
 * path comes from the `artifacts` table rather than being constructed from the
 * request. That matters for more than tidiness: `kind` arrives from the URL, and
 * a path built out of it is a directory traversal waiting to happen. Here an
 * unknown kind simply has no row and 404s.
 */
import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { getArtifact } from "@/lib/db/repo";

const TYPES: Record<string, string> = {
  mp4: "video/mp4",
  vtt: "text/vtt; charset=utf-8",
};

export async function GET(
  request: Request,
  context: RouteContext<"/api/lessons/[id]/artifact/[kind]">,
): Promise<Response> {
  const { id, kind } = await context.params;

  const artifact = getArtifact(id, kind);
  if (!artifact || !(kind in TYPES)) return new Response("Not found", { status: 404 });

  let size: number;
  try {
    size = statSync(artifact.path).size;
  } catch {
    // Recorded in the database but gone from disk — a cleared workspace.
    return new Response("Artifact is recorded but missing from disk", { status: 410 });
  }

  const type = TYPES[kind]!;

  // Range support, because a <video> element seeks by asking for byte ranges and
  // Safari will not scrub at all without it. Scrubbing to the final second is a
  // stated acceptance criterion (§4.2), so it has to actually work in a browser.
  const range = request.headers.get("range");
  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : size - 1;
    if (start >= size || end >= size || start > end) {
      return new Response("Range not satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
    const stream = createReadStream(artifact.path, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": type,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  return new Response(Readable.toWeb(createReadStream(artifact.path)) as ReadableStream, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
    },
  });
}
