import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statementFor, currentQuarter, StatementRangeError } from '../src/invoices/statement.ts';
import { customers, invoices, type Customer, type Invoice } from '../src/db.ts';

// C-1002 Trelawney Foods raised JOB C. Commercial, so their water is standard
// rated. C-1001 is domestic, so their water is zero rated — the pair covers
// both sides of the VAT rule without inventing customers.
const trelawney = customers.find((c) => c.id === 'C-1002')!;
const whitcombe = customers.find((c) => c.id === 'C-1001')!;

function invoiceOf(
  id: string,
  customer: Customer,
  issued: string,
  paid: boolean,
  lines: Invoice['lines'],
): Invoice {
  return { id, customerId: customer.id, issued, source: 'WEB', paid, lines };
}

const service = (pence: number): Invoice['lines'][number] => ({
  description: 'Backflow device test',
  quantity: 1,
  unitPence: pence,
  kind: 'SERVICE',
});

const supply = (pence: number): Invoice['lines'][number] => ({
  description: 'Metered supply',
  quantity: 1,
  unitPence: pence,
  kind: 'SUPPLY',
});

test('opening balance is the unpaid invoices issued before the period', () => {
  // INV-9002 is Trelawney's unpaid 1 July invoice: £2,940.00 gross. Asking for
  // August onwards should carry it forward, not list it.
  const statement = statementFor(trelawney, invoices, '2026-08-01', '2026-09-30');

  assert.equal(statement.openingBalancePence, 294000);
  assert.equal(statement.displayOpeningBalance, '£2,940.00');
  assert.deepEqual(statement.lines, []);
  assert.equal(statement.closingBalancePence, 294000);
});

test('a paid invoice before the period does not open a balance', () => {
  // Mrs Whitcombe's only invoice, INV-9001, is paid.
  const statement = statementFor(whitcombe, invoices, '2026-08-01', '2026-09-30');
  assert.equal(statement.openingBalancePence, 0);
  assert.equal(statement.displayOpeningBalance, '£0.00');
});

test('a customer with no invoices in range gets an empty statement, not an error', () => {
  const statement = statementFor(whitcombe, invoices, '2026-01-01', '2026-03-31');

  assert.equal(statement.lines.length, 0);
  assert.deepEqual(statement.vatSummary, []);
  assert.equal(statement.openingBalancePence, 0);
  assert.equal(statement.closingBalancePence, 0);
  assert.equal(statement.totals.netPence, 0);
  assert.equal(statement.totals.vatPence, 0);
  assert.equal(statement.totals.grossPence, 0);
  assert.equal(statement.totals.outstandingPence, 0);
  assert.equal(statement.totals.displayGross, '£0.00');
});

test('invoices for other customers are ignored', () => {
  // The route can hand us the whole store; the statement must still be one
  // customer's. C-1003's July invoice must not appear on Trelawney's.
  const statement = statementFor(trelawney, invoices, '2026-01-01', '2026-12-31');
  assert.deepEqual(statement.lines.map((l) => l.invoiceId), ['INV-9002']);
});

test('the running balance accumulates unpaid gross line by line', () => {
  const own: Invoice[] = [
    invoiceOf('INV-A', trelawney, '2026-07-05', false, [service(10000)]), // 12000 gross
    invoiceOf('INV-B', trelawney, '2026-07-10', false, [service(20000)]), // 24000 gross
    invoiceOf('INV-C', trelawney, '2026-07-20', false, [service(5000)]), //   6000 gross
  ];
  const statement = statementFor(trelawney, own, '2026-07-01', '2026-07-31');

  assert.deepEqual(statement.lines.map((l) => l.balancePence), [12000, 36000, 42000]);
  assert.deepEqual(statement.lines.map((l) => l.displayBalance), ['£120.00', '£360.00', '£420.00']);
  // The last running balance is the closing balance. If those two ever disagree
  // the statement does not add up on the page.
  assert.equal(statement.closingBalancePence, 42000);
});

test('the running balance starts from the opening balance', () => {
  const own: Invoice[] = [
    invoiceOf('INV-OLD', trelawney, '2026-06-30', false, [service(10000)]), // carried in
    invoiceOf('INV-NEW', trelawney, '2026-07-05', false, [service(20000)]),
  ];
  const statement = statementFor(trelawney, own, '2026-07-01', '2026-07-31');

  assert.equal(statement.openingBalancePence, 12000);
  assert.deepEqual(statement.lines.map((l) => l.balancePence), [36000]);
});

