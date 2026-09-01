/* Thornbury Systems web front end.
 *
 * Vanilla JS, no build step, no dependencies. Served as static files from the
 * same origin as the JSON API, so every fetch uses a root-relative path.
 *
 * Two house rules that this file exists to respect:
 *   1. MONEY. The API sends preformatted `display...` strings alongside every
 *      pence field. We render the strings. There is no arithmetic on money in
 *      this file, and nothing is ever divided by 100.
 *   2. DATES. The API sends date and time strings already in the form the
 *      business wants. We slice and print them. We never build a Date object
 *      from an API value and reformat it — that reintroduces the timezone bug.
 */

'use strict';

/* ------------------------------------------------------------------ *
 * Tiny helpers
 * ------------------------------------------------------------------ */

const PIP = 'assets/pip-the-parrot.png';

/** Escape for interpolation into HTML. */
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape for use inside a URL hash fragment. */
function seg(value) {
  return encodeURIComponent(String(value));
}

/**
 * Return the first key on `obj` that holds a string, or an em dash.
 * Money is only ever rendered through this: it picks the API's preformatted
 * display string and never falls back to doing sums.
 */
function disp(obj, ...keys) {
  if (!obj) return '—';
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.length) return v;
  }
  return '—';
}

/**
 * The calendar date part of a stored timestamp, taken by slicing the string.
 * Deliberately NOT `new Date(...)` — see the header note.
 */
function datePart(iso) {
  return typeof iso === 'string' ? iso.slice(0, 10) : '';
}

/** The clock time part of a stored UTC timestamp, again by slicing. */
function timePart(iso) {
  return typeof iso === 'string' && iso.length >= 16 ? iso.slice(11, 16) : '';
}

