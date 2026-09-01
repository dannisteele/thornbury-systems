import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { slotFor } from '../src/scheduling/slots.ts';
import { dispatch } from '../src/scheduling/dispatch.ts';
import { workOrders } from '../src/db.ts';

test('a customer is quoted a window around the requested time', () => {
  const order = workOrders.find((w) => w.id === 'W-5001')!;
  const slot = slotFor(order);
  assert.equal(slot.window, '08:00 to 11:00');
  assert.equal(slot.date, '2026-09-02');
});

test('dispatch only plans queued work', () => {
  const plan = dispatch(workOrders.map((w) => ({ ...w, status: 'DONE' as const })));
  assert.equal(plan.length, 0);
});

test('dispatch matches the required skill', () => {
  const plan = dispatch(workOrders);
  const backflow = plan.find((a) => a.workOrderId === 'W-5003');
  assert.equal(backflow?.engineerId, 'E-02');
});

test('one visit per address per day even when the address was typed differently', () => {
  // W-5001 and W-5002 are Mrs Whitcombe's meter and leak jobs, half an hour
  // apart. The addresses differ only in how the call handler typed them.
  const plan = dispatch(workOrders);
  const atHers = plan.filter((a) => a.workOrderId === 'W-5001' || a.workOrderId === 'W-5002');
  assert.equal(atHers.length, 1);
});

test('different addresses on the same day are both planned', () => {
  const plan = dispatch(workOrders);
  assert.ok(plan.some((a) => a.workOrderId === 'W-5004'));
  assert.ok(plan.some((a) => a.workOrderId === 'W-5005'));
});

// JOB-D / W-4412: Trelawney's night shift backflow test. Stored 23:30Z on 2 Sep,
// which is 00:30 on 3 Sep in Thornbury. The confirmation printed the 2nd and an
// engineer was expected 24 hours early.
test('a late appointment is confirmed on the UK day it happens', () => {
  const order = workOrders.find((w) => w.id === 'W-5006')!;
  const slot = slotFor(order);
  assert.equal(slot.date, '2026-09-03', 'customer sent to site on the wrong day');
  assert.equal(slot.window, '23:30 to 02:15');
});

// The window legitimately opens the evening before an out of hours visit, so
// `window` on its own reads as though the whole appointment is on `date`. These
// two fields are what make it unambiguous, and they are the reason `date` alone
// is not enough for a night shift job.
test('both ends of an out of hours window carry their own date', () => {
  const slot = slotFor(workOrders.find((w) => w.id === 'W-5006')!);
  assert.equal(slot.windowFrom, '2026-09-02 23:30');
  assert.equal(slot.windowTo, '2026-09-03 02:15');

  // A daytime job stays within one day on both ends.
  const day = slotFor(workOrders.find((w) => w.id === 'W-5001')!);
  assert.equal(day.windowFrom, '2026-09-02 08:00');
  assert.equal(day.windowTo, '2026-09-02 11:00');
});

// The other half of W-4412, 'the window was an hour out'. It was never
// reproducible because it depended on the timezone of the machine rendering it,
// not on the data: developer laptops are Europe/London, the servers are UTC.
// This is the guard that would have caught it on the build box.
test('the quoted slot does not depend on the host timezone', () => {
  const script = `
    import { slotFor } from './src/scheduling/slots.ts';
    import { workOrders } from './src/db.ts';
    const ids = ['W-5001', 'W-5006'];
    console.log(JSON.stringify(ids.map((id) => slotFor(workOrders.find((w) => w.id === id)))));
  `;
  const under = (tz: string) => {
    const out = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '--eval', script],
      {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: { ...process.env, TZ: tz },
        encoding: 'utf8',
      },
    );
    assert.equal(out.status, 0, out.stderr);
    return JSON.parse(out.stdout);
  };

  const expected = [
    {
      workOrderId: 'W-5001',
      window: '08:00 to 11:00',
      date: '2026-09-02',
      windowFrom: '2026-09-02 08:00',
      windowTo: '2026-09-02 11:00',
    },
    {
      workOrderId: 'W-5006',
      window: '23:30 to 02:15',
      date: '2026-09-03',
      windowFrom: '2026-09-02 23:30',
      windowTo: '2026-09-03 02:15',
    },
  ];
  for (const tz of ['UTC', 'Europe/London', 'America/New_York', 'Australia/Sydney']) {
    assert.deepEqual(under(tz), expected, `wrong under TZ=${tz}`);
  }
});

