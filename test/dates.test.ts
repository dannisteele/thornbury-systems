import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWorkingDay, addWorkingDays, toDateKey } from '../src/shared/dates.ts';

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
