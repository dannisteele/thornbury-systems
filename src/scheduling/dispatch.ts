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

export function dispatch(orders: WorkOrder[]): Assignment[] {
  const planned: Assignment[] = [];

  for (const order of orders) {
    if (order.status !== 'QUEUED') continue;
    const when = new Date(order.requestedAt);

    if (alreadyVisiting(order.address, when, planned)) continue;

    const engineer = engineers.find((e) => canDo(e, order));
    if (!engineer) continue;

    planned.push({
      workOrderId: order.id,
      engineerId: engineer.id,
      address: order.address,
      startsAt: order.requestedAt,
    });
  }

  return planned;
}
