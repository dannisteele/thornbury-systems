import { percentOf, sum, type Pence } from '../shared/money.ts';
import { rateFor, rateForSurcharge } from './vat.ts';
import type { Customer, Invoice, LineItem } from '../db.ts';

export interface VatBand {
  ratePercent: number;
  net: Pence;
  vat: Pence;
}

export interface InvoiceTotal {
  net: Pence;
  vat: Pence;
  total: Pence;
  // One entry per VAT rate present on the invoice, lowest rate first. Finance
  // reconcile the return against these, so they stay on the invoice payload.
  vatBreakdown: VatBand[];
}

export function lineTotal(line: LineItem): Pence {
  return line.quantity * line.unitPence;
}

// Paper invoices carried a printing and postage charge that the web product
// never had. Kept so historic invoices still reconcile.
function legacySurcharge(invoice: Invoice): Pence {
  if (invoice.source === 'LEGACY_PAPER') {
    return 150;
  }
  return 0;
}

// Net amounts grouped by the VAT rate that applies to them.
function netByRate(invoice: Invoice, customer: Customer): Map<number, Pence> {
  const bands = new Map<number, Pence>();
  const add = (ratePercent: number, net: Pence) => {
    if (net === 0 && !bands.has(ratePercent)) return;
    bands.set(ratePercent, (bands.get(ratePercent) ?? 0) + net);
  };

  for (const line of invoice.lines) {
    add(rateFor(line, customer), lineTotal(line));
  }
  add(rateForSurcharge(invoice, customer), legacySurcharge(invoice));

  return bands;
}

// VAT is rounded once per rate band rather than once per line. Rounding each
// line separately drifts by a penny or two on invoices with many small service
// lines, which is what finance were reconciling by hand.
export function totalFor(invoice: Invoice, customer: Customer): InvoiceTotal {
  const vatBreakdown: VatBand[] = [...netByRate(invoice, customer)]
    .sort(([a], [b]) => a - b)
    .map(([ratePercent, net]) => ({ ratePercent, net, vat: percentOf(net, ratePercent) }));

  const net = sum(vatBreakdown.map((b) => b.net));
  const vat = sum(vatBreakdown.map((b) => b.vat));

  return { net, vat, total: net + vat, vatBreakdown };
}

export function vatFor(invoice: Invoice, customer: Customer): Pence {
  return totalFor(invoice, customer).vat;
}

// VAT inclusive: this is what the customer actually owes us.
export function outstandingFor(customer: Customer, all: Invoice[]): Pence {
  return sum(
    all
      .filter((i) => i.customerId === customer.id && !i.paid)
      .map((i) => totalFor(i, customer).total),
  );
}
