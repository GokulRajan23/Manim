/**
 * The SQLite connection. One per process, opened lazily, schema applied on first use.
 *
 * The app is a single local process (plan.md §4.1), so a module-level singleton is
 * the whole of the connection management story. `better-sqlite3` is synchronous,
 * which suits this workload: every query here is a metadata read or write measured
 * in microseconds, next to pipeline stages measured in seconds.
 */
import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Job artifacts and the metadata store both live here. */
export function workspaceDir(): string {
  return resolve(process.env.WORKSPACE_DIR ?? "workspace");
}

function databasePath(): string {
  return process.env.DATABASE_PATH ?? join(workspaceDir(), "tafel.db");
}

let connection: Database.Database | undefined;

/**
 * The live connection, initialised on first call.
 *
 * The schema is read from `src/lib/db/schema.sql` relative to the working
 * directory. That holds because this app is only ever started from its project
 * root — `npm run dev`, `npm start`, `npm run doctor`, `vitest`. Deployment is
 * explicitly out of scope for this sprint (plan.md §1), and this is the assumption
 * to revisit when it isn't.
 */
export function db(): Database.Database {
  if (connection) return connection;

  const path = databasePath();
  if (path !== ":memory:") mkdirSync(workspaceDir(), { recursive: true });

  const database = new Database(path);

  // Not on by default in SQLite, and every child table here depends on ON DELETE CASCADE.
  database.pragma("foreign_keys = ON");
  // The render orchestrator appends events while the progress endpoint reads them.
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");

  database.exec(readFileSync(join(process.cwd(), "src/lib/db/schema.sql"), "utf8"));

  connection = database;
  return connection;
}

/** Close and forget the connection. For tests and for `doctor`. */
export function closeDb(): void {
  connection?.close();
  connection = undefined;
}
