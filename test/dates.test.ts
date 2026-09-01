import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWorkingDay, addWorkingDays, toDateKey, formatSlotTime, sameDay } from '../src/shared/dates.ts';

test('weekends are not working days', () => {
  assert.equal(isWorkingDay(new Date('2026-09-05T12:00:00Z')), false);
  assert.equal(isWorkingDay(new Date('2026-09-06T12:00:00Z')), false);
});

test('bank holidays are not working days', () => {
  assert.equal(isWorkingDay(new Date('2026-12-25T12:00:00Z')), false);
});

test('adding working days skips the weekend', () => {
  const friday = new Date('2026-09-04T12:00:00Z');
  assert.equal(toDateKey(addWorkingDays(friday, 1)), '2026-09-07');
});

// JOB-D / W-4412. Everything the customer sees is UK local; everything we store
// is UTC. For half the year those are different days, and the day is what the
// confirmation prints. Every test above uses a midday instant, which is exactly
// why none of them could ever fail: midday agrees in both zones. The boundary
// only exists late in the evening, in summer.
test('the customer day for a late BST appointment is the UK day, not the UTC day', () => {
  // 23:30Z on 2 Sep is 00:30 on 3 Sep in Thornbury. The customer is expecting an
  // engineer on the 3rd.
  assert.equal(toDateKey(new Date('2026-09-02T23:30:00Z')), '2026-09-03');
  // In winter the two agree, which is why this was never reproducible in January.
  assert.equal(toDateKey(new Date('2026-01-14T23:30:00Z')), '2026-01-14');
});

test('a UK working day is judged on the UK calendar', () => {
  // 23:00Z on the Friday is already Saturday in Thornbury during BST.
  assert.equal(isWorkingDay(new Date('2026-09-04T23:00:00Z')), false);
  // And 23:30Z on the Sunday of the August bank holiday weekend is the holiday
  // itself, 31 Aug.
  assert.equal(isWorkingDay(new Date('2026-08-30T23:30:00Z')), false);
});

// The other half of W-4412, 'the window was an hour out'. That was never a data
// fault: formatSlotTime used to read the host machine's clock, so it rendered
// correctly on a Europe/London laptop and an hour early on the UTC servers.
// These are anchored to fixed instants, so they give the same answer whatever
// timezone the box running them is set to.
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

// Matters for dispatch, which allows one visit per address per day: two visits
// either side of UK midnight are two days, even when UTC says otherwise.
test('the same UK day is judged on the UK calendar', () => {
  const beforeMidnight = new Date('2026-09-02T22:00:00Z'); // 23:00 on the 2nd
  const afterMidnight = new Date('2026-09-02T23:30:00Z'); // 00:30 on the 3rd
  assert.equal(sameDay(beforeMidnight, afterMidnight), false);
  assert.equal(sameDay(beforeMidnight, new Date('2026-09-02T12:00:00Z')), true);
});
