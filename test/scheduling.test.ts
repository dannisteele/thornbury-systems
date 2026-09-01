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
