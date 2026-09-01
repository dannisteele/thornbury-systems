// Regression tests for JOB-D / W-4412: a late appointment confirmed for the wrong
// day. Closed twice as cannot reproduce.
//
// Every case here is anchored to a fixed instant and a fixed expected UK local
// answer, so it gives the same result whatever timezone the machine running it is
// set to. That is the property the old code lacked and the reason it stayed hidden:
// the suite agreed with whatever box it ran on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDateKey, formatSlotTime, isWorkingDay, sameDay } from '../src/shared/dates.ts';
import { slotFor } from '../src/scheduling/slots.ts';
import { workOrders, type WorkOrder } from '../src/db.ts';

const order = (id: string): WorkOrder => workOrders.find((w) => w.id === id)!;

test('THE BUG: a late summer appointment is confirmed for the UK local day', () => {
  // W-5006 is stored 2026-09-02T23:30Z. Britain is on BST, so that instant is
  // 00:30 on the 3rd. The confirmation used to say the 2nd.
  const slot = slotFor(order('W-5006'));
  assert.equal(slot.date, '2026-09-03');
});

test('the window of a cross midnight job is spelled out at both ends', () => {
  const slot = slotFor(order('W-5006'));
  // The window opens the evening before the appointment. `window` and `date`
  // together cannot express that, so these two carry the full answer.
  assert.equal(slot.windowFrom, '2026-09-02 23:30');
  assert.equal(slot.windowTo, '2026-09-03 02:15');
});

test('a daytime appointment is unaffected', () => {
  const slot = slotFor(order('W-5001'));
  assert.equal(slot.date, '2026-09-02');
  assert.equal(slot.window, '08:00 to 11:00');
});

test('WHY IT NEVER REPRODUCED IN WINTER: the same job in January is fine either way', () => {
  // Identical shape, GMT instead of BST. UTC and UK local agree, so the old
  // UTC-slicing code got the right answer by accident for half the year.
  const winter: WorkOrder = { ...order('W-5006'), id: 'W-WINTER', requestedAt: '2026-01-14T23:30:00Z' };
  assert.equal(slotFor(winter).date, '2026-01-14');
  assert.equal(toDateKey(new Date('2026-01-14T23:30:00Z')), '2026-01-14');
  // The same instant six months later lands on the next day.
  assert.equal(toDateKey(new Date('2026-07-14T23:30:00Z')), '2026-07-15');
});

test('times are rendered in UK local, not in UTC and not in the host timezone', () => {
  // 12:00Z is 13:00 in Britain in summer and 12:00 in winter.
  assert.equal(formatSlotTime(new Date('2026-07-01T12:00:00Z')), '13:00');
  assert.equal(formatSlotTime(new Date('2026-01-01T12:00:00Z')), '12:00');
  // Midnight is 00:00, not 24:00.
  assert.equal(formatSlotTime(new Date('2026-07-01T23:00:00Z')), '00:00');
});

test('the clocks going forward and back are handled', () => {
  // BST begins 01:00Z on 29 Mar 2026 and ends 02:00Z on 25 Oct 2026.
  assert.equal(formatSlotTime(new Date('2026-03-29T00:30:00Z')), '00:30'); // still GMT
  assert.equal(formatSlotTime(new Date('2026-03-29T01:30:00Z')), '02:30'); // BST
  assert.equal(formatSlotTime(new Date('2026-10-25T00:30:00Z')), '01:30'); // still BST
  assert.equal(formatSlotTime(new Date('2026-10-25T02:30:00Z')), '02:30'); // GMT
});

test('a bank holiday is judged on the UK local day', () => {
  // 31 Aug 2026 is the summer bank holiday. This instant is 23:30 on the 30th in
  // UTC but 00:30 on the 31st in Britain, so it is a bank holiday.
  assert.equal(isWorkingDay(new Date('2026-08-30T23:30:00Z')), false);
  // And a genuine 30 Aug daytime instant is a Sunday, also not a working day.
  assert.equal(isWorkingDay(new Date('2026-08-28T12:00:00Z')), true); // Friday
});

test('weekends are judged on the UK local day too', () => {
  // 23:30Z on Friday 4 Sep is 00:30 Saturday in Britain.
  assert.equal(isWorkingDay(new Date('2026-09-04T23:30:00Z')), false);
  assert.equal(isWorkingDay(new Date('2026-09-04T12:00:00Z')), true);
});

test('two visits either side of UK midnight are not the same day', () => {
  // Matters for dispatch, which allows one visit per address per day.
  const beforeMidnight = new Date('2026-09-02T22:00:00Z'); // 23:00 on the 2nd
  const afterMidnight = new Date('2026-09-02T23:30:00Z'); // 00:30 on the 3rd
  assert.equal(sameDay(beforeMidnight, afterMidnight), false);
});
