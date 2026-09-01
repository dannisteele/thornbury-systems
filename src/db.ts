// The data store. Backed by real SQLite (node:sqlite, built into Node 22) — the
// arrays below are query results, not literals.
//
// The public shape of this module is deliberately unchanged from the in-memory
// version it replaces. Everything above it does `customers.find(...)` and
// `invoices.filter(...)` against plain arrays, and all of that still works,
// because node:sqlite is synchronous: the queries run at module load and hand
// back ordinary objects. Nothing else in the repo had to change.
//
// Schema, migrations and seed data live in src/data/. The database file is
// .data/thornbury.db unless THORNBURY_DB says otherwise.

import { openDatabase } from './data/connection.ts';
import { readCustomers, readEngineers, readInvoices, readWorkOrders } from './data/read.ts';

export type CustomerId = string;

export interface Customer {
  id: CustomerId;
  name: string;
  address: string;
  accountType: 'DOMESTIC' | 'COMMERCIAL';
  vatRegistered: boolean;
}

export interface LineItem {
  description: string;
  quantity: number;
  unitPence: number;
  // 'SUPPLY' is metered water. 'SERVICE' is engineer work and is charged differently.
  kind: 'SUPPLY' | 'SERVICE';
}

export interface Invoice {
  id: string;
  customerId: CustomerId;
  issued: string;
  lines: LineItem[];
  // 'LEGACY_PAPER' came from the pre-2019 desktop product. The importer that
  // created them was switched off when the last paper run went out.
  source: 'WEB' | 'BATCH' | 'LEGACY_PAPER';
  paid: boolean;
}

export interface Engineer {
  id: string;
  name: string;
  skills: string[];
}

export interface WorkOrder {
  id: string;
  customerId: CustomerId;
  address: string;
  requires: string;
  // Stored UTC.
  requestedAt: string;
  durationMinutes: number;
  status: 'QUEUED' | 'DISPATCHED' | 'DONE';
  engineerId?: string;
}

// Opened once for the life of the process. Migrations and seeding happen here,
// on the way in, so importing this module is all anybody has to do — there is no
// separate setup step to forget.
export const db = openDatabase();

export const customers: Customer[] = readCustomers(db);
export const invoices: Invoice[] = readInvoices(db);
export const engineers: Engineer[] = readEngineers(db);
export const workOrders: WorkOrder[] = readWorkOrders(db);

// Re-read the tables into the exported arrays, in place. The arrays are `const`
// and other modules hold references to them, so this splices rather than
// reassigns. Nothing calls it yet — it is here for when something starts writing.
export function refresh(): void {
  customers.splice(0, customers.length, ...readCustomers(db));
  invoices.splice(0, invoices.length, ...readInvoices(db));
  engineers.splice(0, engineers.length, ...readEngineers(db));
  workOrders.splice(0, workOrders.length, ...readWorkOrders(db));
}
