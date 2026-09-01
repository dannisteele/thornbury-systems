import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totalFor, outstandingFor, vatFor } from '../src/invoices/calc.ts';
import { customers, invoices, type Customer, type Invoice } from '../src/db.ts';

const domestic = customers.find((c) => c.id === 'C-1003')!;
const commercial = customers.find((c) => c.id === 'C-1002')!;

function invoiceOf(lines: Invoice['lines'], customer: Customer, source: Invoice['source'] = 'WEB'): Invoice {
  return { id: 'INV-TEST', customerId: customer.id, issued: '2026-07-01', source, paid: false, lines };
}

test('metered supply to a domestic customer is zero rated', () => {
  const invoice = invoiceOf([{ description: 'Metered supply', quantity: 33, unitPence: 218, kind: 'SUPPLY' }], domestic);
  const result = totalFor(invoice, domestic);
  assert.equal(result.net, 7194);
  assert.equal(result.vat, 0);
  assert.equal(result.total, 7194);
});

test('metered supply to a commercial customer is standard rated', () => {
  const invoice = invoiceOf([{ description: 'Metered supply', quantity: 1120, unitPence: 195, kind: 'SUPPLY' }], commercial);
  const result = totalFor(invoice, commercial);
  assert.equal(result.net, 218400);
  assert.equal(result.vat, 43680);
  assert.equal(result.total, 262080);
});

test('engineer work is standard rated even for a domestic customer', () => {
  const invoice = invoiceOf([{ description: 'Emergency call out', quantity: 1, unitPence: 14000, kind: 'SERVICE' }], domestic);
  const result = totalFor(invoice, domestic);
  assert.equal(result.net, 14000);
  assert.equal(result.vat, 2800);
  assert.equal(result.total, 16800);
});

test('a mixed domestic invoice charges VAT on the service lines only', () => {
  const invoice = invoices.find((i) => i.id === 'INV-9003')!;
  const result = totalFor(invoice, domestic);
  assert.equal(result.net, 23594);
  assert.equal(result.vat, 2800);
  assert.equal(result.total, 26394);
});

test('VAT is rounded once per rate band, not once per line', () => {
  // Two 333p service lines. Per line this would round to 67 + 67 = 134.
  // The band total is 666p, and 20% of that is 133.2p, which rounds to 133.
  const invoice = invoiceOf(
    [
      { description: 'Callout part A', quantity: 1, unitPence: 333, kind: 'SERVICE' },
      { description: 'Callout part B', quantity: 1, unitPence: 333, kind: 'SERVICE' },
    ],
    domestic,
  );
  assert.equal(totalFor(invoice, domestic).vat, 133);
});

test('VAT rounds half up to the nearest penny', () => {
  const invoice = invoiceOf([{ description: 'Callout', quantity: 1, unitPence: 333, kind: 'SERVICE' }], domestic);
  assert.equal(totalFor(invoice, domestic).vat, 67);
});

test('the invoice breaks VAT down by rate so finance can reconcile it', () => {
  const invoice = invoices.find((i) => i.id === 'INV-9003')!;
  assert.deepEqual(totalFor(invoice, domestic).vatBreakdown, [
    { ratePercent: 0, net: 9594, vat: 0 },
    { ratePercent: 20, net: 14000, vat: 2800 },
  ]);
});

test('the legacy postage surcharge follows the liability of the water supply', () => {
  const lines: Invoice['lines'] = [{ description: 'Metered supply', quantity: 10, unitPence: 100, kind: 'SUPPLY' }];
  assert.equal(totalFor(invoiceOf(lines, domestic, 'LEGACY_PAPER'), domestic).vat, 0);
  // Commercial: 1000p supply + 150p surcharge, all standard rated.
  assert.equal(totalFor(invoiceOf(lines, commercial, 'LEGACY_PAPER'), commercial).vat, 230);
});

test('vatFor exposes the tax on an invoice on its own', () => {
  const invoice = invoices.find((i) => i.id === 'INV-9002')!;
  assert.equal(vatFor(invoice, commercial), 49000);
});

test('the outstanding balance is VAT inclusive', () => {
  assert.equal(outstandingFor(commercial, invoices), 294000);
  assert.equal(outstandingFor(domestic, invoices), 26394);
});

test('an invoice with no lines has no VAT', () => {
  const invoice = invoiceOf([], commercial);
  const result = totalFor(invoice, commercial);
  assert.equal(result.net, 0);
  assert.equal(result.vat, 0);
  assert.deepEqual(result.vatBreakdown, []);
});
