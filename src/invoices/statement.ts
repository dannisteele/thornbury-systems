// Customer statements (JOB C).
//
// Trelawney Foods asked for "a statement like our other suppliers send" because
// their finance team were reconciling four invoice PDFs by hand every quarter.
// docs/statement-contract.md is the spec this builds; it is a proposal, not yet
// signed off by the business, so keep this file easy to change.
//
// Pure function: no HTTP, no I/O, no reading the db module. Everything it needs
// is passed in, so the route in server.ts stays the only thing that knows about
// requests and the store.

import { format, sum, type Pence } from '../shared/money.ts';
import { toDateKey } from '../shared/dates.ts';
import { totalFor } from './calc.ts';
import type { Customer, Invoice } from '../db.ts';

// A UK calendar date, either already keyed as YYYY-MM-DD or as a Date we key
// ourselves. Never format a Date with toISOString().slice(0, 10) here — that is
// the JOB D bug that sent an engineer to site a day early.
export type DateInput = string | Date;

export interface StatementLine {
  invoiceId: string;
  issued: string;
  source: Invoice['source'];
  paid: boolean;
  netPence: Pence;
  displayNet: string;
  vatPence: Pence;
  displayVat: string;
  grossPence: Pence;
  displayGross: string;
  // Balance owed after this line. Paid invoices leave it unchanged; see below.
  balancePence: Pence;
  displayBalance: string;
}

export interface StatementVatBand {
  ratePercent: number;
  netPence: Pence;
  displayNet: string;
  vatPence: Pence;
  displayVat: string;
}

export interface StatementTotals {
  netPence: Pence;
  displayNet: string;
  vatPence: Pence;
  displayVat: string;
  grossPence: Pence;
  displayGross: string;
  paidPence: Pence;
  displayPaid: string;
  outstandingPence: Pence;
  displayOutstanding: string;
}

export interface Statement {
  customer: {
    id: string;
    name: string;
    address: string;
    accountType: Customer['accountType'];
    vatRegistered: boolean;
  };
  from: string;
  to: string;
  openingBalancePence: Pence;
  displayOpeningBalance: string;
  lines: StatementLine[];
  vatSummary: StatementVatBand[];
  closingBalancePence: Pence;
  displayClosingBalance: string;
  totals: StatementTotals;
  // Plain English caveats for whoever renders this. The front end team said they
  // will render whatever we give them, so the known data gap travels with the
  // payload rather than living only in the docs.
  notes: string[];
}

export class StatementRangeError extends Error {}

// Accepts either a keyed date or a Date. Anything else is the caller's problem
// and becomes a 400 at the route.
function dateKey(value: DateInput, field: string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new StatementRangeError(`${field} is not a valid date`);
    }
    return toDateKey(value);
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  throw new StatementRangeError(`${field} must be a UK calendar date as YYYY-MM-DD`);
}

// Date keys are fixed width and zero padded, so plain string comparison is the
// UK calendar comparison. No Date maths, so no midnight/BST edge to get wrong.
function inPeriod(issued: string, from: string, to: string): boolean {
  return issued >= from && issued <= to;
}

/**
 * Build a statement for one customer over an inclusive UK date range.
 *
 * `invoices` may be the whole store; invoices for other customers are ignored,
 * so the caller does not have to pre-filter.
 */
