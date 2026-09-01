// The SQL shape of the store. One statement per table, all `IF NOT EXISTS`, so
// applying the schema to a database that already has it is a no-op rather than
// an error. That is what makes startup safe to repeat.
//
// Money is INTEGER pence everywhere. Never REAL. The desktop product stored
// pounds as floats and we are still answering tickets about it (see
// src/shared/money.ts) — a REAL column here would put that bug back in the
// database itself, where no amount of careful arithmetic above it can help.
//
// Timestamps are TEXT holding UTC ISO strings, exactly as the in-memory store
// held them. SQLite has no date type, and storing the string the application
// already uses means nothing has to parse and re-render on the way through.
//
// Booleans are INTEGER 0/1 with a CHECK, because SQLite has no boolean either.
//
// Every table carries a `seq`. Consumers such as scheduling/dispatch.ts walk the
// work orders in order and the answer depends on that order, so row order has to
// be an explicit, stored fact rather than whatever the query planner feels like.

export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS customers (
     id            TEXT    NOT NULL PRIMARY KEY,
     name          TEXT    NOT NULL,
     address       TEXT    NOT NULL,
     account_type  TEXT    NOT NULL CHECK (account_type IN ('DOMESTIC', 'COMMERCIAL')),
     vat_registered INTEGER NOT NULL CHECK (vat_registered IN (0, 1)),
     seq           INTEGER NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS invoices (
     id          TEXT    NOT NULL PRIMARY KEY,
     customer_id TEXT    NOT NULL REFERENCES customers (id),
     issued      TEXT    NOT NULL,
     source      TEXT    NOT NULL CHECK (source IN ('WEB', 'BATCH', 'LEGACY_PAPER')),
     paid        INTEGER NOT NULL CHECK (paid IN (0, 1)),
     seq         INTEGER NOT NULL
   )`,

  // Invoice lines were a nested array in the in-memory store. In SQL they are a
  // child table keyed back to the invoice. `line_no` preserves the order they
  // appeared in the array, which is the order they print on the invoice.
  `CREATE TABLE IF NOT EXISTS invoice_lines (
     invoice_id  TEXT    NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
     line_no     INTEGER NOT NULL,
     description TEXT    NOT NULL,
     quantity    INTEGER NOT NULL,
     unit_pence  INTEGER NOT NULL,
     kind        TEXT    NOT NULL CHECK (kind IN ('SUPPLY', 'SERVICE')),
     PRIMARY KEY (invoice_id, line_no)
   )`,

  `CREATE TABLE IF NOT EXISTS engineers (
     id   TEXT    NOT NULL PRIMARY KEY,
     name TEXT    NOT NULL,
     seq  INTEGER NOT NULL
   )`,

  // Skills were a string array. Normalised out so an engineer cannot be given
  // the same skill twice and so we could query "who can do BACKFLOW" in SQL if
  // dispatch ever outgrows loading the whole table.
  `CREATE TABLE IF NOT EXISTS engineer_skills (
     engineer_id TEXT    NOT NULL REFERENCES engineers (id) ON DELETE CASCADE,
     skill       TEXT    NOT NULL,
     position    INTEGER NOT NULL,
     PRIMARY KEY (engineer_id, skill)
   )`,

  // engineer_id is the one genuinely optional field in the whole model: a queued
  // order has not been given to anybody yet. It is the only nullable column here.
  `CREATE TABLE IF NOT EXISTS work_orders (
     id               TEXT    NOT NULL PRIMARY KEY,
     customer_id      TEXT    NOT NULL REFERENCES customers (id),
     address          TEXT    NOT NULL,
     requires         TEXT    NOT NULL,
     requested_at     TEXT    NOT NULL,
     duration_minutes INTEGER NOT NULL,
     status           TEXT    NOT NULL CHECK (status IN ('QUEUED', 'DISPATCHED', 'DONE')),
     engineer_id      TEXT        NULL REFERENCES engineers (id),
     seq              INTEGER NOT NULL
   )`,

  `CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices (customer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines (invoice_id)`,
  `CREATE INDEX IF NOT EXISTS idx_work_orders_customer ON work_orders (customer_id)`,
];