/** Normalised address key, for spotting the same house written two ways. */
function addressKey(address) {
  return String(address || '')
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ *
 * API
 * ------------------------------------------------------------------ */

class ApiError extends Error {
  constructor(message, status, path) {
    super(message);
    this.status = status;
    this.path = path;
  }
}

async function api(path) {
  let res;
  try {
    res = await fetch(path, { headers: { accept: 'application/json' } });
  } catch (networkError) {
    throw new ApiError('Could not reach the billing service.', 0, path);
  }

  let body = null;
  try {
    body = await res.json();
  } catch (parseError) {
    if (!res.ok) throw new ApiError('The service returned an error.', res.status, path);
    throw new ApiError('The service sent something that was not JSON.', res.status, path);
  }

  if (!res.ok) {
    const message = body && typeof body.error === 'string' ? body.error : 'Request failed.';
    throw new ApiError(message, res.status, path);
  }
  return body;
}

/* ------------------------------------------------------------------ *
 * Shared view chrome
 * ------------------------------------------------------------------ */

const viewEl = document.getElementById('view');

function setView(html) {
  viewEl.innerHTML = html;
}

function pipSays(message) {
  return `
    <aside class="pip-says">
      <span class="pip-mark" aria-hidden="true"></span>
      <p><strong>Pip says:</strong> ${message}</p>
    </aside>`;
}

function loadingState(what) {
  return `
    <div class="state" role="status" aria-live="polite">
      <img class="flap" src="${PIP}" width="120" height="120" alt="">
      <h2>Fetching ${esc(what)}…</h2>
      <p>Pip has flown off to the billing service. One moment.</p>
      <div style="max-width:420px;margin:1.2rem auto 0">
        <div class="skeleton" style="width:90%"></div>
        <div class="skeleton" style="width:70%"></div>
        <div class="skeleton" style="width:80%"></div>
      </div>
    </div>`;
}

function errorState(err, what) {
  const status = err instanceof ApiError && err.status ? `HTTP ${err.status}` : 'No response';
  const path = err instanceof ApiError && err.path ? err.path : '';
  const headline =
    err instanceof ApiError && err.status === 404
      ? 'Nothing here'
      : 'That did not work';
  return `
    <div class="state error" role="alert">
      <img src="${PIP}" width="120" height="120" alt="">
      <h2>${headline}</h2>
      <p>Pip could not load ${esc(what)}.</p>
      <p class="detail"><strong>${esc(err.message)}</strong></p>
      <p class="detail mono">${esc(status)}${path ? ' · ' + esc(path) : ''}</p>
      <p><button class="btn" type="button" onclick="location.reload()">Try again</button></p>
    </div>`;
}

function emptyState(title, body) {
  return `
    <div class="state">
      <img src="${PIP}" width="120" height="120" alt="">
      <h2>${esc(title)}</h2>
      <p>${esc(body)}</p>
    </div>`;
}

function accountPill(customer) {
  const type = customer.accountType === 'COMMERCIAL' ? 'commercial' : 'domestic';
  const label = customer.accountType === 'COMMERCIAL' ? 'Commercial' : 'Domestic';
  return `<span class="pill pill-${type}">${label}</span>`;
}

function vatPill(customer) {
  return customer.vatRegistered
    ? '<span class="pill pill-vat">VAT registered</span>'
    : '';
}

function paidPill(paid) {
  return paid
    ? '<span class="pill pill-paid">Paid</span>'
    : '<span class="pill pill-unpaid">Outstanding</span>';
}

function statusPill(status) {
  const cls = { QUEUED: 'queued', DISPATCHED: 'dispatched', DONE: 'done' }[status] || 'skill';
  const label = { QUEUED: 'Queued', DISPATCHED: 'Dispatched', DONE: 'Done' }[status] || status;
  return `<span class="pill pill-${cls}">${esc(label)}</span>`;
}

function markNav(name) {
  document.querySelectorAll('.mainnav a[data-nav]').forEach((a) => {
    if (a.dataset.nav === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

/* ------------------------------------------------------------------ *
 * View: customer list
 * ------------------------------------------------------------------ */

async function customerListView() {
  markNav('customers');
  document.title = 'Customers — Thornbury Systems';
  setView(loadingState('the customer list'));

  let customers;
  try {
    customers = await api('/customers');
  } catch (err) {
    setView(errorState(err, 'the customer list'));
    return;
  }

  const hero = `
    <div class="hero">
      <img src="${PIP}" width="132" height="132"
           alt="Pip the parrot holding their claws up in a heart shape">
      <div class="hero-copy">
        <h1>Hello! Who are we helping today?</h1>
        <p>
          ${customers.length} account${customers.length === 1 ? '' : 's'} on file. Pick one to see
          invoices, the outstanding balance and a statement for any date range.
        </p>
      </div>
    </div>`;

  if (!Array.isArray(customers) || customers.length === 0) {
    setView(hero + emptyState('No customers yet', 'The billing service has no accounts on file.'));
    return;
  }

  const cards = customers
    .map(
      (c) => `
      <li>
        <a class="cust-card" href="#/customers/${seg(c.id)}">
          <div class="cust-name">${esc(c.name)}</div>
          <div class="cust-id mono">${esc(c.id)}</div>
          <p class="cust-addr">${esc(c.address)}</p>
          <div class="tags">${accountPill(c)} ${vatPill(c)}</div>
        </a>
      </li>`,
    )
    .join('');

  setView(`
    ${hero}
    ${pipSays('VAT depends on the <em>account</em>, not just the invoice — the badges on each card tell you which rules apply before you quote anything.')}
    <h2 class="visually-hidden">Customer accounts</h2>
    <ul class="cust-list">${cards}</ul>
  `);
}

/* ------------------------------------------------------------------ *
 * View: customer detail
 * ------------------------------------------------------------------ */

async function customerDetailView(id) {
  markNav('customers');
  document.title = `${id} — Thornbury Systems`;
  setView(loadingState('the customer record'));

  let customer;
  let invoices;
  try {
    [customer, invoices] = await Promise.all([
      api(`/customers/${seg(id)}`),
      api(`/customers/${seg(id)}/invoices`),
    ]);
  } catch (err) {
    setView(errorState(err, `customer ${id}`));
    return;
  }

  document.title = `${customer.name} — Thornbury Systems`;

  const unpaidCount = Array.isArray(invoices) ? invoices.filter((i) => !i.paid).length : 0;

  const rows = (invoices || [])
    .map(
      (inv) => `
      <tr>
        <th scope="row"><a class="row-link mono" href="#/invoices/${seg(inv.id)}">${esc(inv.id)}</a></th>
        <td class="date">${esc(inv.issued)}</td>
        <td>${esc(inv.source)}</td>
        <td class="num">${esc(disp(inv, 'displayNet'))}</td>
        <td class="num">${esc(disp(inv, 'displayVat'))}</td>
        <td class="num"><strong>${esc(disp(inv, 'display', 'displayTotal'))}</strong></td>
        <td>${paidPill(inv.paid)}</td>
      </tr>`,
    )
    .join('');

  const invoiceTable = rows
    ? `<div class="table-wrap">
        <table class="data">
          <caption>Amounts are exactly as issued by the billing service. Dates are issue dates, UK calendar.</caption>
          <thead>
            <tr>
              <th scope="col">Invoice</th>
              <th scope="col">Issued</th>
              <th scope="col">Source</th>
              <th scope="col" class="num">Net</th>
              <th scope="col" class="num">VAT</th>
              <th scope="col" class="num">Gross</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`
    : `<p class="note">No invoices have been raised for this account yet.</p>`;

  setView(`
    <p class="crumbs"><a href="#/customers">← All customers</a></p>
    <div class="page-head">
      <div class="grow">
        <h1>${esc(customer.name)}</h1>
        <p class="lede">
          <span class="mono">${esc(customer.id)}</span> · ${esc(customer.address)}
        </p>
        <p style="margin-top:.5rem">${accountPill(customer)} ${vatPill(customer)}</p>
      </div>
      <p><a class="btn btn-ghost" href="#/customers/${seg(customer.id)}/statement">Build a statement</a></p>
    </div>

    <section class="card" aria-labelledby="bal-h">
      <h2 id="bal-h">Where this account stands</h2>
      <dl class="figures">
        <div class="figure emphasis">
          <dt>Outstanding</dt>
          <dd>${esc(disp(customer, 'outstanding', 'displayOutstanding'))}</dd>
          <span class="sub">VAT inclusive — what the customer actually owes</span>
        </div>
        <div class="figure">
          <dt>Invoices on file</dt>
          <dd>${esc(String((invoices || []).length))}</dd>
          <span class="sub">All time</span>
        </div>
        <div class="figure">
          <dt>Unpaid invoices</dt>
          <dd>${esc(String(unpaidCount))}</dd>
          <span class="sub">Making up the balance above</span>
        </div>
      </dl>
    </section>

    <section class="card" aria-labelledby="inv-h">
      <div class="card-head">
        <h2 id="inv-h">Invoices</h2>
        <span class="hint">Gross = net + VAT, as calculated for this account</span>
      </div>
      ${invoiceTable}
    </section>

    ${pipSays('Reading a balance out to a customer? Quote the <strong>outstanding</strong> figure above — it is VAT inclusive already, so there is nothing to add on.')}
  `);
}

/* ------------------------------------------------------------------ *
 * View: single invoice
 * ------------------------------------------------------------------ */

async function invoiceView(id) {
  markNav('customers');
  document.title = `${id} — Thornbury Systems`;
  setView(loadingState('the invoice'));

  let invoice;
  try {
    invoice = await api(`/invoices/${seg(id)}`);
  } catch (err) {
    setView(errorState(err, `invoice ${id}`));
    return;
  }

  const lines = (invoice.lines || [])
    .map(
      (l) => `
      <tr>
        <th scope="row">${esc(l.description)}</th>
        <td>${esc(l.kind === 'SERVICE' ? 'Engineer work' : 'Metered supply')}</td>
        <td class="num">${esc(String(l.quantity))}</td>
      </tr>`,
    )
    .join('');

  const bands = (invoice.vatBreakdown || [])
    .map(
      (b) => `
      <tr>
        <th scope="row">${esc(String(b.ratePercent))}%</th>
        <td class="num">${esc(disp(b, 'displayNet', 'netDisplay'))}</td>
        <td class="num">${esc(disp(b, 'displayVat', 'vatDisplay'))}</td>
      </tr>`,
    )
    .join('');

  const bandTable = bands
    ? `<div class="table-wrap">
        <table class="data">
          <caption>VAT is rounded once per rate band, not per line. These are the figures finance reconcile against.</caption>
          <thead><tr><th scope="col">Rate</th><th scope="col" class="num">Net</th><th scope="col" class="num">VAT</th></tr></thead>
          <tbody>${bands}</tbody>
        </table>
      </div>`
    : `<p class="note">This invoice carries no VAT band breakdown.</p>`;

  setView(`
    <p class="crumbs">
      <a href="#/customers">All customers</a> ·
      <a href="#/customers/${seg(invoice.customerId)}">${esc(invoice.customerId)}</a>
    </p>
    <div class="page-head">
      <div class="grow">
        <h1>Invoice ${esc(invoice.id)}</h1>
        <p class="lede">
          Issued <span class="date"><strong>${esc(invoice.issued)}</strong></span> ·
          source ${esc(invoice.source)} · ${paidPill(invoice.paid)}
        </p>
      </div>
    </div>

    <section class="card">
      <h2>Totals</h2>
      <dl class="figures">
        <div class="figure"><dt>Net</dt><dd>${esc(disp(invoice, 'displayNet'))}</dd></div>
        <div class="figure"><dt>VAT</dt><dd>${esc(disp(invoice, 'displayVat'))}</dd></div>
        <div class="figure emphasis"><dt>Gross</dt><dd>${esc(disp(invoice, 'display', 'displayTotal'))}</dd><span class="sub">Amount payable</span></div>
      </dl>
    </section>

    <div class="grid-2">
      <section class="card">
        <h2>Lines</h2>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th scope="col">Description</th><th scope="col">Kind</th><th scope="col" class="num">Qty</th></tr></thead>
            <tbody>${lines || '<tr><td colspan="3">No lines on this invoice.</td></tr>'}</tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <h2>VAT bands</h2>
        ${bandTable}
      </section>
    </div>
  `);
}

/* ------------------------------------------------------------------ *
 * View: statement
 * ------------------------------------------------------------------ */

function statementForm(id, from, to) {
  return `
    <form class="rangeform" id="statement-form">
      <div class="field">
        <label for="from">From (inclusive)</label>
        <input type="date" id="from" name="from" value="${esc(from)}">
      </div>
      <div class="field">
        <label for="to">To (inclusive)</label>
        <input type="date" id="to" name="to" value="${esc(to)}">
      </div>
      <button class="btn" type="submit">Show statement</button>
      <button class="btn btn-ghost" type="button" id="clear-range">Current quarter</button>
    </form>
    <p class="note" style="margin-top:.7rem">
      Leave both boxes empty for the current quarter. Dates are UK calendar dates and both
      ends are included.
    </p>`;
}

function wireStatementForm(id) {
  const form = document.getElementById('statement-form');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const from = form.elements.from.value;
    const to = form.elements.to.value;
    const qs = [];
    if (from) qs.push('from=' + encodeURIComponent(from));
    if (to) qs.push('to=' + encodeURIComponent(to));
    location.hash = `#/customers/${seg(id)}/statement${qs.length ? '?' + qs.join('&') : ''}`;
  });
  const clear = document.getElementById('clear-range');
  if (clear) {
    clear.addEventListener('click', () => {
      location.hash = `#/customers/${seg(id)}/statement`;
    });
  }
}

/**
 * The statement endpoint is being built right now, so this renderer reads the
 * shape described in docs/statement-contract.md but stays tolerant about the
 * exact key spellings: every money value is looked up through disp(), which
 * only ever returns a preformatted string from the API.
 */
async function statementView(id, params) {
  markNav('customers');
  document.title = `Statement ${id} — Thornbury Systems`;

  const from = params.get('from') || '';
  const to = params.get('to') || '';

  const head = (extra) => `
    <p class="crumbs">
      <a href="#/customers">All customers</a> ·
      <a href="#/customers/${seg(id)}">${esc(id)}</a>
    </p>
    <div class="page-head">
      <div class="grow">
        <h1>Statement</h1>
        <p class="lede">Account <span class="mono">${esc(id)}</span>. Choose a period; the
          service works out the opening balance, the lines in the period and the closing balance.</p>
      </div>
    </div>
    <section class="card">
      <h2 class="visually-hidden">Statement period</h2>
      ${statementForm(id, from, to)}
    </section>
    ${extra}`;

  setView(head(loadingState('the statement')));
  wireStatementForm(id);

  const qs = [];
  if (from) qs.push('from=' + encodeURIComponent(from));
  if (to) qs.push('to=' + encodeURIComponent(to));
  const path = `/customers/${seg(id)}/statement${qs.length ? '?' + qs.join('&') : ''}`;

  let st;
  try {
    st = await api(path);
  } catch (err) {
    const notBuilt =
      err instanceof ApiError && err.status === 404 && /route/i.test(err.message || '');
    setView(
      head(
        notBuilt
          ? `<div class="state error" role="alert">
               <img src="${PIP}" width="120" height="120" alt="">
               <h2>The statement endpoint is not live yet</h2>
               <p>This screen is ready and waiting for
                  <span class="mono">GET /customers/:id/statement</span>. As soon as the route
                  answers, the statement will render here.</p>
               <p class="detail mono">${esc(path)}</p>
             </div>`
          : errorState(err, 'the statement'),
      ),
    );
    wireStatementForm(id);
    return;
  }

  setView(head(renderStatement(st, id)));
  wireStatementForm(id);
}

function renderStatement(st, id) {
  const period = st.period || st;
  const periodFrom = period.from || st.from || '';
  const periodTo = period.to || st.to || '';

  const lines = st.lines || st.entries || [];
  const totals = st.totals || st;
  const vatBands = st.vatSummary || st.vatBreakdown || st.vat || [];

  const lineRows = lines.length
    ? lines
        .map((l) => {
          const invId = l.invoiceId || l.id || '';
          return `
        <tr>
          <td class="date">${esc(l.issued || l.date || '')}</td>
          <th scope="row">${
            invId
              ? `<a class="row-link mono" href="#/invoices/${seg(invId)}">${esc(invId)}</a>`
              : '<span class="mono">—</span>'
          }</th>
          <td class="num">${esc(disp(l, 'displayNet', 'netDisplay'))}</td>
          <td class="num">${esc(disp(l, 'displayVat', 'vatDisplay'))}</td>
          <td class="num"><strong>${esc(
            disp(l, 'displayGross', 'displayTotal', 'display', 'grossDisplay'),
          )}</strong></td>
          <td>${paidPill(!!l.paid)}</td>
          <td class="num">${esc(
            disp(l, 'displayRunningBalance', 'displayBalance', 'runningBalanceDisplay'),
          )}</td>
        </tr>`;
        })
        .join('')
    : `<tr><td colspan="7">No invoices were issued in this period.</td></tr>`;

  const bandRows = (Array.isArray(vatBands) ? vatBands : [])
    .map(
      (b) => `
      <tr>
        <th scope="row">${esc(String(b.ratePercent !== undefined ? b.ratePercent + '%' : b.rate || '—'))}</th>
        <td class="num">${esc(disp(b, 'displayNet', 'netDisplay'))}</td>
        <td class="num">${esc(disp(b, 'displayVat', 'vatDisplay'))}</td>
      </tr>`,
    )
    .join('');

  const periodLabel =
    periodFrom || periodTo
      ? `<span class="date">${esc(periodFrom || '…')}</span> to <span class="date">${esc(periodTo || '…')}</span>`
      : 'the current quarter';

  return `
    ${pipSays(
      'A statement shows what was <em>invoiced</em>. There is no payments table yet, so it cannot show payments received, payment dates or part payments — say so if finance ask.',
    )}

    <section class="card" aria-labelledby="stmt-sum">
      <div class="card-head">
        <h2 id="stmt-sum">Period ${periodLabel}</h2>
        <span class="hint">Both dates inclusive · UK calendar</span>
      </div>
      <dl class="figures">
        <div class="figure">
          <dt>Opening balance</dt>
          <dd>${esc(disp(st, 'displayOpeningBalance', 'displayOpening', 'openingBalanceDisplay', 'openingBalance'))}</dd>
          <span class="sub">Unpaid and issued before the period</span>
        </div>
        <div class="figure">
          <dt>Invoiced (net)</dt>
          <dd>${esc(disp(totals, 'displayNet', 'netDisplay'))}</dd>
        </div>
        <div class="figure">
          <dt>VAT</dt>
          <dd>${esc(disp(totals, 'displayVat', 'vatDisplay'))}</dd>
        </div>
        <div class="figure">
          <dt>Invoiced (gross)</dt>
          <dd>${esc(disp(totals, 'displayGross', 'displayTotal', 'grossDisplay'))}</dd>
        </div>
        <div class="figure">
          <dt>Paid in period</dt>
          <dd>${esc(disp(totals, 'displayPaid', 'paidDisplay'))}</dd>
        </div>
        <div class="figure emphasis">
          <dt>Closing balance</dt>
          <dd>${esc(disp(st, 'displayClosingBalance', 'displayClosing', 'closingBalanceDisplay', 'closingBalance'))}</dd>
          <span class="sub">What is owed at the end of the period</span>
        </div>
      </dl>
    </section>

    <section class="card" aria-labelledby="stmt-lines">
      <div class="card-head">
        <h2 id="stmt-lines">Lines</h2>
        <span class="hint">One row per invoice issued in the period, oldest first</span>
      </div>
      <div class="table-wrap">
        <table class="data">
          <caption>Running balance is the balance after that line, as calculated by the service.</caption>
          <thead>
            <tr>
              <th scope="col">Issued</th>
              <th scope="col">Invoice</th>
              <th scope="col" class="num">Net</th>
              <th scope="col" class="num">VAT</th>
              <th scope="col" class="num">Gross</th>
              <th scope="col">Status</th>
              <th scope="col" class="num">Balance</th>
            </tr>
          </thead>
          <tbody>${lineRows}</tbody>
        </table>
      </div>
    </section>

    <section class="card" aria-labelledby="stmt-vat">
      <div class="card-head">
        <h2 id="stmt-vat">VAT summary</h2>
        <span class="hint">Grouped by rate band, rounded once per band</span>
      </div>
      ${
        bandRows
          ? `<div class="table-wrap"><table class="data">
              <thead><tr><th scope="col">Rate</th><th scope="col" class="num">Net</th><th scope="col" class="num">VAT</th></tr></thead>
              <tbody>${bandRows}</tbody>
            </table></div>`
          : '<p class="note">No VAT band summary was returned for this period.</p>'
      }
    </section>

    <details class="card">
      <summary><strong>Raw response</strong> — for checking a query against the service</summary>
      <pre class="mono" style="overflow:auto;max-height:22rem">${esc(JSON.stringify(st, null, 2))}</pre>
    </details>
  `;
}

/* ------------------------------------------------------------------ *
 * View: dispatch board
 * ------------------------------------------------------------------ */

async function dispatchView() {
  markNav('dispatch');
  document.title = 'Dispatch board — Thornbury Systems';
  setView(loadingState('the dispatch board'));

  let assignments;
  let orders;
  let slots;
  let customers;
  try {
    [assignments, orders, slots, customers] = await Promise.all([
      api('/dispatch'),
      api('/work-orders'),
      api('/slots'),
      api('/customers'),
    ]);
  } catch (err) {
    setView(errorState(err, 'the dispatch board'));
    return;
  }

  const orderById = new Map((orders || []).map((o) => [o.id, o]));
  const slotById = new Map((slots || []).map((s) => [s.workOrderId, s]));
  const customerById = new Map((customers || []).map((c) => [c.id, c]));

  const planned = [...(assignments || [])].sort((a, b) =>
    String(a.startsAt).localeCompare(String(b.startsAt)),
  );

  /* The UK calendar day a visit falls on. NEVER slice the stored timestamp for
     this: 2026-09-02T23:30:00Z is the 3rd in Thornbury, and slicing gives the
     2nd. That is W-4412 / JOB D, and doing it here would put the bug back in
     the browser after it was fixed in the service. /slots already carries the
     UK day, computed in Europe/London, so join to it and use that. */
  function ukDate(workOrderId, storedIso) {
    const slot = slotById.get(workOrderId);
    return (slot && slot.date) || datePart(storedIso);
  }

  /* Belt and braces. The planner now flattens addresses before comparing and
     counts days in UK local time, so a genuine clash should never reach here.
     This stays as a visible cross-check because a silent regression in that
     logic is what put two vans on Mrs Whitcombe's drive most weeks. */
  const byPlace = new Map();
  for (const a of planned) {
    const key = addressKey(a.address) + '|' + ukDate(a.workOrderId, a.startsAt);
    if (!byPlace.has(key)) byPlace.set(key, []);
    byPlace.get(key).push(a);
  }
  const clashes = [...byPlace.values()].filter((group) => group.length > 1);
  const clashing = new Set();
  clashes.forEach((group) => group.forEach((a) => clashing.add(a.workOrderId)));

  const plannedIds = new Set(planned.map((a) => a.workOrderId));
  const unplanned = (orders || []).filter(
    (o) => o.status === 'QUEUED' && !plannedIds.has(o.id),
  );

  function reasonFor(order) {
    const orderDay = ukDate(order.id, order.requestedAt);
    const sameHouse = planned.find(
      (a) =>
        addressKey(a.address) === addressKey(order.address) &&
        ukDate(a.workOrderId, a.startsAt) === orderDay,
    );
    if (sameHouse) {
      return `Folded into the visit already planned at this address on ${esc(orderDay)} (${esc(sameHouse.workOrderId)}).`;
    }
    return `No engineer on the rota holds the <strong>${esc(order.requires)}</strong> skill for this slot.`;
  }

  /* Lanes: one per engineer, in id order. */
  const lanes = new Map();
  for (const a of planned) {
    if (!lanes.has(a.engineerId)) lanes.set(a.engineerId, []);
    lanes.get(a.engineerId).push(a);
  }
  const laneIds = [...lanes.keys()].sort();

  function visitCard(a) {
    const order = orderById.get(a.workOrderId);
    const slot = slotById.get(a.workOrderId);
    const customer = order ? customerById.get(order.customerId) : null;
    const isClash = clashing.has(a.workOrderId);

    return `
      <article class="visit${isClash ? ' clash' : ''}">
        <div>
          <span class="visit-time">${esc(timePart(a.startsAt))}</span><span class="visit-tz">UTC, as stored</span>
        </div>
        <p class="visit-addr">${esc(a.address)}</p>
        <p class="visit-meta">
          <span class="mono">${esc(a.workOrderId)}</span>
          ${order ? ' · ' + `<span class="pill pill-skill">${esc(order.requires)}</span>` : ''}
        </p>
        <dl>
          <dt>Date</dt><dd class="date">${esc(ukDate(a.workOrderId, a.startsAt))}</dd>
          ${
            customer
              ? `<dt>Customer</dt><dd><a href="#/customers/${seg(customer.id)}">${esc(customer.name)}</a></dd>`
              : order
                ? `<dt>Customer</dt><dd><a href="#/customers/${seg(order.customerId)}">${esc(order.customerId)}</a></dd>`
                : ''
          }
          ${order ? `<dt>Length</dt><dd>${esc(String(order.durationMinutes))} min</dd>` : ''}
          ${slot ? `<dt>Told</dt><dd>${esc(slot.window)}</dd>` : ''}
        </dl>
        ${isClash ? '<p class="visit-meta"><strong style="color:var(--heart-dark)">Same address as another visit today.</strong></p>' : ''}
      </article>`;
  }

  const laneHtml = laneIds
    .map((eid) => {
      const visits = lanes.get(eid);
      return `
      <section class="lane" aria-labelledby="lane-${esc(eid)}">
        <div class="lane-head">
          <h3 id="lane-${esc(eid)}">Engineer <span class="mono">${esc(eid)}</span></h3>
          <span class="count">${visits.length} visit${visits.length === 1 ? '' : 's'}</span>
        </div>
        <div class="lane-body">${visits.map(visitCard).join('')}</div>
      </section>`;
    })
    .join('');

  const unplannedHtml = unplanned.length
    ? `<section class="lane unplanned" aria-labelledby="lane-unplanned">
        <div class="lane-head">
          <h3 id="lane-unplanned">Not on the board</h3>
          <span class="count">${unplanned.length}</span>
        </div>
        <div class="lane-body">
          ${unplanned
            .map((o) => {
              const customer = customerById.get(o.customerId);
              return `
              <article class="visit">
                <div><span class="visit-time">${esc(timePart(o.requestedAt))}</span><span class="visit-tz">requested, UTC</span></div>
                <p class="visit-addr">${esc(o.address)}</p>
                <p class="visit-meta"><span class="mono">${esc(o.id)}</span> · <span class="pill pill-skill">${esc(o.requires)}</span></p>
                <dl>
                  <dt>Date</dt><dd class="date">${esc(datePart(o.requestedAt))}</dd>
                  <dt>Customer</dt><dd><a href="#/customers/${seg(o.customerId)}">${esc(customer ? customer.name : o.customerId)}</a></dd>
                  <dt>Why</dt><dd>${reasonFor(o)}</dd>
                </dl>
              </article>`;
            })
            .join('')}
        </div>
      </section>`
    : '';

  const clashBanner = clashes.length
    ? `<div class="warn" role="alert">
        <h2><img src="${PIP}" width="28" height="28" alt=""> Two vans, one house</h2>
        <p class="why">
          These visits are planned at what looks like the <strong>same address on the same UK day</strong>
          once capitalisation and punctuation are ignored. The planner should already have merged
          them, so if this is showing, something has regressed. Check before the vans roll.
        </p>
        <ul>
          ${clashes
            .map(
              (group) => `<li>
                <span class="date">${esc(ukDate(group[0].workOrderId, group[0].startsAt))}</span> —
                <strong>${esc(group[0].address)}</strong>:
                ${group
                  .map(
                    (a) =>
                      `<span class="mono">${esc(a.workOrderId)}</span> at ${esc(timePart(a.startsAt))} (engineer <span class="mono">${esc(a.engineerId)}</span>)`,
                  )
                  .join(' &amp; ')}
                <br><span class="why">Written as: ${group
                  .map((a) => `“${esc(a.address)}”`)
                  .join(', ')}</span>
              </li>`,
            )
            .join('')}
        </ul>
      </div>`
    : '';

  const dates = [...new Set(planned.map((a) => ukDate(a.workOrderId, a.startsAt)))].sort();

  setView(`
    <div class="page-head">
      <div class="grow">
        <h1>Dispatch board</h1>
        <p class="lede">
          Who is going where, and when. Times on this board are the <strong>stored UTC</strong>
          times, shown exactly as the service holds them. The customer-facing window is on the
          <a href="#/slots">appointment slots</a> screen.
        </p>
      </div>
    </div>

    <section class="card">
      <dl class="figures">
        <div class="figure"><dt>Visits planned</dt><dd>${planned.length}</dd></div>
        <div class="figure"><dt>Engineers out</dt><dd>${laneIds.length}</dd></div>
        <div class="figure"><dt>Not on the board</dt><dd>${unplanned.length}</dd><span class="sub">Queued but unassigned</span></div>
        <div class="figure${clashes.length ? ' emphasis' : ''}"><dt>Possible double visits</dt><dd>${clashes.length}</dd><span class="sub">Same address, same day</span></div>
        <div class="figure"><dt>Days covered</dt><dd style="font-size:1rem">${dates.length ? esc(dates.join(', ')) : '—'}</dd></div>
      </dl>
    </section>

    ${clashBanner}

    ${
      planned.length || unplanned.length
        ? `<div class="board">${laneHtml}${unplannedHtml}</div>`
        : emptyState('Nothing to dispatch', 'There are no queued work orders on the board today.')
    }

    ${pipSays('Before you confirm a visit, glance at the address written in <em>both</em> jobs. “14 Ashfield Row” and “14 ashfield row” are the same doorstep and the planner will not always notice.')}
  `);
}

/* ------------------------------------------------------------------ *
 * View: appointment slots
 * ------------------------------------------------------------------ */

async function slotsView() {
  markNav('slots');
  document.title = 'Appointment slots — Thornbury Systems';
  setView(loadingState('the appointment slots'));

  let slots;
  let orders;
  let customers;
  try {
    [slots, orders, customers] = await Promise.all([
      api('/slots'),
      api('/work-orders'),
      api('/customers'),
    ]);
  } catch (err) {
    setView(errorState(err, 'the appointment slots'));
    return;
  }

  const orderById = new Map((orders || []).map((o) => [o.id, o]));
  const customerById = new Map((customers || []).map((c) => [c.id, c]));

  const rows = (slots || [])
    .slice()
    .sort((a, b) => {
      const byDate = String(a.date).localeCompare(String(b.date));
      if (byDate !== 0) return byDate;
      return String(a.window).localeCompare(String(b.window));
    })
    .map((s) => {
      const order = orderById.get(s.workOrderId);
      const customer = order ? customerById.get(order.customerId) : null;
      return `
      <tr>
        <td class="date">${esc(s.date)}</td>
        <td class="num"><strong>${esc(s.window)}</strong></td>
        <th scope="row" class="mono">${esc(s.workOrderId)}</th>
        <td>${
          customer
            ? `<a class="row-link" href="#/customers/${seg(customer.id)}">${esc(customer.name)}</a>`
            : order
              ? esc(order.customerId)
              : '—'
        }</td>
        <td>${order ? esc(order.address) : '—'}</td>
        <td>${order ? `<span class="pill pill-skill">${esc(order.requires)}</span>` : ''}</td>
        <td>${order ? statusPill(order.status) : ''}</td>
      </tr>`;
    })
    .join('');

  setView(`
    <div class="page-head">
      <div class="grow">
        <h1>Appointment slots</h1>
        <p class="lede">
          The window the customer has actually been given, exactly as the service words it.
          Read these out verbatim — do not translate or round them.
        </p>
      </div>
    </div>

    ${pipSays('The window is the requested time with an hour either side, plus the length of the job. If a customer says the window sounds an hour out, note the work order number and pass it on rather than adjusting it here.')}

    <section class="card">
      <div class="card-head">
        <h2>All windows</h2>
        <span class="hint">${(slots || []).length} slot${(slots || []).length === 1 ? '' : 's'} · earliest first</span>
      </div>
      ${
        rows
          ? `<div class="table-wrap">
              <table class="data">
                <caption>Windows are shown as issued by the scheduling service, unaltered.</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col" class="num">Window told to customer</th>
                    <th scope="col">Work order</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Address</th>
                    <th scope="col">Needs</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>`
          : '<p class="note">There are no appointment windows to show.</p>'
      }
    </section>
  `);
}

/* ------------------------------------------------------------------ *
 * Router
 * ------------------------------------------------------------------ */

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/customers';
  const [pathname, query = ''] = raw.split('?');
  const parts = pathname.split('/').filter(Boolean);
  return { parts, params: new URLSearchParams(query) };
}

let routeToken = 0;

async function route() {
  const token = ++routeToken;
  const { parts, params } = parseHash();

  const run = (fn) => {
    // Ignore a result if the user has navigated on in the meantime.
    Promise.resolve(fn()).catch((err) => {
      if (token === routeToken) setView(errorState(err, 'this screen'));
    });
  };

  if (parts.length === 0 || (parts[0] === 'customers' && parts.length === 1)) {
    run(customerListView);
  } else if (parts[0] === 'customers' && parts.length === 2) {
    run(() => customerDetailView(decodeURIComponent(parts[1])));
  } else if (parts[0] === 'customers' && parts.length === 3 && parts[2] === 'statement') {
    run(() => statementView(decodeURIComponent(parts[1]), params));
  } else if (parts[0] === 'invoices' && parts.length === 2) {
    run(() => invoiceView(decodeURIComponent(parts[1])));
  } else if (parts[0] === 'dispatch') {
    run(dispatchView);
  } else if (parts[0] === 'slots') {
    run(slotsView);
  } else if (parts[0] === 'work-orders') {
    location.replace('#/dispatch');
    return;
  } else {
    markNav('');
    document.title = 'Not found — Thornbury Systems';
    setView(`
      <div class="state">
        <img src="${PIP}" width="120" height="120" alt="">
        <h2>Pip cannot find that page</h2>
        <p>There is nothing at <span class="mono">${esc(location.hash)}</span>.</p>
        <p><a class="btn" href="#/customers">Back to customers</a></p>
      </div>`);
  }

  // Move focus to the main region so keyboard users land in the new view.
  if (viewEl) viewEl.focus({ preventScroll: true });
}

window.addEventListener('hashchange', route);

function start() {
  if (!location.hash) location.replace('#/customers');
  route();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
