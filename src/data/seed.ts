// The reference data the web front end was built against. These literals are a
// straight lift of the arrays that used to live in src/db.ts — the test suite
// asserts against specific invoice totals to the penny and against specific work
// order ids, so this is deliberately a copy and not a tidied-up rewrite.
//
// Seeding is idempotent: it does nothing at all if the customers table already
// has rows. We do not upsert, because that would silently undo real edits made
// against a real database on every restart.

import type { DatabaseSync } from 'node:sqlite';
import type { Customer, Engineer, Invoice, WorkOrder } from '../db.ts';

export const SEED_CUSTOMERS: readonly Customer[] = [
  { id: 'C-1001', name: 'Mrs J Whitcombe', address: '14 Ashfield Row, Bristol', accountType: 'DOMESTIC', vatRegistered: false },
  { id: 'C-1002', name: 'Trelawney Foods Ltd', address: 'Unit 6, Severnside Park, Avonmouth', accountType: 'COMMERCIAL', vatRegistered: true },
  { id: 'C-1003', name: 'Dr A Kowalski', address: '2 Bell Lane, Thornbury', accountType: 'DOMESTIC', vatRegistered: false },
  { id: 'C-1004', name: 'Severn Vale Academy', address: 'Gloucester Road, Thornbury', accountType: 'COMMERCIAL', vatRegistered: true },
];

export const SEED_INVOICES: readonly Invoice[] = [
  {
    id: 'INV-9001', customerId: 'C-1001', issued: '2026-07-01', source: 'WEB', paid: true,
    lines: [
      { description: 'Metered supply, Q2', quantity: 41, unitPence: 218, kind: 'SUPPLY' },
      { description: 'Standing charge', quantity: 1, unitPence: 2400, kind: 'SUPPLY' },
    ],
  },
  {
    id: 'INV-9002', customerId: 'C-1002', issued: '2026-07-01', source: 'BATCH', paid: false,
    lines: [
      { description: 'Metered supply, Q2', quantity: 1120, unitPence: 195, kind: 'SUPPLY' },
      { description: 'Standing charge', quantity: 1, unitPence: 9600, kind: 'SUPPLY' },
      { description: 'Backflow device test', quantity: 2, unitPence: 8500, kind: 'SERVICE' },
    ],
  },
  {
    id: 'INV-9003', customerId: 'C-1003', issued: '2026-07-01', source: 'WEB', paid: false,
    lines: [
      { description: 'Metered supply, Q2', quantity: 33, unitPence: 218, kind: 'SUPPLY' },
      { description: 'Standing charge', quantity: 1, unitPence: 2400, kind: 'SUPPLY' },
      { description: 'Emergency call out', quantity: 1, unitPence: 14000, kind: 'SERVICE' },
    ],
  },
  {
    id: 'INV-9004', customerId: 'C-1004', issued: '2026-04-01', source: 'BATCH', paid: true,
    lines: [
      { description: 'Metered supply, Q1', quantity: 2840, unitPence: 195, kind: 'SUPPLY' },
      { description: 'Standing charge', quantity: 1, unitPence: 9600, kind: 'SUPPLY' },
    ],
  },
];

export const SEED_ENGINEERS: readonly Engineer[] = [
  { id: 'E-01', name: 'Dean Prosser', skills: ['METER', 'LEAK'] },
  { id: 'E-02', name: 'Ify Nwosu', skills: ['METER', 'BACKFLOW', 'LEAK'] },
  { id: 'E-03', name: 'Ryan Betts', skills: ['LEAK'] },
];

export const SEED_WORK_ORDERS: readonly WorkOrder[] = [
  { id: 'W-5001', customerId: 'C-1001', address: '14 Ashfield Row, Bristol', requires: 'METER', requestedAt: '2026-09-02T08:00:00Z', durationMinutes: 60, status: 'QUEUED' },
  { id: 'W-5002', customerId: 'C-1001', address: '14 ashfield row, bristol', requires: 'LEAK', requestedAt: '2026-09-02T08:30:00Z', durationMinutes: 90, status: 'QUEUED' },
  { id: 'W-5003', customerId: 'C-1002', address: 'Unit 6, Severnside Park, Avonmouth', requires: 'BACKFLOW', requestedAt: '2026-09-02T09:00:00Z', durationMinutes: 45, status: 'QUEUED' },
  { id: 'W-5004', customerId: 'C-1003', address: '2 Bell Lane, Thornbury', requires: 'LEAK', requestedAt: '2026-09-02T13:00:00Z', durationMinutes: 60, status: 'QUEUED' },
  { id: 'W-5005', customerId: 'C-1004', address: 'Gloucester Road, Thornbury', requires: 'METER', requestedAt: '2026-09-02T13:30:00Z', durationMinutes: 30, status: 'QUEUED' },
  // Out of hours. Trelawney run a night shift and asked for the backflow test after close.
  { id: 'W-5006', customerId: 'C-1002', address: 'Unit 6, Severnside Park, Avonmouth', requires: 'BACKFLOW', requestedAt: '2026-09-02T23:30:00Z', durationMinutes: 45, status: 'QUEUED' },
];

/** True when the database has never been seeded. */
export function isEmpty(db: DatabaseSync): boolean {
  const row = db.prepare('SELECT COUNT(*) AS n FROM customers').get() as { n: number };
  return row.n === 0;
}

/**
 * Insert the reference data. Does nothing if anything is already there, so this
 * is safe on every startup. Wrapped in a transaction: a half-seeded database
 * with invoices but no customers would fail its own foreign keys.
 */
export function seed(db: DatabaseSync): boolean {
  if (!isEmpty(db)) return false;

  const insertCustomer = db.prepare(
    `INSERT INTO customers (id, name, address, account_type, vat_registered, seq)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertInvoice = db.prepare(
    `INSERT INTO invoices (id, customer_id, issued, source, paid, seq) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertLine = db.prepare(
    `INSERT INTO invoice_lines (invoice_id, line_no, description, quantity, unit_pence, kind)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertEngineer = db.prepare('INSERT INTO engineers (id, name, seq) VALUES (?, ?, ?)');
  const insertSkill = db.prepare(
    'INSERT INTO engineer_skills (engineer_id, skill, position) VALUES (?, ?, ?)',
  );
  const insertWorkOrder = db.prepare(
    `INSERT INTO work_orders
       (id, customer_id, address, requires, requested_at, duration_minutes, status, engineer_id, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  db.exec('BEGIN');
  try {
    SEED_CUSTOMERS.forEach((c, i) => {
      insertCustomer.run(c.id, c.name, c.address, c.accountType, c.vatRegistered ? 1 : 0, i);
    });

    SEED_INVOICES.forEach((inv, i) => {
      insertInvoice.run(inv.id, inv.customerId, inv.issued, inv.source, inv.paid ? 1 : 0, i);
      inv.lines.forEach((line, n) => {
        insertLine.run(inv.id, n, line.description, line.quantity, line.unitPence, line.kind);
      });
    });

    SEED_ENGINEERS.forEach((e, i) => {
      insertEngineer.run(e.id, e.name, i);
      e.skills.forEach((skill, n) => insertSkill.run(e.id, skill, n));
    });

    SEED_WORK_ORDERS.forEach((w, i) => {
      insertWorkOrder.run(
        w.id, w.customerId, w.address, w.requires, w.requestedAt,
        w.durationMinutes, w.status, w.engineerId ?? null, i,
      );
    });

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return true;
}
