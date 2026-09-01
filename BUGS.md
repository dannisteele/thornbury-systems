# What is still broken

Fork of `rialtas-dev/thornbury-systems`. Bug status as of 1 Sep 2026, after the
kawaii-overhaul work.

`npm test` passes 72/72, and it passes identically under `TZ=UTC`,
`Europe/London`, `America/New_York` and `Australia/Sydney`. That TZ sweep is the
point: the suite used to be green *because* coverage was missing, and a
host-dependent bug is exactly what it failed to catch.

| Job | State |
|---|---|
| A - VAT on invoices | Done, merged earlier as `c9ba219`. |
| B - two vans to one house | **Fixed here.** Cherry-picked from upstream, 4 tests. |
| C - customer statements | **Built here** to `docs/statement-contract.md`, 18 tests. Spec still needs business sign-off. |
| D - wrong day / wrong time quoted | **Restored here.** Cherry-picked the lost commits, verified across timezones. |
| Engineer double-booking | **Fixed here.** Was not on the job list. |

## Still open

- **`rialtas-dev/main` still has the JOB D bug.** This fork is fixed; the company
  repo is not, so real customers are still being quoted the wrong day. Needs a
  cherry-pick of `job-d-timezone` onto their main. This is the only item here
  with live customer impact.
- **JOB B's PR is still open** on `ao92265/thornbury-systems` (PR #1) with tests
  pushed to the branch and nobody but the owner able to merge it.
- **Nothing can be written.** Every route is a GET. You cannot create a work
  order, reassign an engineer, mark a job done or record a payment. The front end
  is a read-only viewer.
- **No payments table.** `Invoice.paid` is a boolean, so a statement cannot show
  payments received, payment dates or part payments. The statement payload says
  so in `notes[0]`. Trelawney will probably want them.
- **No auth.** Customer names, addresses and balances on unauthenticated
  endpoints. Fine on localhost, not anywhere else.
- **No CI.** JOB D was merged and then silently wiped by a later merge cut from
  before it, and nothing noticed. A test run on every PR is the systemic fix for
  the incident that started all this.
- **Addresses are still matched as strings.** Case and punctuation are handled;
  `Mill Ln` vs `Mill Lane` is not. That needs a UPRN.
- **Engineer availability is thin.** Overlap is now refused, but nothing models
  travel time between addresses, shift patterns or working hours - W-5006 is a
  23:30 job and nothing asks whether anyone is on shift.
- **Experimental Node features.** `node:sqlite` and `--experimental-strip-types`
  are both experimental. Zero-install is bought with that; fine internally, worth
  knowing before production.
- **No CLAUDE.md or contributor guide.** Still on Priya's list.

## Detail on the fixed bugs, kept for the history

---|---|
| A — VAT on invoices | Done. Merged as `c9ba219`. |
| B — two vans to one house | **Not fixed here.** Fix exists on a branch, PR never merged. |
| C — customer statements | **Not started.** Also not specified. |
| D — wrong day / wrong time quoted | **Fixed, then lost.** Regressed back into main. |

---

## JOB B — two engineers sent to the same house

Live on this fork. Reproduce:

```
node --experimental-strip-types -e "import('./src/scheduling/dispatch.ts').then(async m=>{const {workOrders}=await import('./src/db.ts');console.log(m.dispatch(workOrders).filter(a=>/ashfield/i.test(a.address)))})"
```

Returns two assignments to Mrs Whitcombe's house on 2 Sep, 08:00 and 08:30 —
the complaint Marcus raised, which he says happens most weeks.

**Cause.** `alreadyVisiting` in `src/scheduling/dispatch.ts` compares addresses
with `===`. Addresses are free text typed by whoever takes the call, so
W-5001 `'14 Ashfield Row, Bristol'` and W-5002 `'14 ashfield row, bristol'` are
one house and two strings. The duplicate check runs; it just never matches.

**Fix already written.** Branch `fix/duplicate-dispatch-address-match` on
`rialtas-dev`, by rbs-ben, plus two tests added on top. Compares on a
lower-cased, punctuation-stripped, space-collapsed key. Comparison only — the
address the engineer is given is still the one that was typed.

