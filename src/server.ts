import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { customers, invoices, workOrders, type Customer, type Invoice } from './db.ts';
import { totalFor, outstandingFor } from './invoices/calc.ts';
import { dispatch } from './scheduling/dispatch.ts';
import { slotsFor } from './scheduling/slots.ts';
import { toDateKey, formatSlotTime } from './shared/dates.ts';
import { format } from './shared/money.ts';
import { statementFor, currentQuarter, StatementRangeError } from './invoices/statement.ts';

const PORT = Number(process.env.PORT ?? 4310);

// The front end is plain static files served off the same origin, so it can
// call '/customers' and friends with no CORS and no configured base URL.
const WEB_ROOT = fileURLToPath(new URL('../web/', import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// Anything under these prefixes is the API. Everything else falls through to
// the static front end, so adding a page never needs a route added here.
const API_PREFIXES = new Set(['api', 'customers', 'invoices', 'work-orders', 'dispatch', 'slots']);

// Serve a file from web/, refusing anything that escapes it. normalize() plus
// the prefix check is what stops '../../etc/passwd' style paths.
async function serveStatic(res: import('node:http').ServerResponse, pathname: string) {
  // Strip any leading separators so join() cannot be talked into an absolute path.
  let rel = normalize(decodeURIComponent(pathname));
  while (rel.startsWith('/') || rel.startsWith(sep)) rel = rel.slice(1);
  const full = join(WEB_ROOT, rel === '' ? 'index.html' : rel);
  if (!full.startsWith(WEB_ROOT.endsWith(sep) ? WEB_ROOT : WEB_ROOT + sep)) {
    return json(res, 403, { error: 'nope' });
  }
  try {
    const body = await readFile(full);
    res.writeHead(200, { 'content-type': CONTENT_TYPES[extname(full)] ?? 'application/octet-stream' });
    return res.end(body);
  } catch {
    return json(res, 404, { error: 'no such route', path: pathname });
  }
}

function json(res: import('node:http').ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

// VAT liability depends on who the invoice is for, so totals are always
// resolved against the customer rather than from the invoice alone.
function withTotals(invoice: Invoice, customer: Customer) {
  const totals = totalFor(invoice, customer);
  return {
    ...invoice,
    ...totals,
    display: format(totals.total),
    displayNet: format(totals.net),
    displayVat: format(totals.vat),
  };
}

export const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (parts.length === 0) {
    return void serveStatic(res, '/index.html');
  }

  if (parts[0] === 'api' && parts.length === 1) {
    return json(res, 200, {
      service: 'Thornbury Systems billing and scheduling',
      version: '3.11.2',
      routes: [
        'GET /customers',
        'GET /customers/:id',
        'GET /customers/:id/invoices',
        'GET /invoices/:id',
        'GET /work-orders',
        'GET /dispatch',
        'GET /slots',
        'GET /customers/:id/statement?from=&to=',
      ],
    });
  }

  if (parts[0] === 'customers' && parts.length === 1) {
    return json(res, 200, customers);
  }

  if (parts[0] === 'customers' && parts.length === 2) {
    const customer = customers.find((c) => c.id === parts[1]);
    if (!customer) return json(res, 404, { error: 'no such customer' });
    const outstanding = outstandingFor(customer, invoices);
    return json(res, 200, {
      ...customer,
      // VAT inclusive, as on the invoices themselves.
      outstandingPence: outstanding,
      outstanding: format(outstanding),
    });
  }

  if (parts[0] === 'customers' && parts.length === 3 && parts[2] === 'invoices') {
    const customer = customers.find((c) => c.id === parts[1]);
    if (!customer) return json(res, 404, { error: 'no such customer' });
    return json(
      res,
      200,
      invoices.filter((i) => i.customerId === customer.id).map((i) => withTotals(i, customer)),
    );
  }

  // JOB C. Range defaults to the current quarter, which is what Trelawney's
  // finance team are reconciling. See docs/statement-contract.md.
  if (parts[0] === 'customers' && parts.length === 3 && parts[2] === 'statement') {
    const customer = customers.find((c) => c.id === parts[1]);
    if (!customer) return json(res, 404, { error: 'no such customer' });
    const quarter = currentQuarter();
    const from = url.searchParams.get('from') ?? quarter.from;
    const to = url.searchParams.get('to') ?? quarter.to;
    try {
      return json(res, 200, statementFor(customer, invoices, from, to));
    } catch (err) {
      if (err instanceof StatementRangeError) return json(res, 400, { error: err.message, from, to });
      throw err;
    }
  }

  if (parts[0] === 'invoices' && parts.length === 2) {
    const invoice = invoices.find((i) => i.id === parts[1]);
    if (!invoice) return json(res, 404, { error: 'no such invoice' });
    const customer = customers.find((c) => c.id === invoice.customerId);
    if (!customer) return json(res, 500, { error: 'invoice has no customer', id: invoice.id });
    return json(res, 200, withTotals(invoice, customer));
  }

  if (parts[0] === 'work-orders') {
    return json(res, 200, workOrders);
  }

  if (parts[0] === 'dispatch') {
    // The plan itself is pure UTC. The timeline needs to lay jobs out on a UK
    // clock, so the UK values are resolved here with the same Europe/London
    // helpers the customer-facing slots use. The front end must never derive
    // them itself - deriving a local date in the browser is W-4412 / JOB D.
    return json(
      res,
      200,
      dispatch(workOrders).map((a) => {
        const order = workOrders.find((w) => w.id === a.workOrderId);
        const minutes = order?.durationMinutes ?? 0;
        const start = new Date(a.startsAt);
        const end = new Date(start.getTime() + minutes * 60_000);
        return {
          ...a,
          durationMinutes: minutes,
          ukDate: toDateKey(start),
          ukStart: formatSlotTime(start),
          ukEnd: formatSlotTime(end),
          ukEndDate: toDateKey(end),
        };
      }),
    );
  }

  if (parts[0] === 'slots') {
    return json(res, 200, slotsFor(workOrders));
  }

  // Not an API path, so it is the front end.
  if (!API_PREFIXES.has(parts[0] ?? '')) {
    return void serveStatic(res, url.pathname);
  }

  return json(res, 404, { error: 'no such route', path: url.pathname });
});

if (process.argv[1]?.endsWith('server.ts')) {
  server.listen(PORT, () => {
    console.log(`Thornbury Systems listening on http://localhost:${PORT}`);
  });
}
