import { engineers, type Engineer, type WorkOrder } from '../db.ts';
import { sameDay } from '../shared/dates.ts';

export interface Assignment {
  workOrderId: string;
  engineerId: string;
  address: string;
  startsAt: string;
}

function canDo(engineer: Engineer, order: WorkOrder): boolean {
  return engineer.skills.includes(order.requires);
}

// Addresses are typed by whoever takes the call, so the same house arrives
// spelled several different ways. Compare on a flattened form: lower case, no
// punctuation, single spaces. Comparison only - we never write this back, the
// address the engineer is given stays exactly as it was typed.
//
// This deliberately does not expand abbreviations (Rd/Road, St/Street). Guessing
// two addresses are the same when they are not drops a real visit, which is a
// worse failure than the one being fixed here.
function addressKey(address: string): string {
  return address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// One visit per address per day. Sending two vans to the same house on the same
// morning is the single biggest source of complaints on the support queue.
function alreadyVisiting(address: string, when: Date, planned: Assignment[]): boolean {
  const key = addressKey(address);
  return planned.some(
    (a) => addressKey(a.address) === key && sameDay(new Date(a.startsAt), when),
  );
}

interface Booking {
  from: number;
  to: number;
}

// Two jobs clash if either one is still running when the other starts. Touching
// ends are not a clash: a job finishing at 09:00 and the next starting at 09:00
// is an ordinary back to back morning, and treating that as a double booking
// would spread every round across the whole team for nothing.
function overlaps(a: Booking, b: Booking): boolean {
  return a.from < b.to && b.from < a.to;
}

export function dispatch(orders: WorkOrder[]): Assignment[] {
  const planned: Assignment[] = [];
  // What each engineer has been given so far in this plan, so we can ask whether
  // they are actually free rather than just qualified.
  const booked = new Map<string, Booking[]>();

  for (const order of orders) {
    if (order.status !== 'QUEUED') continue;
    const when = new Date(order.requestedAt);

    if (alreadyVisiting(order.address, when, planned)) continue;

    // The job runs from the requested time for as long as the job takes. That is
    // the window the engineer is unavailable for.
    const booking: Booking = {
      from: when.getTime(),
      to: when.getTime() + order.durationMinutes * 60_000,
    };

    // Skill was never enough on its own: the old code took the first engineer who
    // could do the work and never asked what they were already doing, so two
    // overlapping jobs went to the same man. Take the first who can do it *and*
    // is free. If nobody is, the order drops out of the plan exactly as it always
    // has when nobody has the skill - better a gap the scheduler can see than a
    // visit that was never going to happen.
    const engineer = engineers.find(
      (e) => canDo(e, order) && !(booked.get(e.id) ?? []).some((b) => overlaps(b, booking)),
    );
    if (!engineer) continue;

    booked.set(engineer.id, [...(booked.get(engineer.id) ?? []), booking]);

    planned.push({
      workOrderId: order.id,
      engineerId: engineer.id,
      address: order.address,
      startsAt: order.requestedAt,
    });
  }

  return planned;
}
