import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDatabase } from '../src/data/connection.ts';
import { LATEST_VERSION, MIGRATIONS, appliedVersions, migrate } from '../src/data/migrations.ts';
import { SEED_CUSTOMERS, SEED_ENGINEERS, SEED_INVOICES, SEED_WORK_ORDERS, seed } from '../src/data/seed.ts';
import { readCustomers, readEngineers, readInvoices, readWorkOrders } from '../src/data/read.ts';
import { customers, engineers, invoices, workOrders } from '../src/db.ts';

// Each test gets its own database file. The shared .data/thornbury.db is left
// alone: these tests drop and re-seed, and doing that to a developer's working
// database would be rude.
function freshDb(): { db: DatabaseSync; dispose: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'thornbury-db-'));
  const db = openDatabase(join(dir, 'test.db'));
  return {
    db,
    dispose: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function tableNames(db: DatabaseSync): string[] {
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all() as unknown as { name: string }[];
  return rows.map((r) => r.name);
}

test('migration creates every table the model needs', () => {
  const { db, dispose } = freshDb();
  try {
    const names = tableNames(db);
    for (const expected of [
      'customers',
      'invoices',
      'invoice_lines',
      'engineers',
      'engineer_skills',
      'work_orders',
      'schema_migrations',
    ]) {
      assert.ok(names.includes(expected), `missing table ${expected}`);
    }
  } finally {
    dispose();
  }
});

test('foreign keys are declared and enforced', () => {
  const { db, dispose } = freshDb();
  try {
    // An invoice line pointing at an invoice that does not exist must be refused.
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO invoice_lines (invoice_id, line_no, description, quantity, unit_pence, kind)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run('INV-NOPE', 0, 'ghost', 1, 100, 'SUPPLY'),
      /FOREIGN KEY/i,
    );
  } finally {
    dispose();
  }
});

test('money columns are INTEGER, never REAL', () => {
  const { db, dispose } = freshDb();
  try {
    const cols = db
      .prepare(`SELECT name, type, "notnull" FROM pragma_table_info('invoice_lines')`)
      .all() as unknown as { name: string; type: string; notnull: number }[];

    const unitPence = cols.find((c) => c.name === 'unit_pence');
    assert.ok(unitPence, 'unit_pence column missing');
    assert.equal(unitPence.type, 'INTEGER');
    assert.equal(unitPence.notnull, 1);

    // And the stored values really are integers, not floats that print tidily.
    const stored = db
      .prepare('SELECT unit_pence, typeof(unit_pence) AS t FROM invoice_lines')
      .all() as unknown as { unit_pence: number; t: string }[];
    assert.ok(stored.length > 0);
    for (const row of stored) {
      assert.equal(row.t, 'integer');
      assert.ok(Number.isInteger(row.unit_pence));
    }
  } finally {
    dispose();
  }
});

test('non-optional fields are NOT NULL, optional engineer_id is not', () => {
  const { db, dispose } = freshDb();
  try {
    const cols = db
      .prepare(`SELECT name, "notnull" FROM pragma_table_info('work_orders')`)
      .all() as unknown as { name: string; notnull: number }[];
    const notNull = (name: string) => cols.find((c) => c.name === name)?.notnull;

    for (const name of ['id', 'customer_id', 'address', 'requires', 'requested_at', 'duration_minutes', 'status']) {
      assert.equal(notNull(name), 1, `${name} should be NOT NULL`);
    }
    assert.equal(notNull('engineer_id'), 0, 'engineer_id is optional');
  } finally {
    dispose();
  }
});

test('migration is idempotent: running it again applies nothing and changes nothing', () => {
  const { db, dispose } = freshDb();
  try {
    // openDatabase already migrated once.
    assert.deepEqual(appliedVersions(db), MIGRATIONS.map((m) => m.version));
    const before = tableNames(db);

    assert.deepEqual(migrate(db), [], 'second migrate should apply no versions');
    assert.deepEqual(migrate(db), [], 'third migrate should apply no versions');

    assert.deepEqual(tableNames(db), before);
    assert.deepEqual(appliedVersions(db).length, LATEST_VERSION);
  } finally {
    dispose();
  }
});