**Why it is not merged.** The PR was raised against `ao92265/thornbury-systems`
(open, PR #1), not `rialtas-dev`, where jobs A and D went. Nobody with merge
rights on `ao92265` has actioned it.

**Known limitation of that fix.** It does not expand abbreviations, so
`Mill Ln` and `Mill Lane` are still two addresses. That is deliberate:
wrongly merging two real addresses drops a visit the customer is waiting in
for, and a no-show is worse than a double visit. Doing better needs a real
property identifier (UPRN) rather than more string handling.

## JOB D — customers told the wrong day, and the wrong time

Live on this fork, and this one had already been fixed once. Reproduce:

```
node --experimental-strip-types -e "import('./src/scheduling/slots.ts').then(async m=>{const {workOrders}=await import('./src/db.ts');console.log(m.slotFor(workOrders.find(w=>w.id==='W-5006')))})"
```

W-5006 is Trelawney's night-shift backflow test, stored `2026-09-02T23:30:00Z`.
In Thornbury that is **00:30 on 3 September**. The endpoint reports
`date: '2026-09-02'` — the customer is sent on site 24 hours early.

Run the same command with `TZ=UTC` and the quoted window shifts by an hour
(`22:30 to 01:15` against `23:30 to 02:15` on a UK-local host). The day comes
from `toISOString()`, always UTC; the time comes from `getHours()`, whatever
zone the process runs in. Two different zones in one answer.

**This is W-4412**, closed twice as cannot-reproduce. It does not reproduce in
winter, when UK local and UTC agree, and it does not reproduce on a developer
laptop set to Europe/London, because the time half comes out right there. The
servers run UTC and the reports come in the summer. See the comment history in
`src/scheduling/slots.ts`.

**It was fixed.** PR #2 `job-d-timezone` merged to `rialtas-dev/main` at 14:18
on 1 Sep as `17b90a1`, rewriting `src/shared/dates.ts` to compute every
customer-facing calendar value in `Europe/London` explicitly via `Intl`.

**Then it was lost.** PR #3 (VAT) merged at 14:49 as `c9ba219`, and `c9ba219`
sits directly on top of `4356ba2` — the commit *before* JOB D.
`git merge-base --is-ancestor 17b90a1 origin/main` returns false: JOB D's merge
commit is not in main's history at all. The VAT branch was cut before JOB D and
landed in a way that overwrote it.

Recovering it is a cherry-pick of `job-d-timezone` onto current main. Worth
checking at the same time whether that merge clobbered anything else.

## JOB C — customer statements

Not started. `grep -ri statement src test` returns nothing; there is no endpoint.

Trelawney Foods asked on 5 Aug for "a statement like our other suppliers send"
because their finance team reconciles four invoice PDFs by hand every quarter.
The front end will render whatever an endpoint returns.

This is not blocked on code. Nobody has agreed what goes on a statement —
period covered, opening and closing balance, per-invoice lines, a VAT summary,
payments received. That needs deciding before anything is built.

---

# Not on the job list, found while fixing JOB B

## Engineers get double-booked

`dispatch` has no availability check at all. It takes the first engineer whose
skills match and never asks what that engineer is already doing. Before JOB B's
duplicate was suppressed, both Whitcombe jobs went to E-01 at 08:00 and 08:30 —
one engineer, two overlapping jobs. Deduping the address hides it in this
dataset. The absence of the check is still there.

## The duplicate check counts days in UTC

`alreadyVisiting` calls `sameDay`, which compares UTC days. Two visits to one
house at 23:00 and 01:00 UK time are the same UK day but different UTC days, so
the check misses them; W-5003 and W-5006 are the mirror case and get wrongly
treated as duplicates. This resolves itself when JOB D is restored — its
`toDateKey` returns the UK day — which is another reason to restore it.

## `invoices.test.ts` and the VAT work

When JOB A landed, `totalFor` became VAT-inclusive. Three tests in
`test/invoices.test.ts` briefly failed against the old ex-VAT expectations.
They pass on this fork, so it was reconciled — but the pairing of a
VAT-inclusive `totalFor` with an `outstandingFor` that is also VAT-inclusive is
worth one read-through by whoever owns billing.
