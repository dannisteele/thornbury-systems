import { test } from 'node:test';
import assert from 'node:assert/strict';
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
