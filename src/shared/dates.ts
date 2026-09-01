// Date helpers shared by billing and scheduling.
//
// Everything the customer sees is UK local time. Everything we store is UTC.
// The two are not the same thing for half the year and this file is where that
// kept going wrong.
//
// The rule, and the reason W-4412 was closed twice as cannot reproduce:
//
//   Never use getHours/getDay/getDate/toISOString to work out what the customer
//   sees. getHours and friends answer in whatever timezone the machine running
//   the process happens to be in, and toISOString always answers in UTC. Neither
//   is "UK local". They only agree with UK local by luck: toISOString agrees in
//   winter, and getHours agrees on a machine set to Europe/London. Between them
//   they cover every box anybody tested on, which is why this looked green on
//   two developer laptops and the build box while customers kept complaining.
//
// Everything customer facing goes through Europe/London explicitly, below.

const UK = 'Europe/London';

// en-CA formats as YYYY-MM-DD, which is the key format we already use.
const ukDateKey = new Intl.DateTimeFormat('en-CA', {
  timeZone: UK,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const ukTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK,
  hour: '2-digit',
  minute: '2-digit',
  // h23 so midnight is 00:00 and not 24:00.
  hourCycle: 'h23',
});

const ukWeekday = new Intl.DateTimeFormat('en-GB', { timeZone: UK, weekday: 'short' });

export const BANK_HOLIDAYS_2026 = [
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04',
  '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
];

// The UK local calendar day an instant falls on. This is the day the customer
// means when they say "Thursday", and the day the business books work against.
export function toDateKey(d: Date): string {
  return ukDateKey.format(d);
}

export function isWorkingDay(d: Date): boolean {
  const day = ukWeekday.format(d);
  if (day === 'Sat' || day === 'Sun') return false;
  return !BANK_HOLIDAYS_2026.includes(toDateKey(d));
}

export function addWorkingDays(from: Date, n: number): Date {
  const d = new Date(from.getTime());
  let left = n;
  while (left > 0) {
    // Steps in UTC, so the step size does not change with the host timezone or
    // across a DST boundary. Whether the day that lands on is a working day is
    // still judged in UK local time, by isWorkingDay.
    d.setUTCDate(d.getUTCDate() + 1);
    if (isWorkingDay(d)) left--;
  }
  return d;
}

// What the customer is told their appointment time is. UK local, always.
export function formatSlotTime(d: Date): string {
  return ukTime.format(d);
}

export function sameDay(a: Date, b: Date): boolean {
  return toDateKey(a) === toDateKey(b);
}