test('lines are ascending by issue date', () => {
  const own: Invoice[] = [
    invoiceOf('INV-C', trelawney, '2026-07-20', false, [service(5000)]),
    invoiceOf('INV-A', trelawney, '2026-07-05', false, [service(10000)]),
    invoiceOf('INV-B', trelawney, '2026-07-10', false, [service(20000)]),
  ];
  const statement = statementFor(trelawney, own, '2026-07-01', '2026-07-31');
  assert.deepEqual(statement.lines.map((l) => l.invoiceId), ['INV-A', 'INV-B', 'INV-C']);
});

test('paid invoices are listed but excluded from the closing balance', () => {
  const own: Invoice[] = [
    invoiceOf('INV-PAID', trelawney, '2026-07-05', true, [service(10000)]),
    invoiceOf('INV-OWED', trelawney, '2026-07-10', false, [service(20000)]),
  ];
  const statement = statementFor(trelawney, own, '2026-07-01', '2026-07-31');

  assert.equal(statement.lines.length, 2);
  // The paid line still shows, but leaves the balance where it was.
  assert.deepEqual(statement.lines.map((l) => l.balancePence), [0, 24000]);
  assert.equal(statement.closingBalancePence, 24000);
  assert.equal(statement.totals.paidPence, 12000);
  assert.equal(statement.totals.outstandingPence, 24000);
  // Period totals cover everything issued, paid or not.
  assert.equal(statement.totals.grossPence, 36000);
});

test('VAT summary groups by rate band across the whole period', () => {
  // Domestic: water is zero rated, engineer work is standard rated, so this
  // customer's statement has two bands.
  const own: Invoice[] = [
    invoiceOf('INV-A', whitcombe, '2026-07-05', false, [supply(10000), service(10000)]),
    invoiceOf('INV-B', whitcombe, '2026-07-10', false, [supply(5000), service(20000)]),
  ];
  const statement = statementFor(whitcombe, own, '2026-07-01', '2026-07-31');

  assert.deepEqual(statement.vatSummary, [
    { ratePercent: 0, netPence: 15000, displayNet: '£150.00', vatPence: 0, displayVat: '£0.00' },
    { ratePercent: 20, netPence: 30000, displayNet: '£300.00', vatPence: 6000, displayVat: '£60.00' },
  ]);
  // The summary must reconcile with the lines, which is the whole reason
  // finance asked for it.
  assert.equal(
    statement.vatSummary.reduce((a, b) => a + b.vatPence, 0),
    statement.totals.vatPence,
  );
  assert.equal(
    statement.vatSummary.reduce((a, b) => a + b.netPence, 0),
    statement.totals.netPence,
  );
});

test('the same supply is one band for a commercial customer and another for a domestic one', () => {
  // VAT liability follows the customer, never the invoice alone.
  const lines = [supply(10000)];
  const commercial = statementFor(
    trelawney,
    [invoiceOf('INV-X', trelawney, '2026-07-05', false, lines)],
    '2026-07-01',
    '2026-07-31',
  );
  const domestic = statementFor(
    whitcombe,
    [invoiceOf('INV-X', whitcombe, '2026-07-05', false, lines)],
    '2026-07-01',
    '2026-07-31',
  );

  assert.deepEqual(commercial.vatSummary.map((b) => b.ratePercent), [20]);
  assert.equal(commercial.totals.vatPence, 2000);
  assert.deepEqual(domestic.vatSummary.map((b) => b.ratePercent), [0]);
  assert.equal(domestic.totals.vatPence, 0);
});

test('VAT is rounded once per band per invoice, not once per line', () => {
  // 7p at 20% is 1.4p. Rounded per line that is 1p x 3 = 3p. Rounded once for
  // the band it is 21p x 20% = 4.2p -> 4p. The penny of drift between those two
  // is exactly what finance were chasing by hand, so assert the band answer.
  const own: Invoice[] = [
    invoiceOf('INV-R', trelawney, '2026-07-05', false, [
      { description: 'a', quantity: 1, unitPence: 7, kind: 'SERVICE' },
      { description: 'b', quantity: 1, unitPence: 7, kind: 'SERVICE' },
      { description: 'c', quantity: 1, unitPence: 7, kind: 'SERVICE' },
    ]),
  ];
  const statement = statementFor(trelawney, own, '2026-07-01', '2026-07-31');

  assert.equal(statement.totals.netPence, 21);
  assert.equal(statement.totals.vatPence, 4); // not 3
  assert.equal(statement.vatSummary[0]!.vatPence, 4);
});

