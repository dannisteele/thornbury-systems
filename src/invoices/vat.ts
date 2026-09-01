// UK VAT liability for water utility billing.
//
// The rule is about what is being supplied and to whom, NOT about whether the
// customer is VAT registered. `Customer.vatRegistered` says whether they can
// reclaim the VAT we charge; it never changes whether we charge it. Do not wire
// the rates below to that field.
//
//   Water supplied to a household              zero rated
//   Water supplied to a business               standard rated
//   Engineer work, tests, call outs            standard rated, always
//
// If HMRC changes a rate, this file is the only place it needs changing.

import type { Customer, Invoice, LineItem } from '../db.ts';

export const STANDARD_RATE_PERCENT = 20;
export const ZERO_RATE_PERCENT = 0;

// Metered water and standing charges: zero rated to households, standard rated
// to businesses. Everything the surcharge is attached to is a water supply, so
// the legacy postage surcharge follows this rate too.
export function supplyRateFor(customer: Customer): number {
  return customer.accountType === 'COMMERCIAL' ? STANDARD_RATE_PERCENT : ZERO_RATE_PERCENT;
}

export function rateFor(line: LineItem, customer: Customer): number {
  switch (line.kind) {
    case 'SERVICE':
      return STANDARD_RATE_PERCENT;
    case 'SUPPLY':
      return supplyRateFor(customer);
  }
}

export function rateForSurcharge(_invoice: Invoice, customer: Customer): number {
  return supplyRateFor(customer);
}
