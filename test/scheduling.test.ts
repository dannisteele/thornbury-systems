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