export function statementFor(
  customer: Customer,
  invoices: Invoice[],
  from: DateInput,
  to: DateInput,
): Statement {
  const fromKey = dateKey(from, 'from');
  const toKey = dateKey(to, 'to');
  if (fromKey > toKey) {
    throw new StatementRangeError(`from (${fromKey}) is after to (${toKey})`);
  }

  const mine = invoices.filter((i) => i.customerId === customer.id);

  // VAT liability depends on who the invoice is for, never on the invoice
  // alone, so every total below is resolved against this customer — exactly
  // what withTotals in server.ts does.
  const totalsOf = (invoice: Invoice) => totalFor(invoice, customer);

  // Opening balance: unpaid invoices issued strictly before the period. Paid
  // ones have gone, so they never contribute.
  const openingBalancePence = sum(
    mine
      .filter((i) => i.issued < fromKey && !i.paid)
      .map((i) => totalsOf(i).total),
  );

  const period = mine
    .filter((i) => inPeriod(i.issued, fromKey, toKey))
    .sort((a, b) => (a.issued === b.issued ? a.id.localeCompare(b.id) : a.issued.localeCompare(b.issued)));

  // The running balance is what the customer still owes after each line, so a
  // paid invoice appears on the statement (finance want to see it) but moves
  // the balance by nothing. That is what makes the last running balance equal
  // the closing balance.
  let balancePence = openingBalancePence;
  const lines: StatementLine[] = [];
  // Rate band -> running net and VAT for the period.
  const bands = new Map<number, { net: Pence; vat: Pence }>();

  for (const invoice of period) {
    const totals = totalsOf(invoice);
    if (!invoice.paid) {
      balancePence += totals.total;
    }

    for (const band of totals.vatBreakdown) {
      const running = bands.get(band.ratePercent) ?? { net: 0, vat: 0 };
      running.net += band.net;
      // Add the invoice's already-rounded band VAT rather than re-rounding the
      // aggregated net. JOB A rounds once per band per invoice; re-rounding
      // here would make the summary disagree with the sum of the lines by a
      // penny, which is the hand-reconciliation problem all over again.
      running.vat += band.vat;
      bands.set(band.ratePercent, running);
    }

    lines.push({
      invoiceId: invoice.id,
      issued: invoice.issued,
      source: invoice.source,
      paid: invoice.paid,
      netPence: totals.net,
      displayNet: format(totals.net),
      vatPence: totals.vat,
      displayVat: format(totals.vat),
      grossPence: totals.total,
      displayGross: format(totals.total),
      balancePence,
      displayBalance: format(balancePence),
    });
  }

  // Lowest rate first, matching the order JOB A puts bands on an invoice.
  const vatSummary: StatementVatBand[] = [...bands]
    .sort(([a], [b]) => a - b)
    .map(([ratePercent, { net, vat }]) => ({
      ratePercent,
      netPence: net,
      displayNet: format(net),
      vatPence: vat,
      displayVat: format(vat),
    }));

  const netPence = sum(lines.map((l) => l.netPence));
  const vatPence = sum(lines.map((l) => l.vatPence));
  const grossPence = sum(lines.map((l) => l.grossPence));
  const paidPence = sum(lines.filter((l) => l.paid).map((l) => l.grossPence));
  const outstandingPence = sum(lines.filter((l) => !l.paid).map((l) => l.grossPence));

  const closingBalancePence = openingBalancePence + outstandingPence;

  return {
    customer: {
      id: customer.id,
      name: customer.name,
      address: customer.address,
      accountType: customer.accountType,
      vatRegistered: customer.vatRegistered,
    },
    from: fromKey,
    to: toKey,
    openingBalancePence,
    displayOpeningBalance: format(openingBalancePence),
    lines,
    vatSummary,
    closingBalancePence,
    displayClosingBalance: format(closingBalancePence),
    totals: {
      netPence,
      displayNet: format(netPence),
      vatPence,
      displayVat: format(vatPence),
      grossPence,
      displayGross: format(grossPence),
      paidPence,
      displayPaid: format(paidPence),
      outstandingPence,
      displayOutstanding: format(outstandingPence),
    },
    notes: [
      // Known gap in docs/statement-contract.md. There is no payments table:
      // Invoice.paid is a boolean, so we can say what is unpaid but not what
      // was paid, when, or in part. If Trelawney want payment lines the data
      // model needs a payments table first.
      'Payments are not itemised: the billing model records only whether an invoice is paid, not when or how much was received.',
    ],
  };
}

// The contract defaults an omitted range to the current quarter. Kept here so
// the route does not have to do calendar maths, and so it is testable without
// starting a server.
export function currentQuarter(today: Date = new Date()): { from: string; to: string } {
  const year = today.getFullYear();
  // getMonth() is 0-based; quarters run Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec.
  const firstMonth = Math.floor(today.getMonth() / 3) * 3;
  const pad = (n: number) => String(n).padStart(2, '0');
  // Day 0 of the following month is the last day of the month before it, which
  // keeps month lengths and leap years out of this function.
  const lastDay = new Date(year, firstMonth + 3, 0).getDate();
  return {
    from: `${year}-${pad(firstMonth + 1)}-01`,
    to: `${year}-${pad(firstMonth + 3)}-${pad(lastDay)}`,
  };
}
