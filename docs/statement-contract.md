# Statement contract (JOB C)

Proposed by Claude, 1 Sep 2026. **Not yet agreed by the business** — this exists
so the endpoint could be built at all. Trelawney asked on 5 Aug; the job sat 23
days because nobody defined this. Review it and change it.

## Endpoint

```
GET /customers/:id/statement?from=YYYY-MM-DD&to=YYYY-MM-DD
```

`from` and `to` are UK calendar dates, inclusive. Default to the current
quarter if omitted. 404 if the customer does not exist. 400 on an unparseable
or inverted range.

## What goes on it

Modelled on what Trelawney's other suppliers send, and on the fact that their
finance team is reconciling by hand.

- **Opening balance** — unpaid invoices issued strictly before `from`.
- **Lines** — one per invoice issued within the period, ascending by issue
  date, each carrying net, VAT, gross, whether it is paid, and a running
  balance after that line.
- **VAT summary** — grouped by rate band, so finance can reconcile the VAT
  total without re-deriving it per line. Reuse the existing per-band breakdown
  from JOB A rather than recomputing.
- **Closing balance** — opening, plus unpaid gross issued in the period.
- **Totals** — net, VAT, gross, paid, outstanding for the period.

## Rules

- Money is pence in every `...Pence` field. Every pence field is mirrored by a
  formatted `display...` string via `shared/money.ts` `format()`. No floats.
- VAT liability depends on the customer, not the invoice alone — resolve totals
  through the customer exactly as `withTotals` in `server.ts` already does.
- All dates are UK calendar dates via `shared/dates.ts` `toDateKey()`. Never
  `toISOString().slice(0,10)`, which is the JOB D bug.
- Rounding: VAT rounds once per rate band, never per line. There is already a
  test for this — do not regress it.

## Known gap

There is no payments table. `Invoice.paid` is a boolean, so a statement can say
what is unpaid but cannot show payments received, or dates of payment, or part
payments. A real statement normally shows those. Flag to the business: if
Trelawney want payment lines, the data model needs a payments table first.