// The seed data only varies by case. These are the other ways a call handler
// types the same house: stray runs of spaces, a trailing full stop.
test('addresses differing only in case, spacing or punctuation are the same house', () => {
  const base = {
    customerId: 'C-1001', requires: 'LEAK', durationMinutes: 60,
    status: 'QUEUED' as const, requestedAt: '2026-09-02T08:00:00Z',
  };
  const plan = dispatch([
    { ...base, id: 'X-1', address: '14 Ashfield Row, Bristol' },
    { ...base, id: 'X-2', address: '  14   ASHFIELD ROW,  BRISTOL ' },
    { ...base, id: 'X-3', address: '14 Ashfield Row Bristol.' },
  ]);
  assert.equal(plan.length, 1);
});

// The dangerous direction, and the one the comment on addressKey is about:
// over-matching cancels a visit the customer is waiting in for, which is worse
// than the duplicate this all exists to prevent. Near misses, not obviously
// different addresses - a house number and a street type apart.
test('near-miss addresses are still visited separately', () => {
  const base = {
    customerId: 'C-1003', requires: 'LEAK', durationMinutes: 60,
    status: 'QUEUED' as const, requestedAt: '2026-09-02T08:00:00Z',
  };
  const plan = dispatch([
    { ...base, id: 'Y-1', address: '2 Bell Lane, Thornbury' },
    { ...base, id: 'Y-2', address: '12 Bell Lane, Thornbury' },
    { ...base, id: 'Y-3', address: '2 Bell Road, Thornbury' },
  ]);
  assert.equal(plan.length, 3);
});

// Found while fixing JOB B: dispatch took the first engineer with the right
// skill and never asked what that engineer was already doing. Both of Mrs
// Whitcombe's jobs went to E-01 at 08:00 and 08:30, one man in two places.
// Deduping the address hid it in the seed data; the missing check was still
// there. An engineer cannot be in two places at once, so a job that overlaps
// one they already have has to go to somebody else.
test('an engineer is not given a job overlapping one they already have', () => {
  const base = {
    customerId: 'C-1001', requires: 'METER', durationMinutes: 60,
    status: 'QUEUED' as const,
  };
  const plan = dispatch([
    { ...base, id: 'Z-1', address: '14 Ashfield Row, Bristol', requestedAt: '2026-09-02T08:00:00Z' },
    { ...base, id: 'Z-2', address: '2 Bell Lane, Thornbury', requestedAt: '2026-09-02T08:30:00Z' },
  ]);
  assert.equal(plan.length, 2);
  // E-01 and E-02 both hold METER. The second job overlaps the first by half an
  // hour, so it has to fall through to E-02.
  assert.equal(plan.find((a) => a.workOrderId === 'Z-1')?.engineerId, 'E-01');
  assert.equal(plan.find((a) => a.workOrderId === 'Z-2')?.engineerId, 'E-02');
});

// Back to back is a normal working day, not a clash. One job ending at exactly
// the moment the next starts must stay with the same engineer, or every round
// gets spread across the whole team for no reason.
test('back to back jobs stay with the same engineer', () => {
  const base = {
    customerId: 'C-1001', requires: 'METER', durationMinutes: 60,
    status: 'QUEUED' as const,
  };
  const plan = dispatch([
    { ...base, id: 'Z-3', address: '14 Ashfield Row, Bristol', requestedAt: '2026-09-02T08:00:00Z' },
    { ...base, id: 'Z-4', address: '2 Bell Lane, Thornbury', requestedAt: '2026-09-02T09:00:00Z' },
  ]);
  assert.equal(plan.length, 2);
  assert.equal(plan.find((a) => a.workOrderId === 'Z-3')?.engineerId, 'E-01');
  assert.equal(plan.find((a) => a.workOrderId === 'Z-4')?.engineerId, 'E-01');
});

// Nobody free is the same answer as nobody qualified: the order is left out of
// the plan for the scheduler to deal with, rather than double-booked onto
// somebody who cannot do it.
test('an order nobody qualified is free for goes unassigned', () => {
  const base = {
    customerId: 'C-1002', requires: 'BACKFLOW', durationMinutes: 45,
    status: 'QUEUED' as const,
  };
  // E-02 is the only engineer with BACKFLOW, so the second of two overlapping
  // backflow tests has nowhere to go.
  const plan = dispatch([
    { ...base, id: 'Z-5', address: 'Unit 6, Severnside Park, Avonmouth', requestedAt: '2026-09-02T09:00:00Z' },
    { ...base, id: 'Z-6', address: 'Gloucester Road, Thornbury', requestedAt: '2026-09-02T09:15:00Z' },
  ]);
  assert.equal(plan.length, 1);
  assert.equal(plan[0]?.workOrderId, 'Z-5');
});
