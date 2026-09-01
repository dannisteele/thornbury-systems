// Migrations run on startup and must be safe to run twice, because they will be:
// every process start, every test file, and every restart of a long-lived box.
//
// Two belts and two braces on purpose. `schema_migrations` records which
// versions have been applied so a migration body never runs a second time, and
// the bodies themselves are written with `IF NOT EXISTS` so that even a database
// whose bookkeeping table got lost comes out the other side intact rather than
// erroring on "table already exists".
//
// To add a migration: append to MIGRATIONS with the next version number. Never
// edit or renumber one that has shipped — an existing database has already
// recorded that version and will skip the new body silently.

import type { DatabaseSync } from 'node:sqlite';
import { SCHEMA_STATEMENTS } from './schema.ts';

export interface Migration {
  version: number;
  name: string;
  statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial-schema',
    statements: SCHEMA_STATEMENTS,
  },
];

/** The highest migration version this build knows about. */
export const LATEST_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);

function ensureBookkeeping(db: DatabaseSync): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    INTEGER NOT NULL PRIMARY KEY,
       name       TEXT    NOT NULL,
       applied_at TEXT    NOT NULL
     )`,
  );
}

/** Versions already applied, oldest first. */
export function appliedVersions(db: DatabaseSync): number[] {
  ensureBookkeeping(db);
  const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
    version: number;
  }[];
  return rows.map((r) => r.version);
}

/**
 * Bring the database up to LATEST_VERSION. Returns the versions applied by this
 * call, so the second call on the same database returns an empty array.
 */
export function migrate(db: DatabaseSync): number[] {
  ensureBookkeeping(db);

  const done = new Set(appliedVersions(db));
  const record = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );
  const applied: number[] = [];

  for (const migration of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (done.has(migration.version)) continue;

    // Each migration is one transaction: if statement three of five throws we
    // want no trace of it, not a half-built schema that the next start skips
    // because the version was already recorded.
    db.exec('BEGIN');
    try {
      for (const statement of migration.statements) db.exec(statement);
      // Timestamps are UTC ISO strings throughout this codebase.
      record.run(migration.version, migration.name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    applied.push(migration.version);
  }

  return applied;
}