test('reopening the same file migrates and seeds without duplicating rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thornbury-db-'));
  const path = join(dir, 'reopen.db');
  try {
    const first = openDatabase(path);
    const firstCount = readCustomers(first).length;
    first.close();

    const second = openDatabase(path);
    assert.equal(readCustomers(second).length, firstCount);
    assert.equal(readInvoices(second).length, SEED_INVOICES.length);
    // Seeding is skipped entirely once there is data.
    assert.equal(seed(second), false);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('seeded customers round-trip exactly', () => {
  const { db, dispose } = freshDb();
  try {
    assert.deepEqual(readCustomers(db), SEED_CUSTOMERS.map((c) => ({ ...c })));
  } finally {
    dispose();
  }
});

test('seeded invoices round-trip exactly, nested lines and all', () => {
  const { db, dispose } = freshDb();
  try {
    const loaded = readInvoices(db);
    assert.deepEqual(
      loaded,
      SEED_INVOICES.map((i) => ({ ...i, lines: i.lines.map((l) => ({ ...l })) })),
    );

    // Line order within an invoice is part of the data, not incidental.
    const inv9002 = loaded.find((i) => i.id === 'INV-9002')!;
    assert.deepEqual(
      inv9002.lines.map((l) => l.description),
      ['Metered supply, Q2', 'Standing charge', 'Backflow device test'],
    );
  } finally {
    dispose();
  }
});

test('seeded engineers round-trip with skills in order', () => {
  const { db, dispose } = freshDb();
  try {
    assert.deepEqual(readEngineers(db), SEED_ENGINEERS.map((e) => ({ ...e, skills: [...e.skills] })));
    assert.deepEqual(readEngineers(db).find((e) => e.id === 'E-02')!.skills, [
      'METER',
      'BACKFLOW',
      'LEAK',
    ]);
  } finally {
    dispose();
  }
});

test('seeded work orders round-trip, and unassigned ones have no engineerId key', () => {
  const { db, dispose } = freshDb();
  try {
    const loaded = readWorkOrders(db);
    assert.deepEqual(loaded, SEED_WORK_ORDERS.map((w) => ({ ...w })));

    const w5001 = loaded.find((w) => w.id === 'W-5001')!;
    assert.equal('engineerId' in w5001, false, 'unassigned order should not carry the key');

    // Order matters: dispatch walks these in sequence.
    assert.deepEqual(loaded.map((w) => w.id), [
      'W-5001', 'W-5002', 'W-5003', 'W-5004', 'W-5005', 'W-5006',
    ]);
  } finally {
    dispose();
  }
});

test('timestamps are stored as the UTC ISO strings the app uses', () => {
  const { db, dispose } = freshDb();
  try {
    const rows = db
      .prepare('SELECT requested_at FROM work_orders ORDER BY seq')
      .all() as unknown as { requested_at: string }[];
    for (const row of rows) {
      assert.match(row.requested_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      assert.equal(new Date(row.requested_at).toISOString().slice(0, 19) + 'Z', row.requested_at);
    }
  } finally {
    dispose();
  }
});

test('the exported arrays are still plain arrays with the expected contents', () => {
  // This is the transparency check: consumers do .find and .filter on these.
  assert.ok(Array.isArray(customers) && Array.isArray(invoices));
  assert.ok(Array.isArray(engineers) && Array.isArray(workOrders));

  assert.deepEqual(customers.map((c) => c.id), ['C-1001', 'C-1002', 'C-1003', 'C-1004']);
  assert.deepEqual(invoices.map((i) => i.id), ['INV-9001', 'INV-9002', 'INV-9003', 'INV-9004']);
  assert.deepEqual(engineers.map((e) => e.id), ['E-01', 'E-02', 'E-03']);
  assert.deepEqual(workOrders.map((w) => w.id), [
    'W-5001', 'W-5002', 'W-5003', 'W-5004', 'W-5005', 'W-5006',
  ]);

  // Booleans came back as booleans, not SQLite's 0 and 1.
  assert.equal(customers.find((c) => c.id === 'C-1001')!.vatRegistered, false);
  assert.equal(customers.find((c) => c.id === 'C-1002')!.vatRegistered, true);
  assert.equal(invoices.find((i) => i.id === 'INV-9001')!.paid, true);
  assert.equal(invoices.find((i) => i.id === 'INV-9002')!.paid, false);
});
