// Turning rows back into the objects the rest of the codebase expects.
//
// Everything above src/db.ts was written against plain arrays of plain objects
// and does `.find()` and `.filter()` on them. These readers exist to keep that
// true: SQL column names come back snake_case, 0/1 instead of booleans, and
// child rows in separate result sets, and none of that is allowed to leak past
// this file.
//
// Every query has an explicit ORDER BY on the stored `seq`. Scheduling walks the
// work orders in order and the plan it produces depends on that order, so it has
// to be guaranteed rather than incidental.

import type { DatabaseSync } from 'node:sqlite';
import type { Customer, Engineer, Invoice, LineItem, WorkOrder } from '../db.ts';

interface CustomerRow {
  id: string;
  name: string;
  address: string;
  account_type: string;
  vat_registered: number;
}

interface InvoiceRow {
  id: string;
  customer_id: string;
  issued: string;
  source: string;
  paid: number;
}

interface LineRow {
  invoice_id: string;
  description: string;
  quantity: number;
  unit_pence: number;
  kind: string;
}

interface EngineerRow {
  id: string;
  name: string;
}

interface SkillRow {
  engineer_id: string;
  skill: string;
}

interface WorkOrderRow {
  id: string;
  customer_id: string;
  address: string;
  requires: string;
  requested_at: string;
  duration_minutes: number;
  status: string;
  engineer_id: string | null;
}

export function readCustomers(db: DatabaseSync): Customer[] {
  const rows = db
    .prepare('SELECT id, name, address, account_type, vat_registered FROM customers ORDER BY seq')
    .all() as unknown as CustomerRow[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    address: r.address,
    accountType: r.account_type as Customer['accountType'],
    vatRegistered: r.vat_registered === 1,
  }));
}

export function readInvoices(db: DatabaseSync): Invoice[] {
  const rows = db
    .prepare('SELECT id, customer_id, issued, source, paid FROM invoices ORDER BY seq')
    .all() as unknown as InvoiceRow[];

  // One query for all the lines rather than one per invoice. Grouped in memory
  // afterwards; there is no ORM here to do it and the data is small.
  const lineRows = db
    .prepare(
      `SELECT invoice_id, description, quantity, unit_pence, kind
         FROM invoice_lines ORDER BY invoice_id, line_no`,
    )
    .all() as unknown as LineRow[];

  const byInvoice = new Map<string, LineItem[]>();
  for (const r of lineRows) {
    const lines = byInvoice.get(r.invoice_id) ?? [];
    lines.push({
      description: r.description,
      quantity: r.quantity,
      unitPence: r.unit_pence,
      kind: r.kind as LineItem['kind'],
    });
    byInvoice.set(r.invoice_id, lines);
  }

  return rows.map((r) => ({
    id: r.id,
    customerId: r.customer_id,
    issued: r.issued,
    lines: byInvoice.get(r.id) ?? [],
    source: r.source as Invoice['source'],
    paid: r.paid === 1,
  }));
}

export function readEngineers(db: DatabaseSync): Engineer[] {
  const rows = db
    .prepare('SELECT id, name FROM engineers ORDER BY seq')
    .all() as unknown as EngineerRow[];

  const skillRows = db
    .prepare('SELECT engineer_id, skill FROM engineer_skills ORDER BY engineer_id, position')
    .all() as unknown as SkillRow[];

  const byEngineer = new Map<string, string[]>();
  for (const r of skillRows) {
    const skills = byEngineer.get(r.engineer_id) ?? [];
    skills.push(r.skill);
    byEngineer.set(r.engineer_id, skills);
  }

  return rows.map((r) => ({ id: r.id, name: r.name, skills: byEngineer.get(r.id) ?? [] }));
}

export function readWorkOrders(db: DatabaseSync): WorkOrder[] {
  const rows = db
    .prepare(
      `SELECT id, customer_id, address, requires, requested_at, duration_minutes, status, engineer_id
         FROM work_orders ORDER BY seq`,
    )
    .all() as unknown as WorkOrderRow[];

  return rows.map((r) => {
    const order: WorkOrder = {
      id: r.id,
      customerId: r.customer_id,
      address: r.address,
      requires: r.requires,
      requestedAt: r.requested_at,
      durationMinutes: r.duration_minutes,
      status: r.status as WorkOrder['status'],
    };
    // engineerId is optional in the type and the server JSON-encodes these
    // straight out. An unassigned order had no such key before; keep it that way
    // rather than emitting `"engineerId": null`.
    if (r.engineer_id !== null) order.engineerId = r.engineer_id;
    return order;
  });
}