test('the real Trelawney quarter reconciles against the invoice totals', () => {
  const statement = statementFor(trelawney, invoices, '2026-07-01', '2026-09-30');

  assert.deepEqual(statement.lines.map((l) => l.invoiceId), ['INV-9002']);
  assert.equal(statement.totals.netPence, 245000);
  assert.equal(statement.totals.vatPence, 49000);
  assert.equal(statement.totals.grossPence, 294000);
  assert.equal(statement.closingBalancePence, 294000);
  assert.equal(statement.displayClosingBalance, '£2,940.00');
  assert.equal(statement.customer.name, 'Trelawney Foods Ltd');
});

test('every pence field is mirrored by a formatted display string', () => {
  const statement = statementFor(trelawney, invoices, '2026-07-01', '2026-09-30');
  const line = statement.lines[0]!;

  assert.equal(line.displayNet, '£2,450.00');
  assert.equal(line.displayVat, '£490.00');
  assert.equal(line.displayGross, '£2,940.00');
  assert.equal(statement.totals.displayOutstanding, '£2,940.00');
  assert.equal(statement.totals.displayPaid, '£0.00');
  // All money is integer pence; nothing here may be fractional.
  for (const value of [line.netPence, line.vatPence, line.grossPence, line.balancePence]) {
    assert.ok(Number.isInteger(value), `${value} is not integer pence`);
  }
});

test('the period boundaries are inclusive', () => {
  const own: Invoice[] = [
    invoiceOf('INV-FIRST', trelawney, '2026-07-01', false, [service(10000)]),
    invoiceOf('INV-LAST', trelawney, '2026-07-31', false, [service(10000)]),
    invoiceOf('INV-AFTER', trelawney, '2026-08-01', false, [service(10000)]),
  ];
  const statement = statementFor(trelawney, own, '2026-07-01', '2026-07-31');
  assert.deepEqual(statement.lines.map((l) => l.invoiceId), ['INV-FIRST', 'INV-LAST']);
});

test('a Date range is keyed as a UK calendar date', () => {
  // Passed as Dates rather than keys; the range must still cover July. The
  // exact keying is shared/dates.ts toDateKey's job (JOB D owns the BST bug in
  // it), so assert the shape and the behaviour, not a hand-written key.
  const own: Invoice[] = [invoiceOf('INV-A', trelawney, '2026-07-05', false, [service(10000)])];
  const statement = statementFor(trelawney, own, new Date(2026, 6, 1), new Date(2026, 6, 31));
  assert.match(statement.from, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(statement.to, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(statement.lines.length, 1);
});

test('an inverted or unparseable range is rejected so the route can 400', () => {
  assert.throws(
    () => statementFor(trelawney, invoices, '2026-09-30', '2026-07-01'),
    StatementRangeError,
  );
  assert.throws(() => statementFor(trelawney, invoices, 'last tuesday', '2026-07-01'), StatementRangeError);
  assert.throws(() => statementFor(trelawney, invoices, new Date('nonsense'), '2026-07-01'), StatementRangeError);
});

test('the statement carries the no-payments-table caveat', () => {
  // docs/statement-contract.md known gap: Invoice.paid is a boolean, so we
  // cannot show payment dates or part payments.
  const statement = statementFor(trelawney, invoices, '2026-07-01', '2026-09-30');
  assert.equal(statement.notes.length, 1);
  assert.match(statement.notes[0]!, /Payments are not itemised/);
});

test('the default period is the current calendar quarter', () => {
  assert.deepEqual(currentQuarter(new Date(2026, 7, 15)), { from: '2026-07-01', to: '2026-09-30' });
  assert.deepEqual(currentQuarter(new Date(2026, 0, 1)), { from: '2026-01-01', to: '2026-03-31' });
  assert.deepEqual(currentQuarter(new Date(2026, 11, 31)), { from: '2026-10-01', to: '2026-12-31' });
  // A leap year Q1 ends on the 29th.
  assert.deepEqual(currentQuarter(new Date(2028, 1, 10)), { from: '2028-01-01', to: '2028-03-31' });
});
