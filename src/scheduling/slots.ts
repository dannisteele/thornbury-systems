import { formatSlotTime, toDateKey } from '../shared/dates.ts';
import type { WorkOrder } from '../db.ts';

export interface Slot {
  workOrderId: string;
  // What we tell the customer. UK local time.
  window: string;
  // The UK local day of the appointment itself.
  date: string;
  // Both ends of the window, UK local, spelled out. An out of hours job can open
  // its window on the day before the appointment: W-5006 is a 00:30 visit whose
  // window opens at 23:30 the previous evening, so `window` and `date` alone read
  // as though it opens at 23:30 on the day of. These two are never ambiguous.
  windowFrom: string;
  windowTo: string;
}

// W-4412, closed twice as cannot reproduce, reopened as JOB-D: fixed. The stored
// times were always right, which is why looking at them told nobody anything. The
// bug was in the printing: this slice took the UTC calendar day, and formatSlotTime
// rendered in the host machine's timezone. Both agree with UK local often enough to
// stay hidden on a developer laptop in winter, and neither is correct. See
// shared/dates.ts for the rule.
const WINDOW_PADDING_MINUTES = 60;

// The customer is given a window, not a time: the requested time, minus an hour,
// through the requested time plus the job length plus an hour.
export function slotFor(order: WorkOrder): Slot {
  const start = new Date(order.requestedAt);
  const from = new Date(start.getTime() - WINDOW_PADDING_MINUTES * 60_000);
  const to = new Date(
    start.getTime() + (order.durationMinutes + WINDOW_PADDING_MINUTES) * 60_000,
  );

  return {
    workOrderId: order.id,
    window: `${formatSlotTime(from)} to ${formatSlotTime(to)}`,
    // The UK local day, not the UTC one. A 23:30Z job in summer is tomorrow.
    date: toDateKey(start),
    windowFrom: `${toDateKey(from)} ${formatSlotTime(from)}`,
    windowTo: `${toDateKey(to)} ${formatSlotTime(to)}`,
  };
}

export function slotsFor(orders: WorkOrder[]): Slot[] {
  return orders.map(slotFor);
}
