// Opening the database.
//
// node:sqlite is synchronous, which is the whole reason this swap is possible
// without touching a single consumer: src/db.ts can run real queries at module
// load and still hand out plain arrays, exactly as it did when the data was
// literals in the file.
//
// The file lives in `.data/` at the repo root rather than next to the source,
// so a working database is never mistaken for something to commit — `.data/` is
// gitignored. Set THORNBURY_DB to point somewhere else; tests set it to a temp
// file, and ':memory:' gives a throwaway database with no file at all.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './migrations.ts';
import { seed } from './seed.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Repo root, two levels up from src/data/. */
export const DEFAULT_DB_PATH = join(HERE, '..', '..', '.data', 'thornbury.db');

export function resolveDbPath(): string {
  return process.env.THORNBURY_DB?.trim() || DEFAULT_DB_PATH;
}

/**
 * Open a database and put it in a known-good state: foreign keys enforced,
 * schema migrated, reference data seeded if it is a fresh file. Safe to call
 * against a database that has already been through it.
 */
export function openDatabase(path: string = resolveDbPath()): DatabaseSync {
  // ':memory:' has no directory to create.
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);

  // SQLite ignores foreign keys unless you ask, per connection. Without this the
  // REFERENCES clauses in the schema would be documentation rather than a rule.
  db.exec('PRAGMA foreign_keys = ON');

  migrate(db);
  seed(db);

  return db;
}
